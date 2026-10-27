# 7Network product vision and roadmap

Owner-approved direction: 27 October 2026. Status: strategic roadmap, not evidence of shipped functionality or authorization to deploy every phase.

## Product promise

**A customer can sign in, describe a requirement, receive relevant proposals and permitted calls, select businesses, and track the work through completion. Businesses use the same platform to manage the activities, leads, teams, orders and collections needed to deliver it.**

7Network grows into a connected business operating and fulfilment network for individuals and organisations. Start with Qatar, English/Arabic and existing category infrastructure; expand through verified industry workflows. Training centers, real estate, clothing wholesale and retail, electronics, restaurants, groceries and supermarkets are target categories. Additional categories follow demand and operational readiness rather than a commitment to build everything simultaneously.

There are three connected experiences:

- **Customer:** post and clarify requirements, control visibility and contact preferences, compare proposals, communicate, accept an offer, track delivery, resolve issues and confirm completion.
- **Business:** manage its own leads, communications, people, inventory or service capacity, tasks, sales, fulfilment and financial workflows appropriate to its category.
- **Network:** match requirements to eligible businesses, coordinate consented referrals and multi-business work, and measure delivery outcomes without exposing private tenant data.

“Complete for anyone” is the long-term direction. Each released category must state which workflows it actually supports. Do not describe an incomplete vertical as a complete ERP, accounting system or marketplace.

## Relationship to the current program

This roadmap extends the existing application; it does not replace it or reduce the full 42-ticket program. Read `7NETWORK_TRAINING_CENTER_IMPLEMENTATION_PLAN.md`, `IMPLEMENTATION_STATUS.md`, `UNIFIED_FEATURE_API.md` and `7NETWORK_REBRAND.md` with this document. `DEPLOYMENT.md` remains the production ledger. Historic plan documents retain their original acceptance criteria; this document owns the subsequent network vision.

Preserve the existing admin, business and agent entry points, shared session/context adapter, current Manage Plans catalogue, assignment history and existing screen integrations. Add the future customer-facing experience as an integrated product surface using reviewed shared identity and API contracts. A new customer journey does not authorize a replacement CRM, duplicate business login or unrestricted customer access to business APIs. An individual may be both a customer and a member of a business; switching context must be explicit and permission checked.

## Customer-to-business lifecycle

1. A customer signs in and posts a requirement with category, description, location/service area, timing, optional budget and private attachments. Support text first; voice/image assistance is a later enhancement with review before submission.
2. The customer chooses visibility, eligible audience and contact preferences. Match on actual service capability, area and availability; make eligibility and ranking understandable.
3. Eligible businesses receive a tenant-scoped opportunity. Assignment, follow-up and communication reuse the existing pipeline/inbox/task services. A customer requirement and each business's private lead remain distinct, linked records.
4. Businesses submit versioned proposals with scope, price/currency, assumptions, validity, availability, exclusions and delivery terms. Customers compare and clarify them without revealing competitors' private quotations or business notes.
5. Customers permit contact from selected businesses or a bounded eligible group, choose channels and times, and can revoke permission, mute, block or report. Support the owner's goal of receiving proposals and calls from businesses through these controls. Do not broadcast customer phone numbers to every tenant or treat posting as unlimited marketing consent.
6. Acceptance creates a recorded commitment with agreed scope, milestones and responsible parties. Handle withdrawal, expiry, cancellation, revised offers and conflicting acceptance explicitly. Stock/capacity reservations and financial changes require transactional checks and retry-safe operations.
7. Track work, orders, documents, delivery evidence and issues. Confirm payment only from authoritative verification, independently of delivery status. Provide completion, complaints/disputes and refund workflows appropriate to the category and payment integration.
8. Collect verified outcome feedback. Allow repeat requests and consented referrals. Later, a customer goal can comprise multiple businesses, each with its own accepted scope and visible responsibilities.

## Architecture direction

