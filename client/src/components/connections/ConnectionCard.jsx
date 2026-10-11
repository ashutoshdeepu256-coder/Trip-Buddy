import { Link } from 'react-router-dom'
import { useConnectionStore } from '../../store/connectionStore'

export default function ConnectionCard({ connection, kind }) {
  const act = useConnectionStore((state) => state.act)
  const savingId = useConnectionStore((state) => state.savingId)
  const busy = savingId === connection.id
  const action = async (name, confirmText) => {
    if (!window.confirm(confirmText)) return
    try { await act(connection.id, name) } catch { /* The store displays the server error. */ }
  }
  return <article className="connection-card">
    <div><h2>{connection.otherUser?.name || 'TripBuddy traveller'}</h2>
      {connection.trip && <p>Trip-linked request</p>}
      <p>Status: {connection.status.toLowerCase()}</p>
    </div>
    <div className="connection-actions">
      {kind === 'received' && connection.status === 'PENDING' && <>
        <button className="primary-btn" type="button" disabled={busy} onClick={() => void action('accept', 'Accept this connection request?')}>Accept</button>
        <button className="secondary-btn" type="button" disabled={busy} onClick={() => void action('reject', 'Reject this connection request?')}>Reject</button>
      </>}
      {kind === 'sent' && connection.status === 'PENDING' && <button className="secondary-btn" type="button" disabled={busy} onClick={() => void action('cancel', 'Cancel this connection request?')}>Cancel request</button>}
      {kind === 'accepted' && connection.status === 'ACCEPTED' && <>
        <Link to={`/users/${connection.otherUser?.id}`}>View profile</Link>
        <button className="secondary-btn" type="button" disabled={busy} onClick={() => void action('unmatch', 'Remove this connection?')}>Disconnect</button>
      </>}
      {kind !== 'accepted' && connection.status !== 'PENDING' && <span role="status">Request {connection.status.toLowerCase()}</span>}
      {kind === 'accepted' && connection.status !== 'ACCEPTED' && <span role="status">Connection {connection.status.toLowerCase()}</span>}
    </div>
  </article>
}
