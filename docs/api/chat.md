# Chat API

All routes use `/api/v1/chat`, the existing `tripbuddy_session` cookie or bearer
session, and the standard `{ success, message, data }` response. Request objects
are strict: unknown fields are rejected. Senders and read state always come
from the authenticated session.

## Authorization rules

- **Direct:** the actor must be one of the two users on an `ACCEPTED`
  `Connection`. Both accounts must be active and neither user may have blocked
  the other. An accepted connection creates no conversation until chat is
  opened. A unique conversation key on the accepted connection prevents
  duplicates. A shared trip or group recommendation does not grant direct
  access.
- **Trip:** the actor must have a current `TripMember` record with
  `status: ACTIVE` for the trip, and the trip must be `PUBLISHED`, `PLANNING`,
  `CONFIRMED`, or `ONGOING`. This same rule applies to public, community,
  private, and invite-only trips. Public trip visibility alone is insufficient.
  The owner qualifies through the existing explicit `OWNER` TripMember record.
  Message history begins at the member's `joinedAt` time.
- **Groups:** there is no group-chat endpoint. Phase 11 `GroupRecommendation`
  records are proposals and never count as membership. Trip conversation
  authorization uses only real active `TripMember` records; chat does not
  create or activate membership.

Every REST history/read/send operation and socket join/send/read/typing
operation rechecks account status and the relevant connection or membership.
Direct conversation access is revoked when its connection is unmatched, an
account is suspended/banned, or either user blocks the other. In trip chats,
messages and real-time events from/to a blocked counterpart are withheld for
that pair; other authorized active trip members can continue. Suspended users'
messages are excluded. The current User schema has no separate chat privacy or
discoverability preference.

## Endpoints

| Method | Route | Description |
| --- | --- | --- |
| GET | `/conversations?page=1&limit=20` | Authorized conversations, newest activity first; limit max 50. |
| POST | `/conversations/direct` | Body `{ "connectionId": "<id>" }`; retrieve or create the accepted connection's direct conversation. |
| POST | `/trips/:tripId/conversation` | Retrieve or create the caller's authorized trip conversation. |
| GET | `/conversations/:conversationId` | Authorized conversation details and unread count. |
| GET | `/conversations/:conversationId/messages?limit=30&before=<messageId>` | Stable descending cursor pagination returned in chronological order; limit max 100. Cursor is the oldest returned message. |
| POST | `/conversations/:conversationId/messages` | Body `{ "text": "...", "idempotencyKey": "..." }`; returns `201` for a new message or `200` for an idempotent retry. Text is trimmed and limited to 1–4000 characters. |
| POST | `/conversations/:conversationId/read` | Body `{ "upToMessageId": "<optional message id>" }`; marks eligible prior messages read. |
| GET | `/unread` | Total unread count and per-conversation counts. |

Message records are persisted before Socket.IO delivery. A sender/key unique
index makes retries idempotent; reusing a key in another conversation returns
`409 IDEMPOTENCY_CONFLICT`. Message history uses `(createdAt, _id)` ordering.
Unread counts exclude the actor's own messages and messages outside a trip
member's access window.

REST and socket message sends share a 20-message-per-minute per-user limit.
REST also has a 30-request-per-minute per-rate-limit-key endpoint limit, in
addition to the global API limiter. REST is the reliable fallback when the
socket is disconnected. Authorization failures on private
conversation resources return `404 CONVERSATION_NOT_FOUND` to avoid disclosing
their existence. Invalid payloads return the standard `400 VALIDATION_ERROR`.

Read state is only set by the authenticated read endpoint/event. There are no
client controls for sender, membership, delivery, or read state. Mute/archive,
edit/delete, attachments, end-to-end encryption, and moderation are not
implemented.
