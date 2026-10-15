import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import reviewService from '../../services/reviewService'
import './ReviewSection.css'

const reasonOptions = [
  ['HARASSMENT', 'Harassment'],
  ['SPAM', 'Spam'],
  ['PERSONAL_DATA', 'Private personal information'],
  ['FALSE_CLAIM', 'False or misleading claim'],
  ['OTHER', 'Other concern'],
]

function ReviewSection({ mode, targetId, currentUserId = null, allowCompose = false }) {
  const [data, setData] = useState(null)
  const [eligibility, setEligibility] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(1)
  const [targetUserId, setTargetUserId] = useState('')
  const [rating, setRating] = useState('5')
  const [comment, setComment] = useState('')
  const [editing, setEditing] = useState(null)
  const [reporting, setReporting] = useState(null)
  const [reportReason, setReportReason] = useState('OTHER')
  const [reportDetails, setReportDetails] = useState('')

  const load = useCallback(async (nextPage = 1) => {
    setLoading(true)
    setError('')
    try {
      const result = mode === 'traveller'
        ? await reviewService.listTraveller(targetId, { page: nextPage, limit: 10 })
        : await reviewService.listTrip(targetId, { page: nextPage, limit: 10 })
      setData(result)
      setPage(result.page)
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Reviews could not be loaded.')
    } finally { setLoading(false) }
  }, [mode, targetId])

  useEffect(() => {
    let active = true
    const request = mode === 'traveller'
      ? reviewService.listTraveller(targetId, { page: 1, limit: 10 })
      : reviewService.listTrip(targetId, { page: 1, limit: 10 })
    request.then((result) => {
      if (!active) return
      setData(result)
      setPage(result.page)
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.error?.message || 'Reviews could not be loaded.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [mode, targetId])

  useEffect(() => {
    let active = true
    if (mode !== 'trip' || !allowCompose) {
      return () => { active = false }
    }
    reviewService.eligibility(targetId).then((result) => {
      if (active) setEligibility(result.items)
    }).catch(() => {
      if (active) setEligibility([])
    })
    return () => { active = false }
  }, [allowCompose, mode, targetId])

  const submitReview = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await reviewService.create({ tripId: targetId, revieweeId: targetUserId, rating: Number(rating), comment })
      setComment('')
      setRating('5')
      toast.success('Your verified Trip review was published.')
      await Promise.all([load(page), reviewService.eligibility(targetId).then((result) => setEligibility(result.items))])
    } catch (requestError) {
      toast.error(requestError.response?.data?.error?.message || 'Review could not be submitted.')
    } finally { setBusy(false) }
  }

  const saveEdit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await reviewService.update(editing.id, { rating: Number(editing.rating), comment: editing.comment })
      setEditing(null)
      toast.success('Review updated.')
      await load(page)
    } catch (requestError) { toast.error(requestError.response?.data?.error?.message || 'Review could not be updated.') }
    finally { setBusy(false) }
  }

  const deleteReview = async (review) => {
    if (!window.confirm('Remove this review? It will no longer appear in reviews or rating totals.')) return
    setBusy(true)
    try {
      await reviewService.remove(review.id)
      toast.success('Review removed.')
      await load(page)
    } catch (requestError) { toast.error(requestError.response?.data?.error?.message || 'Review could not be removed.') }
    finally { setBusy(false) }
  }

  const submitReport = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await reviewService.report(reporting.id, { reason: reportReason, details: reportDetails })
      setReporting(null)
      setReportDetails('')
      toast.success('Report sent to the moderation team.')
    } catch (requestError) { toast.error(requestError.response?.data?.error?.message || 'Review could not be reported.') }
    finally { setBusy(false) }
  }

  return <section className="review-section" aria-labelledby={`reviews-heading-${mode}`}>
    <header className="review-section-header">
      <div><span className="eyebrow">Completed Trip feedback</span><h2 id={`reviews-heading-${mode}`}>Reviews</h2></div>
      {data?.summary && <div className="review-score" aria-label={data.summary.averageRating === null ? 'No ratings yet' : `Average rating ${data.summary.averageRating} out of 5`}>
        <strong>{data.summary.averageRating === null ? '—' : `${data.summary.averageRating} / 5`}</strong><span>{data.summary.reviewCount} {data.summary.reviewCount === 1 ? 'review' : 'reviews'}</span>
      </div>}
    </header>

    {allowCompose && mode === 'trip' && eligibility.some((item) => !item.reviewed) && <form className="review-form" onSubmit={submitReview}>
      <h3>Review a fellow traveler</h3>
      <label>Traveler
        <select value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} required>
          <option value="">Choose a traveler</option>
          {eligibility.filter((item) => !item.reviewed).map((item) => <option key={item.userId} value={item.userId}>{item.name}</option>)}
        </select>
      </label>
      <label>Rating
        <select value={rating} onChange={(event) => setRating(event.target.value)}>
          <option value="5">5 — Excellent</option><option value="4">4 — Good</option><option value="3">3 — Okay</option><option value="2">2 — Poor</option><option value="1">1 — Very poor</option>
        </select>
      </label>
      <label>Feedback <span className="review-optional">(optional)</span>
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} rows={3} placeholder="Share useful, respectful feedback." />
      </label>
      <div className="review-form-footer"><small>{comment.length}/1000. Published immediately; reports go to human moderation.</small><button type="submit" className="primary-btn" disabled={busy || !targetUserId}>{busy ? 'Publishing…' : 'Publish review'}</button></div>
    </form>}

    {allowCompose && mode === 'trip' && eligibility.length > 0 && eligibility.every((item) => item.reviewed) && <p className="review-empty">You have reviewed every eligible traveler on this Trip.</p>}
    {allowCompose && mode === 'trip' && eligibility.length === 0 && !loading && <p className="review-empty">No other active Trip members are currently eligible to review.</p>}
    {error && <p className="review-error" role="alert">{error}<button type="button" onClick={() => load(page)}>Retry</button></p>}
    {loading ? <p role="status">Loading reviews…</p> : !error && !data?.items?.length ? <p className="review-empty">No published reviews yet.</p> : <div className="review-list">
      {data?.items?.map((review) => <article className="review-card" key={review.id}>
        <header><div><strong>{review.author.name}</strong><span>{review.verifiedTripReview ? 'Verified Trip review' : 'Review'}</span></div><strong className="review-rating" aria-label={`${review.rating} out of 5`}>{review.rating} / 5</strong></header>
        {review.trip && <p className="review-trip-name">{review.trip.title}</p>}
        {editing?.id === review.id ? <form className="review-edit-form" onSubmit={saveEdit}>
          <label>Rating<select value={editing.rating} onChange={(event) => setEditing({ ...editing, rating: event.target.value })}><option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option></select></label>
          <label>Feedback<textarea value={editing.comment} onChange={(event) => setEditing({ ...editing, comment: event.target.value })} maxLength={1000} rows={3} /></label>
          <button type="submit" className="primary-btn" disabled={busy}>{busy ? 'Saving…' : 'Save review'}</button><button type="button" className="secondary-btn" onClick={() => setEditing(null)}>Cancel</button>
        </form> : <p className="review-comment">{review.comment || 'No written feedback.'}</p>}
        {review.author.id === currentUserId && <div className="review-actions"><button type="button" onClick={() => setEditing({ id: review.id, rating: String(review.rating), comment: review.comment })}>Edit</button><button type="button" onClick={() => deleteReview(review)} disabled={busy}>Remove</button></div>}
        {currentUserId && review.author.id !== currentUserId && <div className="review-actions"><button type="button" onClick={() => setReporting(reporting?.id === review.id ? null : review)}>Report review</button></div>}
        {reporting?.id === review.id && <form className="review-report-form" onSubmit={submitReport}>
          <label>Reason<select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>{reasonOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>Details<textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} maxLength={1000} rows={2} /></label>
          <button type="submit" className="secondary-btn" disabled={busy}>{busy ? 'Sending…' : 'Send report'}</button>
        </form>}
      </article>)}
    </div>}
    {data?.totalPages > 1 && <nav className="review-pagination" aria-label="Review pages"><button type="button" className="secondary-btn" disabled={loading || page <= 1} onClick={() => load(page - 1)}>Previous</button><span>Page {page} of {data.totalPages}</span><button type="button" className="secondary-btn" disabled={loading || page >= data.totalPages} onClick={() => load(page + 1)}>Next</button></nav>}
  </section>
}

export default ReviewSection
