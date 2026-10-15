# Payment integration architecture

Phase 19 adds Razorpay Standard Checkout with Razorpay Route transfers. It reuses the Phase 18 integer minor-unit ledger and `ExpenseSettlement`; it does not create another balance calculator. A user-reported settlement remains `USER_REPORTED`. Only a verified payment plus a matching processed Route transfer creates a `PROVIDER_VERIFIED` settlement.

## Provider and money flow

The repository already depends on Razorpay's official Node SDK (`razorpay`). Orders are created on the server in INR minor units. The browser receives only the public key ID and order reference and loads Razorpay Checkout.js. Razorpay Route sends the order amount to the creditor's linked account. A captured Checkout payment by itself is not a settlement: if Route has not processed the exact transfer to the intended linked account, the payment remains `TRANSFER_PENDING` and the Phase 18 balance remains outstanding. The Route transfer must match the stored recipient account, amount, currency, order and transfer ID before the server records the settlement.

Razorpay Orders currently support INR for this flow, so payments are enabled only for INR ledger obligations and amounts of at least 100 paise. Other Phase 18 currencies remain separate and can still use clearly labelled user-reported settlement records. The server calculates the current debtor/creditor obligation and subtracts in-flight payment reservations before accepting a request. It rejects overpayment, inactive Trip members, unlinked recipients and client supplied payer or provider identifiers.

Route must be enabled for the merchant account. Each recipient must complete the merchant's Route linked-account onboarding and verification. This repository stores the resulting `acc_...` reference in the private `User.razorpayLinkedAccountId` field, which is never returned to clients and cannot be set through profile APIs. Onboarding, KYC collection, consent capture and linked-account management UI are not implemented; these remain an operational requirement before enabling Route.

## State transitions

Internal payment states are `CREATED`, `PENDING`, `AUTHORIZED`, `TRANSFER_PENDING`, `SUCCEEDED`, `FAILED`, `REFUND_PENDING`, `PARTIALLY_REFUNDED`, and `REFUNDED`.

- An idempotent database reservation starts at `CREATED`; after Razorpay returns an order with its intended Route transfer, it becomes `PENDING`.
- A verified authorization may move `PENDING` to `AUTHORIZED`. Checkout failure webhooks do not close an order because the same Razorpay order may be retried.
- A verified capture with a Route transfer still in progress becomes `TRANSFER_PENDING`. The ledger is unchanged.
- A captured payment and the matching `processed` Route transfer move to `SUCCEEDED` and atomically create one `PROVIDER_VERIFIED` Phase 18 settlement.
- A failed or reversed Route transfer becomes `FAILED`; it does not reduce the Trip obligation. The payer can request a provider refund.
- A refund request moves `SUCCEEDED`, `PARTIALLY_REFUNDED`, or an eligible failed Route payment to `REFUND_PENDING`. Refund confirmation alone is insufficient: the Route transfer must also be fully reversed by the same verified provider flow.
- A verified partial refund reduces the provider settlement amount by the confirmed cumulative refund. A verified full refund reverses the settlement. Both happen transactionally with the payment state change.

Razorpay Orders do not provide this integration with a safe cancel operation, so there is no payment cancellation endpoint. Pending orders reserve the obligation until the provider reports a terminal Route failure, success, or refund outcome. If order creation times out after Razorpay may have created it, retries use the same idempotency key and receipt, and reconciliation searches by that receipt rather than creating another order.

Provider callbacks and webhooks are notifications, not the source of truth. Checkout callback signatures are verified server side and the payment is fetched from Razorpay. Webhooks are HMAC verified over the exact raw bytes, deduplicated by Razorpay's `x-razorpay-event-id`, then reconciled against the current Payment, Order, Refund and Route Transfer API state. A stale failed event cannot downgrade a captured payment; a late Route success can resolve a transfer-pending record. State changes, settlement updates, webhook event receipts and audit entries use MongoDB transactions and increment the Trip's `expenseRevision`.

## Refund and reversal behavior

The payer can request a refund of the remaining amount. The server calls Razorpay's refund API with Route reversal enabled. It does not mark a refund complete on the request response alone: it checks the current payment refund total and the corresponding Route transfer reversal. Partial refunds reduce the provider settlement allocation by the confirmed amount; full refunds reverse the settlement. The existing manual settlement reversal API rejects provider verified settlements. Refunds cannot exceed the amount captured, and payment/settlement currencies are never converted.

Manual refunds made in the Razorpay Dashboard can be reconciled using the payment reconciliation endpoint and the configured `refund.processed` webhook. If provider data cannot prove both the refund and Route reversal, the payment remains pending reconciliation and the ledger is not changed. Disputes, chargebacks, transfer reversal without a corresponding payer refund, and automated dispute evidence are not implemented and need operational review.

## Deployment and verification

Configure Test Mode credentials for local and staging use. Set `RAZORPAY_MODE=test`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and set `RAZORPAY_ROUTE_ENABLED=true` only after Route is approved and test linked accounts are available. The local `.env` is not committed. The webhook secret is distinct from the API key secret. In production, deploy with `NODE_ENV=production`, HTTPS, live dashboard keys and the matching live webhook secret; live mode is refused outside production. Never expose API or webhook secrets in `VITE_*` variables.

Configure an HTTPS Razorpay webhook at `/api/v1/payments/webhooks/razorpay` for `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `transfer.processed`, `transfer.reversed`, `refund.created`, `refund.failed`, and `refund.processed`. Test and live modes use their respective keys, linked accounts, webhook secret and callback URL. Razorpay requires a public URL for webhook delivery. Checkout uses the official `https://checkout.razorpay.com/v1/checkout.js`; CSP allows the provider checkout and API origins.

MongoDB must run as a replica set or transaction-capable sharded cluster. A dedicated `MONGODB_TEST_URI` must point to a disposable test database on that topology to execute the payment and Phase 18 transaction integration suites. Mocked SDK tests do not prove sandbox or live connectivity.

The repository environment currently has blank Razorpay credentials and no configured webhook secret or linked accounts. No sandbox Checkout, webhook delivery, Route transfer, refund, or live payment has been verified from this environment. Do not describe this deployment as production ready until an approved Route account, verified sandbox callbacks and reconciliation tests, production HTTPS/webhook setup, and the dedicated replica-set integration suite have all been exercised.

## Official provider references

- [Razorpay Node SDK](https://github.com/razorpay/razorpay-node)
- [Orders API and currency/receipt fields](https://github.com/razorpay/razorpay-node/blob/master/documents/order.md)
- [Standard Checkout and payment signature flow](https://razorpay.com/docs/server-integration/nodejs/payment-gateway/build-integration/)
- [Webhook signature validation, event IDs and delivery ordering](https://github.com/razorpay/markdown-docs/blob/master/webhooks/validate-test.md)
- [Razorpay Route and linked-account transfers](https://github.com/razorpay/razorpay-node/blob/master/documents/transfer.md)
