import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'
import expenseService from '../../services/expenseService'
import { currencies, formatMoney, parseMinorUnits, previewSplit } from '../../utils/expenseMoney'
import './TripExpenses.css'

const categories = ['ACCOMMODATION', 'TRANSPORT', 'FOOD', 'ACTIVITY', 'OTHER']
const emptyForm = () => ({ description: '', category: 'FOOD', amount: '', currency: 'INR', expenseDate: new Date().toISOString().slice(0, 10), splitMethod: 'EQUAL', privateNote: '' })
const formatMinorInput = (amount) => `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`
const fetchLedgerData = (tripId, page) => Promise.all([
  expenseService.summary(tripId), expenseService.participants(tripId),
  expenseService.list(tripId, { page, limit: 20, includeVoided: 'true' }),
  expenseService.settlements(tripId, { page: 1, limit: 50 }), expenseService.suggestions(tripId),
])

function TripExpenses() {
  const { tripId } = useParams()
  const currentUserId = useAuthStore((state) => state.user?.id)
  const [trip, setTrip] = useState(null)
  const [members, setMembers] = useState([])
  const [expenses, setExpenses] = useState([])
  const [settlements, setSettlements] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [form, setForm] = useState(emptyForm)
  const [selectedMembers, setSelectedMembers] = useState([])
  const [splitValues, setSplitValues] = useState({})
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async (page = 1) => {
    setLoading(true)
    setError('')
    try {
      const [summary, participantResult, expenseResult, settlementResult, suggestionResult] = await fetchLedgerData(tripId, page)
      setTrip(summary.trip)
      setMembers(participantResult.items)
      setExpenses(expenseResult.items)
      setSettlements(settlementResult.items)
      setSuggestions(suggestionResult.items)
      setPagination({ page: expenseResult.page, limit: expenseResult.limit, total: expenseResult.total, totalPages: expenseResult.totalPages })
      setSelectedMembers((current) => {
        const activeIds = new Set(participantResult.items.map((member) => member.userId))
        const retained = current.filter((userId) => activeIds.has(userId))
        return retained.length ? retained : participantResult.items.map((member) => member.userId)
      })
    } catch (requestError) {
      setError(requestError.response?.status === 403 || requestError.response?.status === 404
        ? 'You need current active Trip membership to access this expense ledger.'
        : 'The expense ledger could not be loaded. Check your connection and retry.')
    } finally { setLoading(false) }
  }, [tripId])

  useEffect(() => {
    let active = true
    fetchLedgerData(tripId, 1).then(([summary, participantResult, expenseResult, settlementResult, suggestionResult]) => {
      if (!active) return
      setError('')
      setTrip(summary.trip)
      setMembers(participantResult.items)
      setExpenses(expenseResult.items)
      setSettlements(settlementResult.items)
      setSuggestions(suggestionResult.items)
      setPagination({ page: expenseResult.page, limit: expenseResult.limit, total: expenseResult.total, totalPages: expenseResult.totalPages })
      setSelectedMembers((current) => {
        const activeIds = new Set(participantResult.items.map((member) => member.userId))
        const retained = current.filter((userId) => activeIds.has(userId))
        return retained.length ? retained : participantResult.items.map((member) => member.userId)
      })
    }).catch((requestError) => {
      if (!active) return
      setError(requestError.response?.status === 403 || requestError.response?.status === 404
        ? 'You need current active Trip membership to access this expense ledger.'
        : 'The expense ledger could not be loaded. Check your connection and retry.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [tripId])

  const amountMinorUnits = parseMinorUnits(form.amount)
  const splitRows = useMemo(() => selectedMembers.map((userId) => {
    const values = splitValues[userId] || {}
    return {
      userId,
      ...(form.splitMethod === 'EXACT' ? { amountMinorUnits: parseMinorUnits(values.exactAmount, { allowZero: true }) } : {}),
      ...(form.splitMethod === 'PERCENTAGE' ? { basisPoints: Number.isFinite(Number(values.percentage)) ? Math.round(Number(values.percentage) * 100) : 0 } : {}),
      ...(form.splitMethod === 'WEIGHTED' ? { shares: Number(values.shares) } : {}),
    }
  }), [selectedMembers, splitValues, form.splitMethod])
  const preview = useMemo(() => previewSplit(amountMinorUnits, form.splitMethod, splitRows), [amountMinorUnits, form.splitMethod, splitRows])
  const isOwner = trip?.creatorId === currentUserId

  const resetForm = () => { setForm(emptyForm()); setSelectedMembers(members.map((member) => member.userId)); setSplitValues({}); setEditing(null) }
  const setSplitValue = (userId, field, value) => setSplitValues((current) => ({ ...current, [userId]: { ...current[userId], [field]: value } }))
  const toggleMember = (userId) => {
    setSelectedMembers((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId])
  }

  const editExpense = (expense) => {
    setEditing(expense)
    setForm({ description: expense.description, category: expense.category, amount: formatMinorInput(expense.amountMinorUnits), currency: expense.currency, expenseDate: new Date(expense.expenseDate).toISOString().slice(0, 10), splitMethod: 'EXACT', privateNote: expense.privateNote || '' })
    const activeIds = new Set(members.map((member) => member.userId))
    const selected = expense.allocations.map((allocation) => allocation.userId).filter((userId) => activeIds.has(userId))
    setSelectedMembers(selected)
    setSplitValues(Object.fromEntries(expense.allocations.filter((allocation) => activeIds.has(allocation.userId)).map((allocation) => [allocation.userId, { exactAmount: formatMinorInput(allocation.amountMinorUnits) }])))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const allocationInput = () => {
    if (!preview) throw new Error(form.splitMethod === 'EXACT' ? 'Enter exact shares that add up to the expense amount.' : form.splitMethod === 'PERCENTAGE' ? 'Percentages must add up to exactly 100.00%.' : 'Enter a valid amount and select participants.')
    return selectedMembers.map((userId) => ({
      userId,
      ...(form.splitMethod === 'EXACT' ? { amountMinorUnits: preview.find((item) => item.userId === userId).amountMinorUnits } : {}),
      ...(form.splitMethod === 'PERCENTAGE' ? { basisPoints: Math.round(Number(splitValues[userId]?.percentage) * 100) } : {}),
      ...(form.splitMethod === 'WEIGHTED' ? { shares: Number(splitValues[userId]?.shares) } : {}),
    }))
  }

  const submitExpense = async (event) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const data = { description: form.description, category: form.category, amountMinorUnits, currency: form.currency, expenseDate: form.expenseDate, splitMethod: form.splitMethod, participants: allocationInput(), privateNote: form.privateNote }
      if (editing) {
        const updated = await expenseService.update(tripId, editing.id, { ...data, expectedRevision: editing.revision })
        toast.success('Expense updated.')
        setExpenses((current) => current.map((item) => item.id === updated.id ? updated : item))
      } else {
        await expenseService.create(tripId, data, crypto.randomUUID())
        toast.success('Expense added to the Trip ledger.')
      }
      resetForm()
      await load(pagination.page)
    } catch (requestError) { toast.error(requestError.response?.data?.error?.message || requestError.message || 'Could not save this expense. Please retry.') }
    finally { setSaving(false) }
  }

  const voidExpense = async (expense) => {
    if (!window.confirm(`Void “${expense.description}”? Its financial history will remain visible to active Trip members.`)) return
    setSaving(true)
    try {
      await expenseService.voidExpense(tripId, expense.id, { expectedRevision: expense.revision, reason: 'Voided by an authorized Trip participant' })
      toast.success('Expense voided; it is excluded from balances.')
      await load(pagination.page)
    } catch (requestError) { toast.error(requestError.response?.data?.error?.message || 'Could not void this expense.') }
    finally { setSaving(false) }
  }

  const recordSuggestion = async (suggestion) => {
    setSaving(true)
    try {
      await expenseService.recordSettlement(tripId, { toUserId: suggestion.toUserId, amountMinorUnits: suggestion.amountMinorUnits, currency: suggestion.currency, note: 'Recorded from a TripBuddy suggestion' }, crypto.randomUUID())
      toast.success('User-reported settlement recorded. No money was transferred by TripBuddy.')
      await load(pagination.page)
    } catch (requestError) { toast.error(requestError.response?.data?.error?.message || 'Could not record this settlement.') }
    finally { setSaving(false) }
  }

  const reverseSettlement = async (settlement) => {
    if (!window.confirm('Reverse this user-reported settlement record?')) return
    setSaving(true)
    try {
      await expenseService.reverseSettlement(tripId, settlement.id, { reason: 'Reporter corrected the settlement record' })
      toast.success('Settlement record reversed; balances were recalculated.')
      await load(pagination.page)
    } catch (requestError) { toast.error(requestError.response?.data?.error?.message || 'Could not reverse this settlement.') }
    finally { setSaving(false) }
  }

  if ((loading || trip?.id !== tripId) && !error) return <main className="expense-page"><p role="status">Loading Trip expense ledger…</p></main>
  if (error && trip?.id !== tripId) return <main className="expense-page"><div className="expense-error" role="alert">{error}<button type="button" className="secondary-btn" onClick={() => load(1)}>Retry</button><Link to="/my-trips">Back to my trips</Link></div></main>

  return (
    <main className="expense-page">
      <header className="expense-header"><div><Link to={`/trips/${tripId}`} className="expense-back">← {trip?.title || 'Trip'}</Link><span className="eyebrow">Shared trip ledger</span><h1>Expenses</h1><p>Amounts use integer minor units. Each currency is balanced separately.</p></div><span className="expense-access-label">Active Trip members only</span></header>
      {error && <div className="expense-error" role="alert">{error}<button type="button" className="secondary-btn" onClick={() => load(pagination.page)}>Retry</button></div>}
      <section className="expense-summary" aria-labelledby="expense-summary-title">
        <div className="expense-section-title"><div><span className="eyebrow">Server calculated</span><h2 id="expense-summary-title">Balances by currency</h2></div><span className="expense-revision">Ledger revision {trip?.revision ?? 0}</span></div>
        {!trip?.currencies?.length ? <p className="expense-empty">No expenses have been recorded for this Trip.</p> : <div className="balance-grid">{trip.currencies.map((ledger) => <article className="balance-card" key={ledger.currency}><h3>{ledger.currency} · {formatMoney(ledger.totalExpenseMinorUnits, ledger.currency)} recorded shares</h3>{ledger.members.map((member) => <div className="balance-row" key={member.userId}><span>{member.name}{member.userId === currentUserId ? ' (you)' : ''}</span><strong className={member.netMinorUnits > 0 ? 'credit' : member.netMinorUnits < 0 ? 'debit' : ''}>{member.netMinorUnits > 0 ? 'gets back ' : member.netMinorUnits < 0 ? 'owes ' : ''}{formatMoney(Math.abs(member.netMinorUnits), ledger.currency)}</strong><small>paid {formatMoney(member.paidMinorUnits, ledger.currency)} · share {formatMoney(member.shareMinorUnits, ledger.currency)}</small></div>)}</article>)}</div>}
      </section>
      <section className="expense-settlements" aria-labelledby="suggestion-title"><div className="expense-section-title"><div><span className="eyebrow">No transfers</span><h2 id="suggestion-title">Suggested settlements</h2></div></div><p className="expense-hint">Suggestions simplify current balances. Recording one is a user report, not proof or processing of payment.</p>{!suggestions.length ? <p className="expense-empty">No settlements are needed based on the current ledger.</p> : <ul className="suggestion-list">{suggestions.map((item) => <li key={`${item.fromUserId}-${item.toUserId}-${item.currency}`}><span><strong>{item.fromName}</strong> pays <strong>{item.toName}</strong> <b>{formatMoney(item.amountMinorUnits, item.currency)}</b></span>{item.fromUserId === currentUserId && <button type="button" disabled={saving} className="secondary-btn" onClick={() => recordSuggestion(item)}>Record my payment</button>}</li>)}</ul>}</section>
      <section className="expense-editor" aria-labelledby="editor-title"><div className="expense-section-title"><div><span className="eyebrow">{editing ? 'Revision checked' : 'Add a shared expense'}</span><h2 id="editor-title">{editing ? 'Edit expense' : 'New expense'}</h2></div>{editing && <button type="button" className="text-link" onClick={resetForm}>Cancel edit</button>}</div>
        <form onSubmit={submitExpense} className="expense-form">
          <label>Description<input required maxLength="160" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Dinner, museum tickets…" /></label>
          <label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label>Amount ({form.currency})<input required inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0.00" /></label>
          <label>Currency<select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
          <label>Expense date<input type="date" required value={form.expenseDate} onChange={(event) => setForm({ ...form, expenseDate: event.target.value })} /></label>
          <label>Paid by<input value={members.find((member) => member.userId === currentUserId)?.name ? `${members.find((member) => member.userId === currentUserId).name} (you)` : 'You'} readOnly /></label>
          <label>Split method<select value={form.splitMethod} onChange={(event) => setForm({ ...form, splitMethod: event.target.value })}><option value="EQUAL">Equal</option><option value="EXACT">Exact amounts</option><option value="PERCENTAGE">Percentages</option><option value="WEIGHTED">Shares / weights</option></select></label>
          <fieldset className="expense-participants"><legend>Participants and split</legend>{members.map((member) => <div className="split-member-row" key={member.userId}><label className="member-check"><input type="checkbox" checked={selectedMembers.includes(member.userId)} onChange={() => toggleMember(member.userId)} />{member.name}{member.userId === currentUserId ? ' (you; payer)' : ''}</label>{selectedMembers.includes(member.userId) && form.splitMethod !== 'EQUAL' && <label className="split-input"><span>{form.splitMethod === 'EXACT' ? `${form.currency} amount` : form.splitMethod === 'PERCENTAGE' ? 'Percent' : 'Shares'}</span><input type="number" min={form.splitMethod === 'EXACT' ? '0' : form.splitMethod === 'PERCENTAGE' ? '0.01' : '1'} step={form.splitMethod === 'PERCENTAGE' || form.splitMethod === 'EXACT' ? '0.01' : '1'} value={splitValues[member.userId]?.[form.splitMethod === 'EXACT' ? 'exactAmount' : form.splitMethod === 'PERCENTAGE' ? 'percentage' : 'shares'] ?? ''} onChange={(event) => setSplitValue(member.userId, form.splitMethod === 'EXACT' ? 'exactAmount' : form.splitMethod === 'PERCENTAGE' ? 'percentage' : 'shares', event.target.value)} placeholder={form.splitMethod === 'EXACT' ? '0.00' : form.splitMethod === 'PERCENTAGE' ? '0.00%' : '1'} /></label>}</div>)}</fieldset>
          <div className="allocation-preview"><strong>Allocation preview</strong><p>Preview only. The server recalculates and validates authoritative allocations when saved.</p>{preview ? <ul>{preview.map((allocation) => <li key={allocation.userId}><span>{members.find((member) => member.userId === allocation.userId)?.name || 'Trip member'}</span><strong>{formatMoney(allocation.amountMinorUnits, form.currency)}</strong></li>)}</ul> : <small>Enter a valid total split before saving.</small>}</div>
          <label className="private-expense-note">Private note <span>Only you can view this note.</span><textarea maxLength="1000" value={form.privateNote} onChange={(event) => setForm({ ...form, privateNote: event.target.value })} /></label>
          <button type="submit" className="primary-btn" disabled={saving || !preview}>{saving ? 'Saving…' : editing ? 'Save expense changes' : 'Add expense'}</button>
        </form>
      </section>
      <section className="expense-list" aria-labelledby="expense-list-title"><div className="expense-section-title"><div><span className="eyebrow">{pagination.total} records</span><h2 id="expense-list-title">Expense ledger</h2></div><button type="button" className="secondary-btn" onClick={() => load(pagination.page)} disabled={loading}>Refresh</button></div>
        {loading ? <p role="status">Refreshing ledger…</p> : expenses.length === 0 ? <p className="expense-empty">No expenses on this page.</p> : <div className="expense-cards">{expenses.map((expense) => <article className={`expense-card ${expense.status === 'VOIDED' ? 'voided' : ''}`} key={expense.id}><div className="expense-card-heading"><div><span className="expense-category">{expense.category}</span><h3>{expense.description}</h3></div><strong>{formatMoney(expense.amountMinorUnits, expense.currency)}</strong></div><p>Paid by {expense.payer.name} · {new Date(expense.expenseDate).toLocaleDateString()} · {expense.splitMethod.toLowerCase()} split</p><ul className="expense-allocation-list">{expense.allocations.map((allocation) => <li key={allocation.userId}><span>{allocation.name}</span><span>{formatMoney(allocation.amountMinorUnits, expense.currency)}</span></li>)}</ul>{expense.privateNote && <p className="expense-private-note">Your private note: {expense.privateNote}</p>}{expense.status === 'VOIDED' && <p className="voided-label">Voided · {expense.voidReason}</p>}<div className="expense-card-actions">{expense.status === 'ACTIVE' && expense.creatorId === currentUserId && <button type="button" disabled={saving} onClick={() => editExpense(expense)}>Edit</button>}{expense.status === 'ACTIVE' && (expense.creatorId === currentUserId || isOwner) && <button type="button" disabled={saving} onClick={() => voidExpense(expense)}>Void expense</button>}</div></article>)}</div>}
        <div className="expense-pagination"><button type="button" className="secondary-btn" disabled={pagination.page <= 1 || loading} onClick={() => load(pagination.page - 1)}>Previous</button><span>Page {pagination.page} of {Math.max(1, pagination.totalPages)}</span><button type="button" className="secondary-btn" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => load(pagination.page + 1)}>Next</button></div>
      </section>
      <section className="settlement-history" aria-labelledby="settlement-history-title"><div className="expense-section-title"><div><span className="eyebrow">User reported</span><h2 id="settlement-history-title">Settlement records</h2></div></div>{settlements.length === 0 ? <p className="expense-empty">No settlement records yet.</p> : <ul className="settlement-record-list">{settlements.map((settlement) => <li key={settlement.id}><span>{settlement.from.name} → {settlement.to.name} · {formatMoney(settlement.amountMinorUnits, settlement.currency)} · {settlement.status.toLowerCase()}</span>{settlement.status === 'RECORDED' && settlement.recordedBy === currentUserId && <button type="button" disabled={saving} onClick={() => reverseSettlement(settlement)}>Reverse my record</button>}{settlement.note && <small>{settlement.note}</small>}{settlement.reversalReason && <small>Correction: {settlement.reversalReason}</small>}</li>)}</ul>}</section>
    </main>
  )
}

export default TripExpenses
