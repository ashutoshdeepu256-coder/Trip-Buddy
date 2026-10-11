# Connections API

All endpoints use `/api/v1`, require an authenticated session, and return the application's standard `{ success, message, data }` envelope. IDs are MongoDB ObjectIds. List endpoints accept `page` (default 1) and `limit` (default 20, maximum 50) and return `items`, `page`, `limit`, `total`, `totalPages`, `hasNextPage`, and `hasPreviousPage`.

## Create and list

- `POST /connections` — body `{ "recipientId": "<userId>", "tripId": "<optionalTripId>" }`. Returns `201` and the new pending connection. Extra fields (including score) are rejected. Limited to 10 requests per hour. Active or pending duplicate pair/context returns `409 DUPLICATE_CONNECTION`; self, inactive, blocked or inaccessible-trip requests are rejected.
- `GET /connections` — accepted connections for either participant.
- `GET /connections/requests/received` — pending incoming requests.
- `GET /connections/requests/sent` — pending outgoing requests.

## State changes

- `POST /connections/:connectionId/accept` — recipient only; pending to accepted. Account, block and contextual trip eligibility are rechecked.
- `POST /connections/:connectionId/reject` — recipient only; pending to rejected.
- `POST /connections/:connectionId/cancel` — requester only; pending to cancelled.
- `POST /connections/:connectionId/unmatch` — either participant; accepted to unmatched.
- `GET /connections/:connectionId` — participant only; returns minimal counterpart name, optional trip reference, status and lifecycle timestamps.

Invalid or repeated state transitions return `409 INVALID_CONNECTION_STATE`. Nonparticipants and blocked pairs receive a not-found response to avoid confirming private connection existence. The serialized counterpart never includes email, phone, birth date, private verification data, or hidden preferences.

Rejected, cancelled and unmatched records cannot transition to accepted. A new request can be created after those terminal states. A new accepted connection requires a fresh consent cycle. A trip context must be public/community and in an active planning status; community context requires both participants to have trip access. For trip-linked requests, Phase 10 server-side compatibility is reused and known destination/date/budget hard mismatches are refused; unknown data stays unknown. Client-supplied scores are never used. The API does not change trip membership, accept group recommendations, or authorize chat.

## Future chat boundary

Phase 13 should require an accepted connection plus a fresh block/account-state check. Shared membership without an accepted connection does not grant direct chat access under the current policy.
