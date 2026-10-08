import CompatibilityBreakdown from './CompatibilityBreakdown'
import MatchReasons from './MatchReasons'
import './matching.css'

function CompatibilityScore({ compatibility, onRefresh, refreshing = false }) {
  if (!compatibility) return null
  const { overallScore, category, breakdown, dimensionStatus, dataCoverage, scoreBasis } = compatibility
  return (
    <section className="compatibility-card" aria-labelledby="compatibility-title">
      <div className="compatibility-score-header">
        <div>
          <span className="eyebrow">TRAVEL COMPATIBILITY</span>
          <h2 id="compatibility-title">{overallScore}%</h2>
          <p>{scoreBasis === 'NEUTRAL_NO_DATA' ? 'Neutral placeholder; no preferences were available.' : `${category?.toLowerCase()} fit · deterministic preference match`}</p>
          {scoreBasis !== 'NEUTRAL_NO_DATA' && dataCoverage != null && <p>{dataCoverage}% of scoring weight evaluated.</p>}
        </div>
        {onRefresh && <button type="button" className="secondary-btn" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh match'}
        </button>}
      </div>
      <CompatibilityBreakdown breakdown={breakdown} dimensionStatus={dimensionStatus} />
      <MatchReasons
        matchReasons={compatibility.matchReasons}
        potentialDifferences={compatibility.potentialDifferences}
        reasons={compatibility.reasons}
      />
      {compatibility.unknownDimensions?.length > 0 && (
        <p className="compatibility-data-note">
          Unknown dimensions are excluded from the weighted average; missing preferences are not treated as mismatches.
        </p>
      )}
    </section>
  )
}

export default CompatibilityScore
