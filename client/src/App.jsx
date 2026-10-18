import './App.css'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from './store/authStore'
import AuthPage from './pages/AuthPage'
import ProfilePage from './pages/ProfilePage'
import PublicProfilePage from './pages/PublicProfilePage'
import EmailVerificationPage from './pages/EmailVerificationPage'
import VerificationCenter from './pages/verification/VerificationCenter'
import IdentityVerification from './pages/verification/IdentityVerification'
import DestinationDiscovery from './pages/DestinationDiscovery'
import DestinationPage from './pages/DestinationPage'
import CreateTrip from './pages/trips/CreateTrip'
import EditTrip from './pages/trips/EditTrip'
import TripDetails from './pages/trips/TripDetails'
import MyTrips from './pages/trips/MyTrips'
import DiscoverTrips from './pages/trips/DiscoverTrips'
import ConnectionsPage from './pages/connections/ConnectionsPage'
import ChatPage from './pages/ChatPage'
import ItineraryPlanner from './pages/ItineraryPlanner'
import BookingsPage from './pages/BookingsPage'
import TripExpenses from './pages/trips/TripExpenses'
import PaymentsPage from './pages/PaymentsPage'
import SafetyCenter from './pages/SafetyCenter'
import NotificationsPage from './pages/NotificationsPage'
import NotificationBell from './components/notifications/NotificationBell'
import { useNotificationStore } from './store/notificationStore'

const facts = [
  { label: 'Travel style', value: 'Your pace' },
  { label: 'Trip planning', value: 'Your budget' },
  { label: 'Travel buddies', value: 'Your people' },
]

const features = [
  {
    title: 'Smart itinerary builder',
    description:
      'Build a day-by-day travel plan with flights, stays, must-do experiences, and fallback ideas.',
  },
  {
    title: 'Budget-aware planning',
    description:
      'Track costs instantly with local deals, transportation estimates, and spending alerts.',
  },
  {
    title: 'Local recommendations',
    description:
      'Discover hidden gems, weather updates, dining spots, and real-time suggestions.',
  },
]

const tripIdeas = [
  'Kyiv food crawl',
  'Bali sunrise escape',
  'Paris culture weekend',
  'Amalfi coastal route',
]

