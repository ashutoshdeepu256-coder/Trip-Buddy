import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import TripCard from '../../components/trip/TripCard'
import MapPanel from '../../components/maps/MapPanel'
import destinationService from '../../services/destinationService'
import { useTripDiscoveryStore } from '../../store/tripDiscoveryStore'
import { useAuthStore } from '../../store/authStore'
import '../TripPages.css'

const listFilters = [
  ['travelStyle', 'Travel styles'],
  ['interests', 'Interests'],
  ['activities', 'Activities'],
  ['accommodation', 'Accommodation'],
  ['transport', 'Transport'],
  ['foodPreference', 'Food preference'],
  ['language', 'Language'],
]

const valueFrom = (params, key, fallback = '') => params.get(key) || fallback
const readFilters = (searchParams) => Object.fromEntries([
  'destination', 'q', 'startDate', 'endDate', 'dateFlexibility',
  'budgetMin', 'budgetMax', 'budgetCurrency', 'budgetFlexibility',
  'groupSize', 'groupMin', 'groupMax', ...listFilters.map(([key]) => key),
  'verifiedOnly', 'sort',
].map((key) => [key, valueFrom(searchParams, key)]))

const valuesToQuery = (values) => {
  const query = new URLSearchParams()
  const hasDates = Boolean(values.startDate && values.endDate)
  const hasBudget = Boolean(values.budgetMin || values.budgetMax)
  for (const [key, rawValue] of Object.entries(values)) {
    const value = String(rawValue || '').trim()
    if (!value || (['dateFlexibility', 'budgetFlexibility'].includes(key) && Number(value) === 0) ||
      (key === 'verifiedOnly' && value !== 'true')) continue
    if (key === 'dateFlexibility' && !hasDates) continue
    if (key === 'budgetFlexibility' && !hasBudget) continue
    if (key === 'budgetCurrency' && !hasBudget) continue
    query.set(key, value)
  }
  query.set('page', '1')
  query.set('limit', '20')
  return query
}

