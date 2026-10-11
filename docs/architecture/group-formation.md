# Group formation recommendations

## Scope and boundary

Phase 11 creates a proposal for a trip owner to review and for each proposed traveller to accept or reject. A recommendation is not a `Trip`, `TripMember`, invitation, reservation, payment, or connection. Acceptance only records consent. It never enrolls anyone. The proposal becomes `ACCEPTED` only after every proposed traveller has individually accepted.

The service is `server/src/services/groupFormation.service.js`. Candidate compatibility comes from the Phase 10 `match.service` and deterministic engine. Group formation has no separate person-to-trip score formula. It combines those existing scores with group constraints and a deterministic diversity tie-breaker.

## Candidate eligibility

Generation is restricted to the owner of a `PUBLISHED`, `PLANNING`, or `CONFIRMED` `PUBLIC` or `COMMUNITY` trip. Private and invite-only trips do not enter group discovery. Candidates must have `accountStatus: ACTIVE`; legacy records without this field remain eligible until migrated. Suspended and banned records are excluded. The owner, all users already associated with the trip, and recently declined members are excluded. Both-direction blocks between the owner, active trip members, and proposed members prevent co-formation.

The candidate query selects only IDs, account status, travel preferences, and update time. It is capped at 100 candidates. Trip compatibility results with a known destination, date, or budget mismatch are excluded. Missing preferences and incomparable currencies remain unknown. No contact, credentials, identity documents, DOB, or verification records are selected.

## Bounded deterministic algorithm

1. Read the owner-authorized trip, active and historical membership IDs, and a bounded candidate projection.
2. Exclude non-active accounts, current/former members, recent decliners, and users blocked with the owner.
3. Calculate each remaining traveller's trip compatibility with the Phase 10 cached service. No client-provided user IDs or scores are accepted.
4. Starting with current active members, greedily add the eligible candidate with the highest utility until available capacity or the eight-person proposal cap is reached. Utility is the existing integer compatibility score plus up to 10 points for interests not already represented. Ties break by compatibility score and user ID. Duplicate IDs are rejected.
5. Before adding each candidate, require the group's known budget ranges to have a common intersection in the trip currency, require known date windows to overlap the trip and each other, and reject any blocked pair. Different currencies and missing data are unknown, never treated as equal.
6. If the resulting group cannot meet the trip's minimum group size together with current members, return `INSUFFICIENT_CANDIDATES` and do not persist a recommendation.
7. Store the average Phase 10 score and per-dimension average across proposed travellers. Generate reasons from those scores and actual shared interests/known budget/date inputs.

The score is deterministic and rounded to an integer. Group-level constraints are hard gates, not LLM judgments. Work is bounded to 100 compatibility calculations and a maximum proposed group size of eight. The greedy selection is O(C × G × P), where C is the capped candidate count, G the proposed group size, and P the number of known group preferences. It does not enumerate combinations. Large deployments should precompute candidates in a background job.

## Persistence and lifecycle

`GroupRecommendation` is separate from `TripMember`. It stores the trip, proposed user IDs, each user's private Phase 10 score/breakdown/reasons, group score/breakdown, constraint results, algorithm version, generation key, status, and seven-day expiry. Member consent is stored per proposed user as `PENDING`, `ACCEPTED`, or `REJECTED`.

Recommendation states are `PROPOSED`, `VIEWED`, `ACCEPTED`, `REJECTED`, `EXPIRED`, and `SUPERSEDED`. A rejection by any proposed traveller rejects the whole proposal. Every proposed traveller must accept before it becomes `ACCEPTED`. Rejected users are suppressed from that trip's candidate pool for 30 days. A refreshed input snapshot supersedes an outstanding proposal. Repeated generation with the same snapshot reuses the same recommendation.

Indexes include one unique active key per trip, a unique trip/generation-key pair for idempotency, and trip/status/expiry plus proposed-user/status lookup indexes. The active key is cleared on terminal states. Generation is limited to three calls per hour per client.

## Authorization and privacy

Only the trip owner may generate recommendations. The owner may list recommendations for their trip; a traveller may list or inspect only recommendations that include them. Only a proposed traveller can record consent for their own place. Owner and outsider lookups are scoped or concealed as not found.

The owner and proposed travellers can see public display names and response states for the proposed group. Individual compatibility breakdowns and reasons are returned only to the traveller they describe. Group-level aggregate scores and reasons do not include contact, account, verification, or hidden profile fields. Generation, acceptance, and rejection are audited.

## Concurrency and capacity

MongoDB transactions are not required because Phase 11 does not mutate trip membership. Unique active and generation-key indexes prevent duplicate recommendation records; response updates use conditional `findOneAndUpdate` filters against the current status and that actor's `PENDING` response. Concurrent accept/reject attempts for one traveller therefore cannot both succeed.

Immediately before accepting, the service reloads account eligibility, trip status, active member count, capacity, membership, blocks, compatibility hard constraints, and group budget/date intersections. If capacity or constraints changed, acceptance fails and a capacity-invalid proposal expires. A later membership workflow must perform its own atomic capacity and unique-membership operation; Phase 11 acceptance does not claim or reserve a slot.

## Known limits

No discoverability preference or account suspension workflow existed in earlier phases; `accountStatus` is additive and defaults to `ACTIVE`, with missing legacy values treated as active. No group enrollment, invitations, chat, payment, or Gemini explanation is implemented. The bounded candidate query is local and synchronous; it is appropriate for current scale, not an unbounded marketplace.
