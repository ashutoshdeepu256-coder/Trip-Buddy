import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import tripService from '../../services/tripService'
import { useTripStore } from '../../store/tripStore'
import TripForm from './TripForm'
import '../TripPages.css'

function CreateTrip() {
  const navigate = useNavigate()
  const createTrip = useTripStore((state) => state.createTrip)
  const saving = useTripStore((state) => state.saving)
  const error = useTripStore((state) => state.error)
  const [savedTripId, setSavedTripId] = useState('')
  const [uploadError, setUploadError] = useState('')

  const save = async (values, files) => {
    const trip = await createTrip(values)
    setSavedTripId(trip.id)
    if (files.length) {
      try {
        await tripService.uploadTripImages(trip.id, files)
      } catch (requestError) {
        setUploadError(requestError.response?.data?.error?.message || 'The draft was saved, but the images could not be uploaded.')
        return
      }
    }
    navigate(`/trips/${trip.id}`)
  }

  return (
    <main className="trip-shell">
      <header className="trip-page-header"><Link to="/" className="destination-brand">TripBuddy</Link><nav><Link to="/trips">My trips</Link><Link to="/destinations">Destinations</Link></nav></header>
      <section className="trip-page-intro"><span className="eyebrow">Make a plan, find your people</span><h1>Create a trip</h1><p>Start with a draft. You can fill in details over time and publish when it’s ready.</p></section>
      {uploadError && <p className="form-error" role="alert">{uploadError} <Link to={`/trips/${savedTripId}/edit`}>Open the saved draft</Link></p>}
      <TripForm submitting={saving} error={error} onSave={save} />
    </main>
  )
}

export default CreateTrip