function DiscoveryFilters({ initialParams, onApply, onClear, loading, open, onClose, isAuthenticated }) {
  const [values, setValues] = useState(() => readFilters(initialParams))
  const [formError, setFormError] = useState('')
  const [destinationOptions, setDestinationOptions] = useState([])
  const [destinationLoading, setDestinationLoading] = useState(false)
  const [destinationError, setDestinationError] = useState('')
  const update = (name, value) => {
    setFormError('')
    if (name === 'destination') {
      setDestinationOptions([])
      setDestinationLoading(false)
      setDestinationError('')
    }
    setValues((current) => ({ ...current, [name]: value }))
  }

  useEffect(() => {
    const search = values.destination.trim()
    if (!search) return undefined
    let active = true
    const timer = window.setTimeout(() => {
      setDestinationLoading(true)
      destinationService.fetchDestinations({ search, limit: 8 })
        .then((response) => { if (active) setDestinationOptions(response.items) })
        .catch((error) => {
          if (active) setDestinationError(error.response?.data?.error?.message || 'Destination search failed.')
        })
        .finally(() => { if (active) setDestinationLoading(false) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [values.destination])

  return (
    <div className={`discovery-filter-backdrop ${open ? 'is-open' : ''}`} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <form className="discovery-filter-panel" onSubmit={(event) => {
        event.preventDefault()
        if (Boolean(values.startDate) !== Boolean(values.endDate)) {
          setFormError('Choose both a start date and an end date.')
          return
        }
        if (values.startDate && values.endDate && values.endDate < values.startDate) {
          setFormError('End date must be on or after the start date.')
          return
        }
        if (values.budgetMin && values.budgetMax && Number(values.budgetMin) > Number(values.budgetMax)) {
          setFormError('Maximum budget must be at least the minimum.')
          return
        }
        if (values.groupMin && values.groupMax && Number(values.groupMin) > Number(values.groupMax)) {
          setFormError('Maximum open slots must be at least the minimum.')
          return
        }
        onApply(values)
        onClose()
      }}>
        <div className="discovery-filter-heading">
          <div><span className="eyebrow">Refine your search</span><h2>Trip filters</h2></div>
          <button className="discovery-filter-close" type="button" onClick={onClose} aria-label="Close filters">×</button>
        </div>
        <label className="discovery-filter-field">Search trips
          <input value={values.q} onChange={(event) => update('q', event.target.value)} placeholder="Title, description, destination" maxLength={100} />
        </label>
        <label className="discovery-filter-field">Destination
          <input value={values.destination} onChange={(event) => update('destination', event.target.value)} placeholder="Search city or country" maxLength={140} autoComplete="off" />
          {destinationLoading && <small role="status">Searching destinations…</small>}
          {destinationError && <small className="discovery-destination-error" role="alert">{destinationError}</small>}
          {!!destinationOptions.length && (
            <div className="discovery-destination-picker" role="listbox" aria-label="Destination search results">
              {destinationOptions.map((destination) => (
                <button key={destination.id} type="button" role="option" onClick={() => {
                  update('destination', destination.slug)
                  setDestinationOptions([])
                }}>
                  <strong>{destination.name}</strong><span>{[destination.city, destination.state, destination.country].filter(Boolean).join(', ')}</span>
                </button>
              ))}
            </div>
          )}
        </label>
        <div className="discovery-filter-pair">
          <label className="discovery-filter-field">Start date
            <input type="date" value={values.startDate} onChange={(event) => update('startDate', event.target.value)} />
          </label>
          <label className="discovery-filter-field">End date
            <input type="date" value={values.endDate} onChange={(event) => update('endDate', event.target.value)} />
          </label>
        </div>
        <label className="discovery-filter-field">Date flexibility
          <select value={values.dateFlexibility || '0'} onChange={(event) => update('dateFlexibility', event.target.value)}>
            <option value="0">Exact dates</option><option value="1">±1 day</option><option value="3">±3 days</option><option value="7">±7 days</option>
          </select>
        </label>
        <div className="discovery-filter-pair">
          <label className="discovery-filter-field">Budget min
            <input type="number" min="0" step="0.01" value={values.budgetMin} onChange={(event) => update('budgetMin', event.target.value)} />
          </label>
          <label className="discovery-filter-field">Budget max
            <input type="number" min="0" step="0.01" value={values.budgetMax} onChange={(event) => update('budgetMax', event.target.value)} />
          </label>
        </div>
        <div className="discovery-filter-pair">
          <label className="discovery-filter-field">Currency
            <select value={values.budgetCurrency || 'USD'} onChange={(event) => update('budgetCurrency', event.target.value)}>
              {['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY'].map((currency) => <option key={currency}>{currency}</option>)}
            </select>
          </label>
          <label className="discovery-filter-field">Budget flexibility
            <select value={values.budgetFlexibility || '0'} onChange={(event) => update('budgetFlexibility', event.target.value)}>
              <option value="0">None</option><option value="5">±5%</option><option value="10">±10%</option><option value="20">±20%</option><option value="50">±50%</option>
            </select>
          </label>
        </div>
        <div className="discovery-filter-pair">
          <label className="discovery-filter-field">Open slots from
            <input type="number" min="1" max="100" value={values.groupMin} onChange={(event) => update('groupMin', event.target.value)} />
          </label>
          <label className="discovery-filter-field">Open slots to
            <input type="number" min="1" max="100" value={values.groupMax} onChange={(event) => update('groupMax', event.target.value)} />
          </label>
        </div>
        <label className="discovery-filter-field">Seats needed
          <input type="number" min="1" max="100" value={values.groupSize} onChange={(event) => update('groupSize', event.target.value)} />
        </label>
        {listFilters.map(([key, label]) => (
          <label className="discovery-filter-field" key={key}>{label}
            <input value={values[key]} onChange={(event) => update(key, event.target.value)} placeholder="Comma-separated" maxLength={600} />
          </label>
        ))}
        <label className="discovery-filter-check">
          <input type="checkbox" checked={values.verifiedOnly === 'true'} onChange={(event) => update('verifiedOnly', event.target.checked ? 'true' : '')} />
          Identity verified trip creators
        </label>
        <label className="discovery-filter-field">Sort by
          <select value={values.sort || 'recent'} onChange={(event) => update('sort', event.target.value)}>
            <option value="recent">Recently created</option><option value="date">Trip date</option>
            <option value="budget_low">Budget: low to high</option><option value="budget_high">Budget: high to low</option>
            <option value="group_availability">Most open slots</option><option value="popularity">Most active members</option>
            {isAuthenticated && <option value="compatibility">Best compatibility</option>}
          </select>
        </label>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="discovery-filter-actions">
          <button type="button" className="secondary-btn" onClick={onClear}>Clear filters</button>
          <button type="submit" className="primary-btn" disabled={loading}>{loading ? 'Searching…' : 'Search trips'}</button>
        </div>
      </form>
    </div>
  )
}

function TripCardSkeleton() {
  return <div className="discovery-skeleton" aria-hidden="true"><span /><div><i /><i /><i /><i /></div></div>
}

function DiscoverySearchBar({ initialValue, onSearch }) {
  const [value, setValue] = useState(() => initialValue)
  return (
    <form className="discovery-search-bar" onSubmit={(event) => {
      event.preventDefault()
      onSearch(value)
    }}>
      <label className="sr-only" htmlFor="trip-search">Search trip title, destination, or description</label>
      <input id="trip-search" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Where do you want to go?" maxLength={100} />
      <button className="primary-btn" type="submit">Search</button>
    </form>
  )
}

function DiscoverTrips() {
  const user = useAuthStore((state) => state.user)
  const [searchParams, setSearchParams] = useSearchParams()
  const searchKey = searchParams.toString()
  const params = useMemo(() => Object.fromEntries(new URLSearchParams(searchKey)), [searchKey])
  const results = useTripDiscoveryStore((state) => state.results)
  const pagination = useTripDiscoveryStore((state) => state.pagination)
  const loading = useTripDiscoveryStore((state) => state.loading)
  const loadingMore = useTripDiscoveryStore((state) => state.loadingMore)
  const error = useTripDiscoveryStore((state) => state.error)
  const searchTrips = useTripDiscoveryStore((state) => state.searchTrips)
  const loadMore = useTripDiscoveryStore((state) => state.loadMore)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [nearby, setNearby] = useState(null)
  const [locationMessage, setLocationMessage] = useState('')
  const [mappedTrip, setMappedTrip] = useState(null)
  const initialParams = useMemo(() => new URLSearchParams(searchKey), [searchKey])

  useEffect(() => {
    searchTrips({ page: 1, limit: 20, ...params, ...(nearby || {}) }).catch(() => {})
  }, [params, nearby, searchTrips])

  const applyFilters = (values) => setSearchParams(valuesToQuery(values))
  const clearFilters = () => {
    setSearchParams({})
    setFiltersOpen(false)
  }
  const retry = () => searchTrips({ page: 1, limit: 20, ...params }).catch(() => {})
  const fetchNextPage = () => loadMore({ limit: 20, ...params, ...(nearby || {}) }).catch(() => {})
  const findNearbyTrips = () => {
    setLocationMessage('')
    if (!navigator.geolocation) return setLocationMessage('Location search is not supported by this browser.')
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setNearby({ lat: coords.latitude, lng: coords.longitude, radiusKm: 100 })
      setLocationMessage('Showing public and community trips within 100 km. Your coordinates are used only for this search.')
    }, () => setLocationMessage('Location permission was not granted. You can still search trips by destination.'), { timeout: 10000 })
  }

  return (
    <main className="trip-shell discovery-shell">
      <header className="trip-page-header"><Link to="/" className="destination-brand">TripBuddy</Link><nav><Link to="/destinations">Destinations</Link><Link to="/my-trips">My trips</Link></nav></header>
      <section className="trip-page-intro discovery-intro">
        <span className="eyebrow">Real plans from real travelers</span><h1>Discover trips</h1>
        <p>Search published trips by dates, budget, activities, and the people planning them.</p>
        <DiscoverySearchBar key={searchKey} initialValue={params.q || ''} onSearch={(query) => {
          const values = readFilters(new URLSearchParams(searchKey))
          values.q = query
          applyFilters(values)
        }} />
        <button className="secondary-btn trip-location-search" type="button" onClick={findNearbyTrips}>Use my location for nearby trips</button>
        {nearby && <button className="secondary-btn trip-location-search" type="button" onClick={() => { setNearby(null); setLocationMessage('Nearby search cleared.') }}>Clear nearby search</button>}
        {locationMessage && <p className="discovery-footnote" role="status">{locationMessage}</p>}
      </section>
      <div className="discovery-toolbar">
        <button className="secondary-btn discovery-open-filters" type="button" onClick={() => setFiltersOpen(true)}>Filters</button>
        <span>{loading ? 'Searching…' : `${pagination.total} ${pagination.total === 1 ? 'trip' : 'trips'} found`}</span>
        <Link to="/my-trips">Manage my trips</Link>
      </div>
      <div className="discovery-layout">
        <DiscoveryFilters
          key={searchKey}
          initialParams={initialParams}
          onApply={applyFilters}
          onClear={clearFilters}
          loading={loading}
          isAuthenticated={Boolean(user)}
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
        />
        <section className="discovery-results" aria-label="Trip search results" aria-busy={loading}>
          {error && <div className="discovery-error" role="alert"><p>{error}</p><button className="secondary-btn" onClick={retry}>Try again</button></div>}
          {pagination.truncated && <p className="discovery-footnote">Compatibility is ranked across the {pagination.candidateLimit} most recent eligible trips matching these filters.</p>}
          {results.some((trip) => trip.destination?.coordinates?.coordinates?.length === 2) && <div className="trip-nearby-map">
            <p className="discovery-footnote">Map markers show published destination locations, not private trip meeting points.</p>
            <div className="destination-map-selectors">{results.filter((trip) => trip.destination?.coordinates?.coordinates?.length === 2).map((trip) => <button type="button" key={trip.id} aria-pressed={mappedTrip?.id === trip.id} onClick={() => setMappedTrip(trip)}>{trip.destination.name}</button>)}</div>
            {results.some((trip) => trip.id === mappedTrip?.id) && mappedTrip?.destination?.coordinates && <MapPanel key={mappedTrip.id} location={mappedTrip.destination} title={`Destination · ${mappedTrip.destination.name}`} />}
          </div>}
          {loading ? <div className="discovery-trip-grid">{[0, 1, 2, 3, 4, 5].map((item) => <TripCardSkeleton key={item} />)}</div>
            : results.length ? <>
              <div className="discovery-trip-grid">{results.map((trip) => <article className="trip-map-result" key={trip.id}><TripCard trip={trip} />{Number.isFinite(trip.distanceKm) && <p className="discovery-footnote">About {trip.distanceKm} km away · straight-line distance</p>}</article>)}</div>
              {pagination.hasNextPage && <button className="secondary-btn discovery-load-more" type="button" onClick={fetchNextPage} disabled={loadingMore}>{loadingMore ? 'Loading more trips…' : 'Load more trips'}</button>}
            </> : !error && <div className="trip-empty-state discovery-empty">
              <h2>No trips match these filters yet</h2><p>Try another destination, widen your dates, increase your budget flexibility, or remove a filter.</p>
              <button className="secondary-btn" type="button" onClick={clearFilters}>Clear filters</button>
            </div>}
        </section>
      </div>
      <p className="discovery-footnote">Only published, upcoming trips with open places are discoverable. Private and invite-only trips are never listed.</p>
    </main>
  )
}

export default DiscoverTrips
