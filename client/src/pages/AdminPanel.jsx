import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import adminService from '../services/adminService'
import './AdminPanel.css'

const tabs = ['Overview', 'Users', 'Trips', 'Audit']
const date = (value) => value ? new Date(value).toLocaleString() : '—'

function AdminPanel() {
  const user = useAuthStore((state) => state.user)
  const [tab, setTab] = useState('Overview')
  const [overview, setOverview] = useState(null)
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (user?.role !== 'ADMIN') return
      setLoading(true); setError('')
      try {
        if (tab === 'Overview') {
          const result = await adminService.overview()
          if (!cancelled) setOverview(result)
        }
        if (tab === 'Users') {
          const result = await adminService.users({ page, limit: 15, search: search || undefined, status: filter || undefined })
          if (!cancelled) setData(result)
        }
        if (tab === 'Trips') {
          const result = await adminService.trips({ page, limit: 15, search: search || undefined, status: filter || undefined })
          if (!cancelled) setData(result)
        }
        if (tab === 'Audit') {
          const result = await adminService.audit({ page, limit: 15 })
          if (!cancelled) setData(result)
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError.response?.data?.message || 'Admin data could not be loaded.')
      } finally { if (!cancelled) setLoading(false) }
    }
    const timer = window.setTimeout(load, 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [user?.role, tab, page, search, filter, refresh])

  const switchTab = (next) => { setTab(next); setPage(1); setData(null); setFilter(''); setSearch(''); setNotice('') }
  const moderateUser = async (person) => {
    const status = person.accountStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
    if (!window.confirm(`${status === 'SUSPENDED' ? 'Suspend' : 'Restore'} ${person.name}?`)) return
    const reason = window.prompt('Enter the reason for this account status change (at least 10 characters):')
    if (!reason) return
    try { await adminService.setStatus(person.id, { status, reason }); setNotice(`Account status changed to ${status}.`); setRefresh((n) => n + 1) }
    catch (requestError) { setError(requestError.response?.data?.message || 'Account status could not be changed.') }
  }
  const changeRole = async (person, role) => {
    if (role === person.role || !window.confirm(`Change ${person.name}'s role to ${role}?`)) return
    const reason = window.prompt('Enter the reason for this role change (at least 10 characters):')
    if (!reason) return
    try { await adminService.setRole(person.id, { role, reason }); setNotice(`Role changed to ${role}.`); setRefresh((n) => n + 1) }
    catch (requestError) { setError(requestError.response?.data?.message || 'Role could not be changed.') }
  }

  if (!user || !['ADMIN', 'MODERATOR'].includes(user.role)) return <main className="admin-shell"><h1>Access denied</h1><p>Administrator or moderator access is required.</p><Link to="/">Return to TripBuddy</Link></main>
  if (user.role === 'MODERATOR') return <main className="admin-shell"><header><p className="admin-kicker">TripBuddy operations</p><h1>Moderation workspace</h1><p>Your moderator role can review reports and the existing AI moderation queue.</p></header><div className="admin-links"><Link to="/safety">Safety Center reports <span>Review reports and record decisions →</span></Link><Link to="/safety">AI moderation queue <span>Open the existing Phase 24 review workflow →</span></Link></div></main>

  return <main className="admin-shell">
    <header className="admin-header"><div><p className="admin-kicker">TripBuddy operations</p><h1>Admin panel</h1><p>Restricted controls and privacy scoped platform summaries.</p></div><Link className="admin-back" to="/">Back to TripBuddy</Link></header>
    <nav className="admin-tabs" aria-label="Admin sections">{tabs.map((item) => <button key={item} type="button" aria-current={tab === item ? 'page' : undefined} onClick={() => switchTab(item)}>{item}</button>)}</nav>
    {notice && <p className="admin-notice" role="status">{notice}</p>}{error && <p className="admin-error" role="alert">{error}</p>}
    {loading && <p role="status">Loading admin data…</p>}
    {!loading && tab === 'Overview' && overview && <>
      <section className="admin-metrics" aria-label="Platform overview">
        <Metric label="Registered users" value={overview.users.total} detail="All accounts" />
        <Metric label="Recently active" value="Unavailable" detail={overview.users.recentlyActive.reason} />
        <Metric label="Pending safety reports" value={overview.safety.pendingReports} detail={`${overview.safety.openReviewReports} review reports`} />
        <Metric label="Open moderation" value={overview.safety.pendingModeration} detail="Includes open, in review, and escalated" />
        <Metric label="Platform health" value="Unavailable" detail={overview.platformHealth.reason} />
      </section>
      <section className="admin-columns"><CountCard title="Trips by lifecycle" values={overview.trips} /><CountCard title="Bookings" values={overview.bookings} /><CountCard title="Payments" values={overview.payments} /><CountCard title="Moderation queue" values={overview.safety.moderationQueue} /></section>
      <div className="admin-links"><Link to="/safety">Safety Center <span>Reports, review reports, and moderation queues: {overview.safety.pendingReports} pending reports · {overview.safety.openReviewReports} open review reports</span></Link></div>
      <p className="admin-footnote">Payment figures are status counts only. Provider identifiers, credentials, and payment details are not shown.</p>
    </>}
    {!loading && ['Users', 'Trips'].includes(tab) && <>
      <div className="admin-filters"><label>Search {tab.toLowerCase()}<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={tab === 'Users' ? 'Name or email prefix' : 'Trip title'} /></label><label>Status<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }}><option value="">All statuses</option>{(tab === 'Users' ? ['ACTIVE', 'SUSPENDED', 'BANNED'] : ['DRAFT', 'PUBLISHED', 'PLANNING', 'CONFIRMED', 'ONGOING', 'COMPLETED', 'CANCELLED']).map((value) => <option key={value}>{value}</option>)}</select></label></div>
      {tab === 'Users' ? <UserTable rows={data?.items || []} selfId={user.id} onStatus={moderateUser} onRole={changeRole} /> : <TripTable rows={data?.items || []} />}
      <Pager page={page} totalPages={data?.totalPages || 0} onChange={setPage} />
      {!data?.items?.length && <p className="admin-empty">No matching records.</p>}
    </>}
    {!loading && tab === 'Audit' && <><p className="admin-footnote">Append only through application workflows; entries are protected by database access controls, not cryptographically tamper proof.</p><div className="admin-table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Change / reason</th></tr></thead><tbody>{(data?.items || []).map((row) => <tr key={row.id}><td>{date(row.createdAt)}</td><td>{row.actor?.name || 'System'}<small>{row.actor?.email || ''}</small></td><td>{row.action}</td><td>{row.resourceType}<small>{row.resourceId || ''}</small></td><td>{row.before && row.after ? `${row.before} → ${row.after}` : '—'}{row.reason && <small>{row.reason}</small>}</td></tr>)}</tbody></table></div><Pager page={page} totalPages={data?.totalPages || 0} onChange={setPage} />{!data?.items?.length && <p className="admin-empty">No audit records.</p>}</>}
  </main>
}

