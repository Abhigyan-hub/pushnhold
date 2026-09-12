/**
 * Test Resend SMTP: node scripts/send-test-email.js you@email.com
 */
import { sendMail } from '../src/mailer.js'

const to = process.argv[2]
if (!to) {
  console.error('Usage: node scripts/send-test-email.js you@email.com')
  process.exit(1)
}

const result = await sendMail({
  to,
  subject: 'CASCADE test email',
  text: 'If you received this, Resend SMTP is working.',
  html: '<p>If you received this, Resend SMTP is working.</p>',
})
console.log(result)
