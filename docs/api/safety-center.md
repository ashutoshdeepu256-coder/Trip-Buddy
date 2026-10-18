# Safety Center API

All endpoints are under `/api/v1/safety` and require an authenticated, active
session. Writes are rate limited; JSON requests are subject to the application's
1 MB body limit. Report submissions are additionally limited to five per
account/IP window per day.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST / DELETE | `/block/:userId` | User | Create or remove the caller's block edge. |
| GET | `/blocked-users` | User | List only the caller's blocks. |
| GET / PATCH | `/settings` | User | Read/update discoverability and connection-request preferences. |
| POST | `/reports` | User | Submit traveller, trip, message, review, or general incident report. |
| GET | `/reports/mine` | User | Paginated status-only view of the caller's own reports. |
| GET | `/emergency-contacts` | Owner | List private contacts belonging to the caller. |
| POST / PATCH / DELETE | `/emergency-contacts[/:contactId]` | Owner | Manage up to five contacts; phone numbers require a `+` country code. |
| GET / PATCH | `/trips/:tripId` | Active trip member / creator for writes | Read or update private trip safety notes. |
| GET / PATCH | `/admin/reports[/:reportId]` | Moderator or Admin | Paginated queue and report status/notes management. |

Report JSON includes `targetType`, `reason`, a 10–3000 character `description`,
and the matching target reference (`reportedUserId` for `TRAVELLER`, `targetId`
for `TRIP`, `MESSAGE`, or `REVIEW`). `INCIDENT` has no target. Evidence uploads
are not supported, and arbitrary evidence metadata is rejected. Reports begin at
`SUBMITTED`; moderators may move them to `UNDER_REVIEW` or `DISMISSED`, then to
`RESOLVED` or `DISMISSED`. Terminal reports cannot be reopened by this API.
Moderator notes are never included in the reporter's response. No automatic
account punishment is triggered by a report.

Contact data is returned only to its owner, including when included in trip
safety responses. Trip safety includes destination/date summary, owner-managed
meeting point/checklist/notes, and the requesting member's own contacts. It does
not return destination coordinates or local emergency-service claims. The API
returns a clear notice that TripBuddy does not monitor or dispatch assistance.
There is no contact-notification provider configured.

The project uses its existing `Block` model. A block works in both directions
for matching, discovery, connections, and direct chat authorization/delivery;
historical trip, financial, report, and audit records remain intact. API errors
avoid disclosing whether an inaccessible private trip/report target exists.

Current retention follows the application's database retention and account
lifecycle policies; there is no safety-specific automatic purge. Operators must
define a retention schedule before production deployment. Report descriptions
and moderator notes are not copied to audit metadata or application logs.
