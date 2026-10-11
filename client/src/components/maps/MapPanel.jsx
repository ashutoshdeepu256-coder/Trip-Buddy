import { useEffect, useState } from 'react'
import { getMapPresentation } from '../../services/mapProviders'

function MapPanel({ location, title = 'Map', className = '' }) {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [providerFailed, setProviderFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const map = getMapPresentation(location || {})
  useEffect(() => {
    const onlineAgain = () => setOnline(true)
    const offline = () => setOnline(false)
    window.addEventListener('online', onlineAgain)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', onlineAgain)
      window.removeEventListener('offline', offline)
    }
  }, [])
  if (!map) return <p className="trip-map-empty">Location coordinates are unavailable.</p>

  return (
    <section className={`trip-panel trip-map-panel ${className}`} aria-label={title}>
      <h2>{title}</h2>
      {map.kind === 'image'
        ? <img className="trip-map-image" src={map.url} alt={`Map showing ${title}`} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setProviderFailed(true)} />
        : <iframe title={`Map showing ${title}`} src={map.url} loading="lazy" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => setProviderFailed(true)} />}
      {!online && <p className="trip-map-status" role="status">You appear to be offline. The map provider may not load.</p>}
      {online && !loaded && !providerFailed && <p className="trip-map-status" role="status">Loading map from {map.provider}…</p>}
      {providerFailed && <p className="trip-map-status" role="alert">The map provider could not load this map. Try opening the location directly.</p>}
      <div className="trip-map-meta">
        <span>{map.provider}{map.attribution ? ` · ${map.attribution}` : ''}</span>
        <a href={map.directionsUrl} target="_blank" rel="noreferrer">Open directions</a>
      </div>
    </section>
  )
}

export default MapPanel
