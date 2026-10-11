# Connections

Connections are explicit user-to-user consent records. They do not enroll anyone in a trip, accept a Phase 11 group recommendation, create a group, send a message, or grant chat access.

## Lifecycle and duplicate policy

`PENDING` is created by the requester. Only its recipient may move it to `ACCEPTED` or `REJECTED`; only the requester may move it to `CANCELLED`. Either participant may move an accepted connection to `UNMATCHED`. Rejected, cancelled, and unmatched records are terminal. A later request creates a new record, including after a rejection; a prior terminal record cannot be reactivated.

The model stores a normalized, sorted participant pair and a trip context (`GLOBAL` when there is no trip). A unique partial index on `activeKey` allows only one pending or accepted record per pair and context. Terminal transitions clear the key atomically. This permits an independent connection in another trip context, while preventing reverse-direction duplicates in the same context. Requester and recipient must differ.

## Authorization and eligibility

All routes require authentication. Requests require both accounts active and reject either direction of a safety block. Accept rechecks both accounts, blocks and, when present, the trip's status and privacy. Trip-linked connections are limited to public/community trips in active planning statuses; a community trip requires the requester and recipient to be current members or its creator. Private and invite-only trip context is not accepted. A participant can view a connection; a block suppresses detail access and hides that counterpart from lists. Contact details and private profile/verification data are not selected or serialized.

State changes use conditional `findOneAndUpdate` filters on the prior state and authorized participant. MongoDB's single-document atomic update makes concurrent acceptance/rejection/cancellation/unmatching attempts mutually exclusive without requiring a multi-document transaction. The active-pair unique index is the final duplicate-request guard. Actions are recorded in the existing audit log. Request creation is limited to 10 requests per hour per rate-limit key.

## Compatibility and future chat

Clients cannot submit compatibility scores or member lists. For a trip-linked request, the service reuses the Phase 10 compatibility engine and refuses only known destination, date, or budget hard mismatches; unknown dimensions remain unknown. It neither persists nor exposes the requester's private compatibility score through the connection record. Profile-only requests have no trip score. Connection acceptance is not driven by compatibility or AI.

Phase 13 chat authorization should require an `ACCEPTED` connection, recheck that the connection is still accepted and that neither participant blocks the other on every authorization boundary, and reject suspended accounts. A shared trip alone does not grant direct chat access. There is no chat implementation in this phase.

## Indexes and scale

Indexes cover unique active normalized pair/context, requester/status/recent, recipient/status/recent, and trip/status. List endpoints page at 50 records maximum and use safe name/title projections. Audit and history retention follow the existing database policy. The in-memory request limiter is process-local; deployments with multiple instances should configure a shared rate-limit store.

## Limitations

There is no discoverability setting in the current User model, so active accounts with a public profile may be requested by ID. Public profile discovery policy should be explicit before broad directory/search surfaces are added. The global and trip-context records are independent by design. Connections do not join trip membership and provide no messaging permission by themselves.
