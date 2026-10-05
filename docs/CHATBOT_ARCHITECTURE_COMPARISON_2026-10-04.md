# GCCBot chatbot architecture review for SaleMaX

**Review date:** 4 October 2026
**Scope:** Read-only source inspection of the GCCBot Laravel application at `~/crm.gccbot.com/core` and the SaleMaX Node/Express checkout in this repository. No application files, records, credentials, or production settings were changed. No end-to-end message was sent.

## Executive recommendation

Bring the three-mode **product behavior** into SaleMaX, but do not copy Laravel files or replace SaleMaX's Node application. GCCBot's bot services depend on Laravel models, Eloquent, container injection, Blade, `post_options()`, and its own WhatsApp/channel stack. A literal copy would not run here and could bypass SaleMaX tenant identity, plan entitlements, lead conversion, and finance controls.

Implement this within the existing `/user` WhatsApp/inbox and chatbot/flow experience described in the SaleMaX plan. Reuse the current flow builder and messaging adapter where compatible. Add one tenant-scoped bot configuration and runtime dispatcher, then call SaleMaX's existing pipeline, course, batch, form, handover, and approved sale services. Treat GCCBot as a reference for the guided/hybrid/AI interaction design and the rollout controls.

## What the three GCCBot modes mean

The production assistant view exposes **Basic Chatbot**, **Hybrid AI**, and **AI Chatbot**. The `chatbot_active_type` setting is separate from runtime operation modes (live reply, shadow/training, surveillance, human only). This separation is valuable: a tenant chooses a response engine, while operations can independently decide whether it may send.

| Mode | Observed behavior | Training-center fit |
| --- | --- | --- |
| Basic Guided | Deterministic menu, numbered choices, persisted conversation state, catalog lookup, booking/order steps, contact capture, keyword replies, and staff handover. The dispatcher logs that AI is bypassed in this branch. | Best default for fees, course/batch selection, collecting enquiry details, and predictable next steps. It should use SaleMaX course/batch data rather than GCCBot's product/service catalogue. |
| Hybrid AI | Preserves the light guided path for opening menus, numbers, catalog/product turns and an already-active guided step; other free-text turns use AI, business context, conversation memory and constrained tools/actions. | Recommended default for training centers after the guided flow and course facts are reliable. AI can interpret “I work shifts; what evening class fits?” while batch capacity and prices still come from SaleMaX records. |
| AI Chatbot | Routes to the existing business-type AI workflow and contact-discovery path. Runtime settings resolve provider/model/key, plan access, context, fallback, and AI logs. | Useful for flexible FAQ and natural-language discovery, but should be an opt-in mode with verified course knowledge and strict action limits. It must not promise availability, discounts, enrollment, or payment status from model text. |

The implementation also supports operational modes. Human Only disables bot and AI and hands work to staff; Shadow runs generation for internal training without sending; Surveillance observes without auto-reply; Bot/live mode sends. These should be distinct controls in SaleMaX, not more options mixed into the three engine tabs. A bot engine can be tested in Shadow, then enabled for live sending.

## GCCBot flow and design observations

- Inbound messages are captured into a conversation/contact/message/log before bot selection. A handover pause suppresses automated replies.
- A business-level `chatbot_active_type` selects one of the three service branches. Basic settings are normalized through a dedicated configuration service; guided state is saved in conversation context.
- Hybrid's AI path uses an explicit allowed-action list and tool executor; structured choice/menu turns remain deterministic. The inspected path includes fallback intent handling when AI fails and keeps a short safe reply fallback.
- AI provider readiness, account plan access, model selection, encrypted key retrieval, context, fallback settings, and request logging are resolved as separate concerns.
- Handover and incoming notification settings exist; staff handover is part of the customer flow, not a detached error path.
- The user-facing mode picker and runtime mode control live in the existing WhatsApp Assistant page. Existing channels/mobile API also expose runtime mode operations.
- Config is partly stored in business options/settings and conversation JSON, while AI config and conversation logs have dedicated models/tables. This is a useful compatibility pattern but SaleMaX should avoid making versioned flows/config only mutable JSON with no revision/audit boundary.
- Source inspection found one directly named Basic Guided unit test. It did not establish channel delivery, bilingual browser acceptance, concurrency behavior, or complete hybrid/AI production acceptance; this report does not claim those were tested.

## SaleMaX fit and reuse boundary

SaleMaX is `salemax-node` 3.6, built on Express and MariaDB. It already mounts chatbot and flow routes, has legacy chatbot CRUD, two flow mechanisms (file-backed nodes/edges and beta node/edge JSON), a WhatsApp flow executor, an inbox, an owner-scoped lead pipeline, a course/batch catalogue, lead forms, and a training lead journey. The implementation plan explicitly requires extending these existing screens and preserving the existing channels and flows.

