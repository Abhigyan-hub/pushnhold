import { Router } from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { query } from '../db.js'
import {
  requireAuth,
  requireRole,
  optionalAuth,
  canManageEvent,
  requireEventManager,
  logActivity,
} from '../middleware/auth.js'
import { deleteEventImage, uploadEventImage, withImageUrls } from '../s3.js'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
})

async function loadImages(eventId) {
  const { rows } = await query(
    'SELECT id, event_id, storage_path, sort_order, created_at FROM event_images WHERE event_id = $1 ORDER BY sort_order',
    [eventId]
  )
  return withImageUrls(rows)
}

async function loadFields(eventId) {
  const { rows } = await query(
    'SELECT * FROM event_form_fields WHERE event_id = $1 ORDER BY sort_order',
    [eventId]
  )
  return rows
}

router.get('/', async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT e.*, json_build_object('full_name', u.full_name) AS profiles
       FROM events e
       JOIN users u ON u.id = e.created_by
       WHERE e.is_published = true
       ORDER BY e.event_date ASC`
    )
    const events = await Promise.all(
      rows.map(async (e) => ({
        ...e,
        event_images: await loadImages(e.id),
      }))
    )
    res.json(events)
  } catch (err) {
    console.error('list events', err)
    res.status(500).json({ message: 'Failed to load events' })
  }
})

router.get('/admin/mine', requireAuth, requireRole('admin', 'developer'), async (req, res) => {
  try {
    const sql =
      req.user.role === 'developer'
        ? `SELECT e.id, e.name, e.event_date, e.fee_amount, e.is_published, e.created_at
           FROM events e ORDER BY e.created_at DESC`
        : `SELECT DISTINCT e.id, e.name, e.event_date, e.fee_amount, e.is_published, e.created_at
           FROM events e
           LEFT JOIN event_admins ea ON ea.event_id = e.id AND ea.admin_id = $1
           WHERE e.created_by = $1 OR ea.admin_id IS NOT NULL
           ORDER BY e.created_at DESC`
    const { rows } =
      req.user.role === 'developer' ? await query(sql) : await query(sql, [req.user.id])

    const eventIds = rows.map((e) => e.id)
    let totalRegistrations = 0
    let pendingCount = 0
    if (eventIds.length) {
      const totals = await query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
         FROM registrations WHERE event_id = ANY($1::uuid[])`,
        [eventIds]
      )
      totalRegistrations = totals.rows[0]?.total || 0
      pendingCount = totals.rows[0]?.pending || 0
    }
    res.json({ events: rows, stats: { totalRegistrations, pendingCount } })
  } catch (err) {
    console.error('admin events', err)
    res.status(500).json({ message: 'Failed to load events' })
  }
})

