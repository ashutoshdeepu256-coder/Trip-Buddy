# Testing and quality assurance

TripBuddy uses Node's built-in test runner for the Express/Mongoose server and Vitest with React Testing Library for the Vite client. Tests use local fixtures and boundary mocks; routine commands do not contact payment, email, SMS, Gemini, Cloudinary, or reservation providers.

## Commands

Run from the repository root:

| Command | Purpose |
| --- | --- |
| `npm test` | Deterministic server suite followed by client component tests. MongoDB cases are reported as skipped when their database is not configured. |
| `npm run test:server` | All Node server tests. |
| `npm run test:client` | Client tests once, without watch mode. |
| `npm run test:integration` | MongoDB-backed integration suite. Fails before running unless `MONGODB_TEST_URI` identifies a dedicated database with `test` in its name. |
| `npm run test:coverage` | Server source coverage followed by V8 client coverage; the client HTML report is written under `client/coverage/`. |
| `npm run lint` | ESLint for both workspaces. |
| `npm run build` | Production client build. |

For an interactive client run, use `npm run test:watch --workspace=client`.

## Test layers and current scope

- Server unit/service tests cover validation, authorization, domain rules, calculations, privacy serialization, payment signatures/state rules, moderation, notifications, analytics, and Phase 28 security regressions. `api-smoke.test.js` exercises the Express boundary over an ephemeral loopback port and mocks selected service calls.
- Mongo-backed API integration tests cover persisted workflows and database constraints in `server/test/*.integration.test.js` and `server/test/mongo.integration.test.js`.
- Client tests use jsdom, accessible React Testing Library queries, and mocked auth service calls. They cover login/register validation, success and error feedback, protected route redirects, session loading, and lazy profile-route rendering.
- There is no Playwright/browser E2E setup. The API-level suite is the current end-to-end boundary for server workflows; it does not prove browser rendering in a real browser.

## Database requirements and safety

The deterministic default suite does not require MongoDB. Database-backed cases explicitly show as skipped without `MONGODB_TEST_URI`; skips are not counted as passed. Run `npm run test:integration` only with a disposable MongoDB database whose database name includes `test`. The suite drops that database during cleanup. Never set this URI to production or a database containing real user data.

Transaction-dependent cases require a MongoDB replica set (Atlas test cluster or local replica set). A standalone MongoDB instance is not sufficient. Current integration tests use persisted records and include concurrency/idempotency cases where implemented, but transaction rollback/commit behavior and all listed concurrent-write scenarios have not been comprehensively verified in a configured replica-set environment.

Test-only JWT and verification secrets are assigned in test code. Do not place production secrets in test configuration. No provider credentials are needed by the default suite.

## Provider boundaries

Payment, Cloudinary, Gemini, email/SMS delivery, and reservation-provider behavior is tested with mocks or deterministic fallbacks. Payment signature checks and invalid/duplicate state transitions are local tests; these do not constitute Razorpay sandbox or live-provider verification. No external payment, transfer, refund, message, upload, or reservation is initiated by the test commands.

## Membership workflow gap

The current trip API supports creator enrollment and owner trip management. It has no endpoint or service operation for another traveler to request trip membership or for an owner to approve/reject that request. `TripMember` has a `PENDING` status in its schema, but the application does not expose a join-request/approval flow. Connection requests and group recommendations do not establish trip membership. Therefore a join/approval journey cannot currently be tested; this is a product gap, not an assumed successful workflow.

## Environment and troubleshooting

- `MONGODB_TEST_URI`: only for the explicit database-backed suite; must point to a disposable test-named database. Without it, the default server suite clearly reports database tests as skipped, while the explicit integration command fails fast.
- No live provider environment variables are required. Integration tests remove provider webhook settings and disable Cloudinary for their process.
- If a Mongo test fails to connect or times out, confirm the test database is reachable and that its URI enables replica-set transactions for transaction-dependent cases. Ensure the database is disposable: cleanup drops it.
- Latest full-suite coverage run: server 67.11% lines, 75.15% branches, and 47.77% functions; client 5.95% lines (9 UI tests). AuthPage and tested App route lines are covered, while most client pages and service interactions are not yet covered. Coverage is diagnostic, with no arbitrary global percentage threshold. Use it to find untested high-risk branches; skipped database tests cannot contribute runtime execution coverage.

## CI and known limits

`npm test`, `npm run lint`, and `npm run build` are suitable deterministic CI gates and require no secrets. No CI workflow exists in this repository, so this phase does not add provider credentials or assume a managed database. Run `npm run test:integration` only in a separately provisioned disposable replica-set job. Browser E2E, some concurrent database invariants, and live provider sandbox behavior remain outside current verification.
