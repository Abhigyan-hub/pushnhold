import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { config } from './config.js'
import authRoutes from './routes/auth.js'
import eventRoutes from './routes/events.js'
import registrationRoutes from './routes/registrations.js'
import paymentRoutes, { handleWebhook } from './routes/payments.js'
import developerRoutes from './routes/developer.js'

if (!config.jwtSecret) {
  console.warn('JWT_SECRET is not set')
}

const app = express()

app.use(helmet())
const allowedOrigins = config.frontendOrigin
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }
      callback(new Error(`CORS blocked origin: ${origin}`))
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
})