Keep the maintained application and shared services. Prefer clear module boundaries before considering independently deployed services; do not introduce microservices solely for the vision.

- **Shared foundation:** identities/memberships, tenant and customer context, entitlements, contacts, inbox/channels, tasks, documents, notifications, audit, localization, theme and browser API client.
- **Network domain:** customer requirements, audience/contact grants, invitations, matches, proposal revisions, acceptance, fulfilment milestones, referrals and disputes. Define tenant/customer visibility for each entity and API.
- **Vertical domains:** real-estate listings/viewings; apparel variants, wholesale price tiers and retail orders; electronics specifications, serials/warranties and installation; restaurant menus/modifiers, kitchens and ingredient requirements; grocery units, substitutions, batch/expiry and replenishment. These are candidate capabilities, not implemented features. Do not force them into one untyped generic record.
- **Financial boundaries:** distinguish quote, order, invoice, payment, refund and partner commission. Reuse verified finance services where appropriate; new commerce semantics require reviewed contracts. Initial partner fee reconciliation may be manual. Holding funds, escrow or automated payouts requires separate commercial/provider/legal decisions.
- **Documents:** private storage, stable metadata/object references, tenant/customer access rules, upload validation and quotas, signed delivery where appropriate, retention/deletion policy, independent backup and restore verification. Provider choice is a separate decision; an object bucket alone is not a backup.
- **Reliable execution:** transactional invariants for stock, capacity and acceptance; durable jobs/outbox where required; idempotency, bounded retries, audit and reconciliation. Record provider acceptance separately from actual message or call delivery.
- **Interoperability:** versioned category contracts and typed APIs allow later POS, payment, supplier and logistics adapters. Keep third-party credentials and customer data outside Git.

## AI direction

Build business-scoped AI assistance and customer requirement assistance on validated services. Models may extract requirements, read permitted files, translate, suggest matches, draft proposals, identify missing information and prepare plans. AI does not become the authoritative source of price, stock, entitlement, accounting or delivery evidence.

Select models by measured quality, Arabic/English performance, latency, cost and data handling. Keep provider adapters replaceable; do not pin the vision to a model brand or an unverified claim of “best.” Before adding API-backed AI, follow the applicable credential/setup workflow.

Use the sequence: draft/suggest, supervised tool actions, then narrowly delegated execution after evaluation. Tool calls enforce the current actor, tenant/customer scope, consent, spending/action limits and approval requirements server-side. Revocation stops future actions. Treat messages, files and supplier content as untrusted input, including prompt-injection attempts. Keep tenant knowledge/retrieval isolated; no cross-tenant training or retrieval by default. Record model/tool costs and failure/handoff evidence without logging unnecessary personal data.

## Dependency-based delivery roadmap

No dates, budgets or launch claims are implied. Break phases into separately reviewable increments; phases may overlap only where dependencies and acceptance evidence permit.

| Phase | Deliverable | Exit evidence |
| --- | --- | --- |
| R0: dependable operating foundation | Complete existing 42-ticket obligations; reconcile source/live status, permissions, shared APIs, finance/provider gates and storage recovery | Existing-screen authenticated acceptance, role/tenant denial, EN/AR, recovery and release evidence; unresolved gates remain visible |
| R1: customer requirement pilot | Integrated customer identity/context, requirement posting, audience/contact controls, business opportunity handoff, proposals and completion in one ready category | Synthetic and consented pilot covers posting through completion, duplicate/concurrent acceptance, contact revocation, abuse and denied access |
| R2: repeatable vertical operations | Expand categories one at a time with the domain workflows businesses need to fulfil accepted requests | Each category proves an end-to-end operating workflow, existing feature preservation and its own data/finance/fulfilment invariants |
| R3: partner exchange | Consented referrals, partner requests/quotes, responsibility tracking and referral accounting | A small trusted partner cohort repeatedly completes work; attribution, disputes and data boundaries verified |
| R4: evaluated AI operators | Requirement extraction, business assistance and supervised coordination; selectively bounded automation | Representative EN/AR evaluations, permission/prompt-injection checks, tool correctness, cost limits and human handoff evidence |
| R5: coordinated customer goals | Multi-business proposals and fulfilment; later aggregate compatible demand with consent | Proven single-business/partner journeys, customer-controlled sharing, scoped commitments, failure recovery and measurable value |

