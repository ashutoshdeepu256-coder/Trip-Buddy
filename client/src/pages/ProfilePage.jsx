import { useState } from 'react'
import { Link } from 'react-router-dom'
import authService from '../services/authService'
import { useAuthStore } from '../store/authStore'

function ProfilePage({ edit = false, travelPreferences = false }) {
  const storedUser = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const [profile, setProfile] = useState(storedUser)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const currentProfile = profile?.profile || {}
  const preferences = currentProfile.travelPreferences || {}
  const updateProfileField = (field, value) => {
    setProfile((previous) => ({
      ...previous,
      profile: { ...previous?.profile, [field]: value },
    }))
  }

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const updates = travelPreferences
        ? {
            travelPreferences: {
              destinations: (preferences.destinationsText || '').split(',').map((item) => item.trim()).filter(Boolean),
              interests: (preferences.interestsText || '').split(',').map((item) => item.trim()).filter(Boolean),
              activities: (preferences.activitiesText || '').split(',').map((item) => item.trim()).filter(Boolean),
              travelStyle: preferences.travelStyle || '',
              budget: preferences.budget || '',
              groupPreference: preferences.groupPreference || '',
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
                <label>Interests <input value={preferences.interestsText ?? (preferences.interests || []).join(', ')} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, interestsText: event.target.value })} placeholder="Food, hiking, history" /></label>
                <label>Activities <input value={preferences.activitiesText ?? (preferences.activities || []).join(', ')} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, activitiesText: event.target.value })} placeholder="Museums, cycling, beaches" /></label>
                <label>Travel style <input value={preferences.travelStyle || ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, travelStyle: event.target.value })} maxLength={80} /></label>
                <label>Budget range <input value={preferences.budget || ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, budget: event.target.value })} maxLength={80} /></label>
                <label>Group preference <input value={preferences.groupPreference || ''} onChange={(event) => updateProfileField('travelPreferences', { ...preferences, groupPreference: event.target.value })} maxLength={80} /></label>
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
          <span className="secondary-btn" aria-disabled="true" title="Trip discovery is planned for Phase 9">Discover trips · coming soon</span>
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
