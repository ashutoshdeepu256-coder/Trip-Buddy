import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import destinationService from '../services/destinationService'
import './DestinationPages.css'

const feeds = {
  popular: { label: 'Popular', request: destinationService.fetchPopular },
  trending: { label: 'Trending', request: destinationService.fetchTrending },
  seasonal: { label: 'In season', request: destinationService.fetchSeasonal },
  budget: { label: 'Budget friendly', request: destinationService.fetchBudget },
  adventure: { label: 'Adventure', request: destinationService.fetchAdventure },
}

function DestinationCard({ destination }) {
  return (
    <Link className="destination-card" to={`/destinations/${destination.slug}`}>
      {destination.heroImage?.url ? (
        <img
          className="destination-card-image"
          src={destination.heroImage.url}
          alt={destination.heroImage.alt || destination.name}
          loading="lazy"
        />
      ) : (
        <div
          className="destination-card-image destination-image-placeholder"
          aria-hidden="true"
        >
          ✦
        </div>
      )}
      <div className="destination-card-copy">
        <span className="destination-location">
          {[destination.city, destination.state, destination.country]
            .filter(Boolean)
            .join(', ')}
        </span>
        <h2>{destination.name}</h2>
        <p>{destination.description}</p>
        <div className="destination-card-footer">
          <span>
            {destination.estimatedBudget?.min != null
              ? `${destination.estimatedBudget.currency} ${destination.estimatedBudget.min}${destination.estimatedBudget.max != null ? `–${destination.estimatedBudget.max}` : '+'} / ${destination.estimatedBudget.period?.toLowerCase() || 'day'}`
              : 'Budget information unavailable'}
          </span>
          <span>
            {destination.communityStatistics?.tripsCount || 0} community trips
          </span>
        </div>
      </div>
    </Link>
  )
}

function DestinationDiscovery() {
  const [feed, setFeed] = useState('popular')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({
    items: [],
    pagination: { page: 1, pages: 0 },
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nearbyMessage, setNearbyMessage] = useState('')
  const [nearbyLocation, setNearbyLocation] = useState(null)

  const load = useCallback(async () => {
    try {
      const params = { page, limit: 12 }
      const response = nearbyLocation
        ? await destinationService.fetchNearby({
            ...nearbyLocation,
            radiusKm: 100,
            ...params,
          })
        : term
          ? await destinationService.fetchDestinations({
              ...params,
              search: term,
            })
          : await feeds[feed].request(params)
      setResult(response)
    } catch (requestError) {
      setError(
        requestError.response?.data?.error?.message ||
          'Destinations could not be loaded.',
      )
    } finally {
      setLoading(false)
    }
  }, [feed, nearbyLocation, page, term])

  useEffect(() => {
    const request = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(request)
  }, [load])

  const searchDestinations = (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setPage(1)
    setTerm(search.trim())
    setNearbyLocation(null)
    setNearbyMessage('')
  }

  const chooseFeed = (nextFeed) => {
    setLoading(true)
    setError('')
    setFeed(nextFeed)
    setTerm('')
    setNearbyLocation(null)
    setSearch('')
    setPage(1)
    setNearbyMessage('')
  }

  const loadNearby = () => {
    setNearbyMessage('')
    if (!navigator.geolocation) {
      setNearbyMessage('Location search is not supported by this browser.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        setLoading(true)
        setError('')
        setPage(1)
        setTerm('')
        setSearch('')
        setNearbyLocation({ lat: coords.latitude, lng: coords.longitude })
        setNearbyMessage('Showing destinations within 100 km.')
      },
      () =>
        setNearbyMessage(
          'Location permission was not granted. You can still search by name.',
        ),
      { timeout: 10000 },
    )
  }

  const title = term
    ? `Results for “${term}”`
    : nearbyMessage.startsWith('Showing')
      ? 'Nearby destinations'
      : feeds[feed].label + ' destinations'

  return (
    <main className="destination-shell">
      <header className="destination-header">
        <Link className="destination-brand" to="/">
          TripBuddy
        </Link>
        <nav aria-label="Destination navigation">
          <Link to="/">Home</Link>
          <Link to="/profile">Profile</Link>
        </nav>
      </header>
      <section className="destination-hero">
        <span className="eyebrow">Find your next somewhere</span>
        <h1>Go where your story takes you.</h1>
        <p>
          Explore destinations by season, budget, adventure, and the places
          travelers are discovering.
        </p>
        <form className="destination-search" onSubmit={searchDestinations}>
          <label className="sr-only" htmlFor="destination-search">
            Search destinations
          </label>
          <input
            id="destination-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search a city, country, or experience"
            maxLength={120}
          />
          <button className="primary-btn" type="submit">
            Search
          </button>
        </form>
        <button className="nearby-button" type="button" onClick={loadNearby}>
          Use my location for nearby places
        </button>
      </section>
      <section
        className="destination-results"
        aria-labelledby="destination-results-title"
      >
        <div className="destination-feed-bar">
          <div>
            <span className="eyebrow">Curated from destination data</span>
            <h2 id="destination-results-title">{title}</h2>
          </div>
          <div
            className="destination-feed-tabs"
            aria-label="Destination categories"
          >
            {Object.entries(feeds).map(([key, item]) => (
              <button
                className={feed === key && !term ? 'active' : ''}
                key={key}
                type="button"
                onClick={() => chooseFeed(key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {nearbyMessage && (
          <p className="destination-notice" role="status">
            {nearbyMessage}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p className="destination-notice" role="status">
            Finding destinations…
          </p>
        ) : result.items.length ? (
          <>
            <div className="destination-grid">
              {result.items.map((destination) => (
                <DestinationCard
                  destination={destination}
                  key={destination.id}
                />
              ))}
            </div>
            {result.pagination.pages > 1 && (
              <div className="destination-pagination">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {result.pagination.page} of {result.pagination.pages}
                </span>
                <button
                  type="button"
                  disabled={page >= result.pagination.pages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        ) : !error ? (
          <p className="destination-notice">
            No destinations match yet. Try a different search or filter.
          </p>
        ) : null}
      </section>
    </main>
  )
}

export default DestinationDiscovery
