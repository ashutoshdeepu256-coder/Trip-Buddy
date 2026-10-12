import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTripStore } from '../../store/tripStore'
import { useAuthStore } from '../../store/authStore'
import matchingService from '../../services/matchingService'
import CompatibilityScore from '../../components/matching/CompatibilityScore'
import GroupFormationPanel from '../../components/matching/GroupFormationPanel'
import ConnectionRequestButton from '../../components/connections/ConnectionRequestButton'
import chatService from '../../services/chatService'
import MapPanel from '../../components/maps/MapPanel'
import '../TripPages.css'

const nextStatus = {
  PUBLISHED: 'PLANNING',
  PLANNING: 'CONFIRMED',
  CONFIRMED: 'ONGOING',
  ONGOING: 'COMPLETED',
}
const displayDate = (value) => value
  ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  : 'Not set'
const pretty = (value) => value?.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase()) || 'Not set'
const formatList = (values) => values?.length ? values.map(pretty).join(', ') : 'Not set'

function TripDetails() {
  const { tripId } = useParams()
  const navigate = useNavigate()
  const trip = useTripStore((state) => state.currentTrip)
  const user = useAuthStore((state) => state.user)
  const authLoading = useAuthStore((state) => state.loading)
  const loading = useTripStore((state) => state.loading)
  const saving = useTripStore((state) => state.saving)
  const error = useTripStore((state) => state.error)
  const fetchTrip = useTripStore((state) => state.fetchTrip)
  const publishTrip = useTripStore((state) => state.publishTrip)
  const cancelTrip = useTripStore((state) => state.cancelTrip)
  const changeTripStatus = useTripStore((state) => state.changeTripStatus)
  const deleteTrip = useTripStore((state) => state.deleteTrip)
  const [matchingData, setMatchingData] = useState(null)
  const [refreshingMatch, setRefreshingMatch] = useState(false)
  const [openingChat, setOpeningChat] = useState(false)
  const [chatError, setChatError] = useState('')
  const matchingKey = user && trip ? `${tripId}:${user.id}:${user.updatedAt || ''}` : null
  const matchingLoading = Boolean(matchingKey && matchingData?.key !== matchingKey)
  const compatibility = matchingData?.key === matchingKey ? matchingData.result : null
  const matchingError = matchingData?.key === matchingKey ? matchingData.error : ''
  const groupFormationAvailable = ['PUBLISHED', 'PLANNING', 'CONFIRMED'].includes(trip?.status)
    && ['PUBLIC', 'COMMUNITY'].includes(trip?.privacy)
  const tripChatAvailable = ['PUBLISHED', 'PLANNING', 'CONFIRMED', 'ONGOING'].includes(trip?.status)

  const openTripChat = async () => {
    setOpeningChat(true)
    setChatError('')
    try {
      const conversation = await chatService.trip(tripId)
      navigate(`/chat?conversation=${encodeURIComponent(conversation.id)}`)
    } catch (requestError) {
      setChatError(requestError.response?.data?.error?.message || 'Trip chat is unavailable for your current membership.')
    } finally { setOpeningChat(false) }
  }

  useEffect(() => {
    fetchTrip(tripId).catch(() => {})
  }, [fetchTrip, tripId])

  useEffect(() => {
    if (authLoading || !user || !trip || trip.id !== tripId || trip.isOwner) {
      return undefined
    }
    let active = true
    const key = `${tripId}:${user.id}:${user.updatedAt || ''}`
    matchingService.getTripCompatibility(tripId)
      .then((result) => { if (active) setMatchingData({ key, result, error: '' }) })
      .catch((requestError) => {
        if (active) setMatchingData({
          key,
          result: null,
          error: requestError.response?.data?.error?.message || 'Compatibility could not be calculated.',
        })
      })
    return () => { active = false }
  }, [authLoading, trip, tripId, user])

  const owner = trip?.isOwner
  const action = async (operation) => {
    try { await operation(tripId) } catch { /* Store exposes the request error. */ }
  }
  const refreshCompatibility = async () => {
    setRefreshingMatch(true)
    setMatchingData({ key: matchingKey, result: compatibility, error: '' })
    try {
      const match = await matchingService.refreshTripCompatibility(tripId)
      setMatchingData({ key: matchingKey, error: '', result: {
        overallScore: match.score,
        category: match.category,
        scoreBasis: match.scoreBasis,
        dataCoverage: match.dataCoverage,
        breakdown: match.scoreBreakdown,
        dimensionStatus: match.dimensionStatus,
        preferenceBreakdown: match.preferenceBreakdown,
        reasons: match.reasons,
        matchReasons: match.matchReasons,
        potentialDifferences: match.potentialDifferences,
        evaluatedDimensions: match.evaluatedDimensions,
        unknownDimensions: match.unknownDimensions,
      } })
    } catch (requestError) {
      setMatchingData({
        key: matchingKey,
        result: compatibility,
        error: requestError.response?.data?.error?.message || 'Compatibility could not be refreshed.',
      })
    } finally {
      setRefreshingMatch(false)
    }
  }

  if (loading) return <main className="page-loading" role="status">Loading trip…</main>
  if (!trip) return <main className="trip-shell"><p className="form-error" role="alert">{error || 'Trip could not be found or you do not have permission to view it.'}</p><Link to="/my-trips">Back to my trips</Link></main>

  return (
    <main className="trip-shell">
      <header className="trip-page-header"><Link to="/" className="destination-brand">TripBuddy</Link><nav><Link to="/my-trips">My trips</Link><Link to="/trips">Discover trips</Link><Link to="/destinations">Destinations</Link></nav></header>
      <div className="trip-detail-heading">
        <div><Link className="trip-back" to={owner ? '/my-trips' : '/trips'}>← {owner ? 'My trips' : 'Discover trips'}</Link><span className={`trip-status status-${trip.status.toLowerCase()}`}>{pretty(trip.status)}</span><h1>{trip.title || 'Untitled trip draft'}</h1><p>{trip.destination?.name ? `${trip.destination.name}${trip.destination.country ? `, ${trip.destination.country}` : ''}` : 'Choose a destination'}</p></div>
        {owner && <div className="trip-detail-actions">
          {!['CANCELLED', 'COMPLETED'].includes(trip.status) && <Link className="secondary-btn" to={`/planner?tripId=${encodeURIComponent(trip.id)}`}>Build itinerary</Link>}
          <Link className="secondary-btn" to={`/bookings?tripId=${encodeURIComponent(trip.id)}`}>My trip bookings</Link>
          {trip.status === 'DRAFT' && <Link className="secondary-btn" to={`/trips/${trip.id}/edit`}>Edit draft</Link>}
          {trip.status === 'DRAFT' && <button className="primary-btn" type="button" disabled={saving} onClick={() => action(publishTrip)}>Publish trip</button>}
          {nextStatus[trip.status] && <button className="secondary-btn" type="button" disabled={saving} onClick={() => action((id) => changeTripStatus(id, nextStatus[trip.status]))}>Move to {pretty(nextStatus[trip.status])}</button>}
          {!['CANCELLED', 'COMPLETED'].includes(trip.status) && <button className="trip-danger-button" type="button" disabled={saving} onClick={() => {
            if (window.confirm('Cancel this trip? This cannot be undone.')) void action(cancelTrip)
          }}>Cancel</button>}
          {trip.status === 'DRAFT' && <button className="trip-danger-button" type="button" disabled={saving} onClick={() => {
            if (window.confirm('Delete this draft permanently?')) void deleteTrip(trip.id).then(() => navigate('/my-trips')).catch(() => {})
          }}>Delete draft</button>}
        </div>}
      </div>
      {user && (trip.isOwner || trip.isMember) && <Link className="secondary-btn" to={`/trips/${encodeURIComponent(trip.id)}/expenses`}>Open shared expense ledger</Link>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="trip-gallery">
        {trip.images?.length ? trip.images.map((image, index) => <img key={`${image.url}-${index}`} src={image.url} alt={`${trip.title || 'Trip'} photo ${index + 1}`} />) : <div className="trip-gallery-placeholder"><span>Trip photos</span><small>Images will appear here when added by the creator.</small></div>}
      </div>
      <div className="trip-detail-layout">
        <div className="trip-detail-main">
          <section className="trip-panel"><h2>About this trip</h2><p>{trip.description || 'The creator has not added a description yet.'}</p></section>
          <section className="trip-panel trip-facts-grid">
            <p><strong>Dates</strong><span>{displayDate(trip.startDate)} – {displayDate(trip.endDate)}</span></p>
            <p><strong>Budget</strong><span>{trip.budget?.min != null ? `${trip.budget.currency} ${trip.budget.min}${trip.budget.max != null ? `–${trip.budget.max}` : '+'}` : 'Not set'}</span></p>
            <p><strong>Group size</strong><span>{trip.groupSize?.min || 1}–{trip.groupSize?.max || 1} travelers</span></p>
            <p><strong>Privacy</strong><span>{pretty(trip.privacy)}</span></p>
            <p><strong>Travel style</strong><span>{formatList(trip.travelStyle)}</span></p>
            <p><strong>Interests</strong><span>{formatList(trip.interests)}</span></p>
            <p><strong>Activities</strong><span>{formatList(trip.activities)}</span></p>
            <p><strong>Accommodation</strong><span>{formatList(trip.accommodationPreference)}</span></p>
            <p><strong>Transport</strong><span>{formatList(trip.transportPreference)}</span></p>
            <p><strong>Food preferences</strong><span>{formatList(trip.foodPreference)}</span></p>
            <p><strong>Travel pace</strong><span>{pretty(trip.travelPace)}</span></p>
          </section>
          <section className="trip-panel"><h2>Plan together</h2><p>Compatibility and consent-based group recommendations are available for this trip.</p><div className="trip-future-grid"><span>Matching · active</span><span>Group recommendations · active</span><span>Connections · active</span><span>Trip chat · active members</span></div>
            {user && tripChatAvailable && (trip.isOwner || trip.isMember) && <button type="button" className="primary-btn" disabled={openingChat} onClick={openTripChat}>{openingChat ? 'Opening chat…' : 'Open trip chat'}</button>}
            {chatError && <p className="form-error" role="alert">{chatError}</p>}
          </section>
          {trip.isOwner
            ? user && (groupFormationAvailable
              ? <GroupFormationPanel trip={trip} user={user} />
              : <section className="trip-panel"><h2>Group recommendations</h2><p>This trip is not currently eligible for group recommendations.</p></section>)
            : !user && !authLoading
              ? <section className="trip-panel"><h2>Travel compatibility</h2><p>Sign in to see how this trip aligns with your travel preferences.</p><Link className="primary-btn" to="/login">Sign in to check compatibility</Link></section>
              : user && <>
                <section className="trip-panel">
                  {matchingLoading && <p role="status">Calculating your travel compatibility…</p>}
                  {matchingError && <p className="form-error" role="alert">{matchingError}</p>}
                  <CompatibilityScore compatibility={compatibility} onRefresh={refreshCompatibility} refreshing={refreshingMatch} />
                </section>
                {groupFormationAvailable && <GroupFormationPanel trip={trip} user={user} />}
              </>}
        </div>
        <aside className="trip-detail-side">
          <section className="trip-panel"><h2>Destination</h2>
            {trip.destination ? <>
              <Link to={`/destinations/${trip.destination.slug}`} className="trip-destination-link"><strong>{trip.destination.name}</strong><span>{[trip.destination.city, trip.destination.state, trip.destination.country].filter(Boolean).join(', ')}</span></Link>
              {trip.destination.images?.[0]?.url && <img className="trip-destination-image" src={trip.destination.images[0].url} alt={trip.destination.images[0].alt || trip.destination.name} />}
            </> : <p>Destination not selected.</p>}
          </section>
          {(trip.isOwner || trip.isMember) && trip.location
            ? <MapPanel location={trip} title="Trip location" />
            : trip.destination?.coordinates && <MapPanel location={trip.destination} title="Destination map" />}
          <section className="trip-panel">
            <h2>Trip creator</h2>
            <p className="trip-creator-name">{trip.creator?.name || 'TripBuddy traveler'}</p>
            {user && !owner && trip.creator?.id && <ConnectionRequestButton recipientId={trip.creator.id} tripId={trip.id} />}
            {!user && !authLoading && <Link className="primary-btn" to="/login">Sign in to connect with the creator</Link>}
            {trip.creator?.location && <p>{trip.creator.location}</p>}
            {trip.creator?.joinedAt && <p>Member since {new Date(trip.creator.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>}
          </section>
        </aside>
      </div>
    </main>
  )
}

export default TripDetails
