import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import tripService from '../../services/tripService'
import { useTripStore } from '../../store/tripStore'
import TripForm from './TripForm'
import '../TripPages.css'

function EditTrip() {
  const { tripId } = useParams()
  const navigate = useNavigate()
  const trip = useTripStore((state) => state.currentTrip)
  const loading = useTripStore((state) => state.loading)
  const saving = useTripStore((state) => state.saving)
  const error = useTripStore((state) => state.error)
  const fetchTrip = useTripStore((state) => state.fetchTrip)
  const updateTrip = useTripStore((state) => state.updateTrip)
  const [pageError, setPageError] = useState('')

  useEffect(() => {
    let active = true
    fetchTrip(tripId).catch((requestError) => {
      if (active) setPageError(requestError.response?.data?.error?.message || 'Trip could not be loaded.')
    })
    return () => { active = false }
  }, [fetchTrip, tripId])

  const save = async (values, files) => {
    const updated = await updateTrip(tripId, values)
    if (files.length) await tripService.uploadTripImages(tripId, files)
    navigate(`/trips/${updated.id}`)
  }

  const removeImage = useCallback(async (index) => {
    try {
      await tripService.removeTripImage(tripId, index)
      await fetchTrip(tripId)
    } catch (requestError) {
      setPageError(requestError.response?.data?.error?.message || 'Image could not be removed.')
    }
  }, [fetchTrip, tripId])

  if (loading) return <main className="page-loading" role="status">Loading trip…</main>
  if (pageError || !trip) return <main className="trip-shell"><p className="form-error" role="alert">{pageError || error || 'Trip not found.'}</p><Link to="/trips">Return to my trips</Link></main>
  if (!trip.isOwner) return <main className="trip-shell"><p className="form-error" role="alert">Only the trip creator can edit this trip.</p><Link to={`/trips/${tripId}`}>View trip</Link></main>
  if (['CANCELLED', 'COMPLETED'].includes(trip.status)) return <main className="trip-shell"><p className="form-error" role="alert">This trip can no longer be edited.</p><Link to={`/trips/${tripId}`}>View trip</Link></main>

  return (
    <main className="trip-shell">
      <header className="trip-page-header"><Link to="/" className="destination-brand">TripBuddy</Link><nav><Link to="/trips">My trips</Link><Link to={`/trips/${tripId}`}>View trip</Link></nav></header>
      <section className="trip-page-intro"><span className="eyebrow">Update your plan</span><h1>Edit trip</h1><p>Changes are saved as trip details. Lifecycle status can only be changed using its dedicated actions.</p></section>
      <TripForm trip={trip} submitting={saving} error={error} onSave={save} onRemoveImage={removeImage} />
    </main>
  )
}

export default EditTrip
