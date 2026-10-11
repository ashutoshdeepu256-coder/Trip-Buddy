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

function GroupCompatibilitySummary({ score, scoreBreakdown = {} }) {
  return (
    <div className="group-compatibility-summary">
      <p className="group-score"><strong>{score}%</strong> group compatibility</p>
      <div className="compatibility-breakdown">
        {Object.entries(labels).map(([key, label]) => {
          const value = scoreBreakdown[key]
          return (
            <div className="compatibility-dimension" key={key}>
              <div className="compatibility-dimension-heading">
                <span>{label}</span><strong>{value == null ? 'Unknown' : `${value}%`}</strong>
              </div>
              {value == null
                ? <span className="compatibility-unknown">Not enough shared data</span>
                : <progress max="100" value={value} aria-label={`${label}: ${value}%`} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default GroupCompatibilitySummary
