# AI travel planner architecture

`Itinerary` is a separate persisted planning document. It references its
creator and optionally an existing Trip, while keeping a bounded validated
plan, dates, destination, budget context, preferences, provider source/model,
and archive timestamp. It does not duplicate or mutate Trip or Destination
records. Indexes support owner-scoped archive listing, newest updates, and
trip/owner lookup.

## Access and lifecycle

Every service lookup filters by both itinerary ID and authenticated owner.
The caller's account must remain `ACTIVE`. A linked Trip is accepted only when
the actor is its creator and its lifecycle is not cancelled or completed.
Trip membership, public visibility, accepted recommendations, and group
recommendations do not grant itinerary access. Plans remain private to their
creator; explicit sharing is future work. The planner neither creates nor
changes `TripMember` records.

Generation inputs use explicit allowlists and limits. Provider output is JSON
parsed into the same Zod contract used for edits, then checked for exact date
coverage, sequential day numbers, currency consistency, and a daily activity
duration cap. Invalid, unavailable, or unconfigured provider responses use a
deterministic outline with null costs and an explicit unknowns list. Day
regeneration replaces only the selected day; other user edits remain intact.
Saved plans are not recomputed on reads. Audit records contain lifecycle
metadata and IDs, never plan text, prompt, credentials, or provider errors.

## Provider and reliability limits

The existing root workspace already contains Google's Generative AI SDK; the
planner uses it lazily and adds no dependency. It sends only the destination,
dates, budget context, and user-entered itinerary preferences. User identity,
profile, trip membership, and secrets are excluded. Prompt text explicitly
disallows claims of live venue, cost, weather, transport, visa, or safety facts.
The server sets a model, JSON response mode, output token ceiling, and request
timeout. Provider failure is caught and logged by error name only.

Per-user route limits are five full generations and ten day regenerations per
hour. The default 3,000 (maximum 6,000) output-token ceiling and 20-second timeout bound an
individual call. These controls do not establish an exact monetary spend cap;
provider-side quota/budget alerts are required for billing protection.
Production must set the model currently supported for its provider account.

The app has no shared request quota store; the existing Express rate limiter is
in-memory and resets on restart. Horizontal deployments need a shared
rate-limit store and coordinated abuse limits. Plans are stored in MongoDB;
the application uses its configured database connection. The planner has not
been verified against a multi-instance deployment. No live travel-data source,
provider-grounded retrieval, sharing workflow, or cost reconciliation exists.
