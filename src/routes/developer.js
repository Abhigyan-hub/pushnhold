import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()

router.use(requireAuth, requireRole('developer'))

router.get('/stats', async (_req, res) => {
  try {
    const [users, events, registrations, payments] = await Promise.all([
      query('SELECT COUNT(*)::int AS c FROM users'),
      query('SELECT COUNT(*)::int AS c FROM events'),
      query('SELECT COUNT(*)::int AS c FROM registrations'),
      query('SELECT COUNT(*)::int AS c FROM payments'),
    ])
    res.json({
      users: users.rows[0].c,
      events: events.rows[0].c,
      registrations: registrations.rows[0].c,
      payments: payments.rows[0].c,
    })
  } catch (err) {
    console.error('stats', err)
    res.status(500).json({ message: 'Failed to load stats' })
  }
})

router.get('/users', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 5, 100)
  try {
    const { rows } = await query(
      `SELECT id, full_name, email, role, created_at
       FROM users ORDER BY created_at DESC LIMIT $1`,
      [limit]
    )
    res.json(rows)
  } catch (err) {
    console.error('users', err)
    res.status(500).json({ message: 'Failed to load users' })
  }
})

router.get('/activity', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 100)
  try {
    const { rows } = await query(
      `SELECT a.*, json_build_object('full_name', u.full_name) AS profiles
       FROM activity_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.created_at DESC
       LIMIT $1`,
      [limit]
    )
    res.json(rows)
  } catch (err) {
    console.error('activity', err)
    res.status(500).json({ message: 'Failed to load activity' })
  }
})

export default router
