import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { io } from 'socket.io-client'
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
  const [collaborators, setCollaborators] = useState([])
  const [history, setHistory] = useState([])
  const [grantUserId, setGrantUserId] = useState('')
  const [grantRole, setGrantRole] = useState('VIEWER')
  const [liveStatus, setLiveStatus] = useState('saved')

  const refresh = async (selectedId) => {
    const [result, sharedResult] = await Promise.all([itineraryService.list(), itineraryService.listShared()])
    const nextItems = [...result.items.map((item) => ({ ...item, shared: false })), ...sharedResult.items.map((item) => ({ ...item, shared: true }))]
    setItems(nextItems)
    if (selectedId === false) setSelected(null)
    else if (selectedId) {
      const item = nextItems.find((entry) => entry.id === selectedId)
      if (item?.shared) {
        const shared = await itineraryService.getShared(selectedId)
        setSelected({ ...shared.itinerary, role: shared.role, shared: true })
      } else setSelected({ ...await itineraryService.get(selectedId), role: 'OWNER', shared: false })
    }
  }

  useEffect(() => {
    let active = true
    Promise.all([itineraryService.list(), itineraryService.listShared()]).then(async ([result, sharedResult]) => {
      if (!active) return
      const nextItems = [...result.items.map((item) => ({ ...item, shared: false })), ...sharedResult.items.map((item) => ({ ...item, shared: true }))]
      setItems(nextItems)
      if (nextItems[0]) {
        const plan = nextItems[0].shared ? await itineraryService.getShared(nextItems[0].id).then((value) => ({ ...value.itinerary, role: value.role, shared: true })) : { ...await itineraryService.get(nextItems[0].id), role: 'OWNER', shared: false }
        if (active) setSelected(plan)
      }
    }).catch((requestError) => {
      if (active) setError(explainError(requestError))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!selected?.collaborationEnabled || !selected.shared) return undefined
    let active = true
    const base = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1').replace(/\/api\/v1\/?$/, '')
    const socket = io(base, { withCredentials: true, transports: ['websocket', 'polling'] })
    socket.on('connect', () => socket.emit('itinerary:join', { itineraryId: selected.id }, (response) => {
      if (!active) return
      setLiveStatus(response?.success ? 'saved' : 'offline')
    }))
    socket.on('itinerary:changed', (event) => {
      if (event.itineraryId === selected.id && event.revision > selected.revision) setLiveStatus('conflict')
    })
    socket.on('disconnect', () => active && setLiveStatus('offline'))
    socket.on('connect_error', () => active && setLiveStatus('offline'))
    return () => { active = false; socket.emit('itinerary:leave', { itineraryId: selected.id }); socket.disconnect() }
  }, [selected?.id, selected?.collaborationEnabled, selected?.shared, selected?.revision])

  useEffect(() => {
    const offline = () => setLiveStatus('offline')
    const online = () => setLiveStatus('saved')
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online) }
  }, [])

  useEffect(() => {
    if (!selected?.collaborationEnabled || !selected.id) return undefined
    let active = true
    itineraryService.collaborators(selected.id).then((data) => active && setCollaborators(data.collaborators)).catch(() => active && setCollaborators([]))
    itineraryService.history(selected.id, { limit: 8 }).then((data) => active && setHistory(data.items)).catch(() => active && setHistory([]))
    return () => { active = false }
  }, [selected?.id, selected?.revision, selected?.collaborationEnabled])

  const run = async (action, clearSelection = false) => {
    setSaving(true)
    setError('')
    try {
      const result = await action()
      await refresh(clearSelection ? false : (result?.id || selected?.id))
    } catch (requestError) {
      if (requestError.response?.data?.error?.code === 'REVISION_CONFLICT') setLiveStatus('conflict')
      if (requestError.response?.status === 403 || requestError.response?.status === 404) setLiveStatus('revoked')
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

  const write = (action) => run(async () => {
    setLiveStatus('saving')
    const result = await action()
    setLiveStatus('saved')
    return { ...result.itinerary, shared: true, role: selected.role }
  })
  const addActivity = (day, section) => {
    const title = window.prompt('Activity title')
    if (!title?.trim()) return
    write(() => itineraryService.addActivity(selected.id, { expectedRevision: selected.revision, dayId: day.id, section, activity: { title: title.trim(), description: '', durationMinutes: 60, estimatedCost: { amount: null, currency: selected.budget?.currency || 'USD' }, location: selected.destination } }))
  }
  const saveActivityTitle = (day, section, activity) => {
    const title = window.prompt('Activity title', activity.title)
    if (!title?.trim() || !activity.id) return
    write(() => itineraryService.updateActivity(selected.id, activity.id, { expectedRevision: selected.revision, dayId: day.id, section, activity: { ...activity, title: title.trim() } }))
  }
  const moveActivity = (day, section, activity, direction) => {
    const ids = [...day[section].activities].map((entry) => entry.id)
    const index = ids.indexOf(activity.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    write(() => itineraryService.reorderActivities(selected.id, { expectedRevision: selected.revision, dayId: day.id, section, activityIds: ids }))
  }
  const moveDay = (day, direction) => {
    const ids = selected.plan.days.map((entry) => entry.id)
    const index = ids.indexOf(day.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    write(() => itineraryService.reorderDays(selected.id, { expectedRevision: selected.revision, dayIds: ids }))
  }
  const manageCollaboration = (enabled) => run(async () => {
    const result = await itineraryService.setCollaboration(selected.id, { enabled, expectedRevision: selected.revision })
    return { ...result.itinerary, shared: enabled, role: 'OWNER' }
  })
  const grantAccess = (event) => {
    event.preventDefault()
    run(() => itineraryService.grantCollaborator(selected.id, { userId: grantUserId, role: grantRole, expectedRevision: selected.revision }).then((result) => ({ ...result.itinerary, shared: true, role: selected.role })))
    setGrantUserId('')
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
            {items.map((item) => <button key={item.id} className={selected?.id === item.id ? 'itinerary-saved active' : 'itinerary-saved'} type="button" onClick={() => run(async () => { const plan = item.shared ? await itineraryService.getShared(item.id).then((value) => ({ ...value.itinerary, role: value.role, shared: true })) : { ...await itineraryService.get(item.id), role: 'OWNER', shared: false }; setSelected(plan); return plan })}>
              <strong>{item.title} · {item.shared ? 'Shared' : 'Private'}</strong><span>{item.destination} · {new Date(item.startDate).toLocaleDateString()}</span>
            </button>)}
          </div>}
          {selected && <article className="itinerary-plan">
            {selected.tripId && <section className="itinerary-collaboration" aria-label="Itinerary collaboration">
              <div><strong>{selected.collaborationEnabled ? 'Shared itinerary' : 'Private itinerary'}</strong><p>{selected.collaborationEnabled ? `Revision ${selected.revision} · Your role: ${selected.role || 'OWNER'}` : 'Only the itinerary owner can view this plan.'}</p></div>
              {selected.role === 'OWNER' && <button type="button" disabled={saving} onClick={() => manageCollaboration(!selected.collaborationEnabled)}>{selected.collaborationEnabled ? 'Disable sharing' : 'Enable sharing'}</button>}
              <span className={`itinerary-live-status ${liveStatus}`} role="status">{liveStatus === 'saving' ? 'Saving…' : liveStatus === 'saved' ? 'Saved' : liveStatus === 'conflict' ? 'Newer revision available' : liveStatus === 'revoked' ? 'Access changed' : liveStatus === 'offline' ? 'Offline' : 'Connecting'}</span>
              {liveStatus === 'conflict' && <button type="button" onClick={() => refresh(selected.id)}>Reload latest</button>}
              {selected.collaborationEnabled && selected.role === 'OWNER' && <>
                <form className="itinerary-grant-form" onSubmit={grantAccess}>
                  <label>Active Trip member ID<input required value={grantUserId} onChange={(event) => setGrantUserId(event.target.value)} placeholder="User ID" /></label>
                  <label>Permission<select value={grantRole} onChange={(event) => setGrantRole(event.target.value)}><option value="VIEWER">Viewer</option><option value="EDITOR">Editor</option></select></label>
                  <button type="submit" disabled={saving}>Grant access</button>
                </form>
                <ul className="itinerary-collaborators">{collaborators.map((person) => <li key={person.userId}><span>{person.name} · {person.role}</span><button type="button" disabled={saving} onClick={() => run(() => itineraryService.revokeCollaborator(selected.id, { userId: person.userId, expectedRevision: selected.revision }).then((result) => ({ ...result.itinerary, shared: true, role: selected.role })))}>Revoke</button></li>)}</ul>
              </>}
              {selected.collaborationEnabled && <div className="itinerary-history"><h3>Recent changes</h3>{history.map((entry) => <p key={entry.revision}>Revision {entry.revision} · {entry.actor.name} · {entry.operation.replaceAll('_', ' ').toLowerCase()}</p>)}</div>}
            </section>}
            <div className="itinerary-plan-heading">
              {!selected.shared && <Link to={`/bookings?${selected.tripId ? `tripId=${encodeURIComponent(selected.tripId)}&` : ''}itineraryId=${encodeURIComponent(selected.id)}`}>View private booking records</Link>}
              <div><span className={selected.source === 'GEMINI' ? 'itinerary-source' : 'itinerary-source fallback'}>{selected.source === 'GEMINI' ? 'AI draft' : 'Template draft'}</span><h2>{selected.title}</h2><p>{selected.destination} · {new Date(selected.startDate).toLocaleDateString()} – {new Date(selected.endDate).toLocaleDateString()}</p></div>
              <div className="itinerary-actions">{!selected.shared && <><button type="button" onClick={saveTitle} disabled={saving}>Rename</button><button type="button" onClick={() => run(() => itineraryService.duplicate(selected.id))} disabled={saving}>Duplicate</button><button type="button" onClick={() => run(() => itineraryService.archive(selected.id), true)} disabled={saving}>Archive</button><button type="button" onClick={remove} disabled={saving}>Delete</button></>}</div>
            </div>
            <p className="itinerary-disclaimer">Planning suggestions only. Confirm costs, opening hours, access, transport, local advisories, and availability with current sources.</p>
            {selected.plan.days.map((day) => <section className="itinerary-day" key={day.id || day.day}>
              <div className="itinerary-day-heading"><h3>Day {day.day}{day.title ? ` · ${day.title}` : ''} <span>{new Date(`${day.date}T00:00:00`).toLocaleDateString()}</span></h3>{!selected.shared && <button type="button" onClick={() => run(() => itineraryService.regenerateDay(selected.id, day.day))} disabled={saving}>Regenerate day</button>}{selected.shared && ['OWNER', 'EDITOR'].includes(selected.role) && <div className="itinerary-activity-actions"><button type="button" onClick={() => { const title = window.prompt('Day title', day.title || ''); if (title?.trim()) write(() => itineraryService.updateDay(selected.id, { expectedRevision: selected.revision, dayId: day.id, title: title.trim() })) }} disabled={saving}>Rename day</button><button type="button" onClick={() => moveDay(day, -1)} disabled={saving || day.day === 1}>Move up</button><button type="button" onClick={() => moveDay(day, 1)} disabled={saving || day.day === selected.plan.days.length}>Move down</button><button type="button" onClick={() => write(() => itineraryService.removeDay(selected.id, { expectedRevision: selected.revision, dayId: day.id }))} disabled={saving || selected.plan.days.length === 1}>Remove day</button></div>}</div>
              <div className="itinerary-slots">{['morning', 'afternoon', 'evening'].map((slot) => <div key={slot}><h4>{slot}</h4>{day[slot].activities.map((activity, index) => <div className="itinerary-activity" key={activity.id || `${slot}-${index}`}><strong>{activity.title}</strong><p>{activity.description}</p><small>{activity.durationMinutes} min · {activity.estimatedCost.amount == null ? 'Cost unknown' : `${activity.estimatedCost.currency} ${activity.estimatedCost.amount}`}</small>{selected.shared && ['OWNER', 'EDITOR'].includes(selected.role) && <div className="itinerary-activity-actions"><button type="button" onClick={() => saveActivityTitle(day, slot, activity)} disabled={saving}>Edit</button><button type="button" onClick={() => moveActivity(day, slot, activity, -1)} disabled={saving || index === 0}>Move up</button><button type="button" onClick={() => moveActivity(day, slot, activity, 1)} disabled={saving || index === day[slot].activities.length - 1}>Move down</button><button type="button" onClick={() => write(() => itineraryService.removeActivity(selected.id, activity.id, { expectedRevision: selected.revision, dayId: day.id, section: slot }))} disabled={saving}>Remove</button></div>}</div>)}{selected.shared && ['OWNER', 'EDITOR'].includes(selected.role) && <button type="button" onClick={() => addActivity(day, slot)} disabled={saving}>Add activity</button>}</div>)}</div>
            </section>)}
            {selected.shared && ['OWNER', 'EDITOR'].includes(selected.role) && <button type="button" onClick={() => write(() => itineraryService.addDay(selected.id, { expectedRevision: selected.revision }))} disabled={saving || selected.plan.days.length >= 31}>Add day</button>}
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
