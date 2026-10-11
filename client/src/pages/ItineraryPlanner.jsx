import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import itineraryService from '../services/itineraryService'
import './ItineraryPlanner.css'

const explainError = (error) => error.response?.data?.error?.message || 'The itinerary could not be loaded. Please try again.'

function ItineraryPlanner() {
  const [searchParams] = useSearchParams()
  const linkedTripId = searchParams.get('tripId') || ''
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ destination: '', startDate: '', endDate: '', interests: '', pace: 'MODERATE', budgetAmount: '', currency: 'USD' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const refresh = async (selectedId) => {
    const result = await itineraryService.list()
    setItems(result.items)
    if (selectedId === false) setSelected(null)
    else if (selectedId) setSelected(await itineraryService.get(selectedId))
  }

  useEffect(() => {
    let active = true
    itineraryService.list().then(async (result) => {
      if (!active) return
      setItems(result.items)
      if (result.items[0]) {
        const plan = await itineraryService.get(result.items[0].id)
        if (active) setSelected(plan)
      }
    }).catch((requestError) => {
      if (active) setError(explainError(requestError))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  const run = async (action, clearSelection = false) => {
    setSaving(true)
    setError('')
    try {
      const result = await action()
      await refresh(clearSelection ? false : (result?.id || selected?.id))
    } catch (requestError) {
      setError(explainError(requestError))
    } finally {
      setSaving(false)
    }
  }

  const generate = (event) => {
    event.preventDefault()
    const { budgetAmount, interests, currency, pace, ...fields } = form
    run(async () => {
      const input = {
        ...fields,
        budget: { amount: budgetAmount === '' ? null : Number(budgetAmount), currency },
        preferences: { interests: interests.split(',').map((value) => value.trim()).filter(Boolean), pace, notes: '' },
      }
      if (linkedTripId) {
        input.tripId = linkedTripId
        for (const key of ['destination', 'startDate', 'endDate']) if (!input[key]) delete input[key]
      }
      const record = await itineraryService.generate(input)
      setSelected(record)
      return record
    })
  }

  const saveTitle = () => {
    const title = window.prompt('Plan title', selected.title)
    if (title?.trim()) run(() => itineraryService.update(selected.id, { title: title.trim() }))
  }

  const remove = () => {
    if (!window.confirm('Delete this saved itinerary? This cannot be undone.')) return
    run(() => itineraryService.remove(selected.id), true)
  }

  return (
    <main className="itinerary-shell">
      <header className="itinerary-header">
        <Link to="/my-trips">← My trips</Link>
        <Link to="/">TripBuddy</Link>
      </header>
      <section className="itinerary-intro">
        <p className="itinerary-eyebrow">AI travel planner</p>
        <h1>Build a trip plan</h1>
        <p>Draft a day-by-day outline, then check local details and current conditions before you book.</p>
      </section>

      {error && <p className="itinerary-alert" role="alert">{error}</p>}
      <div className="itinerary-layout">
        <section className="itinerary-panel" aria-labelledby="planner-form-title">
          <h2 id="planner-form-title">Start with your trip</h2>
          <form className="itinerary-form" onSubmit={generate}>
            <label>Destination<input required={!linkedTripId} maxLength="160" value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value })} /><small>{linkedTripId ? 'Optional when generated from your owned trip.' : ''}</small></label>
            <div className="itinerary-form-row">
              <label>Start date<input type="date" required={!linkedTripId} value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
              <label>End date<input type="date" required={!linkedTripId} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
            </div>
            <label>Interests<input maxLength="500" value={form.interests} onChange={(event) => setForm({ ...form, interests: event.target.value })} placeholder="Food, history, walking" /><small>Separate interests with commas.</small></label>
            <div className="itinerary-form-row">
              <label>Travel pace<select value={form.pace} onChange={(event) => setForm({ ...form, pace: event.target.value })}><option value="RELAXED">Relaxed</option><option value="MODERATE">Moderate</option><option value="FAST">Fast</option></select></label>
              <label>Budget amount<input type="number" min="0" max="100000000" value={form.budgetAmount} onChange={(event) => setForm({ ...form, budgetAmount: event.target.value })} /></label>
            </div>
            <label>Budget currency<input required minLength="3" maxLength="3" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label>
            <button className="primary-btn" type="submit" disabled={saving}>{saving ? 'Preparing plan…' : 'Generate itinerary'}</button>
            <small>Generation is limited to 5 requests per hour. Provider output is a draft and does not contain verified live information.</small>
          </form>
        </section>

        <section className="itinerary-panel itinerary-results" aria-labelledby="saved-plans-title">
          <h2 id="saved-plans-title">Your saved plans</h2>
          {loading && <p role="status">Loading saved plans…</p>}
          {!loading && items.length === 0 && <p className="itinerary-empty">Your saved plans will appear here after you generate one.</p>}
          {!!items.length && <div className="itinerary-saved-list" aria-label="Saved itineraries">
            {items.map((item) => <button key={item.id} className={selected?.id === item.id ? 'itinerary-saved active' : 'itinerary-saved'} type="button" onClick={() => run(async () => { const plan = await itineraryService.get(item.id); setSelected(plan); return plan })}>
              <strong>{item.title}</strong><span>{item.destination} · {new Date(item.startDate).toLocaleDateString()}</span>
            </button>)}
          </div>}
          {selected && <article className="itinerary-plan">
            <div className="itinerary-plan-heading">
              <div><span className={selected.source === 'GEMINI' ? 'itinerary-source' : 'itinerary-source fallback'}>{selected.source === 'GEMINI' ? 'AI draft' : 'Template draft'}</span><h2>{selected.title}</h2><p>{selected.destination} · {new Date(selected.startDate).toLocaleDateString()} – {new Date(selected.endDate).toLocaleDateString()}</p></div>
              <div className="itinerary-actions"><button type="button" onClick={saveTitle} disabled={saving}>Rename</button><button type="button" onClick={() => run(() => itineraryService.duplicate(selected.id))} disabled={saving}>Duplicate</button><button type="button" onClick={() => run(() => itineraryService.archive(selected.id), true)} disabled={saving}>Archive</button><button type="button" onClick={remove} disabled={saving}>Delete</button></div>
            </div>
            <p className="itinerary-disclaimer">Planning suggestions only. Confirm costs, opening hours, access, transport, local advisories, and availability with current sources.</p>
            {selected.plan.days.map((day) => <section className="itinerary-day" key={day.day}>
              <div className="itinerary-day-heading"><h3>Day {day.day} <span>{new Date(`${day.date}T00:00:00`).toLocaleDateString()}</span></h3><button type="button" onClick={() => run(() => itineraryService.regenerateDay(selected.id, day.day))} disabled={saving}>Regenerate day</button></div>
              <div className="itinerary-slots">{['morning', 'afternoon', 'evening'].map((slot) => <div key={slot}><h4>{slot}</h4>{day[slot].activities.map((activity, index) => <div className="itinerary-activity" key={`${slot}-${index}`}><strong>{activity.title}</strong><p>{activity.description}</p><small>{activity.durationMinutes} min · {activity.estimatedCost.amount == null ? 'Cost unknown' : `${activity.estimatedCost.currency} ${activity.estimatedCost.amount}`}</small></div>)}</div>)}</div>
            </section>)}
            <section className="itinerary-notes"><h3>Budget outline</h3><p>Activity cost estimates are unknown unless listed; the plan does not fetch prices.</p><ul>{selected.plan.budgetBreakdown.map((entry) => <li key={entry.category}>{entry.category}: {entry.estimatedCost.amount == null ? 'Unknown' : `${entry.estimatedCost.currency} ${entry.estimatedCost.amount}`}</li>)}</ul>
              <h3>Assumptions and unknowns</h3><ul>{[...selected.plan.assumptions, ...selected.plan.unknowns].map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
              <h3>Safety reminders</h3><ul>{selected.plan.safetyNotes.map((note) => <li key={note}>{note}</li>)}</ul>
            </section>
          </article>}
        </section>
      </div>
    </main>
  )
}

export default ItineraryPlanner
