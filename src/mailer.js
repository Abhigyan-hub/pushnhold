import nodemailer from 'nodemailer'
import { config } from './config.js'

let transporter

function getTransporter() {
  if (!config.resendApiKey) return null
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: 'resend',
        pass: config.resendApiKey,
      },
    })
  }
  return transporter
}

export async function sendMail({ to, subject, text, html }) {
  const mailer = getTransporter()
  if (!mailer) {
    console.warn('Email skipped: RESEND_API_KEY is not set')
    return { skipped: true }
  }
  if (!config.mailFrom) {
    console.warn('Email skipped: MAIL_FROM is not set')
    return { skipped: true }
  }
  const info = await mailer.sendMail({
    from: config.mailFrom,
    to,
    subject,
    text,
    html,
  })
  return { skipped: false, id: info.messageId }
}

export async function sendWelcomeEmail(user) {
  const text = `Hi ${user.full_name},\n\nYour CASCADE account is ready. You can sign in and register for events.\n\n— CASCADE Events`
  try {
    return await sendMail({
      to: user.email,
      subject: 'Welcome to CASCADE Events',
      text,
      html: `<p>Hi ${escapeHtml(user.full_name)},</p><p>Your CASCADE account is ready. You can sign in and register for events.</p><p>— CASCADE Events</p>`,
    })
  } catch (err) {
    console.error('welcome email failed', err.message)
    return { skipped: true, error: err.message }
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
