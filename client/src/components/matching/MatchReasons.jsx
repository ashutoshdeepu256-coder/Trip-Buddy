function MatchReasons({ matchReasons, potentialDifferences = [], reasons = [] }) {
  const positives = matchReasons ?? reasons
  const notes = reasons.filter((reason) => !positives.includes(reason) && !potentialDifferences.includes(reason))
  return (
    <div className="match-reasons">
      <section>
        <h3>Why you match</h3>
        {positives.length
          ? <ul>{positives.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          : <p>There is not enough preference information to explain this match yet.</p>}
      </section>
      {!!potentialDifferences.length && (
        <section>
          <h3>Potential differences</h3>
          <ul>{potentialDifferences.map((difference) => <li key={difference}>{difference}</li>)}</ul>
        </section>
      )}
      {!!notes.length && (
        <section>
          <h3>Scoring notes</h3>
          <ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </section>
      )}
    </div>
  )
}

export default MatchReasons
