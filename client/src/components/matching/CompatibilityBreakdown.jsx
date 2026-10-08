const labels = {
  destination: 'Destination',
  dates: 'Dates',
  budget: 'Budget',
  interests: 'Interests',
  travelStyle: 'Travel style',
  activities: 'Activities',
  groupSize: 'Group size',
  otherPreferences: 'Other preferences',
}

function CompatibilityBreakdown({ breakdown = {}, dimensionStatus = {} }) {
  return (
    <div className="compatibility-breakdown">
      {Object.entries(labels).map(([key, label]) => {
        const score = breakdown[key]
        const unknown = dimensionStatus[key] === 'UNKNOWN' || score == null
        return (
          <div className="compatibility-dimension" key={key}>
            <div className="compatibility-dimension-heading">
              <span>{label}</span><strong>{unknown ? 'Unknown' : `${score}%`}</strong>
            </div>
            {unknown
              ? <span className="compatibility-unknown">Not enough preference data</span>
              : <progress max="100" value={score} aria-label={`${label}: ${score}%`} />}
          </div>
        )
      })}
    </div>
  )
}

export default CompatibilityBreakdown
