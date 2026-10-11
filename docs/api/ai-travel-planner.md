# AI travel planner API

The planner uses the standard `{ success, message, data }` response envelope
and the existing cookie or bearer session. Plans are private to their creator.
The service validates provider output before saving it. When Gemini is not
configured or returns an unusable response, it saves a visibly labelled
`DETERMINISTIC_FALLBACK` outline with unknown costs rather than fabricating
current facts.

## Authorization

- **Standalone plan:** the authenticated active account that creates it is its
  sole reader and editor. IDs never grant access; a different owner receives
  `404 ITINERARY_NOT_FOUND`.
- **Trip-linked plan:** generation requires the actor to be the `Trip.creator`
  of a non-cancelled, non-completed trip. An active `TripMember` alone does not
  grant authority to link a plan. The linked plan remains private to its owner;
  trip members and trip privacy settings do not make the itinerary shared.
- Suspended or banned accounts cannot use planner operations. Sender, owner,
  source and archive state are never accepted from client input.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/v1/itineraries/generate` | Generate and persist a plan. Requires destination and dates, or `tripId` for an owned trip. |
| GET | `/api/v1/itineraries?page=1&limit=12&archived=false` | List the actor's plans, newest updated first. Limit is at most 50. |
| GET | `/api/v1/itineraries/:itineraryId` | Read one owned plan. |
| PATCH | `/api/v1/itineraries/:itineraryId` | Update title, budget, preferences, or the full validated plan. |
| POST | `/api/v1/itineraries/:itineraryId/days/:day/regenerate` | Replace one day while retaining other saved days. |
| POST | `/api/v1/itineraries/:itineraryId/days/:day/:section/regenerate` | Replace only `morning`, `afternoon`, or `evening` for that day. |
| POST | `/api/v1/itineraries/:itineraryId/duplicate` | Make a standalone owner copy. |
| POST | `/api/v1/itineraries/:itineraryId/archive` | Archive an owned plan. |
| DELETE | `/api/v1/itineraries/:itineraryId` | Permanently delete an owned plan. |

Generation accepts `destination` (160 chars), ISO `startDate`/`endDate` (1 to
31 days), optional `title`, `budget: { amount, currency }`, and
`preferences: { interests, pace, notes }`. A maximum of 20 interests (60 chars
each) and 1,000 preference-note characters are accepted. Request bodies are
limited globally to 1 MB. Generation is limited to 5 requests per user per
hour; day regeneration is limited to 10 per user per hour. The existing global
API limit also applies.

## Plan contract

Each plan includes dates and days. Every day has morning, afternoon, and
evening activity lists. Activities include a short title/description, duration
(15–720 minutes), cost amount or `null`, currency and optional location. A day
cannot exceed 10 scheduled hours for accepted Gemini output. Plans also include
budget categories, suggestions, assumptions, unknowns, and safety notes.
Provider data is parsed and validated before persistence. Costs use the input
currency; missing amounts remain unknown. No endpoint fetches live prices,
weather, venue hours, transport, visa rules, or current advisories.

`source` is `GEMINI` or `DETERMINISTIC_FALLBACK`; a fallback is not presented as
AI output. Errors use the existing `{ success: false, error: { code, message } }`
format. Common codes include `VALIDATION_ERROR`, `ACCOUNT_INELIGIBLE`,
`ITINERARY_NOT_FOUND`, `TRIP_NOT_FOUND`, `INVALID_ITINERARY_DATES`, and
`RATE_LIMITED`.

## Configuration

Set `GEMINI_API_KEY` and `GEMINI_MODEL` on the server to enable provider-backed
generation. Without both values, the deterministic outline is used. Choose a
Gemini model supported by the deployed account and region. `PLANNER_MAX_OUTPUT_TOKENS`
defaults to 3000 and is clamped to 512–6000. Keep the API key server-side; it is never returned or logged.
Provider errors are logged by error name only, without prompts or itinerary
content. Request limits and token caps bound usage, but they are not a provider
billing cap; deployments must configure provider-side quotas and alerts.
