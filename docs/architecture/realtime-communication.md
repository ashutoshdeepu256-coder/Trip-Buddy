# Real-Time Communication

TripBuddy attaches one Socket.IO server to the existing HTTP server. Both
REST and Socket.IO use the existing JWT session strategy: sockets authenticate
with the `tripbuddy_session` cookie (or an explicit `handshake.auth.token`),
the same issuer/audience/algorithm checks, token version, and current account
status. The token is checked again on every event. The browser reuses one
module-level socket and removes event listeners and disconnects it when the
chat page unmounts.

## Authorization

Conversation authorization is centralized in `chat.service` and used by REST
and socket paths.

- A direct conversation is keyed to one accepted `Connection`. Both users must
  still be active, and neither direction of `Block` may exist. `UNMATCHED`,
  pending, rejected, or otherwise terminal connections do not authorize chat.
- A trip conversation requires a current active `TripMember` edge and a trip
  in `PUBLISHED`, `PLANNING`, `CONFIRMED`, or `ONGOING`. This applies to every
  trip privacy setting: viewing a public trip is not membership. The owner is
  represented by the owner membership created by the existing trip service.
  A member can read messages created at or after `joinedAt`. No membership is
  inserted, changed, or inferred by chat.
- No standalone group entity or authorized group membership exists. A Phase 11
  recommendation is never used to authorize a room. Trip chats use explicit
  `TripMember` records only.

For trip chats, a block suppresses the blocked counterpart's history messages
and prevents that pair's message, typing, and read-receipt delivery. Other
authorized current trip members may continue. Suspended or banned users cannot
authenticate or act, and their messages are filtered. There is no separate
chat discoverability preference in the existing user schema.

Socket joins only accept a validated conversation ID and call the same fresh
authorization check as REST. The server never emits message, typing, delivery,
or read data to a conversation room. Instead, each event rechecks authorized
recipients and emits only to server-assigned per-user rooms. This avoids stale
conversation-room subscriptions receiving data after a block, unmatch,
suspension, or membership change. Event errors use `{ success: false, error:
{ code, message } }`; successful acknowledgements use `{ success: true, data }`.

## Event contract

Message payloads have a maximum of 4000 trimmed characters. Socket transport
buffers are capped at 32 KiB. Extra fields are rejected.

| Event | Direction | Payload / result |
| --- | --- | --- |
| `chat:join` | client → server | `{ conversationId }`; acknowledges `{ conversationId, joined: true }` after authorization. |
| `chat:leave` | client → server | `{ conversationId }`; leaves the socket subscription. |
| `chat:message:send` | client → server | `{ conversationId, text, idempotencyKey }`; acknowledgement includes `{ message, duplicate }`. |
| `chat:message:new` | server → authorized user sockets | `{ id, conversationId, senderId, text, createdAt, deliveredTo, readBy }`. |
| `chat:message:delivered` | server → sender's user sockets | `{ conversationId, messageId, deliveredTo }`; records online socket delivery, not a human read. |
| `chat:read` | client → server | `{ conversationId, upToMessageId? }`; marks messages by the authenticated reader. |
| `chat:message:read` | server → authorized participant sockets | `{ conversationId, upToMessageId, updatedCount, readAt, readerId }`. |
| `chat:typing` | both directions | Client sends `{ conversationId, active }`; server relays the same state plus server-derived `userId` to currently authorized peers. |

REST and socket sends share the message serializer and schema. REST is the
fallback; clients reuse the same idempotency key when retrying after a socket
timeout, so a persisted message is reconciled by its message ID instead of
being duplicated. The UI does not insert optimistic messages before a server
acknowledgement. Message text is rendered as ordinary React text, never HTML.

## Persistence, indexes, and limits

`Conversation` already existed as an untracked phase scaffold and is extended
with per-participant read timestamps. A partial unique `activeKey` index
prevents duplicate direct conversations per connection and trip conversations
per trip. Participant/status/activity and trip/status indexes support listing.
`Message` stores the server-derived sender, conversation, text, delivery/read
user IDs, and idempotency key. Indexes support stable history pagination,
sender lookup, idempotency, and unread queries.

REST and socket message sends share a 20-per-minute per-user limit; REST also
has a 30-per-minute per-rate-limit-key endpoint limit. Typing updates are
limited to 30 per minute per user. These rate windows live in process memory.
The standard global REST limiter is also process-local. Audit records store message/conversation IDs and
request metadata only; message text is not logged.

## Deployment and scaling

No new environment variables are required. Configure the existing
`CLIENT_URL`, `JWT_SECRET`, and MongoDB settings. Production requires HTTPS,
secure cookie settings, and a reverse proxy that supports WebSocket upgrades.
The current Socket.IO deployment is single-instance: connected sockets,
rate-limit counters, and user-room broadcasts are local to one process. A
multi-instance deployment needs a shared Socket.IO adapter (for example the
official Redis adapter), shared rate-limit storage, and sticky sessions when
HTTP long-polling is enabled. Redis is not a required dependency in this phase.

There is no persistent online presence. Socket.IO disconnect and reconnect
events update only the client connection indicator; no stale online state is
stored. Message retention, delivery guarantees across process loss, archival,
attachments, E2E encryption, and moderation need separate product and security
design.
