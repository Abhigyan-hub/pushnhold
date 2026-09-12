import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { config } from './config.js'
import authRoutes from './routes/auth.js'
import eventRoutes from './routes/events.js'
import registrationRoutes from './routes/registrations.js'
import paymentRoutes, { handleWebhook } from './routes/payments.js'
import developerRoutes from './routes/developer.js'

const app = express()

app.use(helmet())
const defaultAllowedOrigins = [
  'https://cascade.mozartdev.in',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]
const allowedOrigins = [
  ...new Set(
    [...defaultAllowedOrigins, ...config.frontendOrigin.split(',')]
      .map((s) => s.trim())
      .filter(Boolean)
  ),
]

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }
      try {
        const host = new URL(origin).hostname
        if (host === 'cascade.mozartdev.in') {
          callback(null, true)
          return
        }
      } catch {
        // ignore invalid origin
      }
      callback(null, false)
    },
    credentials: true,
  })
)

app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    handleWebhook(req, res).catch(next)
  }
)

app.use(express.json({ limit: '2mb' }))

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'CASCADE API',
    health: '/api/health',
  })
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.use('/api/auth', authRoutes)
app.use('/api/events', eventRoutes)
app.use('/api/registrations', registrationRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/developer', developerRoutes)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ message: err.message || 'Server error' })
})

app.listen(config.port, config.host, () => {
  console.log(`CASCADE API listening on ${config.host}:${config.port}`)
}).on('error', (err) => {
  console.error('Failed to listen:', err)
  process.exit(1)
})
