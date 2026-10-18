# AI safety and moderation architecture

## Components and data flow

`services/moderation.service.js` owns bounded normalization, deterministic rules, optional Gemini classification, strict output validation, moderation records, queue reads, and moderator decisions. It reuses `ai/gemini.provider.js`; there is no second model client. Classification and enforcement are separate. Provider output contributes a category and confidence, while deterministic rules and policy determine what the product does.

`ModerationRecord` references the target by type and ID. It stores classifier categories, severity/confidence, reason codes, rule/provider version, recommendation, review state, and moderator decision metadata. A unique target index makes classification updates idempotent. Queue transitions use a conditional update to reject concurrent decisions. The existing `AuditLog` records moderator actions and appeals. Full content is read from its source only for authorized moderator queue results; the record does not duplicate content.

Existing report and review-report queues remain authoritative for user reports. The `/safety/admin/moderation` queue covers classifier findings. These queues are complementary: user-submitted reports are not copied to a second report queue.

## Policy

| Result | Policy |
| --- | --- |
| Allow | Ordinary content is persisted and delivered/published under existing authorization. |
| Flag | Content stays available; a moderator review record is created. Used for credential requests, repeated links, possible personal information, and model signals with confidence at least 0.90 (or high/critical severity at confidence at least 0.70). |
| Hold | A narrow deterministic first-person/second-person threat pattern prevents chat delivery or review publication until a moderator decides. It can still match quoted text or miss indirect threats; context-sensitive review and appeals remain necessary. |
| Hide/restore | A moderator may hide or restore supported messages and reviews. Review decisions use the Phase 20 lifecycle and audit history. |
| Escalate | A moderator can keep an item explicitly marked escalated for urgent human handling. The service does not contact emergency services or automatically restrict an account. |

AI scores alone never hide, suspend, or ban an account. The model cannot resolve reports, block users, delete content, execute instructions, or call tools. Deterministic chat checks remain active when the provider is unavailable. Optional AI outages allow otherwise unflagged content and preserve deterministic flags/holds.

Chat classifies after authorization, idempotency lookup, and content validation. A deterministic hold is persisted with an internal moderation state and idempotency key but not included in normal history, notifications, REST success payloads, or Socket.IO broadcasts. Retries return a held acknowledgement without reclassification or redelivery. Delivery and read receipts continue to apply only to allowed messages.

Reviews are classified before their transaction. Legitimate negative feedback is not itself a category. A directly targeted threat is saved hidden and author-only, then returned with an appeal reference; lower-confidence signals remain published and are flagged for human review. Review history and moderator transitions remain in existing review/audit records.

Profile bio and trip title/description updates create review records only when flagged. They do not automatically restrict accounts or erase text. Assistant input and output pass through the same bounded classifier. The assistant has no tools, uses its existing owner-scoped retrieval checks, treats conversation and retrieved content as untrusted, and retains its deterministic provider-offline response. A narrow unsafe-intent rule returns a refusal while preserving emergency and ordinary travel assistance.

## Categories, privacy, retention, and limitations

Categories include harassment/bullying, threats, hate/abuse, spam/scam, phishing, personal information, sexual exploitation, and travel fraud. Current deterministic patterns are intentionally narrow and cover explicit direct threats, credential requests, repeated URLs, and one possible personal-information disclosure shape. Additional category coverage depends on user reports or optional model classification; neither high recall nor low false-positive rates are guaranteed.

When `MODERATION_AI_ENABLED=true` and Gemini credentials are configured, normalized target content is sent to Gemini for classification. Assistant prompts are also sent to Gemini when assistant generation is enabled, per Phase 23 behavior. Operators must review Google's current processing/retention terms and disclose the processing. No API key is sent to client bundles. Provider errors are handled without logging prompt text. Moderation records reference existing content instead of copying it. Assistant messages continue to expire under the existing assistant retention policy; moderation metadata has no TTL yet and should be governed by the deployment's moderation retention policy.

Per-user, per-content-type checks use the existing in-process rate-window utility, in addition to route-level limits. These counters are not distributed across multiple server processes. They bound normal single-process request volume but are not a global cost cap. Gemini quotas/timeouts are provider controlled. No monetary cap is claimed.

Authorized moderators use the Safety Center endpoints and existing role checks. Decisions and appeals create audit records. A target owner may appeal a consequential moderation action through the moderation appeal endpoint; an appeal reopens human review and does not itself restore content. Existing report workflows continue to accept user reports and expose them only to moderators. Do not treat automated classification as a finding of fact.
