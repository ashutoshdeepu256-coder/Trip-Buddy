import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useConnectionStore } from '../../store/connectionStore'
import ConnectionCard from '../../components/connections/ConnectionCard'
import '../../components/connections/connections.css'

const modes = {
  '/connections': { title: 'Your connections', kind: 'list', cardKind: 'accepted', empty: 'You do not have any accepted connections yet.' },
  '/connections/requests': { title: 'Incoming requests', kind: 'received', cardKind: 'received', empty: 'There are no pending incoming requests.' },
  '/connections/sent': { title: 'Sent requests', kind: 'sent', cardKind: 'sent', empty: 'You have no pending sent requests.' },
}

export default function ConnectionsPage() {
  const location = useLocation()
  const mode = modes[location.pathname] || modes['/connections']
  const { items, loading, error, load, page, total } = useConnectionStore()
  useEffect(() => { void load(mode.kind, 1) }, [load, mode.kind])
  return <main className="connections-page">
    <header><Link to="/">TripBuddy</Link><h1>{mode.title}</h1><nav><Link to="/connections">Connections</Link><Link to="/connections/requests">Incoming</Link><Link to="/connections/sent">Sent</Link></nav></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p role="status">Loading…</p> : items.length ? <div className="connection-list">{items.map((item) => <ConnectionCard key={item.id} connection={item} kind={mode.cardKind} />)}</div> : <p>{mode.empty}</p>}
    {!loading && total > 20 && <button type="button" className="secondary-btn" disabled={page * 20 >= total} onClick={() => void load(mode.kind, page + 1)}>Load more</button>}
  </main>
}
