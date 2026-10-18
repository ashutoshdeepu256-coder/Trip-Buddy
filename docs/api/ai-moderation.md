# AI safety and moderation API

Moderation extends the existing Safety Center and review/report workflows. Moderator endpoints require the current `ADMIN` or `MODERATOR` role and are checked on every request. Ordinary users do not receive confidence scores, classifier reasons, moderator notes, or confidential report details.

## Moderator queue

`GET /api/v1/safety/admin/moderation?status=OPEN&page=1&limit=20` returns open moderation records. `status=ALL` includes open, in-review, and escalated records. Each item includes content type and reference, available target text/details, categories, confidence, severity, reason codes, provider, recommendation, and review state. Access is limited to authorized moderators.

`PATCH /api/v1/safety/admin/moderation/:recordId` accepts:

```json
{"action":"ALLOW|FLAG|HIDE|RESTORE|ESCALATE","reason":"A concise decision rationale"}
```

`FLAG` dismisses a classifier-created queue item while retaining its classification record. `HIDE` and `RESTORE` apply only to messages and reviews. `ALLOW` approves the item, and `ESCALATE` leaves it in the queue for urgent human review. Decisions are race-checked and written to the existing audit log. These controls do not suspend or ban accounts.

## Appeals

An author whose review was held receives an `appealId` in the author-only review response. A sender whose chat message was held receives the same reference in the held acknowledgment. They may submit `POST /api/v1/safety/moderation/:recordId/appeal` with `{"reason":"..."}`. For a message hidden later by a moderator, the sender may use its message ID in this path. The content owner is checked against the referenced target; other users receive a not-found response. Appeals reopen the item for a moderator and add an audit event. Existing review edits remain available for published reviews. Existing user reports continue through `/api/v1/safety/admin/reports` and review reports through the established admin-review routes.

## Content and classification

The service handles chat messages, review comments, profile biographies, trip titles/descriptions, and relevant AI assistant inputs/outputs. Safety and review reports remain in their existing queues and are not copied into a second report queue. Categories are harassment/bullying, threats, hate/abuse, spam/scam, phishing, personal information exposure, sexual exploitation, and travel fraud. Deterministic rules currently identify direct targeted threats, explicit credential requests, repeated links, and a narrow possible personal-information pattern. Other categories require the optional classifier or user reports; this is not comprehensive detection.

Messages are bounded to 4,000 characters, reviews to 1,000, trip text to existing 4,000-character limits, and biographies to existing 1,000-character limits. Per-user moderation checks have content-type buckets; existing chat, assistant, and route limits also apply.

## Provider settings and fallback

Classification uses the shared Gemini provider only when `MODERATION_AI_ENABLED=true`, `GEMINI_API_KEY` and `GEMINI_MODEL` are configured. The classifier asks for bounded JSON and validates it against a schema. It cannot invoke tools or enforce account actions. Provider timeouts, quota failures, malformed output, missing configuration, or other errors fall back to deterministic results. A deterministic chat threat hold remains active during provider outages. When optional AI is unavailable, otherwise unflagged content is allowed; deterministic flags remain visible for review.

Assistant generation continues to use the existing Gemini configuration or its deterministic response. Unsafe planning requests matching the narrow deterministic policy receive a refusal with safe travel/reporting help; emergencies remain eligible for safety guidance. Neither the assistant nor the moderation model has tools.

## Data and privacy

With moderation AI enabled, the normalized content being classified is sent to the configured Gemini API in addition to existing assistant-generation requests. Do not enable it until the operator has reviewed the provider's current data-processing and retention terms and disclosed this use to users. Moderation records store references, categories, confidence, reason codes, provider/rule version, and decision state, not duplicate message bodies. Target content remains in its original message/review/profile/trip/assistant record under its existing retention and access rules. Logs do not include content or provider prompts. Assistant conversation retention continues under the existing assistant TTL policy.

Classification may be wrong. A report or low-confidence flag is not proof of abuse; negative reviews, disagreement, unfamiliar links, and contextual mentions are not automatically hidden. A narrow first-person/second-person threat match is held pending review and can still match quoted text or miss indirect threats. Human decisions have an appeal path for target owners. The service does not promise detection of every harmful message.
