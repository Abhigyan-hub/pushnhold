import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { query } from '../db.js'
import { publicUser, signToken, requireAuth } from '../middleware/auth.js'
import { config } from '../config.js'
import { sendVerificationEmail } from '../mailer.js'

const router = Router()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function newVerifyToken() {
  const token = crypto.randomBytes(32).toString('hex')
  return {
    token,
    hash: hashToken(token),
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }
}

function needsEmailVerification(user) {
  return !user.email_verified_at && Boolean(user.email_verify_token_hash)
}

async function issueVerification(user) {
  const { token, hash, expires } = newVerifyToken()
  await query(
    `UPDATE users
     SET email_verify_token_hash = $2, email_verify_expires_at = $3, email_verified_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [user.id, hash, expires]
  )
  const verifyUrl = `${config.frontendPublicUrl}/verify-email?token=${token}`
  const sent = await sendVerificationEmail(user, verifyUrl)
  if (sent.skipped) {
    throw new Error(
      sent.error ||
        'Could not send verification email. Set RESEND_API_KEY and MAIL_FROM on the server.'
    )
  }
}

router.post('/signup', async (req, res) => {
  const { email, password, full_name } = req.body || {}
  if (!email || !password || !full_name) {
    return res.status(400).json({ message: 'Email, password, and full name are required' })
  }
  const normalizedEmail = String(email).trim().toLowerCase()
  if (!EMAIL_RE.test(normalizedEmail)) {
    return res.status(400).json({ message: 'Enter a valid email address' })
  }
  if (String(password).length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' })
  }

  try {
    if (!config.databaseUrl) {
      return res.status(500).json({ message: 'DATABASE_URL is not set on the server' })
    }
    if (!config.jwtSecret) {
      return res.status(500).json({ message: 'JWT_SECRET is not set on the server' })
    }
    if (!config.resendApiKey || !config.mailFrom) {
      return res.status(500).json({
        message: 'Email verification is not configured. Set RESEND_API_KEY and MAIL_FROM.',
      })
    }

    const existing = await query('SELECT id, email_verified_at FROM users WHERE lower(email) = lower($1)', [
      normalizedEmail,
    ])
    if (existing.rows[0]?.email_verified_at) {
      return res.status(409).json({ message: 'An account with this email already exists' })
    }
    if (existing.rows[0] && !existing.rows[0].email_verified_at) {
      return res.status(409).json({
        message: 'This email is already registered but not confirmed. Sign in to resend the confirmation email.',
        code: 'UNVERIFIED',
      })
    }

    const password_hash = await bcrypt.hash(password, 12)
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'client')
       RETURNING id, email, full_name, avatar_url, role, created_at, updated_at`,
      [normalizedEmail, password_hash, String(full_name).trim()]
    )
    const user = rows[0]
    await issueVerification(user)
    res.status(201).json({
      ok: true,
      needs_verification: true,
      message: 'Check your inbox and confirm your email before signing in.',
    })
  } catch (err) {
    console.error('signup', err)
    const message =
      err.code === '42P01'
        ? 'Database tables are missing. SSH to EC2 and run: cd ~/pushnhold && npm run db:init'
        : err.code === '42703'
          ? 'Email columns are missing. SSH to EC2 and run: cd ~/pushnhold && npm run db:init'
          : err.message || 'Sign up failed'
    res.status(500).json({ message })
  }
})

router.post('/verify-email', async (req, res) => {
  const token = String(req.body?.token || req.query?.token || '').trim()
  if (!token) {
    return res.status(400).json({ message: 'Missing confirmation token' })
  }
  try {
    const { rows } = await query(
      `SELECT * FROM users
       WHERE email_verify_token_hash = $1
         AND email_verify_expires_at > NOW()`,
      [hashToken(token)]
    )
    const user = rows[0]
    if (!user) {
      return res.status(400).json({ message: 'This confirmation link is invalid or has expired.' })
    }
    await query(
      `UPDATE users
       SET email_verified_at = NOW(),
           email_verify_token_hash = NULL,
           email_verify_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    )
    const tokenJwt = signToken(user)
    res.json({
      ok: true,
      token: tokenJwt,
      user: publicUser({ ...user, email_verified_at: new Date() }),
      profile: publicUser({ ...user, email_verified_at: new Date() }),
    })
  } catch (err) {
    console.error('verify-email', err)
    res.status(500).json({ message: 'Could not confirm email' })
  }
})

router.post('/resend-verification', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ message: 'Enter a valid email address' })
  }
  try {
    const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email])
    const user = rows[0]
    if (user && needsEmailVerification(user)) {
      await issueVerification(user)
    }
    res.json({
      ok: true,
      message: 'If that account needs confirmation, we sent a new email.',
    })
  } catch (err) {
    console.error('resend-verification', err)
    res.status(500).json({ message: 'Could not resend confirmation email' })
  }
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' })
  }
  try {
    const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email])
    const user = rows[0]
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }
    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }
    if (needsEmailVerification(user)) {
      return res.status(403).json({
        message: 'Confirm your email before signing in. Check your inbox or resend the confirmation email.',
        code: 'UNVERIFIED',
      })
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
