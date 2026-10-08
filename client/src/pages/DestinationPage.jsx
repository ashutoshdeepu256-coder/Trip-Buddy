import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import destinationService from '../services/destinationService'
import { getMapPresentation } from '../services/mapProviders'
import './DestinationPages.css'

const formatMonths = (months = []) =>
  months
    .map((month) =>
      new Date(2024, month - 1, 1).toLocaleString(undefined, { month: 'long' }),
    )
    .join(', ')

function DestinationPage() {
  const { id } = useParams()
  const [destination, setDestination] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    destinationService
      .fetchDestination(id)
      .then((value) => {
        if (active) setDestination(value)
      })
      .catch((requestError) => {
        if (active)
          setError(
            requestError.response?.data?.error?.message ||
              'Destination could not be loaded.',
          )
      })
    return () => {
      active = false
    }
  }, [id])

  if (error)
    return (
      <main className="destination-shell">
        <p className="form-error" role="alert">
          {error}
        </p>
        <Link to="/destinations">Back to destinations</Link>
      </main>
    )
  if (!destination)
    return (
      <main className="page-loading" role="status">
        Loading destination…
      </main>
    )

  const map = getMapPresentation(destination)
  const hero = destination.heroImage || destination.images?.[0]
  const budget = destination.estimatedBudget

  return (
    <main className="destination-shell destination-detail">
      <header className="destination-header">
        <Link className="destination-brand" to="/">
          TripBuddy
        </Link>
        <nav aria-label="Destination navigation">
          <Link to="/destinations">Discover</Link>
          <Link to="/profile">Profile</Link>
        </nav>
      </header>
      <Link className="destination-back" to="/destinations">
        ← All destinations
      </Link>
      <section className="destination-detail-hero">
        {hero?.url ? (
          <img src={hero.url} alt={hero.alt || destination.name} />
        ) : (
          <div className="destination-image-placeholder" aria-hidden="true">
            ✦
          </div>
        )}
        <div className="destination-detail-title">
          <span className="eyebrow">
            {[destination.city, destination.state, destination.country]
              .filter(Boolean)
              .join(', ')}
          </span>
          <h1>{destination.name}</h1>
        </div>
      </section>
      <div className="destination-detail-layout">
        <div className="destination-main-column">
          <section className="destination-panel">
            <h2>About this place</h2>
            <p>{destination.description}</p>
          </section>
          <section className="destination-panel">
            <h2>Best time to visit</h2>
            <p>
              {formatMonths(destination.bestMonths) ||
                'Seasonal guidance is not available yet.'}
            </p>
            {destination.weather?.summary && (
              <p>{destination.weather.summary}</p>
            )}
            {destination.weather?.climate && (
              <p className="destination-muted">{destination.weather.climate}</p>
            )}
            {destination.weather?.averageTemperaturesC?.min != null &&
              destination.weather?.averageTemperaturesC?.max != null && (
                <p className="destination-muted">
                  Typical temperatures:{' '}
                  {destination.weather.averageTemperaturesC.min}°C to{' '}
                  {destination.weather.averageTemperaturesC.max}°C
                </p>
              )}
          </section>
          <section className="destination-panel">
            <h2>Things to do</h2>
            {destination.activities?.length ? (
              <div className="destination-tags">
                {destination.activities.map((activity) => (
                  <span key={activity}>{activity}</span>
                ))}
              </div>
            ) : (
              <p className="destination-muted">
                Activities have not been added yet.
              </p>
            )}
          </section>
          <section className="destination-panel">
            <h2>Popular places</h2>
            {destination.popularPlaces?.length ? (
              <div className="destination-place-list">
                {destination.popularPlaces.map((place) => (
                  <article key={place.name}>
                    <h3>{place.name}</h3>
                    <p>{place.description}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="destination-muted">
                Popular places have not been added yet.
              </p>
            )}
          </section>
          <section className="destination-panel">
            <h2>Community trips</h2>
            <p>
              {destination.communityStatistics?.tripsCount || 0} trips listed
              for this destination.
            </p>
            {destination.communityTrips?.length ? (
              destination.communityTrips.map((trip) => (
                <article className="community-trip" key={trip.id}>
                  <h3>{trip.title}</h3>
                  <p>{trip.summary}</p>
                </article>
              ))
            ) : (
              <p className="destination-muted">
                No community trip listings are available yet.
              </p>
            )}
            <h3>Travel buddies</h3>
            <p>
              {destination.communityStatistics?.buddiesCount || 0} travelers are
              looking for buddies here.
            </p>
            {destination.availableTravelBuddies?.length ? (
              destination.availableTravelBuddies.map((buddy) => (
                <p key={buddy.id}>{buddy.name}</p>
              ))
            ) : (
              <p className="destination-muted">
                No buddy listings are available yet.
              </p>
            )}
          </section>
        </div>
        <aside className="destination-side-column">
          <section className="destination-panel destination-facts">
            <h2>Travel information</h2>
            <p>
              <strong>Estimated budget</strong>
              <span>
                {budget?.min != null
                  ? `${budget.currency} ${budget.min}${budget.max != null ? `–${budget.max}` : '+'} per ${budget.period?.toLowerCase() || 'day'}`
                  : 'Not available'}
              </span>
            </p>
            <p>
              <strong>Community travelers</strong>
              <span>
                {destination.communityStatistics?.travelersCount || 0}
              </span>
            </p>
            {Object.entries({
              Currency: destination.travelInformation?.currency,
              Language: destination.travelInformation?.language,
              'Time zone': destination.travelInformation?.timeZone,
              Visa: destination.travelInformation?.visa,
              Safety: destination.travelInformation?.safety,
              Transport: destination.travelInformation?.transport,
            })
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <p key={label}>
                  <strong>{label}</strong>
                  <span>{value}</span>
                </p>
              ))}
          </section>
          <section className="destination-panel">
            <h2>Map</h2>
            {map ? (
              <>
                {map.kind === 'image' ? (
                  <img
                    className="destination-map"
                    src={map.url}
                    alt={`Map of ${destination.name} provided by ${map.provider}`}
                  />
                ) : (
                  <iframe
                    className="destination-map"
                    title={`Map of ${destination.name}`}
                    src={map.url}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                )}
                <a
                  className="destination-map-link"
                  href={map.directionsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open map and directions ↗
                </a>
                <small className="destination-muted">
                  Map by {map.provider}
                </small>
              </>
            ) : (
              <p className="destination-muted">
                Map coordinates are not available for this destination.
              </p>
            )}
          </section>
        </aside>
      </div>
    </main>
  )
}

export default DestinationPage