That means:

1. Keep the existing login, `/user` panel, inbox, chatbot entry, flow builder and channel adapters.
2. Preserve old bot records and flow IDs; introduce a compatibility adapter/dispatcher and reviewed migration mapping rather than creating a second chatbot catalogue.
3. Persist bot type, runtime send mode, active published config revision, channel scope and fallback policy per tenant. Keep mutable drafts separate from the immutable revision that active conversations use.
4. Reuse the existing training course/batch and lead APIs as authoritative tools. Do not let chatbot code create invoices, mark a lead Won, verify a payment, change installment schedules, or bypass the sale review/accountant workflow.
5. Gate configuration and runtime by the existing versioned `messaging.chatbot` capability and role permissions, then keep old commercial plan IDs/assignments compatible. The current chatbot route's `allow_chatbot` check is legacy plan JSON and is not a substitute for the new capability contract.

## Proposed training-center conversation

**Opening menu:** Ask whether the visitor wants course information, upcoming batches/timings, fees, to request a call, or to speak with a person. Offer language selection only when the channel cannot reliably infer or remember language.

**Course information:** Search the tenant's published courses. Return only approved description, level, duration, delivery format and learning outcomes. Ask the visitor to choose among exact matches if the request is ambiguous.

**Batch and schedule:** Read published batches, schedule, seat state and enrollment window from the tenant-scoped API at reply time. If no suitable batch is available, collect preferred time and create a follow-up task; do not invent a date or claim a place is reserved.

**Enquiry capture:** Reuse the current contact and lead pipeline. Collect learner name, guardian/payer relationship when relevant, phone (channel identity can prefill), course, preferred batch/time, language, consent to contact, and an optional note. Validate each field and confirm the summary before submitting. Make retries idempotent so webhook redelivery cannot create duplicate opportunities.

**Next action:** Create/update the tenant-scoped enquiry through the lead journey API, preserve source/channel attribution, assign by the existing assignment policy, and give the customer a clear confirmation and expected follow-up. Any offer, discount approval, enrollment, invoice and payment goes through the existing controlled sale/finance workflow.

**Human handover:** Support explicit “agent/person/call me” and low confidence, repeated invalid answers, policy/complaint/payment exceptions, unavailable data, and AI/provider failures. Pause automation while staff own the conversation; show reason, transcript context, lead and requested next action in the existing inbox.

## Configuration model to implement

Configure this in the existing chatbot screen, with a compact setup wizard and a preview/test conversation:

- **Engine:** `guided`, `hybrid`, or `ai`.
- **Send mode:** `draft/test`, `shadow`, `surveillance`, `live`, or `human_only` (the runtime API may use its own stable enum names).
- **Channels:** existing connected WhatsApp/Meta/QR channels, each with channel capabilities (buttons/lists/templates), readiness and an explicit assigned bot revision.
- **Published flow:** versioned guided steps, supported inputs/validation, language variants, retry behavior, fallback, and handover nodes. Validate reachability, cycles, required exits and channel limits at publish time.
- **Knowledge:** approved course, batch, fee/offer, location, hours, payment instructions and policy sources; each item carries effective/published state. Live operational facts come from authenticated SaleMaX tools; documents/context provide explanatory content only.
- **AI policy:** provider/model, token/cost bounds, supported languages, confidence/abstain thresholds, approved retrieval sources, tool allowlist and per-tool permission. Never accept arbitrary model-supplied SQL, URLs or executable flow code.
- **Lead capture:** required fields and consent wording, identity matching policy, duplicate handling, pipeline stage, source attribution and assignment rule.
- **Handover:** queue/owner/team, staffed hours, notification preference, pause/resume policy and unanswered-customer SLA.
- **Observability:** config/version, channel, conversation/message IDs, mode, decision class, tool/action, latency, provider status, send status, handover reason and redacted error. Minimize stored message/PII; never log credentials or full provider secrets.

Keep engine selection separate from permission/entitlement, channel connection state and send mode. Changing a draft must not silently change the version already serving active conversations. Provide a one-click rollback to the last published revision and an immediate Human Only kill switch.

## Individual conversation bot control

Add a per-conversation **Bot replies: On / Paused** control to the existing Inbox conversation header or details panel. This is a conversation override, not another bot type and not a replacement for the business-wide runtime mode. Offer `Use business default`, `Pause until resumed`, and optionally bounded pause durations such as 15 minutes, 1 hour, or 24 hours. Show who paused it, when, why (optional), and when it will resume. While paused, continue recording inbound messages and notifying the assigned team, but do not send automated replies.

