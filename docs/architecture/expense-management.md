# Expense management architecture

Phase 18 adds a per-Trip expense ledger and user-reported settlement records. It reuses `Trip`, `TripMember`, the authenticated user, and audit logging. It does not alter Booking status, itinerary content, chat authorization, or payment processing.

## Access boundary

Every read and write requires an active eligible account and a current active `TripMember` for a non-draft, non-cancelled Trip. `TripMember` is checked on every request; public Trip visibility, accepted connections, recommendations, and trip chat do not authorize ledger access. An active trip owner is included through the existing `OWNER` membership row. Leaving/removal revokes ledger access without deleting old expense or settlement data. Currently active ledger viewers retain the trip's historical shares and participant name snapshots. Former members cannot submit new allocations or settlement entries.

An expense payer is derived from the authenticated creator and is immutable after creation. Only that expense creator can edit it; the creator or Trip creator may void it. Edits preserve the before-state of financial fields in protected expense history. Voiding is a terminal soft state change that preserves the record; the API does not unvoid it. A private expense note is serialized only to its creator. No receipt upload or receipt content is stored.

Only a current active member can submit a settlement, and the authenticated member is always its `from` payer. The recipient must have a positive balance in the same currency and the transfer cannot exceed either open balance. Only the reporting member can reverse it. Corrections are a reversal plus a new idempotent report. Settlement records are user claims; there is no confirmation state, third-party payer assertion, external transfer, or payment-provider status.

## Money and split calculation

The ledger stores integer minor units, with an explicit two decimal places for AUD, CAD, CHF, EUR, GBP, INR, SGD, and USD. The API caps individual amounts and checks JavaScript safe integer bounds. It never accepts floating point as an authoritative amount. Currency totals and balances remain separate; there is no implicit conversion or cross-currency settlement.

- Exact splits accept non-negative integer allocations whose sum equals the expense total.
- Percentage splits use integer basis points totaling exactly 10,000.
- Weighted splits use positive integer share counts.
- Equal splits are equal weights.

Equal, percentage, and weighted methods calculate exact integer quotients using `BigInt`, then distribute remaining minor units by largest fractional remainder. Ties go to the ascending stable user ID, so the result is deterministic and independent of request ordering. A per-currency ledger derives paid amount minus allocated share, then adds sent settlements and subtracts received settlements. Voided expenses and reversed settlements are excluded. Each currency must independently sum to zero or the server rejects the inconsistent ledger.

Suggested transfers use sorted debtors and creditors and greedily match the smaller outstanding side until balances clear. This is deterministic and reduces transfers, but is a suggestion only; members may record partial real-world settlements. The server recomputes balances before accepting one.

## Concurrency and audit

Expense creation and edits use unique per-creator idempotency keys. Settlement reports use unique per-reporter idempotency keys. All financial writes run in MongoDB transactions and increment a per-Trip `expenseRevision` document field. That shared write serializes concurrent ledger mutations; expense edits also compare a caller-provided revision. Summary reads use a snapshot transaction so expenses and settlements are calculated from one database view. Deployments must use a replica set or sharded MongoDB topology that supports transactions. Concurrency guarantees require integration testing on that topology.

Creation, edit, void, settlement, and reversal audit events are written in the same transaction as the change. Audit metadata includes trip identity only, not notes, split amounts, or receipt contents. Financial edit snapshots live in the private Trip expense record and are returned only after current Trip authorization succeeds.

## Payment boundary

Expense status (`ACTIVE`/`VOIDED`) and settlement record status (`RECORDED`/`REVERSED`) are separate from actual payment status. No card data is collected, transfers are not initiated, and settlement reports are not independently verified. Phase 19 must add a verified payment provider and signed/authoritative callbacks before representing a transfer as provider-confirmed.
