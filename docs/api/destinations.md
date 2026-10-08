# Destination Discovery API

All routes are public read endpoints under `/api/v1/destinations`. Results
include `items` and pagination metadata (`page`, `limit`, `total`, `pages`).
Unpublished destination records are excluded.

| Method | Path         | Purpose                                                                                                      |
| ------ | ------------ | ------------------------------------------------------------------------------------------------------------ |
| GET    | `/`          | Search and browse; supports `search`/`q`, `page`, `limit`, `month`, `maxBudget`, `activity`, and `category`. |
| GET    | `/popular`   | Sort by the stored popularity score.                                                                         |
| GET    | `/trending`  | Sort by the stored trend score, then popularity.                                                             |
| GET    | `/nearby`    | Geo search using `lat`, `lng`, optional `radiusKm`, `page`, and `limit`.                                     |
| GET    | `/seasonal`  | Destinations whose `bestMonths` include the requested `month`; defaults to the current month.                |
| GET    | `/budget`    | Sort destinations by their stored minimum estimated budget.                                                  |
| GET    | `/adventure` | Destinations marked as adventure-oriented.                                                                   |
| GET    | `/:id`       | Read by MongoDB id or destination slug.                                                                      |

Coordinates are GeoJSON points in `[longitude, latitude]` order and indexed
with MongoDB `2dsphere`. Nearby radius is limited to 20,000 km. Listing and
detail reads are cached in-process for up to 60 seconds; cache entries expire
automatically and are not shared between application instances.

Destination data is not bundled with the application. To import an intentional
catalog, provide a JSON file containing an array of records that match the
Destination model:

```powershell
npm run seed:destinations --workspace=server -- C:\path\to\destinations.json
```

The script validates each record and upserts by slug. It requires
`server/.env` with `MONGODB_URI`.

The destination record supports `mapProvider` (`GOOGLE_MAPS`, `MAPBOX`, or
`NONE`) and an optional provider `mapPlaceId`. The web client uses
`VITE_MAP_PROVIDER` (`GOOGLE_MAPS` or `MAPBOX`) and either
`VITE_GOOGLE_MAPS_API_KEY` or `VITE_MAPBOX_ACCESS_TOKEN` for provider maps.
These are public client-side map credentials; restrict them to the deployed
web origins in the provider console. Without provider configuration, the
destination page uses OpenStreetMap embeds and Google Maps directions links.

Community trip and buddy cards are returned as empty arrays until trip/buddy
models are integrated. Destination-level community counters are stored
statistics and should be maintained from actual community records, never
fabricated.
