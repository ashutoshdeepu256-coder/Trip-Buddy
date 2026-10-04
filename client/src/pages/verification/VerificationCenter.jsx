import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PhoneVerificationForm from '../../components/PhoneVerificationForm'
import verificationService from '../../services/verificationService'
import { useAuthStore } from '../../store/authStore'
import { useVerificationStore } from '../../store/verificationStore'
import { TrustBadge } from '../ProfilePage'

const formatDate = (date) =>
  date ? new Date(date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—'

function VerificationCenter() {
  const status = useVerificationStore((state) => state.verificationStatus)
  const history = useVerificationStore((state) => state.verificationHistory)
  const fetchVerificationStatus = useVerificationStore((state) => state.fetchVerificationStatus)
  const fetchVerificationHistory = useVerificationStore((state) => state.fetchVerificationHistory)
  const [emailToken, setEmailToken] = useState('')
  const [developmentToken, setDevelopmentToken] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const incomingToken = searchParams.get('token')
  const user = useAuthStore((state) => state.user)
  const fetchMe = useAuthStore((state) => state.fetchMe)

  const refresh = useCallback(async () => {
    try {
      await Promise.all([fetchVerificationStatus(), fetchVerificationHistory()])
      setError('')
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Could not load verification details.')
    } finally {
      setLoading(false)
    }
  }, [fetchVerificationStatus, fetchVerificationHistory])

  useEffect(() => {
    let active = true
    Promise.all([fetchVerificationStatus(), fetchVerificationHistory()])
      .catch((requestError) => {
        if (active) {
          setError(requestError.response?.data?.error?.message || 'Could not load verification details.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [fetchVerificationStatus, fetchVerificationHistory])

  useEffect(() => {
    if (!incomingToken) return
    verificationService.verifyEmail(incomingToken)
      .then(async () => {
        setMessage('Your email address is verified.')
        setSearchParams({}, { replace: true })
        await Promise.all([refresh(), fetchMe()])
      })
      .catch((requestError) => {
        setError(requestError.response?.data?.error?.message || 'Email verification link is invalid or expired.')
        setSearchParams({}, { replace: true })
      })
  }, [incomingToken, setSearchParams, refresh, fetchMe])

  const resendEmail = async () => {
    setError('')
    setMessage('')
    setSubmitting(true)
    try {
      const result = await verificationService.resendEmailVerification()
      setDevelopmentToken(result.developmentToken || '')
      setMessage('A verification request was created. Check your inbox for the link.')
      await refresh()
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Could not request email verification.')
    } finally {
      setSubmitting(false)
    }
  }

  const verifyEmail = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    setSubmitting(true)
    try {
      await verificationService.verifyEmail(emailToken)
      setEmailToken('')
      setDevelopmentToken('')
      setMessage('Your email address is verified.')
      await Promise.all([refresh(), fetchMe()])
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Could not verify this email token.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && !status) return <main className="page-loading" role="status">Loading verification center…</main>

  return (
    <main className="app-shell inner-shell">
      <div className="content-card verification-page">
        <Link to="/profile" className="back-link">← Back to profile</Link>
        <span className="eyebrow">Your safety and trust</span>
        <h1>Verification Center</h1>
        <p className="muted-copy">Verification badges show completed checks. Trip activity and reviews are listed separately; TripBuddy does not create a trust score.</p>
        {message && <p className="form-success" role="status">{message}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}

        <section className="verification-section">
          <div className="verification-section-heading">
            <div>
              <h2>Email</h2>
              <p>{user?.email}</p>
            </div>
            <TrustBadge verified={status?.email?.verified} label={status?.email?.verified ? 'Verified' : 'Not verified'} />
          </div>
          {!status?.email?.verified && (
            <>
              <button type="button" className="secondary-btn" onClick={resendEmail} disabled={submitting}>
                {submitting ? 'Requesting…' : 'Send verification email'}
              </button>
              {developmentToken && (
                <p className="dev-code" role="status">Development token: <strong>{developmentToken}</strong></p>
              )}
              <form className="inline-verify-form" onSubmit={verifyEmail}>
                <label htmlFor="email-verification-token">Verification token</label>
                <input id="email-verification-token" value={emailToken} onChange={(event) => setEmailToken(event.target.value)} required minLength={32} maxLength={256} />
                <button className="primary-btn" type="submit" disabled={submitting}>Verify email</button>
              </form>
            </>
          )}
        </section>

        <section className="verification-section">
          <div className="verification-section-heading">
            <div><h2>Phone</h2><p>Only the verified badge is public; your number stays private.</p></div>
            <TrustBadge verified={status?.phone?.verified} label={status?.phone?.verified ? 'Verified' : 'Not verified'} />
          </div>
          {!status?.phone?.verified && <PhoneVerificationForm onVerified={refresh} />}
        </section>

        <section className="verification-section">
          <div className="verification-section-heading">
            <div><h2>Identity</h2><p>Identity checks are reviewed by authorized staff.</p></div>
            <TrustBadge verified={status?.identity?.verified} label={status?.identity?.status?.replaceAll('_', ' ') || 'Not submitted'} />
          </div>
          <Link className="secondary-btn" to="/verification/identity">Manage identity verification</Link>
        </section>

        <section className="verification-section">
          <h2>Verification history</h2>
          {history.length ? (
            <div className="history-list">
              {history.map((item, index) => (
                <div className="history-item" key={`${item.type}-${item.createdAt}-${index}`}>
                  <span><strong>{item.type.charAt(0) + item.type.slice(1).toLowerCase()} verification</strong><small>{formatDate(item.createdAt)}</small></span>
                  <span className={`history-status status-${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted-copy">No verification history yet.</p>}
        </section>
      </div>
    </main>
  )
}

export default VerificationCenter
