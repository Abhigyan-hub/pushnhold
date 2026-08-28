import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireRole, canManageEvent, logActivity } from '../middleware/auth.js'

const router = Router()

router.get('/event/:eventId', requireAuth, requireRole('admin', 'developer'), async (req, res) => {
  const ok = await canManageEvent(req.user, req.params.eventId)
  if (!ok) return res.status(403).json({ message: 'Forbidden' })

  try {
    const event = await query('SELECT id, name FROM events WHERE id = $1', [req.params.eventId])
    if (!event.rows[0]) return res.status(404).json({ message: 'Event not found' })

    const { rows } = await query(
      `SELECT r.id, r.form_data, r.status, r.status_notes, r.status_updated_at, r.created_at,
              json_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email) AS profiles
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       WHERE r.event_id = $1
       ORDER BY r.created_at DESC`,
      [req.params.eventId]
    )
    res.json({ event: event.rows[0], registrations: rows })
  } catch (err) {
    console.error('event registrations', err)
    res.status(500).json({ message: 'Failed to load registrations' })
  }
})

router.get('/user/:userId/history', requireAuth, requireRole('admin', 'developer'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT r.id, r.status, r.created_at,
              json_build_object('id', e.id, 'name', e.name, 'event_date', e.event_date, 'fee_amount', e.fee_amount) AS events
       FROM registrations r
       JOIN events e ON e.id = r.event_id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC`,
      [req.params.userId]
    )
    res.json(rows)
  } catch (err) {
    console.error('user history', err)
    res.status(500).json({ message: 'Failed to load history' })
  }
})

router.get('/mine', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT r.id, r.status, r.created_at, r.form_data,
              json_build_object(
                'id', e.id,
                'name', e.name,
                'event_date', e.event_date,
                'fee_amount', e.fee_amount
              ) AS events,
              COALESCE((
                SELECT json_agg(json_build_object('status', p.status, 'amount_paise', p.amount_paise) ORDER BY p.created_at DESC)
                FROM payments p WHERE p.registration_id = r.id
              ), '[]'::json) AS payments
       FROM registrations r
       JOIN events e ON e.id = r.event_id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    )
    res.json(rows)
  } catch (err) {
    console.error('mine registrations', err)
    res.status(500).json({ message: 'Failed to load registrations' })
  }
})

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT r.*, 
              json_build_object(
                'id', e.id, 'name', e.name, 'event_date', e.event_date, 'fee_amount', e.fee_amount
              ) AS event
       FROM registrations r
       JOIN events e ON e.id = r.event_id
       WHERE r.id = $1`,
      [req.params.id]
    )
    const reg = rows[0]
    if (!reg) return res.status(404).json({ message: 'Registration not found' })

    const manager = await canManageEvent(req.user, reg.event_id)
    if (reg.user_id !== req.user.id && !manager) {
      return res.status(403).json({ message: 'Forbidden' })
    }

    const pays = await query(
      'SELECT * FROM payments WHERE registration_id = $1 ORDER BY created_at DESC',
      [reg.id]
    )
    res.json({ ...reg, payments: pays.rows, payment: pays.rows[0] || null })
  } catch (err) {
    console.error('get registration', err)
    res.status(500).json({ message: 'Failed to load registration' })
  }
})

router.post('/', requireAuth, async (req, res) => {
  const { event_id, form_data } = req.body || {}
  if (!event_id) return res.status(400).json({ message: 'event_id is required' })

  try {
    const { rows: events } = await query(
      'SELECT * FROM events WHERE id = $1 AND is_published = true',
      [event_id]
    )
    const event = events[0]
    if (!event) return res.status(404).json({ message: 'Event not found' })

    const existing = await query(
      'SELECT id FROM registrations WHERE event_id = $1 AND user_id = $2',
      [event_id, req.user.id]
    )
    if (existing.rows[0]) {
      return res.status(409).json({ message: 'You have already registered for this event.' })
    }

    if (event.max_registrations) {
      const count = await query(
        'SELECT COUNT(*)::int AS c FROM registrations WHERE event_id = $1',
        [event_id]
      )
      if (count.rows[0].c >= event.max_registrations) {
        return res.status(400).json({ message: 'This event is full' })
      }
    }

    const { rows } = await query(
      `INSERT INTO registrations (event_id, user_id, form_data, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [event_id, req.user.id, JSON.stringify(form_data || {})]
    )
    const registration = rows[0]
    let payment = null

    if (event.fee_amount > 0) {
      const pay = await query(
        `INSERT INTO payments (registration_id, amount_paise, status)
         VALUES ($1, $2, 'pending') RETURNING *`,
        [registration.id, event.fee_amount]
      )
      payment = pay.rows[0]
    }

    await logActivity(req.user.id, 'registered', 'registration', registration.id, { event_id })
    res.status(201).json({ registration, payment, event })
  } catch (err) {
    console.error('create registration', err)
    res.status(500).json({ message: 'Registration failed' })
  }
})

router.patch('/:id/status', requireAuth, requireRole('admin', 'developer'), async (req, res) => {
  const { status, notes } = req.body || {}
  if (!['pending', 'accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' })
  }

  try {
    const { rows } = await query('SELECT * FROM registrations WHERE id = $1', [req.params.id])
    const reg = rows[0]
    if (!reg) return res.status(404).json({ message: 'Registration not found' })

    const ok = await canManageEvent(req.user, reg.event_id)
    if (!ok) return res.status(403).json({ message: 'Forbidden' })

    const updated = await query(
      `UPDATE registrations
       SET status = $2, status_notes = $3, status_updated_by = $4, status_updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, status, notes || null, req.user.id]
    )
    await logActivity(req.user.id, `${status} registration`, 'registration', req.params.id, {
      event_id: reg.event_id,
    })
    res.json(updated.rows[0])
  } catch (err) {
    console.error('update status', err)
    res.status(500).json({ message: 'Failed to update status' })
  }
})

export default router
