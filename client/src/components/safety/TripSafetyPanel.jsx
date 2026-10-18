import { useEffect, useState } from 'react'
import safetyService from '../../services/safetyService'
import './TripSafetyPanel.css'

function TripSafetyPanel({ tripId, isOwner }) {
  const [data, setData] = useState(null)
  const [meetingPoint, setMeetingPoint] = useState('')
  const [checklist, setChecklist] = useState('')
  const [emergencyNotes, setEmergencyNotes] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const result = await safetyService.tripSafety(tripId)
      setData(result)
      setMeetingPoint(result.safetyInfo.meetingPoint)
      setChecklist(result.safetyInfo.checklist.join('\n'))
      setEmergencyNotes(result.safetyInfo.emergencyNotes)
      setError('')
    } catch (requestError) { setError(requestError.response?.status === 404 ? 'Private trip safety information is unavailable to this account.' : 'Trip safety information could not be loaded.') }
  }

  useEffect(() => { let active = true; safetyService.tripSafety(tripId).then((result) => { if (active) { setData(result); setMeetingPoint(result.safetyInfo.meetingPoint); setChecklist(result.safetyInfo.checklist.join('\n')); setEmergencyNotes(result.safetyInfo.emergencyNotes) } }).catch((requestError) => { if (active) setError(requestError.response?.status === 404 ? 'Private trip safety information is unavailable to this account.' : 'Trip safety information could not be loaded.') }); return () => { active = false } }, [tripId])

  const save = async (event) => {
    event.preventDefault()
    setBusy(true); setError(''); setSaved(false)
    try {
      const result = await safetyService.updateTripSafety(tripId, { meetingPoint, checklist: checklist.split('\n').map((line) => line.trim()).filter(Boolean), emergencyNotes })
      setData(result); setEditing(false); setSaved(true)
    } catch (requestError) { setError(requestError.response?.data?.error?.message || 'Trip safety information could not be saved.') }
    finally { setBusy(false) }
  }

  return <section className="trip-safety-panel">
    <div className="trip-safety-heading"><div><span className="eyebrow">Private trip information</span><h2>Trip safety</h2></div>{isOwner && data && !editing && <button type="button" className="secondary-btn" onClick={() => setEditing(true)}>Edit safety info</button>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}{saved && <p className="form-success" role="status">Trip safety information saved.</p>}
    {data && <>
      <p><strong>{data.trip.destination?.name || data.trip.title}</strong>{data.trip.startDate && ` · ${new Date(data.trip.startDate).toLocaleDateString()} – ${new Date(data.trip.endDate).toLocaleDateString()}`}</p>
      {editing ? <form className="trip-safety-form" onSubmit={save}>
        <label>Meeting point details<textarea maxLength="500" rows="2" value={meetingPoint} onChange={(event) => setMeetingPoint(event.target.value)} placeholder="Share a public meeting place. Do not post a private home address." /></label>
        <label>Safety checklist <small>One item per line, up to 20</small><textarea maxLength="2500" rows="5" value={checklist} onChange={(event) => setChecklist(event.target.value)} placeholder={'Share your itinerary with someone you trust\nAgree on a public meeting point'} /></label>
        <label>Additional trip safety notes<textarea maxLength="2000" rows="3" value={emergencyNotes} onChange={(event) => setEmergencyNotes(event.target.value)} /></label>
        <div className="safety-actions"><button className="primary-btn" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save trip safety info'}</button><button type="button" className="secondary-btn" onClick={() => { setEditing(false); load() }}>Cancel</button></div>
      </form> : <>
        <p><strong>Meeting point</strong><br />{data.safetyInfo.meetingPoint || 'No meeting point has been shared.'}</p>
        <div><strong>Checklist</strong>{data.safetyInfo.checklist.length ? <ul>{data.safetyInfo.checklist.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No trip checklist has been added.</p>}</div>
        {data.safetyInfo.emergencyNotes && <p><strong>Additional notes</strong><br />{data.safetyInfo.emergencyNotes}</p>}
      </>}
      {data.emergencyContacts.length > 0 && <div><strong>Your private emergency contacts</strong><ul>{data.emergencyContacts.map((contact) => <li key={contact.id}>{contact.name} · <a href={`tel:${contact.phone}`}>{contact.phone}</a></li>)}</ul></div>}
      <p className="trip-safety-disclaimer">{data.assistanceNotice} No local emergency number or hospital data is configured.</p>
    </>}
  </section>
}

export default TripSafetyPanel
