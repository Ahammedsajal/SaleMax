# SaleMaX chatbot architecture

## Existing screen

The chatbot management experience is mounted in the existing Automation Flows screen. Automation Flows stays the first tab and its canvas remains intact. The pill tabs open Guided Chatbot, Hybrid AI, and AI Chatbot setup in the same SaleMaX shell. Each saved bot profile belongs to one tenant and one versioned business category, and can be assigned to connected messaging numbers.

## Runtime layers

1. **Existing-channel adapter:** the current WhatsApp QR/Meta inbound flow calls the configured bot runtime before falling through to the existing legacy Automation Flow. Existing channel send functions are reused.
2. **Tenant and entitlement boundary:** the runtime resolves the legacy account to one canonical tenant and membership, validates category capability and plan access, then scopes profile lookup to tenant, category version, channel type, and connected number.
3. **Bot profile and channel assignment:** profile configuration uses optimistic revisions. A database unique key allows one bot assignment per tenant/channel number, preventing ambiguous live replies.
4. **Category pack:** a versioned pack provides approved instructions, live business facts, guided reply logic, and an optional schema-driven editor. Training Center v1 reads only active courses, current offers, upcoming batches, and published enquiry forms.
5. **Engine policy:** Guided uses deterministic menus/flows; Hybrid handles menu choices and known guided intents deterministically, then uses AI only for open questions when enabled; AI uses the provider for approved FAQs and category facts. AI answers must satisfy the confidence threshold and structured-output contract.
6. **Safety and operations:** provider keys use AES-256-GCM encryption with a platform key held in runtime configuration. Token reservations enforce a daily tenant limit. Tenant-authored preferences, customer messages, conversation history, and catalog/FAQ text stay in the data payload and cannot override system policy. Unsupported input, provider errors, low confidence, and explicit human requests pause only that channel-scoped conversation and make the handoff visible in Inbox.
7. **Idempotency and session state:** inbound provider message IDs are hashed with channel and conversation identity. Guided state is tenant/profile/channel/conversation scoped, expires after 24 hours, and is pruned in bounded batches.

## Adding a category

Register an immutable `{category key, version}` pack with a display title, allowed system guidance, `loadFacts`, and optional `guidedReply`/`isGuidedIntent` handlers. Guided content is declared as typed schema fields with defaults and length/range limits; the common editor renders bilingual text, toggles, and bounded integers from that schema. Its read-only preview uses unsaved normalized content and tenant-scoped live facts; conversation state remains in the browser. Category-specific facts must be tenant-scoped and published/active before reaching a model or customer. Add tests for pack validation, facts isolation, bilingual guide behavior, and Hybrid routing. A category without a reviewed guide can use the FAQ/AI path but cannot claim a built-in Guided workflow.

## Current acceptance boundary

The Training Center pack and editor are implemented. The existing channel adapter, permissions, profile APIs, provider adapter, preview, number assignments, and per-conversation pause routes are integrated. A real provider key, connected WhatsApp number, inbound message, and live-provider response must be configured and verified before claiming end-to-end customer delivery; never activate or alter a live bot merely as a test.


## Current bot authority at dispatch and send — 20 October 2026

Bot runtime owner resolution now reuses the shared business context and current
published-plan entitlement loader. Exact owner UID/tenant membership, active
identity, category/version, current assignment period, capability and configured
navigation restrictions are checked before resolving a bot. An expired historical
assignment cannot grant access merely because its status still says active.

Direct reply/media checks refresh this authority and require the same tenant,
category/version, owner identity/membership and plan-assignment identity as the
turn's starting context. Flow dispatch is checked before invoking the existing
executor. A denied live bot assignment consumes that channel's inbound adapter
silently rather than falling through to an unrelated legacy flow. Unmapped legacy
accounts and channels without a live configured bot retain their existing flow
path. The check is scoped to the assigned tenant/channel/profile; no bot is
activated or customer configuration changed by this code update.

This is an authorization boundary, not proof of recall after a provider accepted
a message. Legacy multi-node flow execution still needs its own per-node authority
and outbox/lease acceptance audit; checking dispatch does not establish that every
later node revalidates automatically. Tenant-defined bot capture and generic pack
adoption remain separate implementation work.

Production: `7672d59` is live in `bot-runtime-access-7672d59-20261020`. Thirty-seven focused checks and actual runtime/shared-auth/MariaDB integration pass. The existing live owner still qualifies; health and exact two-file runtime parity pass. No bot configuration, migration or provider message was changed. See DEPLOYMENT.md for rollback and remaining gates.


## Explicit form selection per bot profile — 20 October 2026

Training Center profiles may keep the existing automatic published-form choice,
select one published form belonging to their tenant, or disable catalogue form
facts. The existing editor lists bounded public form metadata and its number of
business fields. No form-management permission is granted by this selection.
Draft/live save, activation and unsaved guided preview validate category support,
current form entitlement and same-tenant published ownership. The selected form's
current published version is used. Publishing a different form does not redirect
this profile. An unavailable selected form or revoked form entitlement contributes
no form facts and never substitutes another form. Existing automatic profiles are
unchanged until an operator explicitly selects a mode.

Guide, AI/Hybrid fact loading, lead-capture facts and both preview paths receive
the same profile configuration. Public URLs are generated from the approved
platform origin and selected tenant/form slugs; callers cannot submit a URL.
Selection is profile-local and uses its existing optimistic revision controls.
A selected form can contain tenant-defined typed questions from the preceding
form increment. Saved FAQ/reply text and legacy Automation Flows retain their own
links; this setting restricts catalogue facts, not arbitrary authored content.
It does not add direct free-text conversational field collection or expose Forms
to unsupported categories. The adapter is explicitly Training Center v1 pending
reviewed generic form/pack adoption.

Verification: 54 focused checks and eight actual editor browser fixtures across
EN/AR, desktop/mobile and selected/disabled modes pass. Real shared-auth/MariaDB
integration passes all 113 migrations and cookie/bearer creation/list/update,
independent profiles, selected/disabled guided preview, real foreign-tenant form
rejection and unavailable-form suppression. No customer profile, assignment,
provider send or configuration adoption is used for verification.

Remaining form integrity gate identified during tracing: the public submission
service selects the current published version at submit time, while the rendered
client does not submit an expected form version. A publication between rendering
and submission can therefore cause rejection or attribute unchanged answers to
newer labels/consent. Add a backward-compatible expected-version handshake and
explicit reload/review error before claiming full immutable visitor acceptance.
This gate is separate from profile-local form routing and remains open.

Rollback after explicit selection must retain the selection adapter. An older
runtime ignores the property and may resume automatic catalogue choice. Before
adoption, the exact previous release/image is safe; after adoption use a compatible
repair image, or explicitly review profile configuration rollback while preserving
submitted form/lead history. Never silently erase selected references.

Production verified 21 October: `76e3c5b` plus loader correction `88fc425` are live in `bot-capture-forms-88fc425-20261020`. Runtime/public hashes and health pass. Nine deployed paths are synchronized locally with backups; zero customer profiles adopted explicit selection. See DEPLOYMENT.md.
