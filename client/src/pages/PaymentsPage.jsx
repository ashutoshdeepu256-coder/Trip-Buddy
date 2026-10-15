import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import paymentService from '../services/paymentService'
import { formatMoney } from '../utils/expenseMoney'
import './PaymentsPage.css'

const statusLabel = (payment) => payment.providerStatus === 'failed' && payment.status === 'PENDING' ? 'Payment failed; retry available' : payment.status.replaceAll('_', ' ').toLowerCase()

function PaymentsPage() {
  const userId = useAuthStore((state) => state.user?.id)
  const [items, setItems] = useState([])
  const [pageInfo, setPageInfo] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(async (page = 1) => {
    setLoading(true)
    setError('')
    try {
      const result = await paymentService.list({ page, limit: 20 })
      setItems(result.items)
      setPageInfo({ page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages })
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Payment history could not be loaded.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let active = true
    paymentService.list({ page: 1, limit: 20 }).then((result) => {
      if (!active) return
      setItems(result.items)
      setPageInfo({ page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages })
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.error?.message || 'Payment history could not be loaded.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const retry = async (paymentId) => {
    setBusyId(paymentId)
    try {
      const result = await paymentService.get(paymentId)
      if (!result.checkout) throw new Error('Checkout is unavailable for this payment. Reconcile its status first.')
      await paymentService.openCheckout(result, {
        onVerified: async () => { toast.success('Payment verified by Razorpay.'); await load(pageInfo.page) },
        onFailure: (message) => toast(message),
        onDismiss: () => toast('Checkout closed. Payment remains pending until Razorpay confirms its status.'),
      })
    } catch (requestError) { toast.error(requestError.response?.data?.error?.message || requestError.message || 'Checkout could not be started.') }
    finally { setBusyId('') }
  }

  const reconcile = async (paymentId) => {
    setBusyId(paymentId)
    try {
      const result = await paymentService.reconcile(paymentId)
      toast(result.payment.status === 'SUCCEEDED' ? 'Razorpay confirmed the payment.' : 'Razorpay has not confirmed payment yet.')
      await load(pageInfo.page)
    } catch (requestError) { toast.error(requestError.response?.data?.error?.message || 'Payment status could not be reconciled.') }
    finally { setBusyId('') }
  }

  const requestRefund = async (payment) => {
    const remainingRefund = payment.amountMinorUnits - (payment.refundedAmountMinorUnits || 0)
    if (!window.confirm(`Request a refund of ${formatMoney(remainingRefund, payment.currency)}? The settlement changes only after Razorpay confirms the refund and Route reversal.`)) return
    setBusyId(payment.id)
    try {
      await paymentService.refund(payment.id, { reason: 'Requested by the original payer' })
      toast.success('Refund request sent. The settlement changes only after Razorpay confirms the refund and Route reversal.')
      await load(pageInfo.page)
    } catch (requestError) { toast.error(requestError.response?.data?.error?.message || 'Refund could not be requested.') }
    finally { setBusyId('') }
  }

  return <main className="payments-page">
    <header className="payments-header"><div><span className="eyebrow">Provider verified transactions</span><h1>Payments</h1><p>Payment status comes from Razorpay verification. User-reported settlements are listed separately in each Trip ledger.</p></div><Link className="secondary-btn" to="/my-trips">Your trips</Link></header>
    <section className="payments-panel" aria-labelledby="payments-title">
      <div className="payments-panel-title"><div><h2 id="payments-title">Transaction history</h2><span>{pageInfo.total} records</span></div><button type="button" className="secondary-btn" onClick={() => load(pageInfo.page)} disabled={loading}>Refresh</button></div>
      {error && <p className="payments-error" role="alert">{error}<button type="button" onClick={() => load(pageInfo.page)}>Retry</button></p>}
      {loading ? <p role="status">Loading payment history…</p> : items.length === 0 ? <p className="payments-empty">No provider payments yet. Open a Trip expense ledger to pay a current settlement obligation.</p> : <div className="payment-list">{items.map((payment) => {
        const isPayer = payment.payerId === userId
        const canCheckout = isPayer && ['PENDING', 'AUTHORIZED'].includes(payment.status) && Boolean(payment.orderId)
        return <article className="payment-card" key={payment.id}>
          <div className="payment-card-heading"><div><span className={`payment-status ${payment.status.toLowerCase()}`}>{statusLabel(payment)}</span><h3>{isPayer ? `You paid ${payment.recipientName}` : `${payment.payerName} paid you`}</h3></div><strong>{formatMoney(payment.amountMinorUnits, payment.currency)}</strong></div>
          <p>Razorpay · {new Date(payment.createdAt).toLocaleString()} · Trip {payment.tripId}</p>
          <dl><div><dt>Payment record</dt><dd>{payment.id}</dd></div>{payment.orderId && <div><dt>Provider order</dt><dd>{payment.orderId}</dd></div>}{payment.paymentId && <div><dt>Provider payment</dt><dd>{payment.paymentId}</dd></div>}{payment.refundId && <div><dt>Provider refund</dt><dd>{payment.refundId}</dd></div>}</dl>
          <div className="payment-actions"><Link to={`/trips/${payment.tripId}/expenses`}>Open Trip ledger</Link>{canCheckout && <button type="button" disabled={busyId === payment.id} onClick={() => retry(payment.id)}>{busyId === payment.id ? 'Opening…' : payment.providerStatus === 'failed' ? 'Retry checkout' : 'Continue checkout'}</button>}{isPayer && ['PENDING', 'AUTHORIZED', 'TRANSFER_PENDING', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'FAILED'].includes(payment.status) && <button type="button" disabled={busyId === payment.id} onClick={() => reconcile(payment.id)}>{busyId === payment.id ? 'Checking…' : 'Check provider status'}</button>}{isPayer && ['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status) && <button type="button" disabled={busyId === payment.id} onClick={() => requestRefund(payment)}>{payment.status === 'PARTIALLY_REFUNDED' ? 'Refund remaining amount' : 'Request full refund'}</button>}{isPayer && payment.status === 'FAILED' && payment.paymentId && payment.providerStatus?.startsWith('transfer_') && <button type="button" disabled={busyId === payment.id} onClick={() => requestRefund(payment)}>Request payer refund</button>}</div>
          {payment.status === 'PENDING' && <small className="payment-hint">A failed Checkout attempt does not release this reserved balance. Reuse this order or reconcile it before starting another payment.</small>}
          {payment.status === 'TRANSFER_PENDING' && <small className="payment-hint">Razorpay captured the payment, but has not confirmed the recipient transfer. The settlement remains outstanding.</small>}
          {payment.status === 'PARTIALLY_REFUNDED' && <small className="payment-hint">The verified settlement was reduced by the confirmed refund. {formatMoney(payment.refundedAmountMinorUnits, payment.currency)} has been refunded.</small>}
          {payment.status === 'FAILED' && payment.providerStatus?.startsWith('transfer_') && <small className="payment-hint">The recipient transfer failed or was reversed. The Trip balance remains outstanding; request a refund of the captured payment.</small>}
          {payment.status === 'REFUND_PENDING' && <small className="payment-hint">The settlement remains recorded until a verified full refund is confirmed.</small>}
        </article>
      })}</div>}
      <nav className="payments-pagination" aria-label="Payment history pages"><button type="button" className="secondary-btn" disabled={loading || pageInfo.page <= 1} onClick={() => load(pageInfo.page - 1)}>Previous</button><span>Page {pageInfo.page} of {Math.max(pageInfo.totalPages, 1)}</span><button type="button" className="secondary-btn" disabled={loading || pageInfo.page >= pageInfo.totalPages} onClick={() => load(pageInfo.page + 1)}>Next</button></nav>
    </section>
  </main>
}

export default PaymentsPage
