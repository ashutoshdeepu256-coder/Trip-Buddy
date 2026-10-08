# TripBuddy

TripBuddy is a travel companion app. The repository currently includes a
responsive React client and an Express/MongoDB API with account, profile,
verification, and safety foundations.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `server/.env.example` to `server/.env` and replace the required secrets
   with unique random values. Never commit that file.
3. Start MongoDB and set `MONGODB_URI`.
4. For local verification flows only, set `ALLOW_DEV_VERIFICATION_CODES=true`.
   This returns codes/tokens only from non-production server responses; it does
   not send email or SMS. Disable it outside local development.
5. Run `npm run dev` from the repository root. The API is on port 5000 and the
   Vite client is on port 5173 by default.

Optional provider configuration and API details are documented in
[verification API docs](./docs/api/verifications.md) and
[safety API docs](./docs/api/safety.md) and
[destination discovery API docs](./docs/api/destinations.md) and
[trip API docs](./docs/api/trips.md).

Destination Discovery is data-driven and ships without production destination
records. Import an explicitly curated JSON catalog with
`npm run seed:destinations --workspace=server -- <path-to-json>`. Search,
ranked feeds, seasonal/budget/adventure filters, nearby discovery, and
destination detail pages are available at `/destinations`.

Trip creation uses the existing Destination catalog. Incomplete plans save as
private drafts; publishing performs stricter server-side validation. Configure
`CLOUDINARY_URL` to enable JPEG, PNG, and WEBP trip image uploads. Trip model,
lifecycle, privacy, index, and future phase integration decisions are in
[trip architecture](./docs/architecture/trips.md).

## Validation

- `npm test` — backend API/security tests; MongoDB-backed scenarios are skipped
  unless `MONGODB_TEST_URI` is set to a disposable test database (the suite
  drops that database afterward)
- `npm run lint --workspace=server` — server lint
- `npm run lint --workspace=client` — client lint
- `npm run build --workspace=client` — client production build

## Security notes

User roles are not selectable during signup. Assign moderator/admin roles only
through trusted database operations. Use HTTPS in production, keep webhook and
storage credentials in environment secrets, configure only trusted origins in
`CLIENT_URL`, and do not enable development verification codes in production.
