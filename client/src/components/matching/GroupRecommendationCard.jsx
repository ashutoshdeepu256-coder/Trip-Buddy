import GroupCompatibilitySummary from './GroupCompatibilitySummary'

const statusLabel = (status) => status?.toLowerCase().replaceAll('_', ' ') || 'unknown'

function GroupRecommendationCard({ recommendation, onRespond, responding = false }) {
  const own = recommendation.myCompatibility
  const canRespond = recommendation.canRespond && onRespond
  return (
    <article className="group-recommendation-card">
      <header className="group-recommendation-heading">
        <div>
          <span className="eyebrow">PROPOSED TRAVELLER GROUP</span>
          <h3>{recommendation.groupSize} travellers · {recommendation.proposedTravellerCount} proposed</h3>
        </div>
        <span className={`group-recommendation-status status-${recommendation.status.toLowerCase()}`}>
          {statusLabel(recommendation.status)}
        </span>
      </header>

      <GroupCompatibilitySummary score={recommendation.score} scoreBreakdown={recommendation.scoreBreakdown} />

      <section>
        <h4>Proposed travellers</h4>
        <ul className="group-member-list">
          {recommendation.members.map((member, index) => (
            <li key={`${member.name}-${index}`}>
              <span>{member.name}</span><small>{statusLabel(member.response)}</small>
            </li>
          ))}
        </ul>
      </section>

      {own && (
        <section className="group-member-compatibility">
          <h4>Your trip compatibility</h4>
          <p>{own.score}% · {own.response.toLowerCase()}</p>
          {own.reasons?.length > 0 && <ul>{own.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}</ul>}
        </section>
      )}

      <section>
        <h4>Why this group</h4>
        <ul>{recommendation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </section>
      {recommendation.unknownConstraints?.length > 0 && (
        <p className="group-recommendation-note">Some group information is missing: {recommendation.unknownConstraints.join(', ')}.</p>
      )}
      <p className="group-recommendation-note">Expires {new Date(recommendation.expiresAt).toLocaleDateString()} · acceptance does not add members to the trip.</p>

      {canRespond && (
        <div className="group-recommendation-actions">
          <button type="button" className="primary-btn" onClick={() => onRespond('accept')} disabled={responding}>
            {responding ? 'Saving…' : 'Accept recommendation'}
          </button>
          <button type="button" className="secondary-btn" onClick={() => onRespond('reject')} disabled={responding}>
            Reject
          </button>
        </div>
      )}
      {own?.response === 'ACCEPTED' && recommendation.status !== 'ACCEPTED' && (
        <p role="status" className="group-recommendation-note">Your acceptance is recorded. The recommendation is not final until every proposed traveller accepts.</p>
      )}
    </article>
  )
}

export default GroupRecommendationCard