function App() {
  const { user, loading, fetchMe, logout } = useAuthStore()

  useEffect(() => {
    fetchMe()
  }, [fetchMe])

  const startNotifications = useNotificationStore((state) => state.start)
  const stopNotifications = useNotificationStore((state) => state.stop)
  useEffect(() => {
    if (user?.id) startNotifications(user.id)
    else stopNotifications()
    return () => stopNotifications()
  }, [user?.id, startNotifications, stopNotifications])

  const home = (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand-wrap">
          <div className="brand-mark">T</div>
          <span>TripBuddy</span>
        </Link>

        <nav className="main-nav" aria-label="Main navigation">
          <Link to="/destinations">Destinations</Link>
          <a href="#features">Features</a>
          <a href="#plans">Trip ideas</a>
          <a href="#pricing">Pricing</a>
        </nav>

        {user ? (
          <div className="topbar-actions">
            <Link to="/trips">Discover trips</Link>
            <Link to="/my-trips">My trips</Link>
            <Link to="/connections">Connections</Link>
            <Link to="/chat">Messages</Link>
            <Link to="/planner">Planner</Link>
            <Link to="/bookings">Travel services</Link>
            <Link to="/safety">Safety Center</Link>
            <Link to="/profile" className="text-link">My profile</Link>
            <button type="button" className="secondary-btn nav-action" onClick={logout}>
              Sign out
            </button>
          </div>
        ) : (
          <div className="topbar-actions">
            <Link to="/login" className="text-link">Sign in</Link>
            <Link to="/register" className="primary-btn small-btn">Get started</Link>
          </div>
        )}
      </header>

      <main className="page-content">
        <section className="hero-section">
          <div className="hero-copy">
            <span className="eyebrow">Your AI-powered travel companion</span>
            <h1>Explore more. Stress less. Travel better.</h1>
            <p>
              Turn ideas into unforgettable journeys with personalized itineraries,
              live recommendations, and smart budgeting built for every trip.
            </p>

            <div className="cta-row">
              <Link to={user ? '/profile' : '/register'} className="primary-btn">
                Start planning
              </Link>
              <a href="#plans" className="secondary-btn">View sample trips</a>
            </div>

            <div className="facts-row" aria-label="TripBuddy statistics">
              {facts.map((fact) => (
                <div key={fact.label} className="fact-card">
                  <strong>{fact.value}</strong>
                  <span>{fact.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-panel" aria-label="Trip overview card">
            <div className="trip-card">
              <div className="panel-header">
                <span className="dot dot-blue" />
                <span className="dot dot-purple" />
                <span className="dot dot-pink" />
              </div>
              <div className="trip-header">
                <div>
                  <p className="label">Upcoming trip</p>
                  <h2>Santorini Escape</h2>
                </div>
                <span className="status-pill">Sample plan</span>
              </div>
              <div className="mini-map" aria-hidden="true">
                <div className="map-pin pin-one" />
                <div className="map-pin pin-two" />
                <div className="map-pin pin-three" />
              </div>
              <ul className="trip-list">
                <li><span className="list-tag">Day 1</span>Arrival + sunset cruise</li>
                <li><span className="list-tag">Day 2</span>Blue dome walk + rooftop dinner</li>
                <li><span className="list-tag">Day 3</span>Island hopping and beach reset</li>
              </ul>
            </div>
          </div>
        </section>

        <section id="features" className="feature-section">
          <div className="section-heading">
            <span className="eyebrow">Why travelers choose us</span>
            <h2>Everything you need for a smoother journey</h2>
          </div>
          <div className="feature-grid">
            {features.map((feature) => (
              <article key={feature.title} className="feature-card">
                <div className="feature-icon" aria-hidden="true">✦</div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="plans" className="idea-section">
          <div className="plan-panel">
            <div>
              <span className="eyebrow">Popular ideas</span>
              <h2>Plan your next unforgettable getaway</h2>
            </div>
            <div className="idea-list" aria-label="Trip ideas">
              {tripIdeas.map((idea) => <span key={idea} className="idea-chip">{idea}</span>)}
            </div>
          </div>
        </section>

        <section id="pricing" className="pricing-panel">
          <span className="eyebrow">Start with a plan</span>
          <h2>Your next journey starts here.</h2>
          <p>Create your traveler profile and start planning with TripBuddy.</p>
          <Link className="primary-btn" to={user ? '/profile' : '/register'}>Create your account</Link>
        </section>
      </main>
    </div>
  )

  if (loading) return <div className="page-loading" role="status">Loading TripBuddy…</div>

  return (
    <>
    {user && <NotificationBell />}
    <Routes>
      <Route path="/" element={home} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/verify-email" element={<EmailVerificationPage />} />
      <Route path="/destinations" element={<DestinationDiscovery />} />
      <Route path="/destinations/:id" element={<DestinationPage />} />
      <Route path="/trips" element={<DiscoverTrips />} />
      <Route path="/my-trips" element={<ProtectedRoute><MyTrips /></ProtectedRoute>} />
      <Route path="/trips/create" element={<ProtectedRoute><CreateTrip /></ProtectedRoute>} />
      <Route path="/trips/:tripId/edit" element={<ProtectedRoute><EditTrip /></ProtectedRoute>} />
      <Route path="/trips/:tripId" element={<TripDetails />} />
      <Route path="/trips/:tripId/expenses" element={<ProtectedRoute><TripExpenses /></ProtectedRoute>} />
      <Route path="/payments" element={<ProtectedRoute><PaymentsPage /></ProtectedRoute>} />
      <Route path="/safety" element={<ProtectedRoute><SafetyCenter /></ProtectedRoute>} />
      <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
      <Route path="/profile/edit" element={<ProtectedRoute><ProfilePage edit /></ProtectedRoute>} />
      <Route path="/profile/travel-preferences" element={<ProtectedRoute><ProfilePage edit travelPreferences /></ProtectedRoute>} />
      <Route path="/verification" element={<ProtectedRoute><VerificationCenter /></ProtectedRoute>} />
      <Route path="/verification/identity" element={<ProtectedRoute><IdentityVerification /></ProtectedRoute>} />
      <Route path="/users/:userId" element={<PublicProfilePage />} />
      <Route path="/connections" element={<ProtectedRoute><ConnectionsPage /></ProtectedRoute>} />
      <Route path="/connections/requests" element={<ProtectedRoute><ConnectionsPage /></ProtectedRoute>} />
      <Route path="/connections/sent" element={<ProtectedRoute><ConnectionsPage /></ProtectedRoute>} />
      <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
      <Route path="/planner" element={<ProtectedRoute><ItineraryPlanner /></ProtectedRoute>} />
      <Route path="/bookings" element={<ProtectedRoute><BookingsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}

function ProtectedRoute({ children }) {
  const { user } = useAuthStore()
  return user ? children : <Navigate to="/login" replace />
}

export default App
