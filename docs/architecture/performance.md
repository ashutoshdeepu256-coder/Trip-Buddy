# Performance and Search

## Phase 27 measurements

Measurements below were taken locally from the checked-out Phase 26 baseline
and the Phase 27 production build using `npm.cmd run build --workspace=client`
on the same workspace and installed dependencies. They describe build output,
not production traffic.

| Metric | Phase 26 baseline | Phase 27 | Change |
| --- | ---: | ---: | ---: |
| Main entry JavaScript | 737.69 kB (215.36 kB gzip) | 274.86 kB (85.67 kB gzip) | -62.8% raw |
| Initial JavaScript including the preloaded shared chunk | 737.69 kB | 374.10 kB (121.43 kB gzip) | -49.3% raw |
| Initial CSS | 78.68 kB (16.10 kB gzip) | 17.77 kB (4.98 kB gzip) | -77.4% raw |
| Largest emitted JavaScript chunk | 737.69 kB | 274.86 kB | below Vite's 500 kB warning threshold |

The Phase 27 build emitted route chunks for admin, itinerary planning, trip
discovery and details, destinations, bookings, chat, verification, and other
pages. The largest non-entry JavaScript chunks were `jsx-runtime` at 99.24 kB
(35.76 kB gzip) and `TripForm` at 129.44 kB (38.91 kB gzip). The former is
preloaded as a shared dependency; page chunks load when their routes render.
Vite's production build completed without an oversized chunk warning. No
manual chunk rules were added.

## Search and database paths

- `GET /api/v1/trips` validates filters with Zod, caps page size at 50 and
  page number at 10,000, escapes text patterns, applies trip status/privacy/
  moderation filters before lookups, and uses stable `_id` tie breakers for
  ordinary sort modes. The aggregation projects response card fields and
  computes ACTIVE member counts in MongoDB. Compatibility mode is capped at
  500 candidates and excludes blocked creators.
- Destination listing validates search filters and pagination. It fetches a
  bounded page and its total count concurrently, uses `.lean()`, and has an
  existing process-local 60-second cache with a 250-entry cap for stable
  destination lists/details. Nearby lookups are not cached and are limited to
  a 500 km radius and 50 results per page.
- Search/discovery endpoints have route-level rate limits: 60 trip searches
  per minute and 30 nearby-destination searches per minute per rate-limit key.
  The general `/api` limiter is also active.
- No additional indexes were added. Existing trip, destination, geospatial,
  and trip-member indexes align with visible query fields, but index selectivity
  and planner use were not measured. Adding indexes without execution stats
  could increase write and storage cost without improving the actual workload.
- No cache was added for trip discovery: member counts, blocks, moderation,
  creator discoverability, and visibility can change. The existing destination
  cache contains published destination data only and expires entries after a
  minute; it does not cache personalized or authorization decisions.

## Verification limits and follow-up

`MONGODB_TEST_URI` was not configured. Consequently no MongoDB integration
tests, `explain("executionStats")` query plans, API latency benchmark, or
database payload benchmark were run. No production traffic measurements,
latency percentiles, or claims of database speedup are available. Existing
search contracts and bounded pagination were retained.

The client has no configured test script. Production build and lint can verify
compilation and static rules, but do not exercise route chunks in a browser.
Browser navigation, refresh, and slow-network chunk loading should be checked
in deployment preview before release. Production compression, caching headers,
and shared rate-limit storage depend on deployment configuration and were not
changed here. Express's default rate-limit memory store is process-local and
does not coordinate limits between multiple server instances.

For database tuning, run representative trip and destination queries against
an isolated copy of deployment-shaped data, capture execution statistics and
payload sizes, and compare before proposing index or pipeline changes. For
runtime API timing, use a repeatable local/deployment load profile with
synthetic non-sensitive data; do not log search terms or private response
content.
