# 7Network scalable CRM customization and isolation

> The current platform brand is **7Network**. Existing source identifiers, routes and schema names retain their historical SaleMaX spelling until a separately reviewed compatibility migration is appropriate.

Evidence review: 20 October 2026. Status: implementation in progress. This extends the existing 42-ticket program; it does not replace its acceptance criteria.

## Product decision

Keep one maintained SaleMaX application, current logins and panels, and shared messaging/CRM services. Treat a business as the tenant; its staff are members, not separate customization owners. Compose its experience from explicit core capabilities, a versioned category contract, an assigned plan, a published tenant configuration, and member permissions. A clinic cannot obtain Training Center courses just by changing a menu label. Two training centers must be able to use different fields, stages, forms, bot content, branding, automations, and enabled modules without editing each other's settings.

Configuration isolation can prevent one business's settings affecting another. It cannot guarantee that a defect in shared application code never affects other businesses. Version pinning, gradual rollout and contract tests reduce that blast radius; dedicated deployment stamps and resource isolation are the stronger option for customers needing separate runtime failure boundaries. Do not sell an absolute guarantee of zero shared-code impact.

## Training lifecycle boundary correction — 21 October 2026

The existing Training Center learner-progress reconciler can move won Pipeline leads through invoice, payment, course and certificate stages. It now requires the authenticated actor's registered category to be `training_center` before it reads or updates those records. All shared Pipeline entry points pass the category, and the service rejects known other categories before opening a database connection. Unmapped legacy workspaces retain their prior behavior pending explicit adoption. This closes a cross-category stage mutation path; it does not make the rest of the legacy Pipeline data model category-aware or complete the separate domain workflows. Focused service/registry/category tests pass; full route/report and authenticated customer acceptance remain separate gates.

## Confirmed source findings

| Area | Owning source | Current finding and consequence |
| --- | --- | --- |
| Category contracts | `modules/platform/categories.js` | Training Center used all registered policy capabilities except four. New features could silently expand an existing category. The first implementation pins explicit lists and freezes titles. |
| Historical assignments | Same source | Training Center v1 already includes `sales.finance` and `hr.recruitment`. Pinning preserves that historical contract; removing these requires a reviewed successor version and assignment impact review, not silently editing customer rights. Recruitment handlers independently check the Sales category. |
| Authorization | `modules/platform/policy.js` | Category, active subscription, member scope, tenant resource ownership and external readiness are separate gates. Retain these gates; a configurable screen must not grant permission. |
| Shared feature authentication | `modules/platform/business-feature-session.js` | Resolves legacy users/agents to canonical tenant membership and entitlements. Unmapped legacy actors can retain a null canonical context; a base-category migration must preserve those working users through verified ownership mappings. |
| UI feature contract | `modules/platform/feature-contract.js` | Existing session module keys and permission names are a curated compatibility API. Catalogue selection now resolves from the pinned category adapter, but arbitrary category modules still need reviewed server navigation, API and client adapters. |
| Plan administration | `modules/platform/existing-catalogue-router.js` | Manage Plans now enumerates reviewed planable registry entries and looks up an explicit category version. The original version-1 default is retained for old callers. Adding a manifest alone still does not deliver a new category workflow. |
| Bot editing/runtime | `modules/platform/chatbot-router.js`, `chatbot-domain-packs.js`, `modules/platform/chatbot-runtime.js` | Reusable typed guided-content schemas, tenant/category-bound profiles, and manifest-declared lead-capture adapters exist. Runtime must select reusable behavior from the exact registered category contract; keep genuinely private workflows such as recruitment explicitly scoped. |
| Navigation | `modules/platform/navigation.js` | Server decisions determine visible modules. Configured visibility must remain a restriction over authorized routes, with matching API enforcement. |
| Frontend recovery | Existing implementation plan | Maintained screen hooks coexist with a generated legacy frontend. Extend the existing screens; do not manually edit minified logic or introduce another panel. |

This is a targeted architecture assessment, not an exhaustive proof of every query, queue, websocket or legacy route. The verification ledger below defines the remaining work.

### Tenant-isolation and real-estate interoperability research — 21 October 2026

OWASP's current multitenant security guidance recommends deriving tenant context from verified identity/membership, enforcing ownership at every access path, including tenant identity in tenant-varying caches and quotas, authorizing async consumers, and testing cross-tenant denial through the ordinary request role. These reinforce the current service pattern: the browser never selects `tenant_id`; the shared authenticated feature session supplies tenant and membership, and the property service keeps tenant predicates in every query. They also add explicit backlog gates for tenant-scoped cache/media/queue coverage, offboarding retention and tenant-only restore testing. See the [OWASP Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html).

