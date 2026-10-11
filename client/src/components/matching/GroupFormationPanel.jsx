import { useEffect, useState } from 'react'
import groupRecommendationService from '../../services/groupRecommendationService'
import GroupRecommendationCard from './GroupRecommendationCard'
import './matching.css'

function GroupFormationPanel({ trip, user }) {
  const [recommendations, setRecommendations] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [respondingId, setRespondingId] = useState('')
  const [error, setError] = useState('')
  const [generationMessage, setGenerationMessage] = useState('')
  const owner = Boolean(trip?.isOwner)

  useEffect(() => {
    let active = true
    groupRecommendationService.listForTrip(trip.id)
      .then((result) => { if (active) setRecommendations(result.items || []) })
      .catch((requestError) => {
        if (active) setError(requestError.response?.data?.error?.message || 'Group recommendations could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [trip, user])

  const generate = async () => {
    setGenerating(true)
    setError('')
    setGenerationMessage('')
    try {
      const result = await groupRecommendationService.generate(trip.id)
      if (!result.recommendation) {
        setRecommendations([])
        setGenerationMessage(`No complete group is available yet. ${result.eligibleCandidateCount} eligible travellers were found; ${result.requiredTravellerCount} are needed.`)
      } else {
        setRecommendations([result.recommendation])
        setGenerationMessage(result.reused ? 'Showing the current recommendation.' : 'A new recommendation is ready for traveller consent.')
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Group recommendation generation failed.')
    } finally {
      setGenerating(false)
    }
  }

  const respond = async (recommendationId, action) => {
    setRespondingId(recommendationId)
    setError('')
    try {
      const updated = action === 'accept'
        ? await groupRecommendationService.accept(recommendationId)
        : await groupRecommendationService.reject(recommendationId)
      setRecommendations((items) => items.map((item) => item.id === recommendationId ? updated : item))
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Your response could not be saved.')
      const result = await groupRecommendationService.listForTrip(trip.id)
      setRecommendations(result.items || [])
    } finally {
      setRespondingId('')
    }
  }

  if (!user) return null

  return (
    <section className="trip-panel group-formation-panel">
      <header className="group-formation-heading">
        <div>
          <span className="eyebrow">PHASE 11</span>
          <h2>Group recommendations</h2>
          <p>{owner ? 'Recommend a compatible traveller group. Each traveller decides for themselves.' : 'Group suggestions are shown only when you are part of a proposed group.'}</p>
        </div>
        {owner && <button type="button" className="primary-btn" onClick={generate} disabled={generating}>
          {generating ? 'Finding a group…' : 'Generate recommendation'}
        </button>}
      </header>
      {loading && <p role="status">Loading recommendations…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {generationMessage && <p role="status" className="group-recommendation-note">{generationMessage}</p>}
      {!loading && !recommendations.length && !owner && !error && <p className="group-recommendation-note">There are no group recommendations for you on this trip.</p>}
      {!loading && !recommendations.length && owner && !error && !generationMessage && <p className="group-recommendation-note">No recommendations have been generated yet.</p>}
      {recommendations.map((recommendation) => (
        <GroupRecommendationCard
          key={recommendation.id}
          recommendation={recommendation}
          responding={respondingId === recommendation.id}
          onRespond={(action) => respond(recommendation.id, action)}
        />
      ))}
    </section>
  )
}

export default GroupFormationPanel