router.get('/:eventId', optionalAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT e.*, json_build_object('full_name', u.full_name) AS organizer
       FROM events e
       JOIN users u ON u.id = e.created_by
       WHERE e.id = $1`,
      [req.params.eventId]
    )
    const event = rows[0]
    if (!event) return res.status(404).json({ message: 'Event not found' })

    const canSeeDraft = req.user && (await canManageEvent(req.user, event.id))
    if (!event.is_published && !canSeeDraft) {
      return res.status(404).json({ message: 'Event not found' })
    }

    const [images, form_fields] = await Promise.all([
      loadImages(event.id),
      loadFields(event.id),
    ])

    let already_registered = false
    if (req.user) {
      const reg = await query(
        'SELECT id FROM registrations WHERE event_id = $1 AND user_id = $2',
        [event.id, req.user.id]
      )
      already_registered = !!reg.rows[0]
    }

    res.json({
      ...event,
      event_images: images,
      images,
      form_fields,
      already_registered,
    })
  } catch (err) {
    console.error('get event', err)
    res.status(500).json({ message: 'Failed to load event' })
  }
})

router.post('/', requireAuth, requireRole('admin', 'developer'), async (req, res) => {
  const {
    name,
    description,
    fee_amount,
    event_date,
    venue,
    max_registrations,
    is_published,
    form_fields,
  } = req.body || {}

  if (!name || !event_date) {
    return res.status(400).json({ message: 'Name and event date are required' })
  }

  try {
    const { rows } = await query(
      `INSERT INTO events (created_by, name, description, fee_amount, event_date, venue, max_registrations, is_published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.user.id,
        name,
        description || null,
        Number(fee_amount) || 0,
        event_date,
        venue || null,
        max_registrations ? Number(max_registrations) : null,
        !!is_published,
      ]
    )
    const event = rows[0]

    if (Array.isArray(form_fields) && form_fields.length) {
      for (let i = 0; i < form_fields.length; i++) {
        const f = form_fields[i]
        await query(
          `INSERT INTO event_form_fields (event_id, field_key, field_label, field_type, options, is_required, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            event.id,
            String(f.field_key || `field_${i}`).replace(/\s/g, '_'),
            f.field_label,
            f.field_type,
            f.options ? JSON.stringify(f.options) : null,
            f.is_required !== false,
            i,
          ]
        )
      }
    }

    await logActivity(req.user.id, 'created event', 'event', event.id)
    res.status(201).json(event)
  } catch (err) {
    console.error('create event', err)
    res.status(500).json({ message: 'Failed to create event' })
  }
})

router.put('/:eventId', requireAuth, requireEventManager, async (req, res) => {
  const {
    name,
    description,
    fee_amount,
    event_date,
    venue,
    max_registrations,
    is_published,
    form_fields,
  } = req.body || {}

  try {
    const { rows } = await query(
      `UPDATE events SET
         name = COALESCE($2, name),
         description = $3,
         fee_amount = COALESCE($4, fee_amount),
         event_date = COALESCE($5, event_date),
         venue = $6,
         max_registrations = $7,
         is_published = COALESCE($8, is_published)
       WHERE id = $1
       RETURNING *`,
      [
        req.params.eventId,
        name,
        description ?? null,
        fee_amount != null ? Number(fee_amount) : null,
        event_date,
        venue ?? null,
        max_registrations ? Number(max_registrations) : null,
        is_published,
      ]
    )
    if (!rows[0]) return res.status(404).json({ message: 'Event not found' })

    if (Array.isArray(form_fields)) {
      await query('DELETE FROM event_form_fields WHERE event_id = $1', [req.params.eventId])
      for (let i = 0; i < form_fields.length; i++) {
        const f = form_fields[i]
        await query(
          `INSERT INTO event_form_fields (event_id, field_key, field_label, field_type, options, is_required, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            req.params.eventId,
            String(f.field_key || `field_${i}`).replace(/\s/g, '_'),
            f.field_label,
            f.field_type,
            f.options ? JSON.stringify(f.options) : null,
            f.is_required !== false,
            i,
          ]
        )
      }
    }

    await logActivity(req.user.id, 'updated event', 'event', req.params.eventId)
    res.json(rows[0])
  } catch (err) {
    console.error('update event', err)
    res.status(500).json({ message: 'Failed to update event' })
  }
})

router.delete('/:eventId', requireAuth, requireEventManager, async (req, res) => {
  try {
    const images = await loadImages(req.params.eventId)
    for (const img of images) {
      await deleteEventImage(img.storage_path)
    }
    await query('DELETE FROM events WHERE id = $1', [req.params.eventId])
    await logActivity(req.user.id, 'deleted event', 'event', req.params.eventId)
    res.json({ ok: true })
  } catch (err) {
    console.error('delete event', err)
    res.status(500).json({ message: 'Failed to delete event' })
  }
})

router.post(
  '/:eventId/images',
  requireAuth,
  requireEventManager,
  upload.array('images', 10),
  async (req, res) => {
    try {
      const files = req.files || []
      if (!files.length) return res.status(400).json({ message: 'No images uploaded' })

      const existing = await query(
        'SELECT COALESCE(MAX(sort_order), -1) AS max FROM event_images WHERE event_id = $1',
        [req.params.eventId]
      )
      let sort = Number(existing.rows[0]?.max ?? -1) + 1
      const created = []

      for (const file of files) {
        const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase()
        const key = `events/${req.params.eventId}/${randomUUID()}.${ext}`
        await uploadEventImage(key, file.buffer, file.mimetype)
        const { rows } = await query(
          `INSERT INTO event_images (event_id, storage_path, sort_order)
           VALUES ($1, $2, $3) RETURNING *`,
          [req.params.eventId, key, sort]
        )
        sort += 1
        created.push(rows[0])
      }

      res.status(201).json(withImageUrls(created))
    } catch (err) {
      console.error('upload images', err)
      res.status(500).json({ message: err.message || 'Failed to upload images' })
    }
  }
)

router.delete('/:eventId/images/:imageId', requireAuth, requireEventManager, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM event_images WHERE id = $1 AND event_id = $2',
      [req.params.imageId, req.params.eventId]
    )
    const img = rows[0]
    if (!img) return res.status(404).json({ message: 'Image not found' })
    await deleteEventImage(img.storage_path)
    await query('DELETE FROM event_images WHERE id = $1', [img.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('delete image', err)
    res.status(500).json({ message: 'Failed to delete image' })
  }
})

export default router
