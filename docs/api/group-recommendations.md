# Group recommendation API

All endpoints require an authenticated session. No endpoint accepts member IDs, compatibility scores, or constraints from the client. Responses use the standard `{ success, message, data }` envelope.

## `POST /api/v1/trips/:tripId/group-recommendations/generate`

Trip owner only. Limited to three requests per hour per client. Creates a bounded deterministic proposal for an eligible public/community trip. Repeated calls with the same input snapshot return the existing recommendation. If a complete group cannot satisfy the trip minimum, returns `recommendation: null`, `result: INSUFFICIENT_CANDIDATES`, and candidate counts. It never creates memberships.

Errors include `401 UNAUTHENTICATED`, `400 INVALID_TRIP_ID`, `403 GROUP_RECOMMENDATION_FORBIDDEN`, `404 TRIP_NOT_FOUND`, `409 TRIP_NOT_RECOMMENDABLE`, and `409 TRIP_FULL`.

## `GET /api/v1/trips/:tripId/group-recommendations`

The owner receives the trip's recommendation history. A proposed traveller receives only recommendations that include their account. Records are capped to the latest 20. A traveller reading a proposal changes `PROPOSED` to `VIEWED`.

## `GET /api/v1/group-recommendations/:recommendationId`

The trip owner or a proposed traveller may read the record. Other users receive `404 GROUP_RECOMMENDATION_NOT_FOUND`. Per-member compatibility details are included only for the authenticated traveller's own entry; names and response states are shown for group coordination.

## `POST /api/v1/group-recommendations/:recommendationId/accept`

A proposed traveller may accept only their own pending place. The server revalidates the live trip, account, capacity, membership, block, and group constraints. The actor's consent is recorded atomically. The recommendation becomes `ACCEPTED` only after all proposed travellers accept. It does not enroll anyone or reserve capacity.

## `POST /api/v1/group-recommendations/:recommendationId/reject`

A proposed traveller may reject only their own pending place. The recommendation becomes `REJECTED`; other responses cannot make it accepted. Rejected users are suppressed from that trip's generated candidate groups for 30 days.

## Status and error behavior

Recommendation statuses are `PROPOSED`, `VIEWED`, `ACCEPTED`, `REJECTED`, `EXPIRED`, and `SUPERSEDED`. A response after expiry, a prior response, or a terminal state returns `409 INVALID_RECOMMENDATION_STATE`. A concurrent duplicate response returns `409 INVALID_RECOMMENDATION_STATE`. Capacity changes return `409 RECOMMENDATION_CAPACITY_CHANGED` and expire the proposal. Block or hard-constraint changes prevent acceptance.

There is intentionally no endpoint here to create a real group or activate `TripMember` records. Those actions require a later membership workflow with a fresh atomic capacity check.
