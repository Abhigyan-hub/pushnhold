import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { query } from '../db.js'

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  )
}

export function publicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    return res.status(401).json({ message: 'Authentication required' })
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    const { rows } = await query(
      'SELECT id, email, full_name, avatar_url, role, created_at, updated_at FROM users WHERE id = $1',
      [payload.sub]
    )
    if (!rows[0]) {
      return res.status(401).json({ message: 'User not found' })
    }
    req.user = rows[0]
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}

export function optionalAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return next()
  jwt.verify(token, config.jwtSecret, async (err, payload) => {
    if (err || !payload?.sub) return next()
    try {
      const { rows } = await query(
        'SELECT id, email, full_name, avatar_url, role, created_at, updated_at FROM users WHERE id = $1',
        [payload.sub]
      )
      req.user = rows[0] || null
    } catch {
      req.user = null
    }
    next()
  })
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Authentication required' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' })
    }
    next()
  }
}

export async function canManageEvent(user, eventId) {
  if (!user) return false
  if (user.role === 'developer') return true
  if (user.role !== 'admin') return false
  const { rows } = await query(
    `SELECT e.id
     FROM events e
     LEFT JOIN event_admins ea ON ea.event_id = e.id AND ea.admin_id = $1
     WHERE e.id = $2 AND (e.created_by = $1 OR ea.admin_id IS NOT NULL)`,
    [user.id, eventId]
  )
  return rows.length > 0
}

export async function requireEventManager(req, res, next) {
  const eventId = req.params.eventId || req.params.id
  const ok = await canManageEvent(req.user, eventId)
  if (!ok) return res.status(403).json({ message: 'You cannot manage this event' })
  next()
}

export async function logActivity(actorId, action, entityType, entityId, metadata = {}) {
  try {
    await query(
      `INSERT INTO activity_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [actorId, action, entityType, entityId, JSON.stringify(metadata)]
    )
  } catch (err) {
    console.error('activity log failed', err)
  }
}
