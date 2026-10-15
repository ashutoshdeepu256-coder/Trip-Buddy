# Reviews and reputation architecture

Phase 20 adds traveller reviews to the existing profile trust summary. Reviews use `Trip`, `TripMember`, `User` and `AuditLog`; they do not derive eligibility from a connection, public Trip visibility, chat access, group recommendation, user assertion or client-supplied verified flag.

## Eligibility and historical evidence

A review is accepted only after the Trip is `COMPLETED` and has a completion timestamp. The reviewer and target each need a current `TripMember.status === ACTIVE` row whose non-null `joinedAt` is no later than the Trip completion timestamp. Both user accounts must be active under the existing account policy (not explicitly suspended or banned), and reviewer and target must differ. Current membership data is not exposed by the review APIs.

`TripMember` stores a unique Trip/user row and join timestamp, but it has no leave/removal timestamp and the current Trip workflows do not retain a participation interval. The policy therefore fails closed for members whose row is no longer active; the service does not infer historical participation from accepted connections, recommendations, chat, or public visibility. The existing group recommendation acceptance flow records consent and does not create a Trip membership. As a result, only Trips with explicit active membership rows can receive reviews. The current app creates an owner row when creating a Trip; member onboarding/history remains a product limitation until a separate membership workflow exists. No historical membership is invented.

## Review lifecycle and moderation

`Review` is unique on `(author, reviewee, trip)` and starts as `PUBLISHED` after all eligibility checks pass. Authors can edit only published reviews; edits keep up to 20 previous snapshots on the record and every edit has a private audit history. Authors may soft-remove their review. Moderators and administrators can publish, hide or remove a review. Removal is terminal. A review report is stored separately with a unique reporter/review index and audit record; reports do not automatically hide a review or change its rating. This prevents report volume or a target's disagreement from silently suppressing negative feedback. Human moderators decide whether to hide or remove a review, and their reason is audited.

Review text is trimmed and control characters are removed before storage. It remains untrusted plain text; the React UI renders it as text. Public serialization omits emails, Trip membership, report details, edit history and moderation-only fields. Trip names are omitted from profile review lists so private Trip identity is not disclosed there.

## Reputation calculation

Only reviews with `status === PUBLISHED` contribute. The service groups integer 1–5 ratings and computes distribution and count on the server. The average is rounded to one decimal place with positive half-up rounding: `round(sum(rating) * 10 / count) / 10`. Empty populations return `averageRating: null`, count zero and zero counts for each rating. Hidden and removed reviews are excluded immediately after the same state write that records moderation. There are no subratings or fabricated scores.

Indexes support per-traveller and per-Trip pagination; unique compound indexes prevent duplicate reviews and reports under concurrent writes. Review edits do not change membership eligibility. Profile completed-trip counts use active membership rows and completed Trips whose completion happened after the recorded join time.

## Endpoints and operational checks

See [reviews API](../api/reviews.md). Review create and report operations are rate limited. Moderation APIs use the existing `requireModerator` guard and every material action writes an `AuditLog` record. Review/report writes and their audit events use MongoDB transactions, so production and database integration tests require a replica-set or transaction-capable sharded MongoDB deployment. Run integration tests against a disposable database named for testing via `MONGODB_TEST_URI`; unit tests do not establish unique-index or concurrent transaction behavior.

The membership limitation above is the main product constraint: review composition is available only when the application has authoritative active TripMember rows for both people. Existing public profile and Trip reads do not create those records.
