# Trip expenses API

All paths are relative to `/api/v1`. Every route requires an authenticated session. The expense ledger is shared trip data and is separate from bookings and payments.

## Routes

- `GET /expenses/trips/:tripId/participants` lists current active members eligible for a new split.
- `GET /expenses/trips/:tripId?page=1&limit=20&includeVoided=false` lists expenses; page size is capped at 50. Voided records are excluded unless requested.
- `POST /expenses/trips/:tripId` creates an expense. Supply an `Idempotency-Key` header (8–64 letters, digits, underscores, or hyphens). The server assigns the authenticated user as creator and payer; clients cannot choose another payer. The payer may be excluded from the allocation participants when they paid for the others.
- `GET /expenses/trips/:tripId/:expenseId` retrieves details. The creator's private note is returned only to that creator.
- `PATCH /expenses/trips/:tripId/:expenseId` edits an active expense created by the caller. Send its `expectedRevision`; payer identity is immutable. The creator or Trip creator may void it through `POST /expenses/trips/:tripId/:expenseId/void` with `{ "expectedRevision": 1, "reason": "Duplicate entry" }`.
- `GET /expenses/trips/:tripId/summary` returns per-currency paid totals, shares, net balances, settlement suggestions, and the Trip ledger revision.
- `GET /expenses/trips/:tripId/settlements/suggestions` returns deterministic suggested transfers.
- `GET /expenses/trips/:tripId/settlements?page=1&limit=20` lists user-reported settlement records, including reversed records.
- `POST /expenses/trips/:tripId/settlements` records a user's own reported outgoing transfer. Its `Idempotency-Key` is required.
- `POST /expenses/trips/:tripId/settlements/:settlementId/reverse` reverses only a settlement originally reported by the caller. Reversal plus a new corrected record is the correction workflow.

Example expense body:

```json
{
  "description": "Group dinner",
  "category": "FOOD",
  "amountMinorUnits": 12500,
  "currency": "INR",
  "expenseDate": "2027-05-01",
  "splitMethod": "PERCENTAGE",
  "participants": [
    { "userId": "507f1f77bcf86cd799439011", "basisPoints": 6000 },
    { "userId": "507f1f77bcf86cd799439012", "basisPoints": 4000 }
  ],
  "privateNote": "Optional; visible only to the expense creator"
}
```

Split methods are `EQUAL` (only `userId`), `EXACT` (`amountMinorUnits` per participant), `PERCENTAGE` (`basisPoints`, totaling exactly 10,000), and `WEIGHTED` (`shares`, positive integers). Exact allocations must sum to the expense amount. The server recomputes all allocations.

Settlement body: `{ "toUserId": "…", "amountMinorUnits": 5000, "currency": "INR", "note": "Reported transfer" }`. The authenticated actor is always the payer (`from`); other payer identities are rejected. The recipient must currently be owed that currency and the amount cannot exceed the current balance. A settlement is user-reported, not verified payment evidence.

## Access and history

Every operation rechecks current account eligibility, an eligible Trip status, and a current `TripMember.status === ACTIVE` record. Trip public/community visibility, connection state, recommendations, and chat access do not grant ledger access. A removed/left member loses access immediately; their existing allocations and snapshot name remain in Trip financial history for current active members. Their records are not silently deleted. An active member can no longer allocate a new expense to a former member.

Expense edits require the expense creator. The Trip creator or expense creator can void; void is soft and excluded from balances while its data/history remains available. A settlement can be reversed only by the active member who reported it. Private notes are visible only to the expense creator. Receipts are not accepted or stored.

## Money and states

Amounts are positive (or zero only for an individual allocation) safe integer minor units. Supported currencies are AUD, CAD, CHF, EUR, GBP, INR, SGD, and USD, each represented with two decimal places (100 minor units = 1 major unit). JPY and currency conversion are not supported. Currency ledgers are independent; no FX rate is inferred.

Expense status is `ACTIVE` or `VOIDED`. Settlement status is `RECORDED` or `REVERSED`. These records do not represent provider-verified payment status and do not initiate transfers. See [expense architecture](../architecture/expense-management.md) for rounding, concurrency, and balance rules.
