import api from './api'

const loadCheckout = () => new Promise((resolve, reject) => {
  if (window.Razorpay) return resolve()
  const current = document.querySelector('script[data-razorpay-checkout]')
  if (current) {
    current.addEventListener('load', resolve, { once: true })
    current.addEventListener('error', () => reject(new Error('Razorpay Checkout could not be loaded.')), { once: true })
    return
  }
  const script = document.createElement('script')
  script.src = 'https://checkout.razorpay.com/v1/checkout.js'
  script.async = true
  script.dataset.razorpayCheckout = 'true'
  script.onload = resolve
  script.onerror = () => reject(new Error('Razorpay Checkout could not be loaded.'))
  document.head.appendChild(script)
})

const create = async (data, idempotencyKey) => (await api.post('/payments', data, { headers: { 'Idempotency-Key': idempotencyKey } })).data.data
const list = async (params = {}) => (await api.get('/payments', { params })).data.data
const get = async (paymentId) => (await api.get(`/payments/${encodeURIComponent(paymentId)}`)).data.data
const verify = async (paymentId, data) => (await api.post(`/payments/${encodeURIComponent(paymentId)}/verify`, data)).data.data
const reconcile = async (paymentId) => (await api.post(`/payments/${encodeURIComponent(paymentId)}/reconcile`)).data.data
const refund = async (paymentId, data) => (await api.post(`/payments/${encodeURIComponent(paymentId)}/refund`, data)).data.data

const openCheckout = async (payment, { onVerified, onFailure, onDismiss } = {}) => {
  if (!payment.checkout) throw new Error('A pending Razorpay order is unavailable for checkout.')
  await loadCheckout()
  const checkout = new window.Razorpay({
    key: payment.checkout.key,
    amount: payment.checkout.amountMinorUnits,
    currency: payment.checkout.currency,
    name: 'TripBuddy',
    description: 'Trip expense settlement',
    order_id: payment.checkout.orderId,
    handler: async (response) => {
      try {
        const verified = await verify(payment.id, response)
        if (verified.verified && verified.payment.status === 'SUCCEEDED') onVerified?.(verified.payment)
        else onFailure?.('The provider has not confirmed this payment yet. Its status remains pending.')
      } catch (error) {
        onFailure?.(error.response?.data?.error?.message || 'Payment status could not be verified. Check the transaction history before retrying.')
      }
    },
    modal: { ondismiss: () => onDismiss?.() },
    theme: { color: '#4f5dd8' },
  })
  checkout.on('payment.failed', (response) => onFailure?.(response.error?.description || 'Checkout reported a failed payment. The order remains pending until the provider confirms its state.'))
  checkout.open()
}

export default { create, list, get, verify, reconcile, refund, openCheckout }
