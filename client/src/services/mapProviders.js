const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const preferredProvider = import.meta.env.VITE_MAP_PROVIDER

export function getMapPresentation(destination) {
  const [longitude, latitude] = destination.coordinates?.coordinates || destination.location?.coordinates || []
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null

  const provider =
    destination.mapProvider && destination.mapProvider !== 'NONE'
      ? destination.mapProvider
      : preferredProvider
  const googleUrl = new URL('https://www.google.com/maps/search/')
  googleUrl.searchParams.set('api', '1')
  googleUrl.searchParams.set('query', `${latitude},${longitude}`)

  if (provider === 'GOOGLE_MAPS' && googleMapsKey) {
    const embedUrl = new URL('https://www.google.com/maps/embed/v1/place')
    embedUrl.searchParams.set('key', googleMapsKey)
    embedUrl.searchParams.set('q', `${latitude},${longitude}`)
    embedUrl.searchParams.set('zoom', '11')
    return {
      kind: 'embed',
      provider: 'Google Maps',
      url: embedUrl.toString(),
      directionsUrl: googleUrl.toString(),
    }
  }

  if (provider === 'MAPBOX' && mapboxToken) {
    const imageUrl = new URL(
      `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+38bdf8(${longitude},${latitude})/${longitude},${latitude},10/1000x520`,
    )
    imageUrl.searchParams.set('access_token', mapboxToken)
    return {
      kind: 'image',
      provider: 'Mapbox',
      url: imageUrl.toString(),
      directionsUrl: googleUrl.toString(),
    }
  }

  const delta = 0.04
  const bbox = `${Math.max(-180, longitude - delta)},${Math.max(-90, latitude - delta)},${Math.min(180, longitude + delta)},${Math.min(90, latitude + delta)}`
  const openStreetMapUrl = new URL(
    'https://www.openstreetmap.org/export/embed.html',
  )
  openStreetMapUrl.searchParams.set('bbox', bbox)
  openStreetMapUrl.searchParams.set('marker', `${latitude},${longitude}`)
  return {
    kind: 'embed',
    provider: 'OpenStreetMap',
    url: openStreetMapUrl.toString(),
    directionsUrl: googleUrl.toString(),
    attribution: '© OpenStreetMap contributors',
  }
}
