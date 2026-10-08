import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import destinationService from '../../services/destinationService'
import '../TripPages.css'

const formSchema = z.object({
  destination: z.string().optional(),
  title: z.string().trim().max(120).refine((value) => !value || value.length >= 3, 'Use at least 3 characters.'),
  description: z.string().trim().max(4000).refine((value) => !value || value.length >= 20, 'Add at least 20 characters or keep the draft empty.'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budgetMin: z.string().optional(),
  budgetMax: z.string().optional(),
  budgetCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  groupMin: z.coerce.number().int().min(1).max(100),
  groupMax: z.coerce.number().int().min(1).max(100),
  travelStyle: z.string().max(500),
  interests: z.string().max(1200),
  activities: z.string().max(1200),
  accommodationPreference: z.string().max(500),
  transportPreference: z.string().max(500),
  foodPreference: z.string().max(500),
  privacy: z.enum(['PUBLIC', 'COMMUNITY', 'PRIVATE', 'INVITE_ONLY']),
}).superRefine((values, context) => {
  if (values.startDate && values.endDate && new Date(values.endDate) <= new Date(values.startDate)) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be after start date.' })
  }
  if (values.budgetMin && (!Number.isFinite(Number(values.budgetMin)) || Number(values.budgetMin) < 0)) {
    context.addIssue({ code: 'custom', path: ['budgetMin'], message: 'Minimum budget cannot be negative.' })
  }
  if (values.budgetMax && (!Number.isFinite(Number(values.budgetMax)) || Number(values.budgetMax) < 0)) {
    context.addIssue({ code: 'custom', path: ['budgetMax'], message: 'Maximum budget cannot be negative.' })
  }
  if (values.budgetMin && values.budgetMax && Number(values.budgetMax) < Number(values.budgetMin)) {
    context.addIssue({ code: 'custom', path: ['budgetMax'], message: 'Maximum budget must be at least the minimum.' })
  }
  if (values.groupMax < values.groupMin) {
    context.addIssue({ code: 'custom', path: ['groupMax'], message: 'Maximum group size must be at least the minimum.' })
  }
})

const joinList = (items) => (items || []).join(', ')
const splitList = (value) => [...new Map(
  value.split(',').map((item) => item.trim()).filter(Boolean).map((item) => [item.toLocaleLowerCase(), item]),
).values()]
const toDateInput = (value) => value ? new Date(value).toISOString().slice(0, 10) : ''
const errorMessage = (errors, name) => errors[name]?.message

