import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const backendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(backendRoot, '.env')
const envResult = dotenv.config({ path: envPath, override: true, quiet: true })

if (envResult.error && envResult.error.code === 'ENOENT') {
  console.warn(`No .env file at ${envPath}`)
  console.warn('Create .env next to package.json (this folder) with DATABASE_URL and JWT_SECRET.')
} else {
  const loaded = envResult.parsed ? Object.keys(envResult.parsed).length : 0
  console.log(`Env file ${envPath} (${loaded} keys)`)
}

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: String(process.env.JWT_SECRET || '').trim(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  frontendOrigin:
    process.env.FRONTEND_ORIGIN ||
    'https://cascade.mozartdev.in,http://localhost:5173,http://127.0.0.1:5173',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  awsRegion: process.env.AWS_REGION || 'eu-north-1',
  s3Bucket: process.env.S3_BUCKET,
  s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL || '',
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  mailFrom: process.env.MAIL_FROM || '',
  smtpHost: process.env.SMTP_HOST || 'smtp.resend.com',
  smtpPort: Number(process.env.SMTP_PORT || 465),
}

if (!config.databaseUrl) {
  console.warn('DATABASE_URL is not set')
}
if (!config.jwtSecret) {
  console.warn('JWT_SECRET is not set')
}
