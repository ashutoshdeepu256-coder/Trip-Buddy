# Payments API

Paths are relative to `/api/v1`. Authenticated APIs require the normal TripBuddy session. The Razorpay webhook is unauthenticated at the application layer; raw-body signature verification is its authentication mechanism. Payments are separate from expense status and user-reported settlement claims.

## Routes

- `POST /payments` creates a server-side Razorpay Order and Route transfer for the authenticated payer. Body: `{ "tripId": "...", "recipientUserId": "...", "amountMinorUnits": 10000, "currency": "INR" }`. Send an `Idempotency-Key` header. The client cannot choose a payer, order, linked account or payment status.
- `GET /payments?page=1&limit=20` lists records where the authenticated user is the payer or recipient. Page size is capped at 50.
- `GET /payments/:paymentId` returns an authorized payment record. Only the payer receives pending Checkout details.
- `POST /payments/:paymentId/verify` accepts Razorpay Checkout's `razorpay_order_id`, `razorpay_payment_id` and `razorpay_signature`. The API verifies the signature, fetches the payment from Razorpay and checks the exact Route transfer. A browser callback alone does not mark the Trip ledger paid.
- `POST /payments/:paymentId/reconcile` fetches the current Razorpay order, payments, refunds and Route transfer state. It is available to the payer and is safe to retry.
- `POST /payments/:paymentId/refund` accepts `{ "reason": "..." }` from the original payer. It requests a refund of the remaining captured amount and reverses the Route transfer. The response can remain `REFUND_PENDING` until both provider refund and transfer reversal are verified.
- `POST /payments/webhooks/razorpay` accepts Razorpay raw JSON bytes and validates `X-Razorpay-Signature` plus `x-razorpay-event-id` before parsing or updating records.

The payment creation API accepts integer minor units only, requires INR and a minimum of 100 paise, and checks the amount against the current per-Trip debtor/creditor balance minus all active payment reservations. Both users must be active Trip members; the creditor also needs an onboarded Razorpay Route linked account. Payments in other supported expense currencies are not available through this provider integration.

## Payment states

`CREATED`, `PENDING`, `AUTHORIZED`, `TRANSFER_PENDING`, `SUCCEEDED`, `FAILED`, `REFUND_PENDING`, `PARTIALLY_REFUNDED`, `REFUNDED`.

`SUCCEEDED` requires a server verified captured payment and a Razorpay Route transfer in `processed` state with the stored recipient, amount, currency and order. A captured payment with a still pending transfer does not modify Trip balances. A confirmed partial refund reduces the corresponding provider settlement; a confirmed full refund reverses it. User-reported `ExpenseSettlement` entries remain `USER_REPORTED`, and provider reversals cannot be manually marked through the Phase 18 settlement API.

Razorpay order cancellation is not supported by this integration, so no cancellation route is exposed. Checkout failures keep the same order open for safe retry; its reservation remains until Razorpay can reconcile the order or Route transfer.

## Webhook and deployment security

Mount the webhook at the public HTTPS URL `/api/v1/payments/webhooks/razorpay` and subscribe the Razorpay dashboard to the payment, order, Route transfer and refund event types listed in [payment deployment documentation](../architecture/payment-integration.md). The endpoint has a 64 KB raw-body limit, rate limit, timing-safe HMAC-SHA256 verification, a unique provider event ID index and transaction-safe deduplication. Unknown event types and invalid signatures are rejected. Never use the client supplied signature or status as a server state transition by itself.

Use Razorpay Test Mode keys and test linked accounts in development/staging. Production requires HTTPS, production `NODE_ENV`, approved Razorpay Route access, live API keys and the corresponding live webhook secret. See [payment integration architecture](../architecture/payment-integration.md) for exact variables, test limitations, transaction topology and provider capability boundaries.
