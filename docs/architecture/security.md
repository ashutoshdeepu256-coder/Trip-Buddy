# Security Review and Hardening

This document records the Phase 28 source review and automated checks. It is
not a penetration test, deployment audit, or claim that TripBuddy is secure or
production-ready.

## Findings and dispositions

### Medium: public profiles exposed private travel preferences — fixed

`GET /api/v1/users/:userId` serialized the whole `profile` object. That exposed
travel availability dates, budget ranges, and excluded destinations to
unauthenticated callers even though the public profile page did not use those
fields. The service now selects only the fields needed for the public page and
returns only bio, city, country, and factual trust signals. The regression test
checks both the database projection and response shape.

### Medium: suspended accounts passed the matching session guard — fixed

The matching-specific user projection omitted `accountStatus`, so the shared
authentication middleware could not reject a suspended user on match routes.
Optional authentication also treated suspended accounts as signed in for
public routes. The matching projection now includes account status, and
optional authentication treats suspended accounts as anonymous. Tests cover
both paths.

### Medium potential risk: cookie-authenticated writes relied on SameSite alone — hardened

Session cookies are HTTP-only and `SameSite=Lax`, which limits ordinary
cross-site cookie requests. The API now also rejects unsafe cookie-authenticated
requests when a supplied `Origin` differs from the configured `CLIENT_URL`.
Safe methods and bearer-only requests are unaffected. Requests without an
`Origin` continue to rely on cookie SameSite behavior; production should serve
the browser app and API over HTTPS and use a single trusted browser origin.

### Deployment risk: process-local rate limits and proxy identity

Express and Socket.IO rate-limit state is held in process memory. Limits do not
coordinate across instances, and without a correctly configured trusted proxy,
IP-based limits may use the proxy address or the wrong client address. Set
Express proxy trust only to the actual proxy hop count or trusted proxy ranges;
use a shared rate-limit store if limits must be global across instances.

### Deployment risk: server startup overrides DNS resolvers

`server/server.js` replaces Node's resolver list with public DNS resolvers
before startup. This is existing behavior intended to work around local Atlas
SRV lookup. It bypasses deployment-provided DNS and can conflict with private
DNS, egress policy, or split-horizon records. This review leaves it unchanged
because removing it could break the existing local database setup; verify the
target hosting environment and remove or make the override opt-in if its
resolver already supports Atlas SRV.

## Controls verified in the repository

- JWT verification pins `HS256`, issuer, audience, and expiration. Logout
  increments a persisted token version. Protected middleware checks account
  status; sockets recheck token version and account status during event work.
- Admin and moderator route groups have explicit server-side role middleware.
  Admin role/status changes use a transaction guard to preserve a last active
  administrator. Public registration cannot choose a role.
- Request schemas bound IDs, filters, page sizes, and accepted fields. Zod
  object schemas strip or reject unknown values; profile and payment mutations
  explicitly constrain client-controlled fields.
- Trip serializers omit hidden location for unauthorized readers. Chat checks
  conversation participation, current account state, accepted connection or
  trip membership, and block edges. Itinerary collaboration rechecks grants.
  Expenses require active trip membership. Payment reads are scoped to payer
  or recipient.
- Socket identity comes from the verified session. Private room joins and
  itinerary events recheck authorization; message sender identity is server
  derived. Existing tests cover unauthorized room joins, cross-user access,
  and suspended chat users.
- Trip images are limited to eight files of 8 MB each, MIME-filtered, and
  checked against JPEG/PNG/WEBP signatures before Cloudinary upload. Identity
  documents are limited to one file of 5 MB and checked for PDF/PNG/JPEG
  signatures before authenticated private storage. These checks validate file
  signatures, not full decoder safety.
- Razorpay checkout signatures use the server secret; webhook signatures use
  the exact raw request bytes. Webhook events have a unique idempotency record,
  and clients cannot submit a success status. No live payment calls were made
  during this review.
- Helmet supplies security headers, CORS uses the configured single origin,
  request bodies are size-limited, the webhook has a smaller raw-body limit,
  and unexpected server errors return a generic message. Application logging
  avoids credentials and private message content in the inspected paths.
- Gemini is optional. When configured, the existing assistant sends the
  current prompt, bounded saved conversation context, and authorized retrieved
  facts to the configured Google AI provider. The model has no tools and
  cannot authorize actions. Operators must review provider terms and disclose
  this data transfer before users submit sensitive content.
- `.gitignore` excludes `.env` files. Tracked environment files are examples
  only. No secret values were inspected or added to Git.

## Remaining limitations and deployment tasks

- There is no password reset/account recovery flow or admin multi-factor
  authentication in this repository.
- Configure `NODE_ENV=production`, a strong unique `JWT_SECRET`, a distinct
  `VERIFICATION_SECRET`, `MONGODB_URI`, and the exact HTTPS `CLIENT_URL` in the
  server environment. Keep `CLOUDINARY_URL`, `EMAIL_PROVIDER_API_KEY`,
  `PHONE_OTP_PROVIDER_API_KEY`, `MAPBOX_SERVER_TOKEN`, `GEMINI_API_KEY`,
  `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` server-side only.
  `RAZORPAY_MODE=live` is allowed only when `NODE_ENV=production`; use test
  credentials outside production. Keep `ALLOW_DEV_VERIFICATION_CODES` disabled
  in production.
- `VITE_API_URL`, `VITE_GOOGLE_MAPS_API_KEY`, and
  `VITE_MAPBOX_ACCESS_TOKEN` are included in browser builds when configured.
  Treat map keys as public and restrict them by allowed web origins, APIs, and
  provider quotas; never put server credentials in `VITE_*` variables.
- TLS termination, HSTS behavior at the public edge, trusted proxy settings,
  database network access, Cloudinary privacy settings, webhook deployment,
  and provider account retention settings require operator verification.
- The dependency audit was run offline from the checked-in npm lockfile and
  reported zero known advisories in the available audit data. Re-run `npm
  audit` online before deployment to refresh advisory data.
- `MONGODB_TEST_URI` was not configured, so MongoDB integration tests and
  database-backed authorization workflows were skipped. No real Cloudinary,
  email/SMS, Gemini, or Razorpay provider account was contacted.
- Moderation is a rules-based and optional-provider aid, not a guarantee that
  harmful content is detected. Provider behavior, availability, retention,
  request budgets, and data-processing terms depend on deployment settings.

## Phase 28 test evidence

Targeted regression coverage verifies suspended matching sessions are denied,
suspended optional sessions are anonymous, public profiles omit private
preferences, and cookie-authenticated mutations reject a mismatched Origin.
Existing API smoke, match, chat, trip, payment, admin, and verification tests
cover the related authorization and validation controls. See the Phase 28
completion report for the full test, lint, build, and audit results.
