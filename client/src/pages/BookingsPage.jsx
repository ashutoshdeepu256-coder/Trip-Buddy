import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import bookingService from '../services/bookingService'
import './BookingsPage.css'

const categories = [
  { id: 'ACCOMMODATION', label: 'Accommodation', serviceId: 'accommodation-search', provider: 'GOOGLE_TRAVEL' },
  { id: 'TRANSPORT', label: 'Transport', serviceId: 'transport-search', provider: 'GOOGLE_TRAVEL' },
  { id: 'ACTIVITY', label: 'Activities and attractions', serviceId: 'activity-search', provider: 'GOOGLE_MAPS' },
]
const today = new Date().toISOString().slice(0, 10)
const defaultEnd = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const safeExternalLink = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'www.google.com' ? url.href : null
  } catch { return null }
}
const statusLabel = (status) => ({ USER_RECORDED: 'User recorded', EXTERNAL_HANDOFF: 'External search prepared', CANCELLED: 'TripBuddy record cancelled' }[status] || status)

function BookingsPage() {
  const [searchParams] = useSearchParams()
  const tripId = searchParams.get('tripId') || ''
  const itineraryId = searchParams.get('itineraryId') || ''
  const [selected, setSelected] = useState('ACCOMMODATION')
  const [destination, setDestination] = useState('')
  const [serviceName, setServiceName] = useState('')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(defaultEnd)
  const [travellers, setTravellers] = useState(1)
  const [note, setNote] = useState('')
  const [estimate, setEstimate] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [mode, setMode] = useState('USER_RECORDED')
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const category = categories.find((item) => item.id === selected)

  const loadRecords = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await bookingService.list({ page: 1, limit: 50 })
      setRecords(result.items)
    } catch {
      setError('Your booking records could not be loaded. Check your connection and retry.')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => {
    let active = true
    bookingService.list({ page: 1, limit: 50 }).then((result) => {
      if (active) setRecords(result.items)
    }).catch(() => {
      if (active) setError('Your booking records could not be loaded. Check your connection and retry.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  const visibleRecords = records.filter((record) => (!tripId || record.tripId === tripId) && (!itineraryId || record.itineraryId === itineraryId))
  const submit = async (nextMode) => {
    if (submitting) return
    setSubmitting(true)
    try {
      const data = {
        serviceId: category.serviceId,
        mode: nextMode,
        serviceName: serviceName.trim() || category.label,
        destination: destination.trim(), startDate, endDate,
        travellers: Number(travellers), tripId: tripId || undefined, itineraryId: itineraryId || undefined,
        travellerNote: note,
        ...(nextMode === 'USER_RECORDED' && estimate !== '' ? { userEstimate: { amount: Number(estimate), currency } } : {}),
      }
      const result = await bookingService.create(data, crypto.randomUUID())
      if (result.booking.status === 'EXTERNAL_HANDOFF') {
        toast.success('Search link prepared. TripBuddy has not made a reservation.')
      } else toast.success('Private travel request saved.')
      setDestination('')
      setServiceName('')
      setNote('')
      setEstimate('')
      await loadRecords()
    } catch (requestError) {
      toast.error(requestError.response?.data?.error?.message || 'Could not save this travel record. Please retry.')
    } finally { setSubmitting(false) }
  }

  const cancel = async (id) => {
    try { await bookingService.cancel(id); await loadRecords(); toast.success('TripBuddy record cancelled.') }
    catch { toast.error('Could not cancel this record. Please retry.') }
  }

  return (
    <main className="bookings-page">
      <header className="bookings-heading">
        <div><span className="eyebrow">Travel services</span><h1>Plan and track travel services</h1><p>Search through external providers, or keep a private note of a travel request.</p></div>
        <Link to="/planner" className="secondary-btn">Open itinerary planner</Link>
      </header>
      <section className="booking-discovery card-surface" aria-labelledby="service-title">
        <div className="booking-section-heading"><div><span className="eyebrow">No live inventory</span><h2 id="service-title">Find a service</h2></div><span className="provider-note">External search links only</span></div>
        <div className="booking-category-tabs" role="tablist" aria-label="Service category">
          {categories.map((item) => <button key={item.id} type="button" role="tab" aria-selected={selected === item.id} className={selected === item.id ? 'active' : ''} onClick={() => { setSelected(item.id); setEstimate('') }}>{item.label}</button>)}
        </div>
        <form className="booking-form" onSubmit={(event) => { event.preventDefault(); submit(mode) }}>
          <label>Destination<input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="City or destination" maxLength={160} required /></label>
          <label>Service name<input value={serviceName} onChange={(event) => setServiceName(event.target.value)} placeholder={category.label} maxLength={160} /></label>
          <label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
          <label>End date<input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
          <label>Travellers<input type="number" min="1" max="20" value={travellers} onChange={(event) => setTravellers(event.target.value)} required /></label>
          {mode === 'USER_RECORDED' && <><label>Personal estimate (optional)<input type="number" min="0" step="0.01" value={estimate} onChange={(event) => setEstimate(event.target.value)} placeholder="Your estimate" /></label><label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>USD</option><option>INR</option><option>EUR</option><option>GBP</option><option>CAD</option><option>AUD</option></select></label></>}
          <label className="booking-note-field">Private traveller note<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Details for your own planning" /></label>
          <p className="booking-disclosure">A personal estimate is your own planning figure. Provider pricing and availability are not supplied by TripBuddy.</p>
          <div className="booking-form-actions"><button className="primary-btn" type="submit" disabled={submitting || !destination.trim()}>{submitting ? 'Saving…' : mode === 'EXTERNAL_HANDOFF' ? `Prepare ${category.label.toLowerCase()} search` : 'Save private request'}</button><button type="button" className="text-link" disabled={submitting || !destination.trim()} onClick={() => setMode(mode === 'USER_RECORDED' ? 'EXTERNAL_HANDOFF' : 'USER_RECORDED')}>{mode === 'USER_RECORDED' ? `Save as external ${category.provider === 'GOOGLE_MAPS' ? 'Maps' : 'Travel'} handoff` : 'Save a private request instead'}</button></div>
        </form>
        <p className="booking-provider-capability">{category.provider === 'GOOGLE_MAPS' ? 'Google Maps' : 'Google Travel'} opens a destination search. It does not make, confirm, or cancel a booking.</p>
      </section>
      <section className="booking-history" aria-labelledby="history-title">
        <div className="booking-section-heading"><div><span className="eyebrow">Private to your account</span><h2 id="history-title">{tripId || itineraryId ? 'Trip booking summaries' : 'Your travel records'}</h2></div>{(tripId || itineraryId) && <Link className="text-link" to="/bookings">View all records</Link>}</div>
        {loading ? <div className="booking-message" role="status">Loading your private travel records…</div> : error ? <div className="booking-message error" role="alert">{error}<button className="secondary-btn" onClick={loadRecords}>Retry</button></div> : visibleRecords.length === 0 ? <div className="booking-message">{tripId || itineraryId ? 'No private booking records are associated with this trip or itinerary yet.' : 'No travel records yet. Add a private request or prepare an external search above.'}</div> : <div className="booking-record-grid">{visibleRecords.map((record) => {
          const externalUrl = safeExternalLink(record.externalUrl)
          return <article className="booking-record card-surface" key={record.id}>
            <div className="booking-record-top"><span className={`booking-status ${record.status.toLowerCase()}`}>{statusLabel(record.status)}</span><span className="booking-category-label">{categories.find((item) => item.id === record.category)?.label}</span></div>
            <h3>{record.serviceName}</h3><p className="booking-record-destination">{record.destination}</p>
            <dl><div><dt>Dates</dt><dd>{new Date(record.startDate).toLocaleDateString()} – {new Date(record.endDate).toLocaleDateString()}</dd></div><div><dt>Travellers</dt><dd>{record.travellers}</dd></div>{record.userEstimate && <div><dt>Your estimate</dt><dd>{record.userEstimate.amount.toLocaleString()} {record.userEstimate.currency} <small>user estimate</small></dd></div>}{record.tripId && <div><dt>Trip</dt><dd>Associated trip</dd></div>}</dl>
            {record.travellerNote && <p className="booking-record-note">{record.travellerNote}</p>}
            <div className="booking-record-actions">{externalUrl && <a href={externalUrl} target="_blank" rel="noopener noreferrer">Open external search ↗</a>}{record.status !== 'CANCELLED' && <button type="button" onClick={() => cancel(record.id)}>Cancel TripBuddy record</button>}</div>
            {record.status === 'EXTERNAL_HANDOFF' && <p className="booking-disclosure">An external search was prepared. TripBuddy has no reservation or confirmation details.</p>}
            {record.status === 'CANCELLED' && record.statusHistory?.at(-1)?.note?.startsWith('TripBuddy record cancelled') && <p className="booking-disclosure">This only cancels your TripBuddy record. Contact the external provider to manage a reservation made there.</p>}
          </article>
        })}</div>}
      </section>
    </main>
  )
}

export default BookingsPage
