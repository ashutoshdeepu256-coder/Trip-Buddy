# Safety API

All routes use `/api/v1` and require the authenticated HTTP-only session except
for public profile reads.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/safety/block/:userId` | Idempotently block another user; self-blocking is rejected. |
| DELETE | `/safety/block/:userId` | Unblock a user; repeated unblocks are harmless. |
| GET | `/safety/blocked-users` | Lists only the caller's blocked users. |
| POST | `/safety/reports` | Submit `{ "reportedUserId": "...", "reason": "...", "description": "..." }`. |
| GET | `/safety/admin/reports` | Moderator/Admin report queue with status and pagination filters. |
| PATCH | `/safety/admin/reports/:reportId` | Moderator/Admin sets `UNDER_REVIEW`, `RESOLVED`, or `DISMISSED` and an internal resolution. |

Report reasons: `SPAM`, `HARASSMENT`, `SCAM`, `FAKE_PROFILE`,
`INAPPROPRIATE_CONTENT`, `SAFETY_CONCERN`, and `OTHER`. Reporters cannot report
themselves; an open report by the same reporter for the same user prevents
duplicates. Report and safety changes create audit events. Internal report
resolution details are not available through user-facing APIs.

The current project has no trip matching, chat, or connection endpoints. The
safety service exports a bidirectional block check for those future interaction
routes; they must call it before allowing a direct interaction or matching a
candidate. Historical trips/reports are not deleted when a block is created.

Audit events record actor, action, resource, request IP/user-agent, and
non-sensitive metadata. Do not put documents, OTPs, raw verification tokens,
or provider secrets in audit metadata.
