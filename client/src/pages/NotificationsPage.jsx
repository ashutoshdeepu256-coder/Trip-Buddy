import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useNotificationStore } from '../store/notificationStore'
import notificationService from '../services/notificationService'
import './NotificationsPage.css'

const safeRoute = (route) => typeof route === 'string' && route.startsWith('/') && !route.startsWith('//') && !route.includes('\\') ? route : '/notifications'

export default function NotificationsPage() {
  const { items, page, totalPages, total, unreadCount, online, loading, error, loadPage, markRead, markAllRead, dismiss } = useNotificationStore()
  const [preferences, setPreferences] = useState(null)
  const [saving, setSaving] = useState(false)
  const [pageError, setPageError] = useState('')

  useEffect(() => { void loadPage(1); notificationService.preferences().then(setPreferences).catch(() => setPageError('Notification preferences could not be loaded.')) }, [loadPage])
  const changePreference = async (category, enabled) => {
    setSaving(true); setPageError('')
    try { const updated = await notificationService.updatePreferences({ [category]: enabled }); setPreferences(updated) }
    catch { setPageError('Your preference could not be saved. Try again when you are online.') }
    finally { setSaving(false) }
  }
  const action = async (fn) => { setPageError(''); try { await fn() } catch { setPageError('This notification action could not be completed.') } }

  return <main className="notification-page">
    <header className="notification-page-header"><div><Link to="/" className="notification-back">TripBuddy</Link><h1>Notifications</h1><p>{online ? 'Live updates are connected.' : 'Offline. Saved notifications remain available and will resync when connected.'}</p></div><span className="notification-count">{unreadCount} unread</span></header>
    {pageError && <p className="notification-error" role="alert">{pageError}</p>}
    {error && <p className="notification-error" role="alert">{error}</p>}
    <section className="notification-preferences"><div><h2>In-app preferences</h2><p>Email and push delivery are not configured.</p></div>
      {preferences && <div className="notification-preference-grid">{Object.entries(preferences.categories).map(([category, enabled]) => <label key={category}><input type="checkbox" checked={enabled} disabled={saving} onChange={(event) => void changePreference(category, event.target.checked)} /> {category.toLowerCase().replaceAll('_', ' ')}</label>)}</div>}
    </section>
    <section className="notification-list-section"><div className="notification-list-heading"><h2>Your notifications <span>({total})</span></h2><button type="button" disabled={!unreadCount || loading} onClick={() => void action(markAllRead)}>Mark all read</button></div>
      {loading && !items.length ? <p role="status">Loading notifications…</p> : !items.length ? <div className="notification-empty"><Bell size={25} /><h3>You’re all caught up</h3><p>New notifications will appear here.</p></div> : <ul className="notification-list">{items.map((item) => <li key={item.id} className={item.readAt ? 'notification-item read' : 'notification-item unread'}>
        <div className="notification-copy"><span className="notification-category">{item.category.toLowerCase()}</span><h3>{item.title}</h3><p>{item.body}</p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></div>
        <div className="notification-actions"><Link to={safeRoute(item.route)} onClick={() => { if (!item.readAt) void action(() => markRead(item.id)) }}>Open</Link>{!item.readAt && <button type="button" onClick={() => void action(() => markRead(item.id))}>Mark read</button>}<button type="button" onClick={() => void action(() => dismiss(item.id))}>Dismiss</button></div>
      </li>)}</ul>}
      {totalPages > 1 && <nav className="notification-pagination" aria-label="Notification pages"><button type="button" disabled={page <= 1 || loading} onClick={() => void loadPage(page - 1)}>Previous</button><span>Page {page} of {totalPages}</span><button type="button" disabled={page >= totalPages || loading} onClick={() => void loadPage(page + 1)}>Next</button></nav>}
    </section>
  </main>
}
