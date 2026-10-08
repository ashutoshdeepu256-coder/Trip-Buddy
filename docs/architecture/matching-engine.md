# Trip compatibility engine

TripBuddy computes compatibility with a deterministic server-side rules engine in `server/src/ai/matching.engine.js`. Numeric scores never depend on Gemini or another language model. The same normalized profile and trip inputs produce the same integer result.

## Weighted dimensions

| Dimension | Weight |
|---|---:|
| Destination | 25% |
| Dates | 20% |
| Budget | 15% |
| Interests | 15% |
| Travel style | 10% |
| Activities | 5% |
| Group size | 5% |
| Other preferences | 5% |
| **Total** | **100%** |

Weights are defined once as `DIMENSION_WEIGHTS`. The engine calculates a weighted mean over evaluated dimensions only, dividing by their total weight. Missing inputs are marked `UNKNOWN`, excluded from the denominator, and returned as `null` in the dimension breakdown. If no dimensions can be evaluated, the score is a documented neutral placeholder of 50 with `scoreBasis: NEUTRAL_NO_DATA`; it is not evidence of a poor fit. `dataCoverage` is the sum of the weights that contributed to the score.

Scores are rounded to whole numbers and clamped to 0–100. Categories are `EXCELLENT` (90–100), `GOOD` (75–89), `MODERATE` (60–74), `LOW` (40–59), and `POOR` (0–39).

## Formulas and unknown data

- **Destination:** exact normalized match against a preferred destination scores 100; a related configured location scores 75. An explicit excluded-destination match scores 0. A non-matching wish list is not treated as an exclusion and remains unknown.
- **Dates:** the trip's date interval is compared with the user's explicitly saved availability, extended by the user's configured flexibility days. The score is the percentage of trip duration overlapping availability. Missing trip dates or user availability are unknown.
- **Budget:** uses the range-overlap coefficient (intersection width divided by the narrower range width). A currency mismatch is unknown; no currency conversion is implied. Non-overlapping ranges score 0.
- **Interests, travel style, activities, accommodation, transport, and languages:** normalized, case-insensitive set comparison using Jaccard similarity (`intersection / union`). If either side has no values, the dimension is unknown.
- **Group size:** compares the user's preferred final group-size range to the feasible trip range, accounting for current active memberships. A full trip is always a mismatch and is excluded from discovery.
- **Other preferences:** averages evaluated accommodation, transport, food, language, and pace subdimensions. Missing subdimensions do not count as mismatches. Vegan/non-vegetarian conflict scores 0; vegan/vegetarian is partial; exact normalized food preferences match. Identical pace scores 100, adjacent `RELAXED`/`MODERATE`/`FAST` paces score 70, and opposite paces score 25.

Each evaluated dimension has `MATCH`, `PARTIAL`, or `MISMATCH` status; unavailable or incomparable data has `UNKNOWN`. Deterministic reasons, matched attributes, mismatched attributes, evaluated dimensions, unknown dimensions, and subdimension results accompany the score. Reasons are built only from the values actually compared.

Budget matching uses only the explicitly structured `budgetRange`. The older free-text budget field is retained for backward compatibility, but is not parsed or guessed into numeric values.

Email, phone, identity documents, contact details, passwords, and tokens are not matching inputs. Block relationships in either direction suppress compatibility results and discovery candidates. Verification status is not used as a quality or trust score; existing verification badges remain factual and separate.

## Persistence and cache

Ordinary compatibility reads calculate a result without saving it. Explicit refresh writes one `Match` per trip/user pair using a unique compound index. A refresh updates that record and resets it to `CALCULATED`; reading its detail changes `CALCULATED` to `VIEWED`. `CONNECTED`, `DISMISSED`, and `EXPIRED` are represented for future workflows only; connection behavior is not implemented.

An in-process cache has a 30-second TTL and a maximum of 1,000 entries. Its key is `tripId:userId:tripUpdatedAt:userUpdatedAt`; cached results are reused only when the current active member count also matches. Updated profile or trip timestamps naturally produce a new key, and membership changes invalidate the entry's member-count check. This cache is intentionally local and disposable; multi-instance deployments should introduce a shared cache or asynchronous precomputation.

Compatibility sorting scores at most the 500 most recently created eligible candidates after filters and availability rules. Results include `truncated` and `candidateLimit` so callers can see when a larger candidate set was not scored. The score calculation is bounded in-process; larger-scale ranking should use queued precomputation rather than expanding synchronous work.

## Optional language-model explanation

The current deployment has no Gemini provider configured and sends no profile or trip data to an LLM. Deterministic reasons are the working explanation. The service exposes an optional explanation-provider seam that receives only structured score, dimension, and deterministic-reason data. Provider output is used only as text; it cannot set or change the score, breakdown, or category. Provider failure falls back to deterministic reasons.

If a provider is integrated later, trip descriptions and other user-generated free text must not be included in its instructions or treated as system rules. Use structured JSON and ignore score-like fields in provider responses.

## Future boundaries

The API returns compatibility only to the authenticated traveller whose preferences were used. A trip owner cannot inspect travellers' private scores. `GET /api/v1/trips/:tripId/matches` and group formation are intentionally deferred; connection workflows belong to a later phase.
