import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../services/api'
import { TrustBadge } from './ProfilePage'
import { useAuthStore } from '../store/authStore'
import ConnectionRequestButton from '../components/connections/ConnectionRequestButton'
import ReviewSection from '../components/reviews/ReviewSection'

function PublicProfilePage() {
  const { userId } = useParams()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const currentUser = useAuthStore((state) => state.user)

  useEffect(() => {
    let active = true
    api.get(`/users/${userId}`)
      .then((response) => {
        if (active) setProfile(response.data.data)
      })
      .catch((requestError) => {
        if (active) setError(requestError.response?.data?.error?.message || 'Profile could not be loaded.')
      })
    return () => { active = false }
  }, [userId])

  if (error) return <main className="app-shell inner-shell"><div className="content-card"><p className="form-error">{error}</p><Link to="/">Return home</Link></div></main>
  if (!profile) return <main className="page-loading" role="status">Loading profile…</main>

  return (
    <main className="app-shell inner-shell">
      <div className="content-card">
        <Link to="/" className="back-link">← TripBuddy</Link>
        <div className="profile-heading">
          <div className="avatar-mark">{profile.name.slice(0, 1).toUpperCase()}</div>
          <div><span className="eyebrow">Traveler</span><h1>{profile.name}</h1></div>
        </div>
        <p className="profile-bio">{profile.profile?.bio || 'This traveler has not added a bio yet.'}</p>
        {currentUser && currentUser.id !== userId
          ? <ConnectionRequestButton recipientId={userId} />
          : !currentUser && <Link className="primary-btn" to="/login">Sign in to connect</Link>}
        <section className="trust-summary">
          <h2>Verified signals</h2>
          <TrustBadge verified={profile.trust.emailVerified} label="Email verified" />
          <TrustBadge verified={profile.trust.phoneVerified} label="Phone verified" />
          <TrustBadge verified={profile.trust.identityVerified} label="Identity verified" />
          <div className="trust-facts">
            <span>{profile.trust.tripsCompleted} trips completed</span>
            <span>{profile.trust.reviewsReceived} reviews</span>
            {profile.trust.averageRating !== null && <span>{profile.trust.averageRating} average rating</span>}
          </div>
        </section>
        <ReviewSection mode="traveller" targetId={userId} currentUserId={currentUser?.id} />
      </div>
    </main>
  )
}

export default PublicProfilePage
