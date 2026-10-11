# Maps and location API

All paths below are relative to `/api/v1`. Responses use the standard `{ success, message, data }` envelope; errors use `{ success: false, error: { code, message } }`.

## Stored geographic search

- `GET /destinations/nearby?lat=40.7&lng=-73.9&radiusKm=100&page=1&limit=12` searches published destinations using the existing `coordinates` GeoJSON field and `2dsphere` index. Radius is 1–500 km; page size is capped at 50. Caller coordinates are not retained or put in the in-process cache.
- `GET /trips?lat=40.7&lng=-73.9&radiusKm=100&page=1&limit=20` adds a nearby filter to existing trip discovery. MongoDB `$geoNear` selects only published/planning/confirmed trips within the existing public/community discovery privacy rules. Anonymous results are public only. Results are ordered by straight-line proximity and contain a rounded `distanceKm`; exact trip location coordinates are never included in discovery cards.
- `POST /maps/distance` with `{ "from": { "lat": 40.7, "lng": -73.9 }, "to": { "lat": 40.8, "lng": -73.8 } }` returns a labeled great-circle `distanceKm`, not road distance or travel time.

## Configured provider lookups

When `MAPBOX_SERVER_TOKEN` is configured, geocoding uses Mapbox Geocoding v6 and directions uses the Mapbox Directions v5 API:

- `GET /maps/geocode?query=Lisbon` returns up to five minimized labels and `{ lng, lat }` coordinates.
- `GET /maps/reverse?lat=38.7&lng=-9.1` returns one minimized label or `null`.
- `POST /maps/route` accepts `{ "profile": "walking", "waypoints": [{ "lat": 38.7, "lng": -9.1 }, { "lat": 38.71, "lng": -9.13 }] }`. Two to six waypoints are supported. Results are provider estimates with retrieval time and distance/duration.
- `GET /maps/capabilities` reports which server lookup capabilities are configured. Nearby-place discovery is unavailable because no trusted places data source is configured.

Without a server token, lookup endpoints return `503 MAPS_PROVIDER_UNCONFIGURED`; the service does not fabricate results. Upstream quota failures and timeouts have stable safe error codes. Lookups are limited to 20 per minute per client IP per server instance, and requests have a bounded timeout. Provider lookups are not cached, avoiding retention of query or exact coordinate values.

## Privacy and coordinate rules

Coordinates are WGS84 GeoJSON `[longitude, latitude]` in storage. Request objects use named `lat` and `lng` fields and are range checked. Public discovery only returns derived rounded distances. Trip-detail exact location is available only to the creator and current active members; other public/community trip readers receive no trip coordinate. User live coordinates are not stored. Browser location is used only for the active nearby request.

Map rendering uses the existing client Google Maps/Mapbox options when configured and otherwise an OpenStreetMap embed. Browser `VITE_*` map keys are public by design: restrict them by allowed web origins, API scope and provider quota. Never place `MAPBOX_SERVER_TOKEN` in a client variable.
