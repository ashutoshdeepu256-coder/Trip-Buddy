import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import verificationService from '../services/verificationService'

function EmailVerificationPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [status, setStatus] = useState(() => token ? 'checking' : 'error')
  const [message, setMessage] = useState(() => token ? 'Checking your verification link…' : 'This verification link is missing its token.')

  useEffect(() => {
    if (!token) return undefined
    let active = true
    verificationService.verifyEmail(token)
      .then(() => {
        if (active) {
          setStatus('success')
          setMessage('Your email address is verified. You can now sign in to TripBuddy.')
        }
      })
      .catch((error) => {
        if (active) {
          setStatus('error')
          setMessage(error.response?.data?.error?.message || 'This verification link is invalid or expired.')
        }
      })
    return () => { active = false }
  }, [token])

  return (
    <main className="app-shell account-shell">
      <div className="account-card">
        <Link to="/" className="brand-wrap">
          <span className="brand-mark">T</span><span>TripBuddy</span>
        </Link>
        <span className="eyebrow">Email verification</span>
        <h1>{status === 'success' ? 'You’re verified' : status === 'error' ? 'Could not verify email' : 'Verifying…'}</h1>
        <p className={status === 'error' ? 'form-error' : status === 'success' ? 'form-success' : 'muted-copy'} role="status">{message}</p>
        {status !== 'checking' && <Link to="/login" className="primary-btn">Continue to sign in</Link>}
      </div>
    </main>
  )
}

export default EmailVerificationPage
