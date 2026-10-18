# Analytics architecture

## Data model and processing

Phase 26 adds no analytics event collection, outbox, worker, external analytics provider, or cache. The endpoint aggregates existing business records and histories at read time. This avoids recording a second copy of each business event and keeps message text, itinerary plans, user preferences, payment amounts, provider IDs, and credentials out of the analytics response.

Each query is restricted to a validated period of at most 90 days and uses a bounded date range, grouping dimensions, and UTC hourly/daily buckets. The endpoint caps calls at 10 per minute per authenticated administrator. Source timestamp indexes were added for the measured paths (including lifecycle timestamps, join dates, histories, payment histories, moderation dates, and message creation); production deployments must build these indexes before enabling the analytics page. Results are live and uncached. Aggregations run across collections in parallel and therefore are not a single cross-collection transactional snapshot. A metric can reflect a small amount of write-time skew while the request is running.

Time series report event/activity counts, not unique users. Ratios use an explicit numerator and denominator, and a zero denominator returns unavailable/null. Empty time buckets are explicit zeroes. The API uses UTC independent of the browser or server local timezone. Custom `from` is inclusive and `to` exclusive; ranges cannot exceed 90 days.

## Source semantics and delivery guarantees

- Registration, trip lifecycle timestamps, membership joins, messages, conversations, itinerary records, bookings, expenses, settlements, reviews, and persisted notifications use their stored timestamps.
- Account-status history relies on Phase 25's transactional status-change and audit write. It does not reconstruct older changes.
- Some existing service actions write audit events after the primary document update rather than in the same transaction. Connection acceptance and itinerary-generation audit counts therefore measure recorded audit entries and are not a complete transactional event ledger. No guarantee of complete audit-event delivery is claimed.
- Verified payment metrics read PaymentAttempt status history written after server-side provider API, webhook, or reconciliation validation. They return counts only. They are not a source of accounting totals or settlement balances.
- External booking handoffs are not reservation conversions. Settlement rows marked `USER_REPORTED` are not provider confirmations.
- Notification documents expire after 180 days. Assistant messages expire after one year. The analytics API's maximum 90-day range stays within these record-retention periods, but it does not preserve deleted documents or retain a separate historical summary.
- Moderation classifier provider labels indicate persisted moderation-record classification. They do not count every model request. Assistant deterministic fallback replies are measurable, but provider failures cannot be isolated from intentional fallback. Notification socket delivery acknowledgements are not persisted.

No background aggregation is currently justified: the endpoint groups bounded, indexed ranges and has no event-processing lag. There is no aggregation rebuild process because no summary collection is maintained. If volume makes live aggregation too expensive, add a transactional outbox or durable change stream with idempotent event keys before claiming complete event capture, then define backfill, correction, retention, and lag monitoring.

## Privacy and access

Platform analytics require the active `ADMIN` role, reloaded from the database on each request. Moderators do not receive platform-wide analytics, and regular users cannot access these routes. The Phase 26 personal trip-statistics endpoint is not added; no user analytics are exposed outside existing owner-scoped trip views.

Aggregations return counts and time buckets only. Messages are counted by timestamps without reading content. Itinerary contents and expenses' amounts/allocations are not returned. Financial counts are separated from provider-verified payment and settlement states; no balances, revenue, or conversion are inferred. No third-party analytics tracking is introduced. Existing source retention rules continue to apply; analytics queries do not extend retention.

## Known limits

- Historical eligibility cannot be reconstructed from the current account status; only current `ACTIVE` count and Phase 25 onward audited changes are available.
- Connection acceptance and itinerary-generation audit events may be missing when an existing nontransactional audit write fails.
- Booking reservation conversion, notification delivery, message reads/engagement cohorts, and assistant provider failure rates are not instrumented.
- The UI renders simple accessible bucket charts without adding a charting library. It displays UTC dates and labels unavailable values rather than zero.
- Analytics behavior must be exercised with a dedicated MongoDB integration database to validate aggregation plans, date boundaries, and production indexes. Unit tests alone do not establish query performance.
