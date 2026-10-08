import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTripStore } from '../../store/tripStore'
import tripService from '../../services/tripService'
import '../TripPages.css'

const filters = [
  ['ALL', 'All'],
  ['DRAFT', 'Drafts'],
  ['PUBLISHED', 'Published'],
  ['PLANNING', 'Planning'],
  ['CONFIRMED', 'Confirmed'],
  ['ONGOING', 'Ongoing'],
  ['COMPLETED', 'Completed'],
  ['CANCELLED', 'Cancelled'],
]

function MyTrips() {
  const trips = useTripStore((state) => state.myTrips)
  const pagination = useTripStore((state) => state.pagination)
  const loading = useTripStore((state) => state.loading)
  const saving = useTripStore((state) => state.saving)
  const error = useTripStore((state) => state.error)
  const fetchMyTrips = useTripStore((state) => state.fetchMyTrips)
  const publishTrip = useTripStore((state) => state.publishTrip)
  const cancelTrip = useTripStore((state) => state.cancelTrip)
  const [filter, setFilter] = useState('ALL')
  const [page, setPage] = useState(1)

  useEffect(() => {
    fetchMyTrips({ page, limit: 9, ...(filter === 'ALL' ? {} : { status: filter }) }).catch(() => {})
  }, [fetchMyTrips, filter, page])

  const chooseFilter = (nextFilter) => { setFilter(nextFilter); setPage(1) }
  const action = async (operation, id) => {
    try { await operation(id); await fetchMyTrips({ page, limit: 9, ...(filter === 'ALL' ? {} : { status: filter }) }) } catch { /* Store exposes the request error. */ }
  }

  return (
    <main className="trip-shell">
      <header className="trip-page-header"><Link to="/" className="destination-brand">TripBuddy</Link><nav><Link to="/destinations">Destinations</Link><Link to="/profile">Profile</Link></nav></header>
      <section className="trip-page-intro trip-list-heading"><div><span className="eyebrow">Your journeys</span><h1>My trips</h1><p>Keep drafts, published plans, and past journeys in one place.</p></div><Link className="primary-btn" to="/trips/create">Create trip</Link></section>
      <div className="trip-filter-tabs" aria-label="Filter trips">
        {filters.map(([value, label]) => <button type="button" key={value} className={filter === value ? 'active' : ''} onClick={() => chooseFilter(value)}>{label}</button>)}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p className="trip-state" role="status">Loading your trips…</p> : trips.length ? <>
        <div className="my-trip-grid">{trips.map((trip) => (
          <article className="my-trip-card" key={trip.id}>
            <Link to={`/trips/${trip.id}`} className="my-trip-card-link">
              {trip.images?.[0]?.url ? <img src={trip.images[0].url} alt="" /> : <div className="my-trip-placeholder" aria-hidden="true">✦</div>}
              <div className="my-trip-card-body"><span className={`trip-status status-${trip.status.toLowerCase()}`}>{trip.status.replaceAll('_', ' ')}</span><h2>{trip.title || 'Untitled trip draft'}</h2><p>{trip.destination?.name || 'Destination not selected'}{trip.destination?.country ? `, ${trip.destination.country}` : ''}</p><small>{trip.startDate ? new Date(trip.startDate).toLocaleDateString() : 'Dates not set'}{trip.endDate ? ` – ${new Date(trip.endDate).toLocaleDateString()}` : ''}</small></div>
            </Link>
            <div className="my-trip-actions">
              <Link to={`/trips/${trip.id}`}>View</Link>
              {trip.status === 'DRAFT' && <Link to={`/trips/${trip.id}/edit`}>Edit</Link>}
              {trip.status === 'DRAFT' && <button disabled={saving} onClick={() => action(publishTrip, trip.id)}>Publish</button>}
              {!['CANCELLED', 'COMPLETED'].includes(trip.status) && <button disabled={saving} onClick={() => {
                if (window.confirm(`Cancel ${trip.title || 'this trip'}?`)) void action(cancelTrip, trip.id)
              }}>Cancel</button>}
            </div>
          </article>
        ))}</div>
        {pagination.totalPages > 1 && <div className="trip-pagination"><button type="button" disabled={!pagination.hasPreviousPage} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {pagination.page} of {pagination.totalPages}</span><button type="button" disabled={!pagination.hasNextPage} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
      </> : <section className="trip-empty-state"><h2>No {filter === 'ALL' ? '' : `${filter.toLowerCase()} `}trips yet</h2><p>When you create a trip, it will appear here. Drafts are private until you choose to publish.</p><Link className="primary-btn" to="/trips/create">Create your first trip</Link></section>}
    </main>
  )
}

export default MyTrips