function Metric({ label, value, detail }) { return <article className="admin-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article> }
function CountCard({ title, values }) { return <article className="admin-count-card"><h2>{title}</h2>{Object.entries(values || {}).map(([key, value]) => <div key={key}><span>{key.replaceAll('_', ' ').toLowerCase()}</span><strong>{value}</strong></div>)}</article> }
function UserTable({ rows, selfId, onStatus, onRole }) { return <div className="admin-table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Profile</th><th>Created</th><th>Actions</th></tr></thead><tbody>{rows.map((person) => <tr key={person.id}><td>{person.name}<small>{person.email}</small></td><td><select aria-label={`Role for ${person.name}`} disabled={person.id === selfId} value={person.role} onChange={(event) => onRole(person, event.target.value)}>{['USER', 'MODERATOR', 'ADMIN'].map((role) => <option key={role}>{role}</option>)}</select></td><td><span className={`admin-status status-${person.accountStatus.toLowerCase()}`}>{person.accountStatus}</span></td><td>{[person.profile.city, person.profile.country].filter(Boolean).join(', ') || '—'}</td><td>{date(person.createdAt)}</td><td><button type="button" disabled={person.id === selfId || (person.role === 'ADMIN' && person.accountStatus === 'ACTIVE')} onClick={() => onStatus(person)}>{person.accountStatus === 'ACTIVE' ? 'Suspend' : 'Restore'}</button></td></tr>)}</tbody></table></div> }
function TripTable({ rows }) { return <div className="admin-table-wrap"><table><thead><tr><th>Trip</th><th>Creator</th><th>Status</th><th>Visibility</th><th>Moderation</th><th>Dates</th><th>Created</th></tr></thead><tbody>{rows.map((trip) => <tr key={trip.id}><td>{trip.title || 'Untitled'}<small>{trip.description.slice(0, 140)}</small></td><td>{trip.creator?.name || 'Unknown'}</td><td><span className="admin-status">{trip.status}</span></td><td>{trip.privacy}</td><td>{trip.moderationVisibility || 'VISIBLE'}</td><td>{date(trip.startDate)}<small>to {date(trip.endDate)}</small></td><td>{date(trip.createdAt)}</td></tr>)}</tbody></table></div> }
function Pager({ page, totalPages, onChange }) { return <div className="admin-pager"><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button><span>Page {page} of {Math.max(1, totalPages)}</span><button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</button></div> }

export default AdminPanel
