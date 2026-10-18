# Safety Center architecture

## Existing infrastructure

The Safety Center reuses `Block`, `Report`, `AuditLog`, the established session
authentication and moderator authorization. `EmergencyContact` stores owner
scoped contact details. Trip safety notes are a private subdocument on `Trip`;
the ordinary trip serializer does not expose them. Report content remains in
`Report`; audit events contain resource/action metadata only.

## Blocking

`Block` has a unique `(blocker, blocked)` index and block creation is idempotent.
An edge is treated as blocking in either direction. Matching and group candidate
generation, trip discovery, connection requests/listing, and direct chat
authorization check the edge. Chat revalidates access on joins and message
delivery; blocked senders are filtered from message history and group recipient
delivery. Existing connections and conversations are not deleted. A block makes
direct chat unavailable and suppresses the counterpart in supported candidate
surfaces. Historical financial, moderation, trip, and audit records are kept.

## Report lifecycle and access

Authenticated users may report travellers, trips, chat messages they can access,
published reviews, or a general incident. Target references are validated on the
server; submitted evidence URLs/metadata are not accepted because secure evidence
storage is not implemented. Reporters receive only their own target category,
reason, status, and timestamps. Only users with the existing moderator/admin
role can inspect the paginated queue and transition reports. Status history and
notes are internal. The supported lifecycle is:

```text
SUBMITTED -> UNDER_REVIEW -> RESOLVED
     |             |-------> DISMISSED
     +---------------------> DISMISSED
```

Terminal statuses cannot be reopened. An allegation alone causes no account
action. Sensitive descriptions/notes are excluded from logs and audit metadata.

## Emergency contacts and assistance

Contacts belong to an authenticated user, have a maximum of five entries, and
are never added to public profile serializers. Safety and trip pages render
manual `tel:` links from owner-provided phone numbers. There is no SMS, email,
push notification, monitoring, dispatch, or rescue provider configured. The UI
states that users in immediate danger should contact local emergency services;
TripBuddy does not supply unverified local numbers or hospital data.

## Trip safety authorization and location

Reading safety information requires an `ACTIVE` `TripMember` record whose
`joinedAt` is null or not in the future. The trip creator must also have their
active owner membership. Only the creator may change meeting-point/checklist/
notes. Removed and non-member users receive a not-found response. Safety
responses omit exact coordinates and include only destination/date summary.
Public trip serialization continues to omit precise location and safety notes.

## Moderation and retention

The minimal moderator controls live in the Safety Center; APIs use the existing
`requireModerator` middleware. The full administrative dashboard remains a
later phase. Safety writes are rate limited, report submissions have a tighter
daily limit, and request bodies share the 1 MB JSON cap. Contact/report records
currently follow the application's general database retention and account
lifecycle policies; a specific safety retention schedule and deletion workflow
remain operational follow-up items. No external notification or emergency-data
provider dependency is present.

## Trip membership enrollment audit

`trip.service.createTrip` creates only the creator's `OWNER/ACTIVE` membership.
The repository has no join-request or invitation-acceptance path that creates
non-owner active membership. Connections, group recommendations, and chat do
not enroll users, which is correct for consent boundaries. As a result, the
private trip safety panel is currently reachable only by the creator in normal
flows. Add a consent-based enrollment workflow as a high-priority follow-up:
traveller requests to join; creator reviews; accepted request creates/reactivates
the unique `TripMember` as `ACTIVE` with `joinedAt`; decline/cancel/revoke retain
history; every transition is authorized, audited, and reflected in trip chat
authorization. Do not infer membership from a connection, recommendation, or
chat request.
