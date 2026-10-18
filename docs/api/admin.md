# Admin API

All endpoints use the existing TripBuddy session cookie or bearer token. Admin endpoints require an active account with the database role `ADMIN`; role values sent by clients are never used for authorization. The server reloads the account for each authenticated request and rejects restricted accounts. Admin writes are rate limited and validate strict request schemas.

## Endpoints

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/admin/overview` | `ADMIN` | Bounded totals for users, trip lifecycle states, pending reports, moderation, bookings, and payment statuses |
| `GET` | `/api/v1/admin/users` | `ADMIN` | Paginated name/email prefix search with account-status and role filters |
| `PATCH` | `/api/v1/admin/users/:userId/status` | `ADMIN` | Suspend, ban, or restore an account with a reason |
| `PATCH` | `/api/v1/admin/users/:userId/role` | `ADMIN` | Change a role with a reason; allowed values are `USER`, `MODERATOR`, and `ADMIN` |
| `GET` | `/api/v1/admin/trips` | `ADMIN` | Paginated trip title search and lifecycle filter |
| `GET` | `/api/v1/admin/audit` | `ADMIN` | Paginated, read-only audit history |

Search, filters, and pagination are processed by MongoDB. Page sizes are capped at 50. The overview uses `countDocuments` and grouped aggregation pipelines; it never loads complete collections. Payment and booking output contains status counts only. It omits amounts, counterparties, provider IDs, checkout details, and credentials.

Moderators continue to use `/api/v1/safety/admin/reports`, `/api/v1/safety/admin/moderation`, `/api/v1/admin/reviews`, and `/api/v1/admin/verifications` under their existing role guards. Safety report lists accept `status`, `targetType`, `createdFrom`, and `createdTo`. The AI moderation queue accepts `status`, `targetType`, `severity`, `createdFrom`, and `createdTo`. Existing moderation decisions support hiding and restoring messages, reviews, and trips. Trip hide/restore is available only for trips already represented in the existing moderation queue. Review moderation remains subject to its existing lifecycle rules.

Account and role changes require a 10–500 character reason, increment `tokenVersion` to invalidate existing sessions, and create an `ADMIN_USER_STATUS_CHANGED` or `ADMIN_ROLE_CHANGED` audit record with the actor, target, previous value, new value, and reason. An administrator cannot alter their own status or role. The application blocks demotion or restriction of the last active administrator. Accounts are restricted rather than deleted, preserving linked history.

## First administrator

There is intentionally no public bootstrap endpoint, environment email allowlist, or client-controlled role flag. A database operator must select an existing, verified account through the trusted account recovery process and promote it out of band using a privileged database session, for example:

```javascript
db.users.updateOne(
  { email: "operator@example.com", accountStatus: "ACTIVE" },
  { $set: { role: "ADMIN" } }
)
```

Confirm that exactly the intended account matched and that the operator can sign in before ending the database session. Do not expose database credentials through the application. See [the admin panel architecture](../architecture/admin-panel.md) for deployment and operational limits.
