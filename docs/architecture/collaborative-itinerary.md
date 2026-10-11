# Collaborative itinerary architecture

Phase 15 extends the Phase 14 `Itinerary` document and its planner service. It does not add another itinerary collection or AI provider. Private itinerary endpoints and generation stay owner-scoped. When collaboration is enabled, its legacy whole-plan update and day-regeneration routes reject writes; shared edits go through revision-aware endpoints.

## Policy and persistence

`Itinerary.collaborationEnabled` is an explicit opt-in. `collaborators` stores only explicit itinerary grants (`user`, `VIEWER`/`EDITOR`, grant actor/time); it is not a copy of Trip membership. Each access check also requires an eligible active account and current `TripMember.status === ACTIVE`. The Trip creator or an administrator can change policy and grants; a collaborator cannot grant access to themself. Trip privacy, connections, recommendations, and chat are not authorization inputs.

The itinerary has a monotonically increasing `revision`. Shared writes validate the complete edit, then conditionally update on `_id` and the expected revision inside a MongoDB transaction. The same transaction inserts an `ItineraryRevision` snapshot/change record with actor, time, operation, and resource. The unique `(itinerary, revision)` index protects history integrity. The transaction requires a MongoDB deployment that supports transactions (replica set or sharded cluster). A failed conditional write returns 409 and the latest revision; changes are never silently overwritten. Retry with a stale revision is rejected, so clients must fetch the latest state before deciding whether to retry.

Revision snapshots contain the itinerary plan and budget for safe restoration; history API results omit snapshot content. Collaboration responses serialize only itinerary fields needed by the planner, and collaborator listings expose only user ID, name, role, and grant time.

## Stable resources and budgets

Days and activities use stable ObjectId strings in the existing mixed planner document. Enabling collaboration backfills missing IDs. Every activity edit validates shape, daily duration, cost currency, and revision. Reordering requires each current ID exactly once. Costs recalculate each day's total and the Activities budget line; a total remains unknown if any activity amount is unknown.

## Real-time behavior

The existing authenticated Socket.IO server handles itinerary rooms separately from chat rooms. Join/write handlers revalidate the session and authorization; room delivery revalidates each connected recipient and removes sockets whose access was revoked. Notifications are emitted only after the transaction commits and contain no itinerary text or profile fields. Disconnect automatically releases room membership. The deployment has no shared adapter configured, so multiple instances need a shared Socket.IO adapter for cross-instance rooms and broadcasts.

## Limits

Current editing UI exposes activity create, title edit, delete, and within-section reorder, plus saving/offline/conflict/revocation states and recent history. Revision restoration and day reorder are available in the API. Activity discussion, presence indicators, cross-section drag-and-drop, and automatic conflict merging are not implemented. Production database integration and concurrent-writer checks must run against a dedicated test database before making production-readiness claims.
