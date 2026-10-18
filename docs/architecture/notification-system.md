# Notification system architecture

## Data and REST access

`Notification` stores recipient, type/category, safe title/body, a server-built
internal route, optional related entity, read/dismiss timestamps, a unique
deduplication key, and expiry. Recipient timeline, unread, unique dedupe, and TTL
indexes support the current queries. All APIs filter by authenticated recipient;
no client-provided recipient ID is accepted. Items expire after 180 days through
MongoDB TTL cleanup, which runs asynchronously.

## Event policy

| Event | Recipient rule | Preview |
| --- | --- | --- |
| Connection request | Request recipient, after active-account, block, and request-eligibility checks. | Generic request text. |
| Connection accepted/rejected | Original requester, after the authorized transition. | Generic status text. |
| Chat message | Current conversation recipients returned by chat authorization, rechecked before notification; blocked/inactive/ineligible users are excluded. | No message content. |
| Expense create/update/void | Current active members allocated to the expense, excluding actor and blocked pairs. | No description, amount, or private note. |
| User-reported settlement | The named receiving member. It is labelled as reported, not verified. | No amount or note. |
| Verified payment success | Payer and recipient, after verified provider capture and Route transfer. | No amount or provider identifiers. |
| Safety report status | Only the report's reporter after moderator transition. | Status only; never moderator notes. |

No notifications are generated for presence, typing, ordinary read receipts,
public profile views, or connection acceptance in group recommendations. There is
no active trip enrollment workflow, so this phase does not infer trip
membership. Itinerary collaboration notifications and review moderation
notifications are not enabled yet.

## Persistence and deduplication

Notification inserts have a unique sparse deduplication index. Connection,
message, expense, settlement, and safety keys include the domain event/entity,
recipient, and (where relevant) revision or transition. Chat and expense
idempotency retry paths reuse those keys. Verified payment-success notifications
are inserted in the same MongoDB transaction as the successful payment and
settlement transition; the payment-attempt status guard and notification unique
index prevent duplicate records when provider webhook events repeat.

For other event sources, the underlying domain write completes before
notification persistence. Those writes are idempotently keyed but are not in one
transaction with the domain change. This phase does not claim exactly-once
delivery. A process failure between a domain write and notification insertion
can omit that notification; retrying a domain request may recover it only where
the service retries that event. No generic transactional outbox or retry worker
is currently installed.

## Socket.IO delivery

The existing authenticated Socket.IO connection joins a server-assigned
`user:<authenticated id>` room at connection time. Clients cannot join arbitrary
user notification rooms. The server emits:

- `notifications:new` with a minimized, persisted notification representation.
- `notifications:read` after read state changes.
- `notifications:unread-count` with the current persisted count.

Persistence occurs before emission. Socket delivery is best effort; reconnecting
clients resynchronize from list and unread-count REST endpoints. A missed emit
does not delete a notification. In a multi-instance deployment, configure a
shared Socket.IO adapter for cross-instance room delivery. MongoDB remains the
source of truth; no delivery receipt or exactly-once socket guarantee exists.

## Preferences, privacy, and operations

In-app category preferences default to enabled. Email and push are disabled in
capabilities and no external provider credentials are required. Security notice
preference is fixed to enabled. Preview content is generic for chat, money, and
safety events; navigation goes to authorized application pages.

Retention is 180 days with asynchronous TTL cleanup. Notification text is
server-controlled and rendered as ordinary React text. Event logs and audit
records do not include notification bodies. Production multi-instance use needs
a shared Socket.IO adapter; adding external channels requires a verified
provider, consent, delivery retries, bounce/failure handling, and updated
preference semantics.
