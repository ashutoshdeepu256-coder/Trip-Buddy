# Admin analytics API

`GET /api/v1/admin/analytics` returns period totals and zero-filled time series. It uses the existing session cookie or bearer token and requires an active database account with role `ADMIN` on every request. Moderators and regular users are denied. The endpoint is rate limited to 10 requests per minute per administrator.

## Period selection

- `?window=24h`, `?window=7d`, or `?window=30d` selects a trailing UTC duration. The default is `30d`.
- Custom ranges use `?from=2026-03-01T00:00:00Z&to=2026-03-31T00:00:00Z`. Both must be ISO date-times with an explicit timezone. `from` is inclusive and `to` is exclusive. Ranges are limited to 90 days and cannot end in the future.
- `24h` uses hourly UTC buckets; the longer presets and custom ranges use daily UTC buckets. First and last buckets can be partial. Returned period timestamps are normalized to UTC.
- Genuine empty buckets are returned with count `0`. Ratios have a `null` value and `available:false` when their denominator is zero.

The response has `period`, `summary`, and `metrics`. Most metrics are arrays of `{ at, count }`. `currentEligibleUsers` is a point-in-time count, not a time series. Each account is eligible for this count when `accountStatus` is `ACTIVE` at the time of the request. `historicalEligibleUsers` is explicitly unavailable because past status snapshots were not retained.

## Metric definitions and sources

All timestamps are source-record timestamps in UTC. These are operational activity counts, not unique-user counts or business conversion rates unless stated.

| Metric | Definition and source |
| --- | --- |
| `usersRegistered` | User records grouped by `createdAt`. |
| `currentEligibleUsers` | Current `User.accountStatus = ACTIVE` count via the indexed status field. |
| `accountStatusChanges` | `ADMIN_USER_STATUS_CHANGED` audit records. Complete only from Phase 25 deployment onward; older changes are not backfilled. |
| `tripsCreated` | Trip records by `createdAt`. |
| `tripsPublished`, `tripsCompleted`, `tripsCancelled` | Trip lifecycle timestamps `publishedAt`, `completedAt`, and `cancelledAt`; these are event timestamps, not current status counts. |
| `membershipsJoined` | TripMember records by non-null `joinedAt`; includes historical rows for members who later left or were removed. |
| `connectionRequests` | Connection records by `createdAt`. |
| `connectionAcceptances` | `CONNECTION_ACCEPTED` audit entries. The source operation and audit write are separate, so this is a count of recorded acceptance audit events, not a guaranteed event ledger or a cohort conversion rate. |
| `conversationsCreated`, `messagesCreated` | Conversation and Message `createdAt` counts. Message aggregation never reads or returns message text. |
| `itinerariesCreated` | Itinerary records by `createdAt`, without reading plan or preference content. |
| `itineraryGenerations` | `ITINERARY_GENERATED` audit entries. `geminiItinerariesCreated` and `fallbackItinerariesCreated` group itinerary records by their recorded source. Audit event delivery is not transactionally guaranteed for every legacy workflow. |
| `bookingsCreated` | TripBuddy booking records by `createdAt`. |
| `bookingExternalHandoffs` | Status history entries labeled `EXTERNAL_HANDOFF`. This records preparing/handing a user to a provider; TripBuddy does not observe or claim an external reservation conversion. |
| `expensesCreated` | Expense records by `createdAt`; amounts and allocation details are not selected. |
| `settlementsRecorded`, `providerVerifiedSettlements`, `userReportedSettlements` | Settlement records by `recordedAt`, split by their `source`. Counts do not imply cash movement for user-reported settlements. |
| `paymentAttemptsCreated` | Payment attempt records by `createdAt`. |
| `paymentVerifiedSuccesses`, `paymentVerifiedFailures`, `paymentRefundEvents` | PaymentAttempt history transitions grouped by `history.at`, only where source is the server-side `API`, `WEBHOOK`, or `RECONCILIATION` path. These states are written after provider verification. Refund metric counts full and partial refund transition events, not amounts. No amounts, counterparties, provider references, or credentials are returned. |
| `paymentStatusEvents` | Zero-filled series for recorded provider-backed payment history statuses in the same period. These are transition counts, not current-state totals or accounting balances. |
| `reviewsCreated`, `reviewsModerated`, `safetyReportsCreated`, `reviewReportsCreated`, `reviewReportsResolved` | Review, report, and review report source timestamps. Moderation activity counts decisions by `ModerationRecord.reviewedAt`. |
| `moderationClassifierProviders` | ModerationRecord creation counts grouped by the stored provider label (`RULES`, `GEMINI`, `UNAVAILABLE`). This is record volume, not provider request volume or a provider failure rate. |
| `assistantReplies` and `assistantFallbackShare` | Persisted assistant response messages by `createdAt` and recorded source. Fallback share is deterministic-fallback responses divided by all persisted assistant responses; no replies means a null ratio. It is not a request failure rate. |
| `assistantProviderFailureRate` | Unavailable: provider failures are not persisted separately from deterministic fallback replies. |
| `notificationPersistence` | Retained Notification documents by `createdAt` (180-day TTL). This is persistence volume, not device delivery or read count. The API permits at most 90-day ranges. |
| `notificationDelivery` | Unavailable: delivery acknowledgements are not instrumented. |

The existing `/api/v1/admin/overview` endpoint remains the Phase 25 source for current lifecycle and status summaries. This analytics API focuses on time-series activity and does not duplicate those current status cards.
