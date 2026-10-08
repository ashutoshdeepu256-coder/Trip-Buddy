# Trip Creation Engine Architecture

## Entity boundaries

`Trip` is the planning entity and references `User` and `Destination` by
ObjectId. It stores trip-specific dates, budget, group size, preferences,
privacy, status, images, optional GeoJSON location, and lifecycle timestamps.
Destination facts remain in the existing Destination collection. `TripMember`
is the membership edge (`trip`, `user`, `role`, `status`, `joinedAt`,
`invitedBy`) for future join/invitation functionality; the creator is
represented as an active `OWNER` edge at trip creation.

The trip read serializer only returns creator name, location, join date, and
factual verification booleans. It never returns email, phone, role, or
provider-specific image IDs. Destination population is a field allowlist.
Community trip listings and matching are intentionally deferred until their
domain models exist.

## Index decisions

- `{ creator: 1, createdAt: -1 }` supports a creator's newest-first trip list.
- `{ destination: 1, status: 1, startDate: 1 }` supports destination-oriented
  discovery for upcoming trips.
- `{ status: 1, privacy: 1, startDate: 1 }` supports public/community
  availability filtering.
- `{ status: 1, startDate: 1, endDate: 1 }` supports date-window discovery
  and lifecycle schedulers.
- `{ status: 1, budget.min: 1, budget.max: 1 }` supports future budget-range
  discovery.
- A `2dsphere` index on optional trip location supports future proximity
  queries.

`TripMember` has a unique `{ trip: 1, user: 1 }` edge and
`{ user: 1, status: 1, createdAt: -1 }` for membership lookup. Indexes are
compound around the anticipated query shapes rather than separate indexes on
every status/privacy/date field.

## Service and API flow

Routes authenticate/validate and delegate to `trip.controller.js`, which
delegates business rules to `trip.service.js`. The service owns destination
existence checks, membership/ownership, privacy visibility, publishing
requirements, legal status transitions, and pagination. Lifecycle status is
not accepted by create/update. Publish, cancel, and status changes have
dedicated operations.

Draft creation tolerates missing planning details. Publishing runs the strict
publish schema against persisted data and rechecks the destination. The
current status graph is:

```text
DRAFT --publish--> PUBLISHED --> PLANNING --> CONFIRMED --> ONGOING --> COMPLETED
   \________________________ cancel any non-completed state __________> CANCELLED
```

Only the creator can mutate trips in this phase. Trip-member roles and statuses
are established for later authorized member actions but do not grant write
access yet.

## Images and later phases

Image upload is a separate authenticated draft-only endpoint. It validates
both MIME and binary signatures, applies byte/file-count limits, stores image
assets in Cloudinary, and stores only URL/provider ID/format/timestamp in
MongoDB. Provider IDs are stripped from API output.

Trip dates, destination, budget, interests, activities, travel style, and group
size are explicit fields for Phase 9 discovery and Phase 10 compatibility.
Connections, join requests, chat, AI plans, expenses, and reviews are not
implemented here and have no fabricated records or implicit model behavior.
