import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import verificationService from '../../services/verificationService'

function IdentityVerification() {
  const [identity, setIdentity] = useState(null)
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = async () => {
    try {
      setIdentity(await verificationService.getIdentityStatus())
      setError('')
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Unable to load identity verification status.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    verificationService.getIdentityStatus()
      .then((result) => {
        if (active) setIdentity(result)
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError.response?.data?.error?.message || 'Unable to load identity verification status.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  const startReview = async () => {
    setError('')
    setSubmitting(true)
    try {
      await verificationService.submitIdentityVerification()
      setMessage('Your request was submitted. Upload a document to complete the review package.')
      await refresh()
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Could not submit identity verification.')
    } finally {
      setSubmitting(false)
    }
  }

  const uploadDocument = async (event) => {
    event.preventDefault()
    if (!file) return
    setError('')
    setMessage('')
    setSubmitting(true)
    try {
      await verificationService.uploadIdentityDocument(file)
      setFile(null)
      setMessage('Your document was uploaded to secure storage for manual review.')
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Could not upload this document.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <main className="page-loading" role="status">Loading identity verification…</main>

  return (
    <main className="app-shell inner-shell">
      <div className="content-card identity-page">
        <Link to="/verification" className="back-link">← Verification Center</Link>
        <span className="eyebrow">Identity checks</span>
        <h1>Identity verification</h1>
        <p className="muted-copy">Your document is stored privately and is visible only to authorized reviewers. TripBuddy will not verify your identity automatically.</p>
        <div className="identity-status">
          <span className="label">Current status</span>
          <strong>{identity?.status?.replaceAll('_', ' ') || 'NOT SUBMITTED'}</strong>
        </div>
        {message && <p className="form-success" role="status">{message}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {['NOT_SUBMITTED', 'REJECTED', 'EXPIRED', 'REVOKED'].includes(identity?.status) && (
          <div className="identity-step">
            <h2>1. Start a manual review</h2>
            <p>Submit a review request. You will need a current government-issued identity document for an authorized reviewer.</p>
            <button className="primary-btn" type="button" onClick={startReview} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Start verification'}
            </button>
          </div>
        )}
        {identity?.status === 'PENDING' && (
          <div className="identity-step">
            <h2>2. Upload your document</h2>
            <p>Your status remains pending until a moderator reviews your request and document.</p>
            <form className="form-stack" onSubmit={uploadDocument}>
              <label>
                Identity document (PDF, PNG, or JPEG; up to 5 MB)
                <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] || null)} required />
              </label>
              <button className="secondary-btn" type="submit" disabled={!file || submitting}>{submitting ? 'Uploading…' : 'Upload for review'}</button>
            </form>
          </div>
        )}
        {identity?.status === 'PENDING' && (
          <div className="review-notice" role="status">Your verification is under review. We will update this status after an authorized review.</div>
        )}
        {identity?.status === 'VERIFIED' && (
          <div className="review-notice success-notice" role="status">Your identity has been verified.</div>
        )}
      </div>
    </main>
  )
}

export default IdentityVerification
