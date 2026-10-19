# Trip Discovery API

`GET /api/v1/trips` returns paginated discovery cards assembled from MongoDB
`Trip`, `Destination`, `User`, and `TripMember` records. It uses the standard
`{ success, message, data }` response envelope. This endpoint is read-only;
Phase 8 trip mutation and detail routes remain in place.

## Query parameters

All parameters are optional. Unknown parameters are rejected. Defaults are
`page=1`, `limit=20`, and `sort=recent`; `limit` is capped at 50.

| Parameter | Meaning |
| --- | --- |
| `destination` | Destination ObjectId, slug, or exact case-insensitive name. Only published destinations match. |
| `q` | Case-insensitive substring in trip title, description, destination name, city, or country. |
| `startDate`, `endDate` | Both required together, ISO-compatible dates. Trips overlap the requested interval when `trip.startDate <= endDate` and `trip.endDate >= startDate`. |
| `dateFlexibility` | `0`, `1`, `3`, or `7` days. Expands the requested interval on both sides before testing overlap. Requires both dates. |
| `budgetMin`, `budgetMax` | Inclusive requested budget range. At least one may be supplied; `budgetCurrency` is required with either. |
| `budgetCurrency` | Three-letter ISO-style currency code, normalized to uppercase. Different currencies are never converted or compared. |
| `budgetFlexibility` | Percentage from `0` to `50`; lowers the requested minimum and raises the requested maximum by that percentage. Requires a budget bound. |
| `groupSize` | Minimum number of currently open slots required for the searching party. |
| `groupMin`, `groupMax` | Inclusive lower/upper bounds for currently open slots. All discovery results have at least one open slot, regardless. |
| `travelStyle`, `interests`, `activities` | Comma-separated values. Each filter is case-insensitive and matches ANY selected value in its corresponding trip field. |
| `accommodation` | Comma-separated values matched against `accommodationPreference` (ANY). |
| `transport` | Comma-separated values matched against `transportPreference` (ANY). |
| `foodPreference` | Comma-separated values matched against `foodPreference` (ANY). |
| `language` | Comma-separated values matched against the trip's normalized `languages` field (ANY). |
| `verifiedOnly` | `true` restricts results to creators whose existing identity verification status is `VERIFIED`. |
| `ageMin`, `ageMax` | Currently returns `AGE_FILTER_UNAVAILABLE` (422); the account model has no date-of-birth or age-display consent field. No age is inferred or exposed. |
| `sort` | `recent`, `date`, `budget_low`, `budget_high`, `group_availability`, `popularity`, or `compatibility`. |
| `page`, `limit` | Positive bounded pagination values; maximum `limit` is 50 and maximum page is 10,000. |

Range and enum validation use Zod before any aggregation executes. Multi-value
filters are trimmed, lowercased, deduplicated, bounded to ten values per field,
and matched as escaped anchored regular expressions; user input cannot inject
Mongo query operators or regular-expression syntax.

## Budget and date semantics

Date comparison uses MongoDB Date values, not strings. For a requested window
`[from, to]` with `dateFlexibility=d`, discovery checks overlap with
`[from - d days, to + d days]`. Endpoints are inclusive.

Budget match uses interval overlap:

```text
trip.max >= requested.min * (1 - flexibility / 100)
trip.min <= requested.max * (1 + flexibility / 100)
trip.currency == requested.currency
```

When only one request bound exists, only its corresponding overlap condition is
applied. There is no exchange-rate provider or implicit conversion; e.g., an
INR request will not match a USD trip.

## Visibility and membership

Only `PUBLISHED`, `PLANNING`, and `CONFIRMED` trips are candidates. Anonymous
requests see only `PUBLIC`; an authenticated session may also discover
`COMMUNITY` trips. `PRIVATE` and `INVITE_ONLY` trips are never included in
discovery, even for members; their existing detail endpoint continues to
enforce its owner/member authorization. Drafts, cancelled, ongoing, completed,
unpublished/missing destinations, and trips without an existing creator are
excluded.

Active `TripMember` records determine `currentMembers` (including the owner
edge created by Phase 8). `availableSlots = max(Trip.groupSize.max -
currentMembers, 0)`. Full trips are always excluded; only ACTIVE memberships
count, not pending invitations.

`verifiedOnly=true` means **identity verified**, based strictly on
`User.verification.identity.status === "VERIFIED"`. Email and phone status are
separate factual booleans in the card; neither is represented as an invented
trust score. Age filtering is unavailable pending explicit private DOB
collection and an age-display consent policy. Languages are recorded on trips
for Phase 9 discovery; user profile language fields do not currently exist.

## Sorting and response

- `recent`: newest trip first.
- `date`: soonest trip start first.
- `budget_low` / `budget_high`: lowest `budget.min` / highest `budget.max`.
- `group_availability`: most currently open slots first.
- `popularity`: most active members first, a factual count rather than a
  synthetic score.
- `compatibility`: reserved for Phase 10; returns
  a compatibility-ranked list for signed-in users. The service scores at most
  500 eligible candidates and reports `truncated` when more candidates were
  available. Anonymous requests receive `UNAUTHENTICATED` (401). The current
  implementation filters blocks before returning results and uses creation
  time and ID as stable tie breakers.

`data` contains `items`, `page`, `limit`, `total`, `totalPages`,
`hasNextPage`, and `hasPreviousPage`. Each card contains a restricted trip
summary, destination identity/location, date and budget ranges, group
availability, preference arrays, first image URL, creator ID/name/profile
image if present, factual verification booleans, status, privacy, and creation
time. It never includes creator email, phone, DOB, password, or document data,
and never returns Cloudinary provider IDs.

## Indexes and operational choices

Discovery uses one aggregation pipeline with `$lookup` stages for published
destinations, projected creator fields, and ACTIVE member counts; it avoids
per-result application queries. `$facet` produces records and total count from
the same filtered result set. Requests are not cached because membership
counts and visibility can change frequently. The pipeline has not been
validated with production query plans: no isolated MongoDB test URI was
available during Phase 27. Index changes are therefore deferred until
`explain("executionStats")` evidence is available for representative data.

Trip query indexes include:

- `{ status: 1, privacy: 1, startDate: 1 }` for discoverable date-window scans.
- `{ destination: 1, status: 1, startDate: 1 }` for selected destination feeds.
- `{ status: 1, privacy: 1, startDate: 1, budget.currency: 1 }` for
  currency-specific budget feeds.
- `{ status: 1, budget.min: 1, budget.max: 1 }` for budget ordering/filtering.
- `{ trip: 1, status: 1 }` on `TripMember` for ACTIVE membership counts.
- `{ creator: 1, createdAt: -1 }` for Phase 8 owner lists.
- Budget and bounded array predicates are applied in the initial Trip `$match`
  before lookups. Existing Trip arrays are not separately indexed as
  independent arrays because that would add write/index cost without a
  dedicated high-volume search profile; a compound index over multiple array
  fields is intentionally avoided.

Text filters currently use escaped, case-insensitive MongoDB regular
expressions appropriate to the current scale. The discovery service isolates
filter construction from the HTTP layer so a MongoDB Atlas Search pipeline can
replace/extend this implementation later.

## Known limitations

- No FX conversion, age data, age-consent policy, connection state, or AI
  compatibility rank exists yet.
- A trip's `languages` describe languages associated with that plan; profiles
  do not currently store spoken languages.
- Profile images are not currently part of the user schema; card output is
  `null` until that field exists.
- Detailed connection, join-request, review, and popularity event systems are
  deferred; sort popularity uses active member count only.
