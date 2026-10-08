import { useState } from 'react'
import { Link } from 'react-router-dom'
import authService from '../services/authService'
import { useAuthStore } from '../store/authStore'

const numericOrNull = (value) => value === '' || value === null || value === undefined ? null : Number(value)

function ProfilePage({ edit = false, travelPreferences = false }) {
  const storedUser = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const [profile, setProfile] = useState(storedUser)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const currentProfile = profile?.profile || {}
  const preferences = currentProfile.travelPreferences || {}
  const splitPreferences = (value) => value.split(',').map((item) => item.trim()).filter(Boolean)
  const updateProfileField = (field, value) => {
    setProfile((previous) => ({
      ...previous,
      profile: { ...previous?.profile, [field]: value },
    }))
  }

  const save = async (event) => {
    event.preventDefault()
    setError('')
    const budgetMin = preferences.budgetRangeMin ?? preferences.budgetRange?.min ?? ''
    const budgetMax = preferences.budgetRangeMax ?? preferences.budgetRange?.max ?? ''
    const groupMin = preferences.groupSizeMin ?? preferences.groupSizeRange?.min ?? ''
    const groupMax = preferences.groupSizeMax ?? preferences.groupSizeRange?.max ?? ''
    const hasAvailabilityStart = Boolean(preferences.availabilityStart ?? preferences.availability?.startDate)
    const hasAvailabilityEnd = Boolean(preferences.availabilityEnd ?? preferences.availability?.endDate)
    const hasBudgetMin = budgetMin !== '' && budgetMin !== null && budgetMin !== undefined
    const hasBudgetMax = budgetMax !== '' && budgetMax !== null && budgetMax !== undefined
    const hasGroupMin = groupMin !== '' && groupMin !== null && groupMin !== undefined
    const hasGroupMax = groupMax !== '' && groupMax !== null && groupMax !== undefined
    if (hasBudgetMin !== hasBudgetMax || (hasBudgetMin && Number(budgetMax) < Number(budgetMin))) {
      setError('Enter a complete budget range with the maximum at least the minimum.')
      return
    }
    if (hasGroupMin !== hasGroupMax || (hasGroupMin && Number(groupMax) < Number(groupMin))) {
      setError('Enter a complete preferred group-size range with the maximum at least the minimum.')
      return
    }
    if (hasAvailabilityStart !== hasAvailabilityEnd) {
      setError('Enter both availability dates or leave both blank.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const updates = travelPreferences
        ? {
            travelPreferences: {
            destinations: splitPreferences(preferences.destinationsText ?? (preferences.destinations || []).join(', ')),
            excludedDestinations: splitPreferences(preferences.excludedDestinationsText ?? (preferences.excludedDestinations || []).join(', ')),
            interests: splitPreferences(preferences.interestsText ?? (preferences.interests || []).join(', ')),
            activities: splitPreferences(preferences.activitiesText ?? (preferences.activities || []).join(', ')),
            travelStyle: preferences.travelStyle || '',
            budget: preferences.budget || '',
            groupPreference: preferences.groupPreference || '',
            budgetRange: {
              min: numericOrNull(preferences.budgetRangeMin ?? preferences.budgetRange?.min),
              max: numericOrNull(preferences.budgetRangeMax ?? preferences.budgetRange?.max),
              currency: preferences.budgetRange?.currency || 'USD',
            },
            groupSizeRange: {
              min: numericOrNull(preferences.groupSizeMin ?? preferences.groupSizeRange?.min),
              max: numericOrNull(preferences.groupSizeMax ?? preferences.groupSizeRange?.max),
            },
            availability: preferences.availabilityStart && preferences.availabilityEnd
              ? { startDate: preferences.availabilityStart, endDate: preferences.availabilityEnd }
              : null,
            dateFlexibilityDays: Number(preferences.dateFlexibilityDays) || 0,
            accommodationPreference: splitPreferences(preferences.accommodationText ?? (preferences.accommodationPreference || []).join(', ')),
            transportPreference: splitPreferences(preferences.transportText ?? (preferences.transportPreference || []).join(', ')),
            foodPreference: splitPreferences(preferences.foodText ?? (preferences.foodPreference || []).join(', ')),
            languages: splitPreferences(preferences.languagesText ?? (preferences.languages || []).join(', ')),
            travelPace: preferences.travelPace || '',
            },
          }
        : {
            name: profile.name,
            bio: currentProfile.bio || '',
            city: currentProfile.city || '',
            country: currentProfile.country || '',
          }
      const updated = await authService.updateProfile(updates)
      setUser(updated)
      setProfile(updated)
      setMessage('Your profile was saved.')
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Unable to save your profile.')
    } finally {
      setSaving(false)
    }
  }

  if (edit) {
    return (
      <main className="app-shell inner-shell">
        <div className="content-card">
          <Link to="/profile" className="back-link">← Back to profile</Link>
          <span className="eyebrow">Your travel identity</span>
          <h1>{travelPreferences ? 'Travel preferences' : 'Edit profile'}</h1>
          <form className="form-stack profile-form" onSubmit={save}>
            {travelPreferences ? (
              <>
                <label>Destinations <input value={preferences.destinationsText ?? (preferences.destinations || []).join(', ')} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, destinationsText: event.target.value })} placeholder="Tokyo, Lisbon, Patagonia" /></label>
                <label>Destinations to avoid <input value={preferences.excludedDestinationsText ?? (preferences.excludedDestinations || []).join(', ')} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, excludedDestinationsText: event.target.value })} placeholder="Optional" /></label>
                <label>Interests <input value={preferences.interestsText ?? (preferences.interests || []).join(', ')} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, interestsText: event.target.value })} placeholder="Food, hiking, history" /></label>
                <label>Activities <input value={preferences.activitiesText ?? (preferences.activities || []).join(', ')} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, activitiesText: event.target.value })} placeholder="Museums, cycling, beaches" /></label>
                <label>Travel style <input value={preferences.travelStyle || ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, travelStyle: event.target.value })} maxLength={80} /></label>
                <label>Budget range <input value={preferences.budget || ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, budget: event.target.value })} maxLength={80} /></label>
                <div className="form-row">
                  <label>Budget minimum <input type="number" min="0" value={preferences.budgetRangeMin ?? preferences.budgetRange?.min ?? ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, budgetRangeMin: event.target.value })} /></label>
                  <label>Budget maximum <input type="number" min="0" value={preferences.budgetRangeMax ?? preferences.budgetRange?.max ?? ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, budgetRangeMax: event.target.value })} /></label>
                  <label>Budget currency <input maxLength={3} value={preferences.budgetRange?.currency || 'USD'} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, budgetRange: { ...preferences.budgetRange, currency: event.target.value.toUpperCase() } })} /></label>
                </div>
                <label>Group preference <input value={preferences.groupPreference || ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, groupPreference: event.target.value })} maxLength={80} /></label>
                <div className="form-row">
                  <label>Preferred group minimum <input type="number" min="1" max="100" value={preferences.groupSizeMin ?? preferences.groupSizeRange?.min ?? ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, groupSizeMin: event.target.value })} /></label>
                  <label>Preferred group maximum <input type="number" min="1" max="100" value={preferences.groupSizeMax ?? preferences.groupSizeRange?.max ?? ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, groupSizeMax: event.target.value })} /></label>
                </div>
                <div className="form-row">
                  <label>Available from <input type="date" value={preferences.availabilityStart ?? preferences.availability?.startDate?.slice?.(0, 10) ?? ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, availabilityStart: event.target.value })} /></label>
                  <label>Available through <input type="date" value={preferences.availabilityEnd ?? preferences.availability?.endDate?.slice?.(0, 10) ?? ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, availabilityEnd: event.target.value })} /></label>
                  <label>Date flexibility (days) <input type="number" min="0" max="31" value={preferences.dateFlexibilityDays ?? 0} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, dateFlexibilityDays: event.target.value })} /></label>
                </div>
                <label>Accommodation <input value={preferences.accommodationText ?? (preferences.accommodationPreference || []).join(', ')} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, accommodationText: event.target.value })} placeholder="Hostel, homestay" /></label>
                <label>Transport <input value={preferences.transportText ?? (preferences.transportPreference || []).join(', ')} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, transportText: event.target.value })} placeholder="Train, bus" /></label>
                <label>Food preferences <input value={preferences.foodText ?? (preferences.foodPreference || []).join(', ')} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, foodText: event.target.value })} placeholder="Vegan, vegetarian" /></label>
                <label>Languages <input value={preferences.languagesText ?? (preferences.languages || []).join(', ')} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, languagesText: event.target.value })} placeholder="English, Hindi" /></label>
                <label>Travel pace
                  <select value={preferences.travelPace || ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, travelPace: event.target.value })}>
                    <option value="">No preference</option><option value="RELAXED">Relaxed</option><option value="MODERATE">Moderate</option><option value="FAST">Fast</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>Name <input value={profile?.name || ''} onChange={(event) => setProfile((previous) => ({ ...previous, name: event.target.value }))} required minLength={2} maxLength={80} /></label>
                <label>About you <textarea value={currentProfile.bio || ''} onChange={(event) => updateProfileField('bio', event.target.value)} rows={4} maxLength={1000} /></label>
                <div className="form-row">
                  <label>City <input value={currentProfile.city || ''} onChange={(event) => updateProfileField('city', event.target.value)} maxLength={100} /></label>
                  <label>Country <input value={currentProfile.country || ''} onChange={(event) => updateProfileField('country', event.target.value)} maxLength={100} /></label>
                </div>
              </>
            )}
            {message && <p className="form-success" role="status">{message}</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="primary-btn" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </form>
        </div>
      </main>
    )
  }

  return (
    <main className="app-shell inner-shell">
      <div className="content-card">
        <div className="profile-heading">
          <div className="avatar-mark">{(profile?.name || '?').slice(0, 1).toUpperCase()}</div>
          <div>
            <span className="eyebrow">Traveler profile</span>
            <h1>{profile?.name}</h1>
            <p className="muted-copy">{currentProfile.city}{currentProfile.city && currentProfile.country ? ', ' : ''}{currentProfile.country}</p>
          </div>
        </div>
        <p className="profile-bio">{currentProfile.bio || 'Add a few details about yourself to help find compatible travel companions.'}</p>
        <div className="profile-actions">
          <Link className="primary-btn" to="/trips/create">Create trip</Link>
          <Link className="secondary-btn" to="/my-trips">My trips</Link>
          <Link className="secondary-btn" to="/trips">Discover trips</Link>
          <Link className="secondary-btn" to="/profile/edit">Edit profile</Link>
          <Link className="secondary-btn" to="/profile/travel-preferences">Travel preferences</Link>
          <Link className="primary-btn" to="/verification">Verification &amp; Trust</Link>
        </div>
        <section className="trust-summary">
          <h2>Verification &amp; Trust</h2>
          <TrustBadge verified={profile?.verification?.email?.verified} label="Email verified" />
          <TrustBadge verified={profile?.verification?.phone?.verified} label="Phone verified" />
          <TrustBadge verified={profile?.verification?.identity?.verified} label="Identity verified" />
          <p>Verification badges reflect confirmed account checks, not a trust score.</p>
          <Link to="/verification">Manage verification →</Link>
        </section>
      </div>
    </main>
  )
}

export function TrustBadge({ verified, label }) {
  return (
    <span className={`trust-badge ${verified ? 'is-verified' : ''}`}>
      <span aria-hidden="true">{verified ? '✓' : '○'}</span> {label}
    </span>
  )
}

export default ProfilePage
