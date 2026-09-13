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
    replyTo: config.mailReplyTo || undefined,
    headers: {
      'X-Entity-Ref-ID': `cascade-${Date.now()}`,
      'List-Unsubscribe': `<${config.frontendPublicUrl}/privacy>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  })
  return { skipped: false, id: info.messageId }
}

export async function sendVerificationEmail(user, verifyUrl) {
  const text = `Hi ${user.full_name},

Confirm your CASCADE Events account (Department of CSE & AI, GHRSTU):

${verifyUrl}

This link expires in 24 hours. If you did not create an account, you can ignore this email.

CASCADE Events
https://cascade.mozartdev.in`
  try {
    return await sendMail({
      to: user.email,
      subject: 'Confirm your CASCADE Events account',
      text,
      html: `<p>Hi ${escapeHtml(user.full_name)},</p>
<p>Confirm your CASCADE Events account (Department of CSE &amp; AI, GHRSTU).</p>
<p><a href="${escapeHtml(verifyUrl)}">Confirm my email</a></p>
<p style="color:#666;font-size:13px">Or paste this URL into your browser:<br>${escapeHtml(verifyUrl)}</p>
<p>This link expires in 24 hours. If you did not create an account, ignore this email.</p>
<p>CASCADE Events<br><a href="https://cascade.mozartdev.in">cascade.mozartdev.in</a></p>`,
    })
  } catch (err) {
    console.error('verification email failed', err.message)
    return { skipped: true, error: err.message }
  }
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