Use this precedence when deciding whether an outbound bot reply is allowed:

1. Tenant entitlement, channel connection/readiness, provider policy, and business-wide Human Only/global shutdown are mandatory gates; a chat-level setting cannot bypass them.
2. An active staff handover or per-conversation pause suppresses bot sends for that conversation.
3. Otherwise, the conversation inherits the business/channel runtime mode and published bot revision.
4. A conversation-level resume may restore inheritance only when the global gates allow replies; it must not force Live mode.

Persist the override and expiry in a tenant-scoped conversation record, with actor and audit event. Use an atomic revision/update so concurrent agent actions have a clear winner. The dispatcher should check pause/handover before AI work and re-check immediately before enqueue/send; this prevents a slow AI response from arriving after staff has taken control. Duplicate webhook deliveries remain idempotent. Permission checks must ensure only authorized owner/manager/staff roles can change automation state, while agents may receive narrower pause/resume rights if the tenant grants them.

GCCBot's inspected global mode switch updates bot/AI flags and statuses across existing threads/conversations. Preserve the engine/runtime separation, but do not copy that global-update behavior as the implementation of a single-chat pause. SaleMaX needs an independently persisted conversation override and inbox control.

## Important SaleMaX risks found in source

These are source-code observations, not exploit tests. Fix before expanding chatbot configuration or enabling customer-controlled automation:

1. `routes/chatbot.js` updates an existing `chatbot` by `id` only in `/update_chatbot`; unlike status/delete, the SQL does not also constrain `uid`. A logged-in tenant can potentially update another tenant's bot if its identifier is known. Add owner/tenant scoping and verify exactly one matching record.
2. `routes/chatbot.js` passes a user-supplied URL, method, body and headers into `makeRequest` in `/make_request_api`. This is an SSRF-capable surface unless `makeRequest` applies a strict destination allowlist and blocks private/link-local/metadata IP ranges after DNS resolution and redirect handling. Do not reuse it as a chatbot tool API.
3. `routes/chatFlow.js` checks and updates legacy flow records by `flow_id` without tenant scope in `/add_new`; the beta flow update path also looks up `flow_id` globally and updates by `flow_id`. Scope lookup/update to the authenticated business and use opaque tenant-owned IDs. File paths must use validated IDs and remain inside the tenant flow directory.
4. Bot/flow save routes accept large nested JSON and variable shapes; add schema validation, body/node/edge limits, execution timeouts, cycle/step limits, safe variable interpolation, and an allowlisted action registry. Persist publication/audit events and prevent edits from changing active conversations mid-turn.
5. Basic bot and hybrid code has no evidence here for SaleMaX tenant roles, category entitlements, course/batch lookup, bilingual training prompts, or controlled finance actions. Those are new integration contracts, not properties inherited by copying the services.

## Delivery sequence

1. **P0 preservation/security:** inventory the live-existing chatbot, flow, inbox and provider paths; close cross-tenant CRUD/flow gaps; audit the outbound request helper; record current behavior and migration mapping.
2. **Contract and guided mode:** add tenant/category capability checks, configuration draft/publish/revision and runtime dispatcher in SaleMaX's existing Node modules. Implement the training-center guided conversation against existing course/batch/lead APIs with idempotency and handover.
3. **Shadow operations:** add safe non-sending shadow and surveillance behavior, review logs/decisions in the current inbox, and compare proposed leads/actions to human outcomes using synthetic accounts.
4. **Hybrid:** add natural-language routing and approved read-only SaleMaX tools first. Use deterministic confirmation for writes. Add provider errors/timeouts, confidence fallback, rate and cost limits, and a visible handover path.
5. **AI mode:** expose only after the hybrid controls and knowledge/source review pass. Keep writes behind the same action service and role/tenant checks.
6. **Acceptance and release:** existing-screen EN/AR/RTL and mobile acceptance; guided/hybrid/AI tests; old chatbot/flow regression; role and direct-URL denial; duplicate webhook/concurrency tests; provider sandbox evidence; channel capability tests; publish/rollback and Human Only drill. Live customer use remains gated on provider approval and release review.

## Evidence limits

GCCBot was inspected over authenticated SSH in read-only mode from its Laravel source tree. The assistant view, mode/config services and inbound dispatcher were inspected. No `.env`, credentials, database contents, customer conversations, logs containing customer data, or settings values were read. No GCCBot or SaleMaX production files were changed. The GCCBot production page was not browser-tested and no real WhatsApp message was sent. SaleMaX conclusions are from the local source snapshot and its required plan/status documents; this review does not refresh the currently deployed SaleMaX release or prove end-to-end behavior.
