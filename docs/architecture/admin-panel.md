# Admin panel architecture

## Roles and access

TripBuddy retains its existing `USER`, `MODERATOR`, and `ADMIN` roles. `requireAuth` verifies the existing signed session, reloads the account and checks `tokenVersion` and `accountStatus`. `requireModerator` grants the existing review workflows to moderators and administrators. The new `requireAdmin` guard protects every admin dashboard API and checks the current database role. Hiding a client link is only a usability choice; it is not an access control.

Admin account status and role writes increment `tokenVersion`, invalidating all sessions for the changed account. Login and authenticated requests reject `SUSPENDED` and `BANNED` accounts. The last active administrator cannot be demoted or restricted through the panel, and administrators cannot alter their own status or role. Do not delete users to enforce moderation; preserving referential and financial history is required.

## Dashboard sources and boundaries

- User totals use `User.countDocuments`. A recent-activity metric is returned as unavailable because the application does not track reliable last-active timestamps.
- Trip lifecycle, booking, and payment status counts use grouped aggregation pipelines over their respective collections.
- Pending safety and review reports use bounded `countDocuments` queries. Open moderation workload is grouped from `ModerationRecord`.
- Platform health is explicitly unavailable because no application observability source is configured.
- Payment metrics contain status counts only. No payment amount, provider reference, account ID, token, credential, or checkout field is exposed by the admin panel.
- User lists return name, email, role, status, location labels, and timestamps only. They do not return profile preferences, emergency contacts, passwords, phone numbers, or verification documents.
- Trip lists return trip content and lifecycle/moderation visibility metadata. The admin list does not alter membership, expenses, bookings, payment records, or private itinerary records.

The overview and list endpoints use server-side counts, grouped aggregation, projection, capped page sizes, and sort order. User name and trip title indexes support common admin lookups. Search is prefix based to bound the common search shape.

## Moderation and audit

Report handling, review moderation, and AI moderation use the existing Safety Center and Phase 24 moderation records. Trip visibility changes use `ModerationRecord` decisions and the `moderationVisibility` field; hidden trips are excluded from public discovery and from public trip detail access. Owners and members can still access their trip. No AI score automatically changes visibility.

Administrative status and role changes require a reason and write minimal before/after values to the existing `AuditLog`. Existing moderation and report decisions retain their current audit paths. Audit records can be queried by administrators and are paginated; the app exposes no edit/delete endpoint. The collection is not cryptographically tamper proof: deployment must restrict direct database write access, protect backups, and alert on privileged database access.

## Bootstrap and deployment

Promote the first administrator using a trusted database operator and an existing account as described in [the admin API guide](../api/admin.md). Never derive admin access from a request body, registration input, email suffix, public bootstrap route, or client state. Restrict MongoDB administrative credentials and access logs. Use TLS, secure production cookies, a strong `JWT_SECRET`, and the existing trusted `CLIENT_URL` configuration.

Status and role updates and their corresponding audit events are committed in one MongoDB transaction, so the deployment must use a transaction-capable replica set. These updates also write a shared guard document in the transaction, serializing admin-panel account changes around the last-active-admin check. Direct database role edits bypass that guard and must remain restricted to trusted operators. MongoDB integration tests require a dedicated `MONGODB_TEST_URI`; without it, database-level concurrency and authorization behavior has not been verified.

The app has no observability integration or reliable activity timestamp, so those metrics remain unavailable rather than being represented as zero. Financial actions remain in existing provider-authorized services; this panel adds no refund or manual payment-success control.
