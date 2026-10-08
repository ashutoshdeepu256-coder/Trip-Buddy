# Matching API

All matching endpoints require an authenticated TripBuddy session. Compatibility details and saved matches are private to the requesting traveller. Match detail lookups are scoped by both match ID and authenticated user ID, returning `404 MATCH_NOT_FOUND` for inaccessible records.

## `GET /api/v1/trips/:tripId/compatibility`

Calculates a deterministic compatibility result for the signed-in traveller and an accessible trip. This read does not persist a `Match`.

Example response data:

```json
{
  "overallScore": 94,
  "category": "EXCELLENT",
  "scoreBasis": "EVALUATED_DIMENSIONS",
  "dataCoverage": 75,
  "breakdown": {
    "destination": 100,
    "dates": null,
    "budget": 100,
    "interests": 75,
    "travelStyle": 100,
    "activities": 100,
    "groupSize": null,
    "otherPreferences": 90
  },
  "dimensionStatus": {
    "destination": "MATCH",
    "dates": "UNKNOWN"
  },
  "evaluatedDimensions": ["destination", "budget", "interests"],
  "unknownDimensions": ["dates", "groupSize"],
  "matchedAttributes": ["kyoto", "trekking"],
  "mismatchedAttributes": [],
  "matchReasons": ["Same destination preference"],
  "potentialDifferences": []
}
```

Unknown dimension scores are `null` and are omitted from the weighted denominator. With no evaluated dimensions the engine returns the neutral placeholder `overallScore: 50`, `scoreBasis: NEUTRAL_NO_DATA`, and `dataCoverage: 0`. `dataCoverage` is the total configured weight contributing to the score.

Errors include `401 UNAUTHENTICATED`, `400 INVALID_TRIP_ID`, `404 TRIP_NOT_FOUND`, and `409 SELF_MATCH_UNAVAILABLE` when the creator requests compatibility for their own trip.

## `GET /api/v1/matches`

Lists only saved match records owned by the current user. Supports `page` (default 1), `limit` (default 20, maximum 50), and optional `status` (`CALCULATED`, `VIEWED`, `CONNECTED`, `DISMISSED`, or `EXPIRED`). The response includes pagination metadata and a limited trip summary, never another traveller's private profile.

## `GET /api/v1/matches/:matchId`

Returns one saved match owned by the current user. A `CALCULATED` record becomes `VIEWED` when read. Invalid IDs return `400 INVALID_MATCH_ID`.

## `POST /api/v1/trips/:tripId/matches/refresh`

Recalculates and persists the current user's result for an accessible trip. Limited to 10 requests per 15 minutes per client by the route rate limiter. A unique `(trip, user)` index and atomic upsert prevent duplicate pair records; an existing record is updated rather than duplicated. Refresh resets its status to `CALCULATED`.

## Privacy and scoring

Compatibility routes do not accept user IDs, scores, weights, or arbitrary MongoDB filters from clients. The server derives the user from the authenticated session and calculates numeric scores deterministically. The optional explanation-provider seam is not configured in the current deployment; scores and reasons work without Gemini.

If either the requester or trip creator has blocked the other, compatibility returns the same not-found response used for inaccessible trips. Compatibility-sorted discovery also omits trips whose creators are blocked in either direction; block relationships are never included in the response.
