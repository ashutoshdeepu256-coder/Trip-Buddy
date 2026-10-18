import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import safetyService from '../services/safetyService'
import './SafetyCenter.css'

const emptyContact = { name: '', relationship: '', phone: '', email: '', primary: false }
const reportReasons = ['SAFETY_CONCERN', 'HARASSMENT', 'THREATS', 'SCAM', 'SPAM', 'DISCRIMINATION', 'UNSAFE_MEETING', 'EMERGENCY', 'INAPPROPRIATE_CONTENT', 'OTHER']
const errorText = (error, fallback) => error.response?.data?.error?.message || fallback

function SafetyCenter() {
  const [searchParams] = useSearchParams()
  const [settings, setSettings] = useState(null)
  const [blocked, setBlocked] = useState([])
  const [contacts, setContacts] = useState([])
  const [reports, setReports] = useState([])
  const [moderatorReports, setModeratorReports] = useState([])
  const [moderatorAccess, setModeratorAccess] = useState(false)
  const [contact, setContact] = useState(emptyContact)
  const [editingContact, setEditingContact] = useState(null)
  const [report, setReport] = useState({ targetType: searchParams.get('reportedUserId') ? 'TRAVELLER' : 'INCIDENT', reportedUserId: searchParams.get('reportedUserId') || '', targetId: '', reason: 'SAFETY_CONCERN', description: '' })
  const [blockId, setBlockId] = useState('')
  const [moderatorNotes, setModeratorNotes] = useState({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const [nextSettings, nextBlocked, nextContacts, nextReports] = await Promise.all([
      safetyService.settings(), safetyService.blocked(), safetyService.contacts(), safetyService.myReports(),
    ])
    setSettings(nextSettings)
    setBlocked(Array.isArray(nextBlocked) ? nextBlocked : nextBlocked.items || [])
    setContacts(nextContacts)
    setReports(nextReports.items || [])
    try {
      const queue = await safetyService.moderatorReports()
      setModeratorReports(queue.items || queue)
      setModeratorAccess(true)
    } catch (requestError) {
      if (requestError.response?.status !== 403) setModeratorAccess(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(refresh).catch((requestError) => { if (active) setError(errorText(requestError, 'Could not load Safety Center data.')) })
    return () => { active = false }
  }, [refresh])

  const perform = async (action, success) => {
    setError('')
    setMessage('')
    setBusy(true)
    try { await action(); setMessage(success); await refresh() }
    catch (requestError) { setError(errorText(requestError, 'This safety action could not be completed.')) }
    finally { setBusy(false) }
  }

  const saveContact = (event) => {
    event.preventDefault()
    perform(async () => {
      if (editingContact) await safetyService.updateContact(editingContact, contact)
      else await safetyService.addContact(contact)
      setContact(emptyContact)
      setEditingContact(null)
    }, editingContact ? 'Emergency contact updated.' : 'Emergency contact saved.')
  }

  const submitReport = (event) => {
    event.preventDefault()
    const values = { targetType: report.targetType, reason: report.reason, description: report.description }
    if (report.targetType === 'TRAVELLER') values.reportedUserId = report.reportedUserId
    if (['TRIP', 'MESSAGE', 'REVIEW'].includes(report.targetType)) values.targetId = report.targetId
    perform(async () => { await safetyService.report(values); setReport((value) => ({ ...value, description: '' })) }, 'Your report was submitted for human review.')
  }

  const moderate = (id, status) => perform(async () => {
    await safetyService.resolveReport(id, { status, moderatorNotes: moderatorNotes[id] || '' })
  }, 'Report status updated.')

  return (
    <main className="app-shell inner-shell safety-center">
      <div className="content-card">
        <Link to="/profile" className="back-link">← Back to profile</Link>
        <span className="eyebrow">Your travel wellbeing</span>
        <h1>Safety Center</h1>
        <p className="muted-copy">Manage your privacy, contacts and reports. TripBuddy does not monitor journeys or dispatch emergency help.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="form-success" role="status">{message}</p>}

        <section className="safety-section">
          <h2>My safety settings and privacy</h2>
          {settings && <div className="safety-toggle-list">
            <label><input type="checkbox" checked={settings.discoverable} onChange={(event) => perform(async () => setSettings(await safetyService.updateSettings({ discoverable: event.target.checked })), 'Privacy setting saved.')} /> Include me in trip matching, group recommendations and trip discovery</label>
            <label><input type="checkbox" checked={settings.allowConnectionRequests} onChange={(event) => perform(async () => setSettings(await safetyService.updateSettings({ allowConnectionRequests: event.target.checked })), 'Connection setting saved.')} /> Allow new connection requests</label>
          </div>}
        </section>

        <section className="safety-section">
          <h2>Blocked travellers</h2>
          <form className="safety-inline-form" onSubmit={(event) => { event.preventDefault(); perform(async () => { await safetyService.block(blockId); setBlockId('') }, 'Traveller blocked.') }}>
            <label>Traveller account ID <input value={blockId} onChange={(event) => setBlockId(event.target.value)} placeholder="Paste the traveller ID" required /></label>
            <button type="submit" className="secondary-btn" disabled={busy}>Block traveller</button>
          </form>
          {!blocked.length ? <p className="muted-copy">You have no blocked travellers.</p> : <ul className="safety-list">{blocked.map((item) => <li key={item.id}><span><strong>{item.name}</strong><small>{item.location || 'TripBuddy traveller'}</small></span><button className="secondary-btn" type="button" disabled={busy} onClick={() => perform(() => safetyService.unblock(item.id), 'Traveller unblocked.')}>Unblock</button></li>)}</ul>}
          <p className="safety-note">Blocks hide matching and discovery results and prevent new connections and direct chat. Existing financial, report and audit records are retained.</p>
        </section>

        <section className="safety-section">
          <h2>Emergency contacts</h2>
          <p className="safety-note">Only you can view these contacts. TripBuddy does not call or message them.</p>
          <ul className="safety-list">{contacts.map((item) => <li key={item.id}><span><strong>{item.name}{item.primary ? ' · Primary' : ''}</strong><small>{item.relationship} · <a href={`tel:${item.phone}`}>{item.phone}</a>{item.email ? ` · ${item.email}` : ''}</small></span><span className="safety-actions"><button type="button" onClick={() => { setEditingContact(item.id); setContact({ name: item.name, relationship: item.relationship, phone: item.phone, email: item.email || '', primary: item.primary }) }}>Edit</button><button type="button" onClick={() => perform(() => safetyService.removeContact(item.id), 'Emergency contact removed.')}>Remove</button></span></li>)}</ul>
          <form className="safety-form" onSubmit={saveContact}>
            <h3>{editingContact ? 'Edit contact' : 'Add emergency contact'}</h3>
            <div className="safety-contact-grid">
              <label>Name<input required minLength="2" maxLength="80" value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} /></label>
              <label>Relationship<input required minLength="2" maxLength="40" value={contact.relationship} onChange={(event) => setContact({ ...contact, relationship: event.target.value })} /></label>
              <label>Phone with country code<input required type="tel" placeholder="+14155552671" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} /></label>
              <label>Email (optional)<input type="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} /></label>
            </div>
            <label className="safety-check"><input type="checkbox" checked={contact.primary} onChange={(event) => setContact({ ...contact, primary: event.target.checked })} /> Make primary contact</label>
            <div className="safety-actions"><button className="primary-btn" disabled={busy} type="submit">{editingContact ? 'Save contact' : 'Add contact'}</button>{editingContact && <button type="button" className="secondary-btn" onClick={() => { setEditingContact(null); setContact(emptyContact) }}>Cancel edit</button>}</div>
          </form>
        </section>

        <section className="safety-section">
          <h2>Report a traveller or incident</h2>
          <form className="safety-form" onSubmit={submitReport}>
            <label>What are you reporting?<select value={report.targetType} onChange={(event) => setReport({ ...report, targetType: event.target.value })}><option value="INCIDENT">General safety incident</option><option value="TRAVELLER">Traveller</option><option value="TRIP">Trip</option><option value="MESSAGE">Chat message</option><option value="REVIEW">Review</option></select></label>
            {report.targetType === 'TRAVELLER' && <label>Traveller account ID<input required value={report.reportedUserId} onChange={(event) => setReport({ ...report, reportedUserId: event.target.value })} /></label>}
            {['TRIP', 'MESSAGE', 'REVIEW'].includes(report.targetType) && <label>Reference ID<input required value={report.targetId} onChange={(event) => setReport({ ...report, targetId: event.target.value })} /></label>}
            <label>Category<select value={report.reason} onChange={(event) => setReport({ ...report, reason: event.target.value })}>{reportReasons.map((reason) => <option key={reason} value={reason}>{reason.replaceAll('_', ' ').toLowerCase()}</option>)}</select></label>
            <label>Description<textarea required minLength="10" maxLength="3000" rows="4" value={report.description} onChange={(event) => setReport({ ...report, description: event.target.value })} /></label>
            <p className="safety-note">Do not include passwords, payment details, identity documents, or other people’s sensitive data. Reports are reviewed by authorized moderators; a report alone does not automatically penalize anyone.</p>
            <button className="primary-btn" disabled={busy} type="submit">Submit report</button>
          </form>
        </section>

        <section className="safety-section">
          <h2>My reports</h2>
          {!reports.length ? <p className="muted-copy">You have not submitted any reports.</p> : <ul className="safety-list">{reports.map((item) => <li key={item.id}><span><strong>{item.targetType.replaceAll('_', ' ')} · {item.reason.replaceAll('_', ' ')}</strong><small>Submitted {new Date(item.createdAt).toLocaleString()}</small></span><span className="safety-status">{item.status.replaceAll('_', ' ')}</span></li>)}</ul>}
        </section>

        <section className="safety-section safety-assistance">
          <h2>Emergency assistance</h2>
          <p>If you are in immediate danger, contact the local emergency services directly. TripBuddy does not provide emergency dispatch, live monitoring, or guaranteed response.</p>
          <p>There is no contact-notification provider configured. Use your phone to call a trusted contact or local emergency services.</p>
          {contacts.length > 0 && <ul className="safety-list">{contacts.map((item) => <li key={item.id}><span><strong>{item.name}</strong><small>{item.relationship}</small></span><a className="primary-btn" href={`tel:${item.phone}`}>Call {item.name}</a></li>)}</ul>}
          <p className="safety-note">TripBuddy does not currently provide location-specific emergency numbers or verified hospital information.</p>
        </section>

        {moderatorAccess && <section className="safety-section">
          <h2>Moderator report queue</h2>
          {!moderatorReports.length ? <p className="muted-copy">No reports are awaiting review.</p> : <ul className="safety-list moderator-list">{moderatorReports.map((item) => <li key={item.id}><div><strong>{item.targetType} · {item.reason}</strong><small>{item.description}</small><small>Reported by {item.reporter?.name || 'traveller'} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small><textarea aria-label="Private moderator notes" maxLength="2000" value={moderatorNotes[item.id] || ''} onChange={(event) => setModeratorNotes({ ...moderatorNotes, [item.id]: event.target.value })} placeholder="Private moderator notes" /></div><div className="safety-actions"><button type="button" onClick={() => moderate(item.id, 'UNDER_REVIEW')}>Review</button><button type="button" onClick={() => moderate(item.id, 'RESOLVED')}>Resolve</button><button type="button" onClick={() => moderate(item.id, 'DISMISSED')}>Dismiss</button></div></li>)}</ul>}
        </section>}

        <section className="safety-section">
          <h2>Travel safety guidelines</h2>
          <ul><li>Share your itinerary and check-in plan with someone you trust.</li><li>Meet new travel companions in a public place and arrange your own transport.</li><li>Keep identity documents, payment credentials and precise lodging details private.</li><li>Use local emergency services when urgent help is needed.</li></ul>
        </section>
      </div>
    </main>
  )
}

export default SafetyCenter