RESO's live Data Dictionary page identifies DD 2.0 as active for certification and DD 2.1 as a draft; RESO Web API Core is a REST/OData interoperability contract centered on the Data Dictionary, and RESO states that it publishes standards rather than MLS listing data. For 7Network, keep the internal property model typed and business-oriented, then build a separately versioned mapping/transport adapter if a customer later needs MLS exchange. Do not force the CRM's internal lifecycle or custom fields to masquerade as RESO lookups, and do not promise listing data access without the relevant local MLS/provider agreement. See the [RESO Data Dictionary](https://dd.reso.org/), [RESO Web API specification](https://transport.reso.org/proposals/web-api-core/), and [RESO Web API overview and access FAQ](https://www.reso.org/reso-web-api/).

## Read-only production adoption baseline — 21 October 2026

The aggregate-only `scripts/audit-tenant-adoption.cjs` preflight runs inside a
read-only transaction and emits no tenant IDs, names, account identifiers,
credentials or contact details. Its live production result confirms three active
tenants: one SaleMaX Sales v1 and two Training Center v1. There are three current
plan assignments; all three resolve to an existing plan version with the exact
tenant category and version. No Base CRM tenant is currently assigned, so the
new Base CRM capture adapter has not yet had a real-tenant screen or channel
acceptance.

Seven legacy `user` records map to active canonical memberships, identities and
tenants (three owners, two accountants, two managers), with no unmapped rows,
UID-hash mismatches or inactive links. Eleven current legacy agents map to active
agent memberships. Two additional active legacy agent rows have no ownership
mapping, and neither agent's `owner_uid` matches a current legacy user record.
The ownership table also retains six agent mappings whose legacy source
rows no longer exist; all retained mappings have a membership reference. These
two active agents must remain on their existing legacy path until an operator
reviews their owner relationship. Do not infer a category or backfill them from
their `owner_uid` alone. The report is aggregate preflight evidence, not an
authorization to mutate account ownership.

The audit has two focused unit checks and was run against the live MariaDB
through a temporary copy in the app container. It completed read-only and the
temporary files were removed. No production code, tenant, membership, plan or
customer record changed. Re-run this audit before any legacy-category adoption,
then require a reviewed mapping manifest and a before/after count/hash report.

## Research and application to SaleMaX

AWS distinguishes pooled, silo and bridge isolation models. SaleMaX can keep pooled infrastructure for ordinary tenants while introducing dedicated resources where a customer's requirements justify them. Authentication alone does not replace application-level ownership checks. See [AWS isolation concepts](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/core-isolation-concepts.html) and [bridge model](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/the-bridge-model.html).

Microsoft describes deployment stamps, feature flags, and rollout rings as complementary ways to control multitenant updates, and calls for visibility into the version each tenant uses. The proposed SaleMaX control plane therefore records active category/config revisions and rollout state; feature flags select tested behavior but never substitute for entitlements. See [multitenant update guidance](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/updates).

These are architectural inputs, not a recommendation to migrate SaleMaX to AWS or Azure. Keep the existing Node/Express and MariaDB stack while strengthening its boundaries.

### Current multitenant rollout guidance refresh — 21 October 2026

The current AWS SaaS Lens continues to describe pooled, silo and bridge tenancy as choices that can be combined by service or workload; a dedicated database or application is an isolation tradeoff, not a requirement for every category. Microsoft’s current multitenant guidance explicitly separates temporary feature rollout from commercial entitlement and warns against hand-built tenant-specific deployments. Its update guidance also calls for support visibility into each tenant’s deployed version and rollout ring. See [AWS SaaS Lens: silo, pool and bridge models](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html), [Microsoft: multitenant deployment and configuration approaches](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/deployment-configuration), and [Microsoft: multitenant update considerations](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/updates).

For 7Network, this supports one shared application and identity/control plane, immutable category adapters, tenant-published configuration stored as tenant data, and existing plan entitlements as the commercial gate. Rollout rings may select a reviewed code version for a cohort, but neither a ring nor a tenant setting may grant a paid capability. Dedicated deployment stamps remain an operational tier for measured isolation needs; they must retain the same onboarding, support, audit and release controls. This confirms the existing architecture decision rather than changing provider, database or hosting choices.

### Deployment and data-boundary decision — 21 October 2026

The vendor guidance supports a progressive isolation model rather than one deployment or database per category. AWS describes pooled, silo and bridge partitioning; bridge lets a service choose a tenant-specific partition while retaining a shared application. Microsoft recommends explicit tenant configuration and staged update rings, with tenant-visible version state. For SaleMaX, keep the current pooled release and tenant-keyed data path as the default; introduce a bridge boundary only for a measured workload, residency, contractual or failure-isolation need. A category or customer configuration must not select arbitrary code, a database name, or a release image. A dedicated stamp is an operational isolation tier with an audited control-plane assignment and a tested migration/restore path.

Apply rollout rings to code compatibility, not commercial access: category capability, paid entitlement, tenant module enablement and member permission remain independent runtime gates. Record the running release and active category/configuration revisions for each tenant so support can identify whether a defect follows shared code, a category contract, or one tenant's published settings. Roll out first to synthetic tenants, then internal tenants, then a bounded customer cohort; retain a tested rollback image and backward-compatible readers during the adoption window. Feature flags may select a reviewed implementation, but they cannot grant a plan feature or relax tenant authorization.

For bot collection, reuse the existing tenant-published Forms workflow as the authoritative schema, consent surface, typed validation and answer store. The existing bot profile may select a same-tenant published form; its runtime facts expose only that form's approved public URL and metadata. Bot answers should land through the versioned form submission service, which already rejects a stale rendered form version. Do not create a parallel conversation answer store until product requirements require truly conversational collection. If that later becomes necessary, pin the form/configuration revision per conversation, obtain clear consent before storage, support decline/skip and a durable stop, and route the answer through the same typed lead-field contract. Raw answers must bypass AI prompts and logs, and category packs must explicitly decide which fields are appropriate. Recruitment is a separate private workflow and must not inherit general-purpose lead questions.

This decision reduces duplicate schema and consent logic and makes an answer's form version auditable. It still leaves generic form/category adapters and authenticated live bot-to-submission acceptance open; selecting a form in the editor alone does not prove that a real channel delivered or submitted it.

Sources: [AWS SaaS partitioning models](https://docs.aws.amazon.com/whitepapers/latest/multi-tenant-saas-storage-strategies/saas-partitioning-models.html), [AWS bridge isolation model](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/the-bridge-model.html), and [Microsoft multitenant deployment and configuration guidance](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/deployment-configuration). These inform deployment boundaries and staged rollout; the SaleMaX choices above are architecture decisions based on the repository's current tenant and Forms contracts.

## Contract layers and precedence

1. Core: maintained inbox, QR/Meta adapters, flow executor, templates, campaigns, contacts, tasks, identity and audit. A category chooses reviewed core capabilities explicitly. A category-less legacy business keeps its original feature contract until reviewed mapping to a base category; do not auto-provision it into Training Center.
2. Category: immutable `{key, version}` module contracts, domain data model, typed defaults, available workflow handlers, navigation contributions, form/entity schemas and bilingual labels. Published versions are never overwritten. New module registration does not automatically enable old categories.
3. Commercial assignment: existing plan IDs and compatible adapters remain authoritative for the sold capability set and limits. No duplicate plan catalogue. A category contract does not automatically grant paid features.
4. Tenant configuration: immutable published revisions pinned to one tenant, category version and schema version. Typed permitted overrides include labels, optional fields, stage settings, guide copy, layout choices and registered workflow bindings. No arbitrary JavaScript, SQL, server paths, class names or unrestricted HTML.
5. Membership: owner-managed roles, scope and navigation further restrict the effective contract. A staff preference cannot change company-wide configuration or increase its privileges.

## Category-declared bot-to-Pipeline lead capture — 21 October 2026

Category manifests now declare a reviewed chatbot lead-capture adapter. `base_crm@1` uses the shared generic Pipeline adapter, `training_center@1` retains its established learner/course enrichment, and `salemax_sales@1` explicitly disables generic lead capture so candidate applications stay in their dedicated workflow. Unspecified/future categories default to `none`; adding a category cannot silently start creating leads.

For Base CRM, lead creation is a per-profile owner choice in the existing Chatbot editor. It defaults off, is displayed only when the current owner context has the active matching `crm.leads` plan entitlement, and is checked again by both the write API and inbound runtime. When enabled, existing Pipeline identity locking, inbound-event idempotency, tenant owner UID scope and contact association create or update the lead; no raw message is copied into a new qualification store. The original message remains in Inbox. No migration or customer bot configuration change is involved.

This closes shared lead capture for the category-neutral base contract, not generic conversational collection of each tenant's custom fields. Those answers still use the published Forms route until a separate category-approved conversational schema, consent and stop/skip design is implemented. Tests cover category adapter immutability/validation, plan denial, opt-in/default-off behavior, Sales/Training denial and the adapter's passed data; live browser, MariaDB integration and provider acceptance remain release gates.

## Manifest-driven chatbot training adapter — source update, 22 October 2026

The registry already permits a reviewed category to declare the reusable
`chatbotLeadCapture: training` adapter, but the runtime had three remaining
`training_center` key comparisons for guided onboarding, lead enrichment and
capture. Those checks now use the pinned category manifest property. A
synthetic future category proves the shared adapter can be selected without
adding a category-name branch, while Base CRM and Sales remain excluded by their
own adapter declarations. This does not add or publish a new category, change
the Sales recruitment workflow, or collect additional customer data. The
focused registry and chatbot capture checks pass 8/8; full chatbot, authenticated
channel, MariaDB and provider acceptance remain open.

Effective access is the intersection of category capability, plan entitlement, enabled tenant configuration, member permission/scope and runtime readiness. Restrictions accumulate. Tenant overrides cannot change `tenant_id`, category identity, subscription rights, audit requirements, resource ownership checks or accounting invariants. Missing/invalid configuration must produce a controlled error or a specifically versioned compatibility default; never fall back to another tenant or arbitrary category.

## Configuration persistence and publication design

Extend existing Business Settings and platform Manage Users. Introduce reviewed migrations for tenant configuration drafts/revisions plus an active revision pointer. Store tenant ID, category key/version, schema version, module key, canonical validated JSON, checksum, revision number, creator and timestamps. Published documents are immutable. Every lookup/update includes authenticated tenant ID, even when revision IDs are globally unique.

Publishing validates every key against the category's schema, checks module dependencies and plan rights, compares an expected revision atomically, and writes the new active pointer and audit event in the same transaction. Preview uses the draft without affecting the active tenant. Rollback selects a previously validated compatible revision through the same audited operation. Resetting a field restores that tenant's pinned default; it does not mutate the category default. Concurrent edits return a conflict and preserve the winning revision.

Cache key: tenant ID + category key/version + configuration revision + relevant module schema version. Never cache effective settings by category alone. Resolve the tenant from authenticated context; domain routing identifies the intended tenant but does not authorize access. Background jobs retain tenant ID and explicit execution/version semantics. Idempotency keys include tenant ID. Workers recheck suspension, revocation and provider readiness before external effects.

## Extensibility and domain boundaries

| Category | Candidate modules, subject to implementation and acceptance |
| --- | --- |
| Base CRM | Shared conversations, contacts, pipelines, automations and templates; no course or clinical defaults |
| Training Center | Courses, batches, enrollments and existing collections workflow |
| Sales | Products/services and its deals, commissions and Sales finance contracts; private first-party recruitment stays explicitly scoped |
| Real estate | Properties, owners, buyer/tenant requirements, viewings and listing-specific pipelines |
| Dental / clinic | Appointments, practitioners and service catalogue first; patient records require separately designed sensitive-data access and retention boundaries |
| Retail / supermarket | Product variants, stock movements, suppliers and POS integration; inventory is a ledger with concurrency control, not a renamed course table | Retail has a private, non-planable inventory ledger slice in source; variants, purchasing, suppliers, POS and supermarket workflows remain pending |
| Hotels | Rooms, availability, reservations and rate rules; allocation/overbooking needs database invariants |
| Restaurants | Menu, modifiers, orders, tables and kitchen workflow; the existing restaurant fixture is a test fixture, not this implementation |

Use dedicated tables and services for domain invariants. Use bounded, typed custom fields for customer-specific metadata and indexed promoted fields for important search/report dimensions. Do not store invoices, stock balances, medical records, or reservation constraints in an unrestricted JSON entity table. Reference another module through tenant-constrained foreign keys or validated service boundaries; category labels do not change financial meanings.

### Qatar clinic and dental data gate — 22 October 2026

The current official Qatar privacy materials materially change the clinic launch sequence. The National Cyber Security Agency's version 3.0 Special Nature Processing Guidelines identify health, physical condition, psychological condition and children's data as special-nature personal data. They direct controllers to document a permitted reason and an additional processing condition, complete a DPIA, and obtain the required permission before that processing begins; a permission is tied to the stated purpose and changed processing requires review. The underlying [Law No. 13 of 2016](https://almeezan.qa/EnglishLaws/132016.pdf), [NCSA Special Nature Processing Guidelines v3](https://ncsa.gov.qa/shared/document_library/94787172324409/33000/8880/1.0~be43a21b-0e16-448e-8a54-7c58963f421e?filename=Guidelines-for-Special-Nature-Processing-EN-v3.pdf&mimetype=application%2Fpdf), and [NCSA permissions process](https://www.ncsa.gov.qa/en/pages/special-nature-permissions-request) are the primary references.

The Ministry of Public Health's [DHP Circular DHP/2024/12](https://dhp.moph.gov.qa/en/QCHPCirculars/DHP-2024-12-E.pdf) assigns private healthcare facility medical directors responsibility for confidential patient files, access limited to authorized personnel, reliable patient-centred documentation and legally required retention. This is a healthcare-facility duty; the CRM must support it without representing that software alone makes a clinic compliant.

Product boundary: do not enable a clinic/dental category for customer onboarding or plan assignment, and do not route patient data through generic lead custom fields, public Forms, FAQs, chatbot prompts, WhatsApp automation, analytics or ordinary support logs. Even an appointment linked to a named clinic may reveal a health relationship, so treating appointment data as ordinary contact data would be an unsafe assumption. The precise legal classification and the respective controller/processor roles require review for the actual processing and customer contract; this is a conservative product decision, not a legal conclusion.

Before a clinical module is planable, require a reviewed controller/processor and purpose map, customer-provided lawful basis and special-nature permission evidence where applicable, DPIA and processing record, data-subject/access/retention procedures, and a distinct clinical data path with purpose-scoped roles, auditable access, tenant-bound storage and backups, private file handling, and explicit exclusions from AI/provider payloads. The initial module should have no diagnosis, treatment notes, medication, images or free-text clinical fields until those gates are complete. This is stricter than making the category private: private only hides onboarding; it does not make an unapproved processing path safe.

## Real Estate v1 implementation slice — 21 October 2026

The first domain slice is a private `real_estate@1` contract and a tenant-scoped listing service in the existing `/user` panel. It introduces a typed property table instead of reusing training courses or generic custom-field JSON. Each listing has bilingual titles/descriptions, property and transaction types, explicit lifecycle states, price/currency, area, room counts, city, revision, an optional assigned membership and actor audit events. Query predicates include the authenticated tenant on every listing read and mutation. Edits lock the tenant/listing row, require an expected revision, validate lifecycle transitions, and write the audit event in the same transaction. Sold/rented listings are immutable except for archival, and archived records stay immutable so archival cannot reopen edits to a completed transaction; hard deletion is not exposed. Owners and managers can see tenant inventory; managers assign listings only to active agents in their current team. Agents see only listings assigned to them; team leaders see their own and their current team's assigned listings. The assignment foreign key includes tenant identity, stale/out-of-team assignees are rejected, and custom permissions cannot widen these scopes.

The category is `public:false` and `planable:false`; it is deliberately absent from customer plan selection while the workflow is incomplete. `realestate.listings` is a distinct entitlement and is independently gated by category version, active subscription, role permission and assigned navigation. Thirty focused unit/policy/migration/HTTP tests pass, and a disposable MariaDB run verifies manager-team assignment, agent and team-leader visibility, cross-tenant assignment denial, concurrent revision writes and audit rollback. This establishes a vertical-module pattern, not a claim that the full category or multi-tenant acceptance is complete. Buyer/tenant requirements, owners, viewings, listing pipelines, search ranking, media uploads, RESO mapping, bilingual browser/device review and authenticated existing-panel acceptance remain open before plan publication or production migration.

## Isolation beyond database reads

- All canonical repositories require tenant context and tenant predicates on reads, writes, joins, exports and deletes. Review raw legacy UID ownership adapters rather than assuming canonical guards cover them.
- Tenant-owned child relations need composite tenant/parent keys or transactional ownership validation. Globally unique IDs alone are insufficient.
- Cache entries, websocket rooms, uploaded files, signed media grants, search indexes, vector stores, provider credential lookups and generated reports carry tenant identity. Shared bot defaults are immutable; tenant guide edits and conversation state are not process-global mutable objects.
- Apply per-tenant queue concurrency, upload/storage bounds, report limits and provider budgets. One large customer must not monopolize the shared database or external send workers. Size limits need measured workloads and query plans, not invented capacity claims.
- Secrets remain outside tenant configuration JSON and Git. Only reviewed secret references reach provider adapters. Logs include correlation and tenant identifiers with redacted business content.
- Separate tenant migration, configuration publication and code deployment. Expand/contract migrations preserve older readers until adoption completes. Backups and restore tests cover database records and private media consistently.

## Implementation and verification ledger

| Workstream | Required evidence | State |
| --- | --- | --- |
| Explicit category contracts | Future capability injection cannot change existing category lists; immutable metadata; preserve v1 assignments | Deployed in category-registry-6d5c2ef; authenticated UI acceptance pending |
| Registry/adoption | Version-aware Manage Plans and Manage Users, permissions, impact mapping, category rollout/rollback | Validated immutable registry, Manage Plans version selection/listing and provisioning version propagation implemented; tenant adoption/mapping and UI acceptance pending |
| Tenant configuration | Migrations, validated draft/preview/publish/rollback APIs, transactional audit and optimistic concurrency | First typed schema (navigation labels) deployed as tenant-customization-10354f7 after MariaDB isolation tests; broader schema/module settings pending |
| Existing settings UI | Authenticated owner/staff EN/AR desktop/mobile, clear errors and permission denial, old settings preserved | Existing CRM appearance editor supports bilingual labels, typed lead fields and schema-3 tenant-only hidden menu sections; browser rerun and live acceptance pending |
| Effective runtime settings | Shared resolver adopted by real screens/APIs/workers; tenant revision cache invalidation | Published labels and hidden menu sections flow through the shared workspace session and legacy sidebar-access contract; API permissions remain independent; other modules/workers pending |
| Legacy/base CRM | Inventory legacy modules and ownership, approved mappings, no forced Training Center assignment | Pending |
| Bot/flow customization | Two tenants of same category produce different responses, other category unchanged, state/cache isolation and real channel acceptance | Partly existing; broader proof pending |
| Data and media isolation | Cross-tenant adversarial API/queue/socket/media tests with disposable database fixtures | Pending comprehensive audit |
| New categories | Real estate, clinic, retail, supermarket, hotel and restaurant domain modules integrated in existing panels | Real Estate has a private, non-planable typed listing slice in source; category workflow and migration acceptance remain incomplete. Retail has a private, non-planable tenant-scoped inventory ledger in source; category workflow and migration acceptance remain incomplete. Clinic/dental is gated on official Qatar special-nature processing controls; supermarket, hotel and restaurant modules remain pending. Adding names to a dropdown is not delivery. |
| Operational scale | Measured tenant load/fairness, recoverable backups, restore drill, rollout rings and health telemetry | Pending |
| Publication | Verified source push, targeted production backup/deploy, hashes, API/browser acceptance and deployment record | Category foundation deployed. Real Estate and Retail source slices are not deployed and their migrations are not applied; tenant configuration, broad category isolation and the full objective remain in progress. |

Acceptance requires a matrix covering two businesses in the same category, two different categories, and an unmapped legacy business. Change A's draft, publish it, run its workflow, revoke permissions and roll back; B's active revision, visible modules, API decisions, bot content and stored data must remain unchanged throughout. Also cover concurrent publish, malformed/unknown fields, unsupported category version, expired plan, cross-tenant ID substitution, stale worker/cache state, migration failure and partial provider failure. Fixtures cannot stand in for authenticated existing-screen verification.

The first foundation deliberately preserves Training Center v1's two historical extra capabilities. A successor contract should remove those only after actual plan/subscription usage is reviewed and mapped. That remaining mixed legacy contract is an explicit release gate, not a solved issue.


## Registry and explicit version integration — 20 October 2026

The reviewed-source registry rejects duplicate key/version pairs, unknown capabilities, invalid role lists and malformed metadata. It copies/freezes each manifest; exact lookup never substitutes a newer version. Existing category exports retain lookup identity. Planable entries feed the original Manage Plans context; private categories retain category-admin authorization and fixtures remain excluded.

Manage Plans selectors now identify a category by key and version, include both in list requests and use the selected definition when drafting. Catalogue listing filters both database columns. Provisioning options, previews and writes propagate the selected version rather than forcing v1; the existing Manage Users form sends the version returned by its options API. Legacy requests default to v1. Historical v1 provisioning idempotency hashes remain unchanged; later versions include the explicit version. No successor category is registered or assigned by this increment.

Fifty focused tests pass, including HTTP authorization/listing requests, malformed and unavailable versions, synthetic future registry versions, immutable input isolation, prior policy, provisioning, existing-screen contracts and chatbot domains. The local shared Express dependencies stalled on module loading; HTTP checks used a disposable `/private/tmp` dependency installation with Express 4.21.2. Production dependencies were unchanged. Rendered/authenticated EN/AR UI acceptance, database provisioning concurrency, successor adoption and production release remain open.


## First tenant configuration schema — 20 October 2026

The current increment implements immutable owner-managed configuration revisions,
preview, optimistic draft saves, audited publication and historical rollback.
Schema 1 supports bilingual primary-menu labels. It does not implement arbitrary
custom entities, fields, domain workflows, module enablement or bot behavior.
Publishing labels cannot grant a route or permission. Training Center v1's two
historical Sales-only grants are excluded from new label options; commercial
assignments remain unchanged pending reviewed successor adoption.

A disposable real-MariaDB test proves same-category and different-category
isolation, unique concurrent-edit winner, cross-tenant rollback denial, composite
foreign-key ownership, audit-failure rollback, inactive-owner denial, expired-plan
denial and runtime session filtering. The full shared-feature integration passes
113 migrations with real bearer/cookie sessions and owner/Manager/Accountant/Agent
permission checks. Its legacy fixture was extended with the two empty campaign
tables required by the existing timezone migration. No production record is used.
The browser tests cover the actual existing appearance hook and sidebar with
synthetic API/session data: eight editor combinations, four customization/sidebar
combinations, and twenty existing duplicate/sidebar regressions. Screenshots stay
outside Git. Production deployment and authenticated live acceptance are recorded
separately in DEPLOYMENT.md; the full customization objective remains open.

## Tenant-local menu visibility — 21 October 2026

Customization schema 3 adds a typed `hiddenNavigation` list to the existing
owner-managed draft, preview, publish and rollback document. Keys must belong to
the current category's reviewed navigation contract; schema 1 and 2 documents
remain readable. The shared workspace session and the legacy Team Access
sidebar contract both apply this tenant's published list, and member screen
assignments cannot reintroduce a hidden entry. The manager shared-QR grant is
applied before the tenant visibility restriction, so it cannot restore a hidden
entry. The editor preview lists the menu sections it will hide. This setting changes menus only:
it does not grant or revoke plan capabilities, role permissions or direct API
authorization. Each tenant is still loaded by its authenticated tenant ID.

Focused contract tests pass across two same-category tenants with different
published navigation, other-category rejection and legacy schema compatibility.
The existing owner editor and HTTP preview route are extended. Thirty focused
customization, policy, Team Access and HTTP tests pass; eight synthetic browser
cases pass in EN/AR, desktop/mobile and cookie/bearer modes, including draft,
preview of hidden sections, publication, reset and rollback. Source
`64a3b6f106f366aaefafb63b74598e15d8d5de7b` is pushed and deployed in
`/opt/salemax/releases/tenant-menu-visibility-64a3b6f-20261021`. Production
health, login routes, public editor asset, and release/container hashes pass.
The deployment preserved a production-only omission of the unfinished Real
Estate module mapping in `feature-contract.js`; its deployed hash is recorded in
`DEPLOYMENT.md`. No migration or tenant setting was changed. These checks do
not prove signed-in live owner/staff acceptance, broad category workflow
customization, or the full multi-category isolation matrix.


## Next adoption boundary: lead fields and legacy Pipeline — 20 October 2026

Source tracing after the first configuration deployment confirms that menu labels
alone do not make lead workflows category-neutral:

- `client/public/pipeline/pipeline.js` builds the Add Lead dialog with student,
  certificate, QID, course-interest and learning-goal controls directly in the
  shared screen. The board response already includes category context, but those
  controls do not consume a versioned field contract.
- `helper/pipeline/leadPipeline.js` normalizes qualification through a fixed set
  of training-oriented enums/text limits. Unknown keys are discarded. Adding
  arbitrary inputs to a UI would therefore not persist customer-specific values.
  Editing qualification replaces the normalized JSON, so historical custom values
  need an explicit preservation strategy before a new schema can be adopted.
- `routes/pipeline.js` retains legacy bearer authentication alongside canonical
  actors. Some fallback actors have no category metadata. Do not treat missing
  category context as Training Center or reject those working legacy accounts
  merely to simplify the configurable path.

Required next implementation: a versioned server field contract with explicit
shared and category fields; tenant-published typed field definitions; bounded
custom values with a reserved namespace; snapshot/version attribution on saved
records; create/edit/read UI generated from the same contract; and tests proving
unknown/foreign field IDs cannot cross tenants. Preserve historical values when
fields are archived or labels/types evolve. Never reuse medical/stock/reservation
invariants as free-form custom fields. Both legacy base behavior and canonical
owner/staff sessions must pass their existing-screen acceptance matrix before
publication. These requirements remain unimplemented in the first label schema.


## Typed lead-field implementation — 20 October 2026

Configuration schema 2 adds up to 24 tenant-defined lead fields (text, bounded
whole number, Boolean, or calendar date). A type-bearing random field key fixes
its type permanently. Labels, active/archive state and required-on-manual-entry
are published through the existing draft/preview/publish flow. Schema 1 documents
and checksums remain readable without rewriting their published revisions.
Definitions cannot enable a missing `crm.leads` category capability.

The existing Pipeline Add Lead and edit forms render these controls. Server-side
create/update handlers validate values against the verified owner's published
configuration, enforce revision checks and retain the existing lead/team scope.
Values live under an internal `qualification_data.customFields` namespace with
server-generated definition/configuration snapshots. A regular qualification edit
preserves custom values. Archived or removed fields remain readable using saved
snapshots; clients cannot overwrite archived fields. History is bounded separately
from active definitions. Typed false/zero values are retained. Configuration reads
are locked during writes to serialize with publication. The manual API forces
manual source attribution so a caller cannot skip required fields by claiming to
be a public form. Existing trusted public/staff submission services keep their
separate schemas and are not forced to collect these manual-only fields.

Legacy accounts without reviewed tenant mappings retain an empty custom contract
and cannot submit another business's field keys. No account is auto-provisioned.
The pre-existing training-oriented standard controls still require category-neutral
adoption; this increment adds isolated custom fields without silently deleting or
renaming historical standard fields. Pipeline search and its bounded CSV export
consume custom fields with tenant scope. Reports, bot collection, public
conversational forms and new industry invariants remain to be adapted.

Validation: 81 focused checks pass. Browser fixtures cover four typed-field builder
cases, four actual existing Pipeline Add Lead cases, and eight existing editor
cases across EN/AR and desktop/mobile. Disposable MariaDB/shared-auth integration
passes all 113 migrations and actual Pipeline create/update, required validation,
assigned-lead denial, stale configuration and historical-value preservation.
No live business field is configured during deployment verification.

Rollback must account for adoption: reverting to a schema-1-only application after
businesses publish schema 2 can make their session/configuration reads fail, and an
older qualification writer can discard custom values. Before adoption, ordinary
code rollback is safe. After adoption, retain the schema-2 reader and custom-value
preservation adapter in a compatible repair/rollback image, or use an explicitly
reviewed per-tenant configuration rollback while preserving stored values. Do not
blindly restore a previous database or silently erase business field history.

Production: source `072ae58` is deployed in `lead-fields-072ae58-20261020`, derived from the current live release with eleven allowlisted changes. Live health and runtime/public asset hashes pass; primary local files are synchronized with verified backups. No migration or customer configuration write occurred. Signed-in live browser acceptance remains open; see DEPLOYMENT.md.


## Shared Pipeline presentation contract — 20 October 2026

The existing Pipeline now consumes `leadWorkspaceContract` from Board and Detail.
The server resolves the owner UID through verified legacy ownership, active owner
membership/identity and the exact registered category version. Workflow visibility
uses the intersection of that manifest and its current matching plan. It is a
presentation contract; existing workflow API authorization remains authoritative.
No category is inferred from a missing mapping. Unmapped legacy businesses use
shared contact controls and no training workflow shortcuts, without provisioning
or rewriting their data.

Sales/shared Add Lead omits learner, certificate, QID and other student-specific
inputs, course/learning/payer qualification fields, and training enquiry choices.
Shared contact, attribution, follow-up and tenant-defined typed fields remain.
Training Center retains its existing controls. Course options, form creation and
training sale review requests are made only when the verified workflow contract
enables them. Historical submitted application snapshots remain readable even when
new application creation is unavailable. Historical qualification values are
preserved on edit when their category-specific inputs are absent.

This closes the known Sales detail `CATEGORY_UNAVAILABLE` training-panel leak.
It does not make the training registration schema generic or authorize medical,
stock, property or reservation workflows. Typed custom fields still require
reviewed form/bot/export/report adapters. No customer configuration or category
assignment changes in this increment; no migration is needed.

Production: `1e7d977` is live in `pipeline-workspace-1e7d977-20261020`. Thirty focused checks, 12 browser fixture cases and real shared-auth/MariaDB integration pass. Current production owner contracts, public/runtime hashes and health pass; five deployed paths are synchronized locally. Signed-in live browser acceptance remains open. See DEPLOYMENT.md for rollback and remaining gates.


## Pinned tenant fields in existing forms — 20 October 2026

The existing Forms editor can select active published tenant lead fields and set
required flags for that form. Draft save and publication validate the exact current
tenant configuration revision, field identity/type and bilingual labels; only the
form-required switch may differ. The existing form version stores the selected
typed definitions. Public/staff capture validates against that pinned snapshot,
not a visitor-provided definition or another tenant's current configuration.
Renaming/archiving a CRM field does not rewrite published forms. Republish a form
to change its questions; this behavior is stated in both editors.

Typed values and server definition/revision snapshots persist in the existing
submission JSON and Pipeline qualification namespace. New leads use an internal
trusted capture contract available only to existing public/staff source services;
manual API callers still use the current owner contract and manual required rules.
Staff linking to an existing scoped lead merges the captured fields without
discarding other qualification/custom values. Saved values, false and zero remain
readable under their submitted labels. Unknown keys/types and foreign/stale draft
definitions are rejected. Staff and public payload ceilings are both 96 KiB.

This adapter extends existing Training Center forms; it does not silently grant
`portal.forms` to Sales, unmapped legacy businesses or new industry categories.
Registration/accounting invariants and server permission checks remain unchanged.
The category-neutral adapter is reusable when those categories receive reviewed
form contracts. Pipeline search and bounded CSV export now consume custom fields;
bot collection, report consumption and new industry modules remain separate work.

Rollback after adoption must retain this adapter: older form validators reject the
new `customFields` payload and older clients omit its controls. Before adoption,
the exact previous release/image is safe; after adoption use a compatible repair
image or an explicit reviewed form publication rollback that preserves historical
form versions, submissions and Pipeline snapshots. Never restore an old database
dump over subsequent customer activity.

Production: source `605849d` is live in `lead-form-fields-605849d-20261020`. Forty-nine focused checks, 16 browser fixtures and real editor/public/staff HTTP/MariaDB integration pass. All twelve runtime hashes and public assets match; existing three published forms remain readable, with zero customer pinned-form/configuration adoption during deployment. Primary files are synchronized with verified backups. Signed-in live browser acceptance remains open; see DEPLOYMENT.md.


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

## Per-node chatbot flow authority — implementation increment, 21 October 2026

Configured and intro chatbot flows now accept an executor hook before every active node, including each delayed continuation. The runtime rechecks the same tenant, category/version, member identity, plan assignment, live profile revision, channel assignment, recipient policy and conversation pause state using the existing authority loader. A denied node does not execute; its profile/channel-scoped flow session is cleared. If authority changes after dispatch, the conversation is handed to a human. An existing manual pause remains authoritative and keeps its pause/session state. General automations and webhook flows omit the hook and keep their existing behavior.

Three executor tests simulate revocation before and between nodes and a manual pause; they confirm no unauthorized send, stale session removal only for revoked flows, and preservation of manual pause state. Source `07205b2` is deployed in `chatbot-flow-node-authority-07205b2-20261021`; 23 chatbot/profile/authority tests pass locally and in the production image, live health/login and anonymous API checks pass, and the production-only Real Estate omission was preserved. Actual provider acceptance and a race/load test remain pending. This closes the legacy per-node gap for configured chatbot flows only; other shared automation entry points require a separate inventory and authority contract.


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


## Rendered form version handshake — 21 October 2026

The public/staff capture client submits `expectedFormVersion` from the fetched
form definition. Existing public/staff APIs accept only positive safe integer
versions. Under their current form publication lock, new submissions must match
the current version before validation, reservation, rate-bucket or lead writes.
A mismatch returns `FORM_VERSION_CHANGED` (409). The bilingual capture screen
keeps entered answers visible, disables stale resubmission and offers an explicit
reload/review action; it does not silently update consent or resend answers.

An existing tenant/form/idempotency token is resolved first using its stored
immutable form version. A retry after publication returns that original result,
including registration workflow result when applicable, without revalidating
against newer questions. Older callers omitting the version retain compatibility;
the new guarantee applies to version-bearing updated capture clients. Omitted
versions cannot establish which consent/questions an old external client showed.
A future retirement policy for unversioned external clients remains necessary.
Form deletion/unpublication/slug changes may still make an old link unavailable;
this increment does not promise replay through withdrawn public links.

No migration or customer form/configuration rewrite is needed. Before enabling
this code, deployment overlays must preserve the current public template and
source preimages. Older code rejects version-bearing payloads, so rollback must
retain version-aware API acceptance for browser tabs loaded from this release,
or coordinate a compatible repair. Never restore customer tables for code rollback.

Production: `1c6c442` is live in `form-version-1c6c442-20261021`. Twenty-three focused checks, 12 browser fixtures and actual public/staff/shared-auth/MariaDB integration pass. Runtime/public hashes, health and three current published-form reads pass. Six paths are synchronized locally with backups; no customer form/data mutation occurred. See DEPLOYMENT.md for rollback and compatibility limits.


## Exact plan/category binding in shared authority — 21 October 2026

The common entitlement loader now joins the assigned published plan to the owning
tenant's exact category key/version. A mismatched current assignment returns no
entitlement instead of granting its shared capability set. Central policy also
rejects explicit or partial category metadata mismatches before category-specific
exceptions, including internal Sales recruitment. Older in-process contexts that
omit both metadata fields retain their existing compatibility contract; actual
canonical/legacy business loaders carry the exact plan metadata. This does not
prove that every historical handcrafted context uses the common loader.

No assignment or published plan is rewritten to repair a mismatch. Provisioning
and category adoption must establish reviewed matching assignments transactionally.
Production preflight checked three current assignments and found zero mismatches.
The initial API test assumed a uniform 403, but the existing Courses contract
returns 409 FEATURE_UNAVAILABLE; verification accepts the established 403/409
feature-denial responses and requires no success/data access. This preserves the
existing error contracts without turning category mismatch into an outage error.

The audit also found hardcoded category adoption gates in legacy Pipeline actors,
product/catalog adapters and bot/form packs. Exact plan binding is a prerequisite
for expanding those adapters, not evidence that new vertical workflows are ready.
New categories must not be exposed for sale solely by registering display names.

Production: `334b58b` is live in `plan-category-334b58b-20261021`. Thirty-three focused checks and actual cookie/bearer/shared-auth/MariaDB API mismatch tests pass. All three current production assignments resolve; exact two-file runtime parity and health pass. No customer plan/data was rewritten; local files are synchronized with backups. See DEPLOYMENT.md.


## Reviewed catalogue extension per category version — 21 October 2026

Category manifests now declare an optional `catalogue` adapter: `courses`,
`products`, null or absent. Registry validation refuses unknown adapter names and
adapters without their required capability. This is reviewed source metadata, not
tenant-provided SQL or a runtime plugin path. Capability assignment alone never
selects storage. Existing Training Center v1 explicitly declares courses; Sales
v1 explicitly declares products. Other existing fixture behavior remains absent.
No capability, commercial assignment, role, category key/version or stored record
is changed by this declaration.

Shared session catalogue metadata, Inbox quick-reply lookup/labels, fixed table
adapter selection, catalogue route guards, legacy owner context and transactional
create checks now use this declaration and exact context category/version rather
than hardcoded business names. The products adapter retains its fixed server table
mapping and separate storage. Course/product request permissions, member/inbox
scope, published offers, media checks and tenant predicates remain authoritative.
The historical `sales(ctx)` helper name is retained for callers but now means the
products adapter; it is not a brand check. No new category is registered/exposed.

A future-category registry fixture proves explicit version selection, immutability,
no implicit opt-in from capability lists, product table selection, shared session
metadata and exact-category creation without adding a brand branch. Thirty-eight
focused checks and actual shared-auth/MariaDB integration across all 113 migrations
pass for current category APIs, separate historical course/product storage and
Inbox quick replies. This is adapter extensibility, not a delivered retail,
clinical, property, inventory or reservation domain model. Product editing still
reuses maintained catalogue fields; further vertical contracts need their own
invariants and existing-screen adoption evidence.

Remaining extension work includes generic legacy Pipeline actor adoption, forms,
bot packs, navigation-specific presentation and operational scale/restore gates.
Published category versions need reviewed semantic change/adoption rules before
altering an existing adapter selection; do not mutate it for a customer in place.

Production: `8685b36` is live in `catalogue-extension-8685b36-20261021`. Thirty-eight focused checks and real shared-auth/MariaDB API integration pass. Eight-file runtime parity/health pass; two Training Center tenants still resolve courses and Sales products. No customer configuration or catalogue record changed. Exact files are synced locally with backups; see DEPLOYMENT.md.


## Registry-aware Pipeline actors — 21 October 2026

The maintained legacy Pipeline adapter now resolves exact registered planable
category versions with `crm.leads`, instead of accepting only two category names
and version 1. New category owner/manager actors receive that category's canonical
context and current entitlement, never a Sales context by default. Agent resolution
binds the same owner tenant/category/version and member identity before existing
assigned-lead checks. The shared route accepts such verified canonical agents.
Malformed custom-role scope/status/seat metadata is rejected before using it.

Sales org-history manager/team-leader scope remains specialized to Sales. Future
categories do not inherit that hierarchy or team-leader access merely from a role
name. Existing accountant exclusion remains. Training Center v1 owner's historical
legacy path and its manager adapter remain explicit compatibility behavior; this
increment does not prove their full canonical permission migration. Unmapped
legacy accounts are not silently provisioned or assigned a category.

Future-category v2 fixtures prove owner/manager/agent resolution, no Sales org
queries, malformed scopes, wrong plan/version and absent capability rejection.
Read-only production comparison of seven mapped users finds zero changes in
access decisions: three mapped canonical actors, two legacy paths, two expected
permission denials. No new category is registered/exposed; catalogue declarations
and Pipeline support alone do not deliver a new vertical workflow.

Production: `ee29b8f` is live in `pipeline-category-ee29b8f-20261021`. Forty focused checks and actual shared-auth/MariaDB API integration pass. Both runtime hashes and health pass; seven current mapped-user access outcomes are preserved. Two exact deployed paths are synced locally with backups. No category/customer data mutation occurred; see DEPLOYMENT.md.


## Shared task adapter authority — 21 October 2026

The existing Pipeline task endpoint and lead-assignment reminder path now load
current membership/category/plan grants through the shared feature-session loader
and use the existing task-context adapter. Previously the Pipeline adapter omitted
the required storage tenant identifier; adding that identifier alone also exposed
that legacy Training Center contexts omitted assigned navigation. Reusing the
shared loaders fixes both without duplicating task storage or category services.
The task tenant and owner UID are server-derived; verified Sales team scopes stay
on the context. Unmapped accounts cannot create tenant-owned tasks implicitly.

Disposable real-API regressions cover Training Center and Sales owner creation,
assigned-agent access, team-queue denial, current task-navigation revocation,
inactive owner denial, foreign-task rejection/list isolation even with the same
legacy owner hash, and ignored client-supplied tenant IDs. These are backend API
checks, not authenticated production browser acceptance. Category-free base
provisioning and new vertical workflows remain unfinished.


## Base CRM contract and existing-panel provisioning — 21 October 2026

`base_crm@1` is an explicit shared-core contract for reviewed businesses without
a vertical module. It includes the existing messaging, QR/Meta, campaigns,
flows/chatbot, lead/contact, team/task, call-center, reporting and tenant settings
capabilities. It declares no catalogue and no Training, Sales, recruitment or
Training Finance capability. It is private and planable: platform category
authority is required to publish its contract or provision an existing account.
It is not self-service onboarding and does not automatically adopt unmapped
legacy accounts or reclassify any customer.

Manage Plans already consumes the registry. Manage Users now receives authorized
category versions, localized titles and seat roles from that same server registry;
its category selector, setup and linked-contract view retain exact version IDs.
The existing plan ID, commercial terms, owner login, preview/state token,
idempotency, seat checks and audit transaction remain the provisioning authority.
Private category guards apply to all private manifests, not only Sales by name.

Two synthetic Base CRM businesses are provisioned through the existing HTTP
setup endpoints against a real catalogue draft/publication and disposable MariaDB
schema. Tests cover unauthorized platform staff (with portfolio access), exact
version rejection, confirmation replay, bearer/cookie shared sessions and
Phonebook, Pipeline/tasks, same-category task/label/bot/FAQ isolation and denial of
Training/Sales catalogue/form/finance APIs. No bot/provider send or live customer
provisioning occurs. Base bots use existing tenant FAQs and configured Automation
Flows; no Training/Sales built-in guide is implied. AI/provider activation remains
subject to existing configuration and acceptance gates. A denied Training Finance
tenant-context error now returns 403 instead of a misleading server error.

Twelve browser fixtures exercise existing Manage Users setup in EN/AR, desktop
and mobile, across Base/Training/Sales and a synthetic version-2 metadata contract.
This proves exact version/role rendering and preview payloads, not authenticated
production browser or provider acceptance. Additional real-estate, clinical,
retail, hospitality and restaurant domain workflows remain separate work.


## Tenant-specific custom-field search in the existing Pipeline — 21 October 2026

The existing Pipeline's tenant-configured typed lead fields are now searchable
from its normal lead search. A MariaDB `JSON_TABLE` projection reads only each
saved custom field's `value`, so field labels, schema metadata and configuration
revisions do not create false matches. The JSON validity guard tolerates older
malformed qualification snapshots. The filter remains in both the page query
and result count, beneath the existing tenant UID hash and member/agent scope;
it does not accept a client tenant or field path. Text, integer and boolean
snapshot values are compared as display strings, and English/Arabic search hints
describe the additional coverage.

This extends per-business flexibility through the maintained `/user` Pipeline;
it does not change category manifests, permissions, stages or any other tenant's
configuration. It also exposes a scale boundary: custom values live in bounded
JSON snapshots, and searching them requires a per-row projection when a search
is active. Current field definitions allow at most 24 active fields and saved
history is bounded to 120 values/128 KiB per lead. Production currently has six
businesses with Pipeline data (median 10 leads; maximum 242). MariaDB first
planned a full-table scan in this small 398-row table, so both page and count
queries now force the existing `idx_pipeline_board` index, whose leading key is
`uid_hash`; a live EXPLAIN for the largest tenant changed from `ALL` over 398
rows to `ref` over that tenant's estimated 242 rows before the JSON projection.
This is a current production snapshot, not a capacity guarantee. Repeat plans and
latency measurements as data grows; if they exceed the budget, add a
tenant/lead/field-key/value projection with transactional write-through,
migration backfill and reconciliation. Do not index every
customer-defined value without a measured access pattern.

Research basis: AWS documents pooled, bridge and silo storage as trade-offs by
resource and customer needs, supporting SaleMaX's current pooled tenant-keyed
model with a future bridge/silo option for exceptional accounts ([partitioning
models](https://docs.aws.amazon.com/whitepapers/latest/multi-tenant-saas-storage-strategies/saas-partitioning-models.html),
[tier-based isolation](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/tier-based-isolation.html)).
Microsoft recommends feature flags, deployment rings and deployment stamps as
complementary controls for tenant-aware updates ([multitenant update guidance](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/updates)).
MariaDB's JSON_TABLE converts JSON values into relational rows and supports the
wildcard path used by this bounded value search ([MariaDB JSON_TABLE](https://mariadb.com/docs/server/reference/sql-functions/special-functions/json-functions/json_table)).
These are design inputs, not a change to SaleMaX's existing Node/MariaDB
deployment or an assertion of unlimited pooled scale.

## Current plan entitlement for custom lead fields

The published field contract is now loaded only when the owner's active plan
allows `crm.leads` under the same tenant, category, membership and policy
context used by other tenant capabilities. A revoked entitlement hides the
field contract and rejects newly submitted custom values with
`FEATURE_UNAVAILABLE`. Ordinary lead edits remain available, and existing
custom-field snapshots stay attached to the lead. This is application-layer
MariaDB enforcement; it does not claim database row-level security. The full
synthetic integration harness passes on MariaDB 11.4.13 after applying all 118
discovered migrations, including plan revocation, category mismatch denial and
snapshot preservation. This validates the database path without touching
customer data; authenticated EN/AR browser acceptance remains open. Tenant
isolation follows OWASP's guidance to derive tenant context from verified identity and
apply it consistently at every access path ([OWASP Multi-Tenant Security
Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)); AWS also describes runtime policy enforcement for pooled SaaS systems
([AWS runtime policy isolation](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/run-time-policy-based-isolation-with-iam.html)).


## Legacy Flow Builder state ownership

A source audit found that the legacy `flow_data` table stores a nullable owner
`uid` separately from `uniqueId`, and `uniqueId` is not unique. The QR and Meta
runtimes previously read and updated state by the conversation key alone. Those
paths now bind every read and mutation to both owner UID and conversation key;
a composite prefix index supports the lookup. The migration and colliding-key
reads/writes pass in the full synthetic MariaDB 11.4.13 integration harness.
A read-only aggregate audit of the active production database found six rows,
zero missing owner UIDs, zero missing conversation keys, and zero duplicate
`(uid, uniqueId)` pairs; no conversation contents were read and production
schema remains unchanged. Do not infer or backfill missing owners by parsing
the concatenated key. Legacy per-node authorization and durable message
idempotency remain separate requirements.

QR and Meta Flow Builder state keys now include the stable chatbot profile ID
as well as sender and conversation, while database reads and writes remain
owner-scoped. Separate profiles therefore do not share newly created state,
even when they process the same owner's conversation concurrently. A read-only
production audit found six existing `flow_data` rows, all with saved state;
two also have a pending-node marker. Their legacy keys do not identify a
profile, so runtime code preserves but does not auto-adopt or rewrite them.
Profile-scoped handlers cannot resume these sessions. In-flight legacy state
needs a reviewed mapping or an explicit restart policy before deploying this
behavior. An actual distributor test with a fake transport confirms that two
profiles persist distinct input-node state for the same owner, sender and
conversation. The
active production `user.uid` index is also non-unique; current read-only counts
show seven rows with seven distinct nonempty UIDs, but future uniqueness
enforcement remains open.

The legacy flow-state owner/key pair now also has a database-enforced unique
digest. It is generated from the exact UTF-8 bytes of the two source values
with a NUL separator and stored as a fixed-width binary value, keeping the
constraint safe for the legacy 999-character columns. Runtime lookups include
that digest and still compare both source identifiers. MariaDB integration
proves same-owner duplicate and re-key attempts fail, racing inserts have one
winner, and another owner may use the same conversation key independently.
Production has not applied this migration; its DDL, duplicate preflight and
rollback must be reviewed with the live migration ledger before release.

## Channel-bound legacy Automation Flow sessions — 22 October 2026

The shared Automation Flow Builder now treats owner, origin, connected channel,
flow and sender as one session identity. QR and Meta conversations for the same
person cannot resume or overwrite one another's legacy `flow_session` row. Node
updates and reset/loop cleanup target the selected row ID plus owner, and Hybrid
chatbot checks use the same channel-scoped lookup. Nullable origin fields use
MariaDB null-safe equality so webhook and older null-valued identities remain
explicit instead of broadening the match.

This is a shared-core isolation repair; category-specific flow content and bot
configuration remain tenant-owned. Focused regressions cover same-sender QR/Meta,
two connected QR accounts, owner separation and scoped mutation contracts.
Production deployment and runtime channel smoke remain pending; source testing
did not change session data or schema.


## Manifest-owned task assignment scope — 22 October 2026

The shared Tasks service no longer checks the Training Center category key to
decide whether an agent may assign colleagues. The pinned category manifest
declares `taskAssignmentScope`; the safe default is `self`, and Training Center
v1 explicitly retains its existing `workspace` behavior. Managers and owners
keep their existing task-management authority. Future categories can declare
their approved assignment model at registration, while a mismatched or missing
category version fails closed for agents. This is a platform policy, not a
client-editable tenant preference, so a business customization cannot silently
expand an agent's authority.

Task-type filtering and explicit due-date requirements also use the resolved
category task-adapter contract. The shared Tasks service no longer names the
Sales category or `sales_call` as special cases for those rules. Only types
registered by the exact category version can be filtered; unknown type names
are rejected. Existing Sales call requirements remain declared by its reviewed
adapter, so future categories can add reviewed task behavior without editing
shared task lifecycle code.

## Manifest-owned conversation-transfer lead behavior — 22 October 2026

The shared Inbox conversation-transfer service no longer selects the Training
Center category by key before creating or reassigning a Pipeline lead. The exact
pinned category manifest opts into the reviewed `whatsapp_inquiry_v1` adapter;
all other categories default to no lead side effect. Registry validation requires
both shared Inbox and CRM lead capabilities, and a missing/mismatched category
version cannot trigger the workflow. The adapter remains responsible for its
transactional lead/conversation association; the manifest selects reviewed
server behavior and never contains executable tenant configuration.

## Versioned chatbot profile defaults — 22 October 2026

The existing category/version domain pack now owns a validated bot-profile
contract: default guided mode, whether an opening Automation Flow is supported,
category workflow choices/collection fields with bilingual labels, and an optional same-origin CRM
catalogue link. Training Center v1 preserves its guided course admissions
defaults; 7Network Sales v1 retains its optional opening Flow. Shared bot
normalization and the existing chatbot editor consume this contract instead of
checking category names. Unsupported workflow values and opening-Flow fields
are rejected by the server.

The contract supplies defaults only. Each bot still stores a separately
normalized `guidedContent` object in its tenant-owned profile, so two businesses
using the same category can use different bilingual replies. Tests cover profile
copy isolation, immutable category-pack metadata, unsupported settings and the
existing category-specific behavior. This does not yet generalize domain reply
implementations or prove live provider delivery.

The bot-profile workflow contract also supplies a localized field label and an
English/Arabic label for every registered choice. The existing bot editor
renders this selector only while the bot uses the category's built-in guide,
submits the chosen workflow, and retains the category default when the profile
predates the selector. Registry validation requires an exact label map for the
registered choice set; unknown category workflow choices remain rejected by
the server. This keeps future category workflows discoverable and editable
without adding category-name checks to shared UI code.


## Retail Shop inventory ledger — source update, 22 October 2026

A private `retail_shop@1` category now mounts an inventory screen inside the existing authenticated business panel. Its tenant-scoped ledger supports locations, stock reads, audited adjustments, optimistic revisions, request idempotency and movement history. Tenant-composite foreign keys bind locations, products and actor memberships; balances cannot go negative. The category is not public or planable. It reuses the existing product catalogue, so product-variant management is not included.

The existing-screen/API contract, category/policy, router and inventory regressions pass 55/55. A disposable MySQL integration passed nine checks for tenant isolation, replay conflicts, concurrency, nonnegative balances and audit rollback. No production migration or release was performed. Authenticated browser acceptance in English and Arabic remains open. Suppliers, purchasing, POS, automatic sales decrement, product variants and supermarket workflows remain unimplemented; this slice does not complete the Retail category or the full customization program.

### Retail inventory pagination — source update, 22 October 2026

The tenant-scoped product stock screen now consumes the API's bounded pagination
instead of silently showing only the first 30 products. It displays the filtered
range and total, offers English/Arabic page controls, resets the selected page
on location/search changes and discards stale asynchronous responses. This
improves catalogue scale inside the existing panel without broadening the
private category or changing its non-planable status. Focused inventory, router
and screen tests pass 12/12; authenticated browser acceptance remains open.

### Retail catalogue search scale — source update, 22 October 2026

Retail stock lookup now uses an explicit prefix search on product code and the
English/Arabic names. A tenant/status-leading composite index is added to the
shared product catalogue, and the search unions three separately indexable
lookups with distinct product IDs before returning a bounded page. This avoids
leading-wildcard scans and keeps identical matches from duplicating a product.
A 5,000-row disposable MySQL 9.6 integration verified migration application,
English/Arabic/code matching, deduplication and index selection in `EXPLAIN`.
Production MariaDB planning and index-build resource estimates remain release
preflight gates; no production migration has been applied.
