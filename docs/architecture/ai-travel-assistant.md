# AI travel assistant architecture

## Provider and request flow

`server/src/ai/gemini.provider.js` is the shared Gemini SDK boundary used by both the Phase 14 itinerary planner and this assistant. It reads only `GEMINI_API_KEY` and `GEMINI_MODEL` from the server environment, supports bounded output and a request timeout, and never returns credentials. Assistant prompts use the configured Gemini model only when both values exist. The planner continues to validate generated itinerary JSON against its existing schema; invalid or unavailable output uses the planner's existing deterministic fallback.

Assistant messages are persisted in owner-scoped conversation and message collections. When Gemini is configured, each prompt includes at most the eight latest prior messages (2,500 characters total) from that same conversation so follow-up questions can use actual saved context. These messages remain untrusted input. Requests carry a client-generated idempotency key; a completed retry returns the saved response without another provider call. If a process stops after the user message is written but before its reply is stored, a retry returns a processing conflict for 60 seconds, then can reclaim and complete the turn. This is not a distributed exactly-once guarantee. Conversation and message documents expire after 365 days through MongoDB TTL indexes, whose cleanup is asynchronous. Daily usage counters expire after 400 days. Archiving hides a conversation from the active list but does not shorten its retention. Explicit delete removes its messages and conversation immediately.

Gemini replies are not streamed. Provider errors, quotas, timeouts, blank responses, malformed output and overlong responses fall back to bounded deterministic text. No conversation contents or credentials are written to application logs. Usage counters are per owner and UTC day and record request counts, characters, and provider attempts; they do not measure monetary spend or provider-side token billing.

## Retrieval boundary and privacy

Retrieval is selected by server code from strict typed request fields and simple intent checks. The model cannot call tools. The allowlisted operations are:

- Search published destination records, returning a small projection of stored names, descriptions, activities, best months and estimated budget ranges.
- Read a trip through `tripService.getAccessibleTrip`; private location coordinates are excluded from assistant context.
- Read an itinerary through `collaborativeItineraryService.getShared`, which rechecks owner, active membership, account status and collaborator grants. Only a bounded projection of the plan is sent.
- Read expense balances through `expenseService.summary`, which independently requires current active trip membership and returns deterministic per-currency ledger figures.
- Compute compatibility through `matchService.getTripCompatibility`, which reuses the deterministic match engine and its visibility/block checks.
- Request a non-saving planner preview through the existing planner validator and `itineraryService.generateWithGemini`/`fallbackPlan`.
- Read configured maps capability flags. The assistant does not report live route conditions or traffic.

Each protected read rechecks authorization at retrieval time. If the record is missing or unavailable, the context includes only a generic unavailable marker, not its contents. The assistant does not retrieve booking records, payment data, emergency contacts, safety reports, moderator notes, credentials, or arbitrary profile fields. It does not receive exact trip coordinates. Retrieved destination descriptions and user prompts are untrusted text. They are isolated from the system policy and cannot select operations, query MongoDB, follow URLs, execute code, or change authorization.

The only external data transfer is the bounded prompt/context sent to the configured Gemini provider. TripBuddy does not claim that the assistant has memory beyond saved conversation messages and context explicitly retrieved for a particular request. Google AI provider retention and training rules depend on the configured account, API product and current terms; operators should verify those terms and disclose them before using sensitive user data.

## Actions and limitations

The assistant has no write tools. A planner preview is not persisted, and a natural-language answer cannot change an itinerary, trip, connection, expense, settlement, booking, or payment. Users must use the existing authorized feature and its confirmation flow to make changes. The assistant never initiates payment or books travel. It does not browse the web or verify current prices, hours, availability, advisories, weather, route conditions, or entry requirements. Safety replies direct urgent situations to local emergency services and in-app resources; they are not live monitoring or emergency response.

Rate limits use the existing application limiter plus per-user assistant limits. Daily request limits are configurable and enforceable, but no exact cost ceiling is claimed. Provider timeouts and quota behavior still depend on the configured SDK/account. In a multi-instance deployment, rate-limit and daily-usage storage must be configured/shared appropriately for global enforcement; process-local rate-limit state alone is per instance.