function TripForm({ trip, submitting, error, onSave, onRemoveImage }) {
  const [destinationSearch, setDestinationSearch] = useState(trip?.destination?.name || '')
  const [destinationOptions, setDestinationOptions] = useState([])
  const [destinationLoading, setDestinationLoading] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState([])
  const [formMessage, setFormMessage] = useState('')
  const schema = useMemo(() => formSchema, [])
  const defaults = useMemo(() => ({
    destination: typeof trip?.destination === 'string' ? trip.destination : trip?.destination?.id || '',
    title: trip?.title || '',
    description: trip?.description || '',
    startDate: toDateInput(trip?.startDate),
    endDate: toDateInput(trip?.endDate),
    budgetMin: trip?.budget?.min == null ? '' : String(trip.budget.min),
    budgetMax: trip?.budget?.max == null ? '' : String(trip.budget.max),
    budgetCurrency: trip?.budget?.currency || 'USD',
    groupMin: trip?.groupSize?.min || 1,
    groupMax: trip?.groupSize?.max || 1,
    travelStyle: joinList(trip?.travelStyle),
    interests: joinList(trip?.interests),
    activities: joinList(trip?.activities),
    accommodationPreference: joinList(trip?.accommodationPreference),
    transportPreference: joinList(trip?.transportPreference),
    foodPreference: joinList(trip?.foodPreference),
    privacy: trip?.privacy || 'PUBLIC',
  }), [trip])
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(schema), defaultValues: defaults })

  useEffect(() => {
    if (!trip?.destination) return
    setDestinationSearch(trip.destination.name || '')
    setValue('destination', trip.destination.id || trip.destination, { shouldDirty: false })
  }, [trip, setValue])

  useEffect(() => {
    const search = destinationSearch.trim()
    if (!search) {
      setDestinationOptions([])
      return undefined
    }
    let active = true
    const timer = window.setTimeout(() => {
      setDestinationLoading(true)
      destinationService.fetchDestinations({ search, limit: 8 })
        .then((response) => { if (active) setDestinationOptions(response.items) })
        .catch((requestError) => {
          if (active) setFormMessage(requestError.response?.data?.error?.message || 'Destination search failed.')
        })
        .finally(() => { if (active) setDestinationLoading(false) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [destinationSearch])

  useEffect(() => {
    if (!isDirty) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])

  useEffect(() => {
    for (const [field, value] of Object.entries(defaults)) {
      setValue(field, value, { shouldDirty: false })
    }
  }, [defaults, setValue])

  const submit = handleSubmit(async (values) => {
    setFormMessage('')
    const budgetMin = values.budgetMin === '' ? null : Number(values.budgetMin)
    const budgetMax = values.budgetMax === '' ? null : Number(values.budgetMax)
    if (budgetMin != null && budgetMax != null && budgetMax < budgetMin) {
      setError('budgetMax', { type: 'manual', message: 'Maximum budget must be at least the minimum.' })
      return
    }
    try {
      await onSave({
        destination: values.destination || null,
        title: values.title,
        description: values.description,
        startDate: values.startDate || null,
        endDate: values.endDate || null,
        budget: { min: budgetMin, max: budgetMax, currency: values.budgetCurrency },
        groupSize: { min: Number(values.groupMin), max: Number(values.groupMax) },
        travelStyle: splitList(values.travelStyle),
        interests: splitList(values.interests),
        activities: splitList(values.activities),
        accommodationPreference: splitList(values.accommodationPreference),
        transportPreference: splitList(values.transportPreference),
        foodPreference: splitList(values.foodPreference),
        privacy: values.privacy,
      }, selectedFiles)
    } catch (requestError) {
      setFormMessage(requestError.response?.data?.error?.message || 'The trip draft could not be saved.')
    }
  })

  const selectDestination = (destination) => {
    setValue('destination', destination.id, { shouldDirty: true, shouldValidate: true })
    setDestinationSearch([destination.name, destination.country].filter(Boolean).join(', '))
    setDestinationOptions([])
  }

  const uploadFiles = (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length + (trip?.images?.length || 0) > 8) {
      setFormMessage('A trip can have no more than 8 images total.')
      event.target.value = ''
      return
    }
    const invalid = files.find((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)
    if (invalid) {
      setFormMessage('Images must be JPEG, PNG, or WEBP and 8 MB or smaller.')
      event.target.value = ''
      return
    }
    setSelectedFiles(files)
    setFormMessage('')
  }

  const fields = watch()

  return (
    <form className="trip-form" onSubmit={submit} noValidate>
      <section className="trip-form-section">
        <span className="trip-step">01 · Destination</span>
        <label className="trip-field">
          <span>Find a destination</span>
          <input value={destinationSearch} onChange={(event) => {
            setDestinationSearch(event.target.value)
            setValue('destination', '', { shouldDirty: true })
          }} placeholder="Search city or country" autoComplete="off" />
          <input type="hidden" {...register('destination')} />
          {destinationLoading && <small role="status">Searching destinations…</small>}
          {!!destinationOptions.length && (
            <div className="destination-picker" role="listbox" aria-label="Destination search results">
              {destinationOptions.map((destination) => (
                <button key={destination.id} type="button" role="option" onClick={() => selectDestination(destination)}>
                  <strong>{destination.name}</strong><span>{[destination.city, destination.state, destination.country].filter(Boolean).join(', ')}</span>
                </button>
              ))}
            </div>
          )}
          {errorMessage(errors, 'destination') && <small className="trip-field-error">{errorMessage(errors, 'destination')}</small>}
          <small>A destination is required before a draft can be published.</small>
        </label>
      </section>

      <section className="trip-form-section">
        <span className="trip-step">02 · The trip</span>
        <div className="trip-field-grid">
          <label className="trip-field trip-field-wide"><span>Trip title</span><input {...register('title')} maxLength={120} placeholder="A week exploring the coast" />{errorMessage(errors, 'title') && <small className="trip-field-error">{errorMessage(errors, 'title')}</small>}</label>
          <label className="trip-field trip-field-wide"><span>Description</span><textarea {...register('description')} rows={4} maxLength={4000} placeholder="What would you like to do together?" />{errorMessage(errors, 'description') && <small className="trip-field-error">{errorMessage(errors, 'description')}</small>}</label>
          <label className="trip-field"><span>Start date</span><input type="date" {...register('startDate')} />{errorMessage(errors, 'startDate') && <small className="trip-field-error">{errorMessage(errors, 'startDate')}</small>}</label>
          <label className="trip-field"><span>End date</span><input type="date" {...register('endDate')} />{errorMessage(errors, 'endDate') && <small className="trip-field-error">{errorMessage(errors, 'endDate')}</small>}</label>
        </div>
      </section>

      <section className="trip-form-section">
        <span className="trip-step">03 · Budget and group</span>
        <div className="trip-field-grid">
          <label className="trip-field"><span>Minimum budget</span><input type="number" min="0" step="0.01" {...register('budgetMin')} placeholder="Optional" />{errorMessage(errors, 'budgetMin') && <small className="trip-field-error">{errorMessage(errors, 'budgetMin')}</small>}</label>
          <label className="trip-field"><span>Maximum budget</span><input type="number" min="0" step="0.01" {...register('budgetMax')} placeholder="Optional" />{errorMessage(errors, 'budgetMax') && <small className="trip-field-error">{errorMessage(errors, 'budgetMax')}</small>}</label>
          <label className="trip-field"><span>Currency</span><input {...register('budgetCurrency')} maxLength={3} /></label>
          <label className="trip-field"><span>Minimum group size</span><input type="number" min="1" max="100" {...register('groupMin')} />{errorMessage(errors, 'groupMin') && <small className="trip-field-error">{errorMessage(errors, 'groupMin')}</small>}</label>
          <label className="trip-field"><span>Maximum group size</span><input type="number" min="1" max="100" {...register('groupMax')} />{errorMessage(errors, 'groupMax') && <small className="trip-field-error">{errorMessage(errors, 'groupMax')}</small>}</label>
        </div>
      </section>

      <details className="trip-form-section trip-optional-section">
        <summary><span className="trip-step">04 · Preferences</span><span>Add interests, activities, and travel preferences</span></summary>
        <div className="trip-field-grid trip-preferences-grid">
          {[
            ['travelStyle', 'Travel style'],
            ['interests', 'Interests'],
            ['activities', 'Activities'],
            ['accommodationPreference', 'Accommodation preferences'],
            ['transportPreference', 'Transport preferences'],
            ['foodPreference', 'Food preferences'],
          ].map(([name, label]) => (
            <label className="trip-field" key={name}><span>{label}</span><input {...register(name)} placeholder="Comma-separated" /><small>Separate multiple options with commas.</small></label>
          ))}
        </div>
      </details>

      <section className="trip-form-section">
        <span className="trip-step">05 · Visibility and photos</span>
        <div className="trip-field-grid">
          <label className="trip-field"><span>Privacy</span>
            <select {...register('privacy')}>
              <option value="PUBLIC">Public — discoverable by travellers</option>
              <option value="COMMUNITY">Community — TripBuddy members</option>
              <option value="PRIVATE">Private — owner and trip members</option>
              <option value="INVITE_ONLY">Invite only — invited members</option>
            </select>
          </label>
          <label className="trip-field"><span>Trip images (JPEG, PNG, WEBP; max 8 MB each)</span>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={uploadFiles} />
            {!!selectedFiles.length && <small>{selectedFiles.length} image{selectedFiles.length === 1 ? '' : 's'} selected.</small>}
            {!!trip?.images?.length && <small>{trip.images.length} existing image{trip.images.length === 1 ? '' : 's'} are stored securely.</small>}
          </label>
        </div>
        {!!trip?.images?.length && onRemoveImage && (
          <div className="trip-existing-images">
            {trip.images.map((image, index) => (
              <figure key={`${image.url}-${index}`}><img src={image.url} alt={`Trip image ${index + 1}`} /><button type="button" onClick={() => onRemoveImage(index)} disabled={submitting}>Remove</button></figure>
            ))}
          </div>
        )}
      </section>

      {formMessage && <p className="form-error" role="alert">{formMessage}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="trip-form-footer">
        <p>Saving creates a private draft. Publishing is a separate action and checks all required details again.</p>
        <button className="primary-btn" type="submit" disabled={submitting}>{submitting ? 'Saving…' : trip ? 'Save draft changes' : 'Save trip draft'}</button>
      </div>
      {fields.destination && <span className="sr-only" aria-live="polite">Destination selected.</span>}
    </form>
  )
}

export default TripForm