Training Center is the initial operating foundation. Real Estate has an incomplete source slice documented in the status ledger. Clothing wholesale-to-retail is a candidate first supply relationship, not an already approved build order. Choose the next category using customer demand, reachable pilot businesses, integration effort and a complete achievable workflow.

## Responsive, theme and PWA delivery contract

Apply this contract to every new screen and materially changed screen/component. Prioritise the affected user journey; do not require an unrelated whole-application redesign for a narrow fix. Record inherited limitations and follow-up work honestly.

- Reuse maintained shared components, shell, spacing, typography and semantic theme tokens. Support light and dark themes, persisted user preference and system preference where supported; avoid hard-coded light-only colours, unreadable controls and theme flashes. Use approved theme-specific brand assets.
- Design for phone, tablet and desktop. Verify representative widths of 360, 390, 768, 1024 and 1440 CSS pixels, plus 320 pixels for reflow-critical views and 200% text/zoom where applicable. These are verification samples, not fixed layout breakpoints; adapt to content.
- Prevent page-level horizontal overflow, clipped actions, overlapping drawers, broken alignment and fixed-width dialogs. Use fluid grids and logical CSS properties; check LTR English and RTL Arabic, long names, large numbers and mixed-direction phone/currency strings.
- Preserve important actions and information on mobile. Tables may use prioritised columns, detail views, cards or a clearly contained accessible scroll region. Do not hide essential data merely to fit the viewport. Test nested scroll, safe-area spacing, keyboard appearance and sticky controls.
- Provide touch-friendly targets (aim for at least 44 by 44 CSS pixels), keyboard operation, visible focus, labels, readable contrast and status information beyond colour alone. Handle loading, empty, error, denied, disabled, validation, success and retry states.
- Remain usable in a PWA/standalone viewport: routing/deep links, back navigation, installation metadata and assets when touched, reconnect/session expiry and resumable user intent. PWA-ready does not mean all business actions work offline. Offline sends/purchases/payments must never appear confirmed; queue only explicitly designed retry-safe actions.
- Service workers must not cache private API responses, attachments or another user's data indiscriminately. Verify logout/account switching and update/cache-version behaviour when PWA caching changes. Request notification/camera/microphone permissions only when a user invokes the relevant feature.
- Verify the actual maintained screen with screenshots/browser evidence in both themes, EN/AR and representative viewports. Exercise supported owner/staff/customer roles and credential modes where relevant. Report tested combinations and gaps; do not claim full visual acceptance from source tests alone.

## Planning and completion rules

For an upgrade, identify the user outcome, roadmap phase, existing module to extend, data/permission boundaries, responsive/theme/PWA effects, dependencies, verification and rollback. Keep this proportional: a small fix needs a short rationale; a new vertical needs a design and acceptance plan. Maintenance, security and reliability work are valid roadmap work without inventing marketplace features.

Record new work as **planned**, **source implemented**, **tested**, **deployed**, or **accepted**, with evidence. Update `IMPLEMENTATION_STATUS.md` for delivered increments and `DEPLOYMENT.md` for production changes under the required production skill. Never replace current release gates with this strategy document. This roadmap is guidance for future authorised work, not permission to send calls/messages, expose data, take payments or deploy unrelated changes.

Measure completed requirements, relevant proposals/time to first proposal, acceptance and fulfilment rates, complaints/unwanted contacts, repeat use, business response effort, recovered sales, cost per completed requirement and reliability. Separate observed measures from estimates; signups and AI message volume alone do not establish product value.
