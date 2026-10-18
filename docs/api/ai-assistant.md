# AI travel assistant API

Base path: `/api/v1/assistant`. All routes require a signed-in, active user. JSON responses use the standard TripBuddy success envelope. IDs are owner-scoped and unauthorized conversations return `404`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/conversations` | Create a conversation; optional `title` up to 100 characters. |
| `GET` | `/conversations?page=1&limit=20` | List active conversations, newest first; `limit` is at most 50. |
| `GET` | `/conversations/:conversationId/messages?page=1&limit=20` | Read paginated history. An owner can still read an archived conversation. |
| `POST` | `/conversations/:conversationId/messages` | Send a message and receive the user and assistant messages. |
| `PATCH` | `/conversations/:conversationId/archive` | Archive with `{ "archived": true }`; archives leave the active list. |
| `DELETE` | `/conversations/:conversationId` | Permanently delete the conversation and its messages. |
| `GET` | `/usage` | Read this UTC day's request and character counters and provider configuration status. |

Send body example:

```json
{
  "content": "Explain the current trip balances",
  "requestId": "9c7cf617-1d85-401b-9b2f-7841540abc00",
  "context": { "tripId": "64b000000000000000000001" }
}
```

`content` is 1–4,000 characters. A request ID is required for retry deduplication. Optional context is a strict allowlist: a `tripId`, `itineraryId`, `destinationQuery` (up to 100 characters), and/or `plannerInput`. Planner input uses the existing itinerary generation fields and date limits. A planner preview is not saved. Do not send private notes or secrets in messages.

Per-user route limits are 8 message sends per minute and 20 assistant writes per minute; users can have at most 100 active conversations. Daily use defaults to 20 requests per UTC day and can be changed with `ASSISTANT_DAILY_REQUEST_LIMIT` (bounded to 1–200). Message input is capped at 4,000 characters; retrieved context at 5,000 characters; Gemini output is capped by `ASSISTANT_MAX_OUTPUT_TOKENS` (256–1,000, default 700) and 4,000 characters. The daily counter tracks request count, input/output characters, and provider attempts; it is not a monetary cap. A request may invoke the existing itinerary planner and the assistant model, so a planner preview can make two provider calls.

The routes use the existing server configuration `GEMINI_API_KEY` and `GEMINI_MODEL`. If either is absent, or Gemini fails or returns invalid output, the assistant uses a deterministic limited fallback. The usage endpoint reports whether both settings are present; it never returns secrets. Provider billing, quotas, data retention and eligibility are controlled by the configured Google AI account and applicable provider terms. Confirm the account's current data handling and quota settings before enabling the provider for sensitive production conversations.

There is no live web-search provider. Destination results come from published TripBuddy destination records. Internal references in the response point only to server-selected records. Generated text must not be treated as live prices, weather, opening hours, availability, legal/visa advice, road conditions, a booking, payment, or completed action.
