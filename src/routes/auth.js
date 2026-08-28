import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { query } from '../db.js'
import { publicUser, signToken, requireAuth } from '../middleware/auth.js'

const router = Router()

router.post('/signup', async (req, res) => {
  const { email, password, full_name } = req.body || {}
  if (!email || !password || !full_name) {
    return res.status(400).json({ message: 'Email, password, and full name are required' })
  }
  if (String(password).length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' })
  }

  try {
    const existing = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [email])
    if (existing.rows[0]) {
      return res.status(409).json({ message: 'An account with this email already exists' })
    }
    const password_hash = await bcrypt.hash(password, 12)
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'client')
       RETURNING id, email, full_name, avatar_url, role, created_at, updated_at`,
      [email.trim().toLowerCase(), password_hash, full_name.trim()]
    )
    const user = rows[0]
    const token = signToken(user)
    res.status(201).json({ token, user: publicUser(user), profile: publicUser(user) })
  } catch (err) {
    console.error('signup', err)
    res.status(500).json({ message: 'Sign up failed' })
  }
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' })
  }
  try {
    const { rows } = await query(
      'SELECT * FROM users WHERE lower(email) = lower($1)',
      [email]
    )
    const user = rows[0]
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }
    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }
    const token = signToken(user)
    res.json({ token, user: publicUser(user), profile: publicUser(user) })
  } catch (err) {
    console.error('login', err)
    res.status(500).json({ message: 'Sign in failed' })
  }
})

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), profile: publicUser(req.user) })
})

router.post('/logout', (_req, res) => {
  res.json({ ok: true })
})

export default router
