# Reviews API

Paths are relative to `/api/v1`. Public review reads return only published reviews. Mutations require an authenticated active account; moderation routes require the existing moderator or administrator role. Review comments are plain text and clients must render them as text, never as HTML.

## Eligibility

A traveller review requires a `COMPLETED` Trip with `completedAt`. The reviewer and reviewed traveller must both have an active `TripMember` row with a non-null `joinedAt` no later than the Trip completion time, and both accounts must currently be active. Self-reviews are rejected. A public Trip, accepted connection, chat, or group recommendation does not establish review eligibility. There is one review per reviewer, reviewed traveller and Trip.

## Routes

- `POST /reviews` creates and immediately publishes a review. Body: `{ "tripId": "...", "revieweeId": "...", "rating": 5, "comment": "Optional plain text" }`. Ratings are integer values from 1 to 5. The server derives the author and eligibility evidence.
- `GET /reviews/travellers/:userId?page=1&limit=10` lists published traveller reviews and includes the aggregate summary. Pagination is capped at 50. Private Trip title and ID are omitted from this profile response.
- `GET /reviews/travellers/:userId/summary` returns the traveller rating average, count and distribution for ratings 1–5.
- `GET /reviews/trips/:tripId?page=1&limit=10` lists published reviews for a completed Trip. Trip visibility and membership authorization follow the existing Trip access service.
- `GET /reviews/trips/:tripId/summary` returns aggregate ratings for the completed Trip.
- `GET /reviews/trips/:tripId/eligibility` requires active Trip membership and returns only other active members who can be reviewed, including whether this author already reviewed them.
- `GET /reviews/:reviewId` requires authentication. Published reviews are readable; an author can also retrieve their own hidden or removed record.
- `PATCH /reviews/:reviewId` lets the author update a published review. Earlier rating and feedback snapshots are retained and an audit record is written.
- `DELETE /reviews/:reviewId` soft-removes an author's review. It remains in private history and no longer appears in public lists or aggregates.
- `POST /reviews/:reviewId/reports` reports a published review with one of `HARASSMENT`, `SPAM`, `PERSONAL_DATA`, `FALSE_CLAIM`, or `OTHER`. A user may submit one report per review.
- `GET /admin/reviews/reports?page=1&limit=20&status=OPEN` lists reports for moderators and administrators. The default is open reports.
- `PATCH /admin/reviews/reports/:reportId` resolves a report as `RESOLVED` or `DISMISSED`, with a required resolution.
- `PATCH /admin/reviews/:reviewId` sets moderation status to `PUBLISHED`, `HIDDEN`, or `REMOVED`, with a required reason. Removed reviews cannot be republished.

Review creation is limited to 8 submissions per account per day; reports are limited to 5 per account per day. The application-wide API limiter also applies. Database unique indexes handle concurrent duplicate reviews and reports.

## Response privacy

Public serializers include reviewer and reviewed traveller names, rating, plain-text comment, publication timestamps and a verified-trip indicator. They do not return email addresses, account status, membership rows, report details, edit history or moderation metadata. Public profile review lists omit Trip identity entirely; Trip titles are returned only when the caller can access that Trip. A verified-trip label means the server checked the completed Trip and membership records described above.
