import { Link } from 'react-router-dom'

const formatDate = (value) => new Date(value).toLocaleDateString(undefined, {
  month: 'short',
  day: 'numeric',
})

const formatBudget = (budget) => {
  if (budget?.min == null || budget?.max == null) return 'Budget not listed'
  return `${budget.currency} ${Number(budget.min).toLocaleString()}–${Number(budget.max).toLocaleString()}`
}

function TripCard({ trip }) {
  const verified = trip.creator.verificationStatus
  const destination = trip.destination
  return (
    <article className="discovery-trip-card">
      <Link className="discovery-trip-cover" to={`/trips/${trip.id}`} aria-label={`View trip: ${trip.title}`}>
        {trip.coverImage?.url
          ? <img src={trip.coverImage.url} alt="" loading="lazy" />
          : <span aria-hidden="true">TripBuddy</span>}
        <span className={`trip-status status-${trip.status.toLowerCase()}`}>{trip.status.replaceAll('_', ' ')}</span>
      </Link>
      <div className="discovery-trip-card-body">
        <p className="discovery-trip-destination">{[destination.city || destination.name, destination.country].filter(Boolean).join(', ')}</p>
        <h2><Link to={`/trips/${trip.id}`}>{trip.title}</Link></h2>
        <p className="discovery-trip-meta">{formatDate(trip.startDate)} – {formatDate(trip.endDate)}</p>
        <div className="discovery-trip-facts">
          <span>{formatBudget(trip.budget)}</span>
          <span>{trip.availableSlots} {trip.availableSlots === 1 ? 'slot' : 'slots'} open</span>
        </div>
        {!!trip.travelStyle.length && <p className="discovery-trip-tags">{trip.travelStyle.slice(0, 3).join(' · ')}</p>}
        {!!trip.interests.length && <p className="discovery-trip-interests">{trip.interests.slice(0, 3).join(' · ')}</p>}
        <div className="discovery-trip-creator">
          {trip.creator.profileImage
            ? <img src={trip.creator.profileImage} alt="" loading="lazy" />
            : <span className="discovery-trip-avatar" aria-hidden="true">{trip.creator.name.slice(0, 1).toUpperCase()}</span>}
          <span>{trip.creator.name}</span>
          <span className="discovery-verification" aria-label={[
            verified.email && 'Email verified',
            verified.phone && 'Phone verified',
            verified.identity && 'Identity verified',
          ].filter(Boolean).join(', ') || 'No verification badges'}>
            {verified.identity ? 'Identity verified' : verified.phone ? 'Phone verified' : verified.email ? 'Email verified' : 'Not verified'}
          </span>
        </div>
        <Link className="secondary-btn discovery-trip-view" to={`/trips/${trip.id}`}>View trip</Link>
      </div>
    </article>
  )
}

export default TripCard
