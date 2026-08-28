import crypto from 'crypto'
import { Router } from 'express'
import Razorpay from 'razorpay'
import { config } from '../config.js'
import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

function getRazorpay() {
  if (!config.razorpayKeyId || !config.razorpayKeySecret) {
    return null
  }
  return new Razorpay({
    key_id: config.razorpayKeyId,
    key_secret: config.razorpayKeySecret,
  })
}

function verifySignature(orderId, paymentId, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')
  return expected === signature
}

router.post('/create-order', requireAuth, async (req, res) => {
  const { registration_id, amount, currency = 'INR' } = req.body || {}
  if (!registration_id || !amount || amount < 100) {
    return res.status(400).json({ message: 'Invalid registration_id or amount (min ₹1)' })
  }

  const razorpay = getRazorpay()
  if (!razorpay) {
    return res.status(500).json({
      message: 'Payment gateway not configured on backend. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
    })
  }

  try {
    const { rows: regs } = await query(
      'SELECT * FROM registrations WHERE id = $1 AND user_id = $2',
      [registration_id, req.user.id]
    )
    if (!regs[0]) {
      return res.status(404).json({ message: 'Registration not found' })
    }

    const { rows } = await query(
      `SELECT * FROM payments
       WHERE registration_id = $1 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [registration_id]
    )
    const payment = rows[0]
    if (!payment) {
      return res.status(400).json({ message: 'No pending payment found for this registration' })
    }

    if (payment.razorpay_order_id) {
      return res.json({
        orderId: payment.razorpay_order_id,
        amount: payment.amount_paise,
        currency,
      })
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount),
      currency,
      receipt: `reg_${registration_id}`.slice(0, 40),
      notes: { registration_id },
    })

    await query('UPDATE payments SET razorpay_order_id = $1 WHERE id = $2', [
      order.id,
      payment.id,
    ])

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    })
  } catch (error) {
    console.error('Razorpay order creation error:', error)
    let errorMessage = 'Failed to create payment order'
    if (error.message?.includes('Invalid key') || error.message?.includes('authentication')) {
      errorMessage = 'Invalid Razorpay API keys.'
    } else if (error.message) {
      errorMessage = error.message
    }
    res.status(500).json({ message: errorMessage })
  }
})

router.post('/verify', requireAuth, async (req, res) => {
  const {
    registration_id,
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
  } = req.body || {}

  if (!registration_id || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ message: 'Missing payment details' })
  }
  if (!config.razorpayKeySecret) {
    return res.status(500).json({ message: 'Server configuration error' })
  }
  if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, config.razorpayKeySecret)) {
    return res.status(400).json({ message: 'Invalid payment signature' })
  }

  try {
    const { rows } = await query(
      `SELECT p.* FROM payments p
       JOIN registrations r ON r.id = p.registration_id
       WHERE p.registration_id = $1 AND p.razorpay_order_id = $2 AND r.user_id = $3`,
      [registration_id, razorpay_order_id, req.user.id]
    )
    const payment = rows[0]
    if (!payment) return res.status(404).json({ message: 'Payment record not found' })
    if (payment.status === 'captured') {
      return res.json({ success: true, message: 'Already verified' })
    }

    await query(
      `UPDATE payments
       SET razorpay_payment_id = $1, razorpay_signature = $2, status = 'captured', verified_at = NOW()
       WHERE id = $3`,
      [razorpay_payment_id, razorpay_signature, payment.id]
    )
    res.json({ success: true })
  } catch (err) {
    console.error('verify payment', err)
    res.status(500).json({ message: 'Failed to update payment' })
  }
})

export async function handleWebhook(req, res) {
  const signature = req.headers['x-razorpay-signature']
  if (!signature || !config.razorpayWebhookSecret) {
    return res.status(400).json({ error: 'Missing signature or webhook secret' })
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body)
  const expected = crypto
    .createHmac('sha256', config.razorpayWebhookSecret)
    .update(rawBody)
    .digest('hex')

  if (expected !== signature) {
    return res.status(400).json({ error: 'Invalid webhook signature' })
  }

  const event = JSON.parse(rawBody)
  const eventType = event.event
  const payload = event.payload

  if (eventType === 'payment.captured' || eventType === 'payment.authorized') {
    const paymentEntity = payload.payment?.entity || payload.payment
    const orderId = paymentEntity?.order_id
    const paymentId = paymentEntity?.id
    if (orderId && paymentId) {
      await query(
        `UPDATE payments
         SET razorpay_payment_id = $1, status = 'captured', verified_at = NOW()
         WHERE razorpay_order_id = $2 AND status <> 'captured'`,
        [paymentId, orderId]
      )
    }
  }

  return res.status(200).json({ received: true })
}

export default router
