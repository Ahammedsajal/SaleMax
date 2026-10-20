# SaleMaX scalable CRM customization and isolation

Evidence review: 20 October 2026. Status: implementation in progress. This extends the existing 42-ticket program; it does not replace its acceptance criteria.

## Product decision

Keep one maintained SaleMaX application, current logins and panels, and shared messaging/CRM services. Treat a business as the tenant; its staff are members, not separate customization owners. Compose its experience from explicit core capabilities, a versioned category contract, an assigned plan, a published tenant configuration, and member permissions. A clinic cannot obtain Training Center courses just by changing a menu label. Two training centers must be able to use different fields, stages, forms, bot content, branding, automations, and enabled modules without editing each other's settings.

Configuration isolation can prevent one business's settings affecting another. It cannot guarantee that a defect in shared application code never affects other businesses. Version pinning, gradual rollout and contract tests reduce that blast radius; dedicated deployment stamps and resource isolation are the stronger option for customers needing separate runtime failure boundaries. Do not sell an absolute guarantee of zero shared-code impact.

## Confirmed source findings

| Area | Owning source | Current finding and consequence |
| --- | --- | --- |
| Category contracts | `modules/platform/categories.js` | Training Center used all registered policy capabilities except four. New features could silently expand an existing category. The first implementation pins explicit lists and freezes titles. |
| Historical assignments | Same source | Training Center v1 already includes `sales.finance` and `hr.recruitment`. Pinning preserves that historical contract; removing these requires a reviewed successor version and assignment impact review, not silently editing customer rights. Recruitment handlers independently check the Sales category. |
| Authorization | `modules/platform/policy.js` | Category, active subscription, member scope, tenant resource ownership and external readiness are separate gates. Retain these gates; a configurable screen must not grant permission. |
| Shared feature authentication | `modules/platform/business-feature-session.js` | Resolves legacy users/agents to canonical tenant membership and entitlements. Unmapped legacy actors can retain a null canonical context; a base-category migration must preserve those working users through verified ownership mappings. |
| UI feature contract | `modules/platform/feature-contract.js` | Modules and quick-reply catalogues still contain fixed category comparisons. This is not yet a general extension registry. |
| Plan administration | `modules/platform/existing-catalogue-router.js` | Manage Plans now enumerates reviewed planable registry entries and looks up an explicit category version. The original version-1 default is retained for old callers. Adding a manifest alone still does not deliver a new category workflow. |
| Bot editing/runtime | `modules/platform/chatbot-router.js`, `chatbot-domain-packs.js`, `docs/CHATBOT_CATEGORY_ARCHITECTURE.md` | Reusable typed guided-content schemas and tenant/category-bound profiles already exist. Extend this design. Shared runtime contains category-specific branches that need adoption tests before replacement. |
| Navigation | `modules/platform/navigation.js` | Server decisions determine visible modules. Configured visibility must remain a restriction over authorized routes, with matching API enforcement. |
| Frontend recovery | Existing implementation plan | Maintained screen hooks coexist with a generated legacy frontend. Extend the existing screens; do not manually edit minified logic or introduce another panel. |

This is a targeted architecture assessment, not an exhaustive proof of every query, queue, websocket or legacy route. The verification ledger below defines the remaining work.

## Research and application to SaleMaX

AWS distinguishes pooled, silo and bridge isolation models. SaleMaX can keep pooled infrastructure for ordinary tenants while introducing dedicated resources where a customer's requirements justify them. Authentication alone does not replace application-level ownership checks. See [AWS isolation concepts](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/core-isolation-concepts.html) and [bridge model](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/the-bridge-model.html).

Microsoft describes deployment stamps, feature flags, and rollout rings as complementary ways to control multitenant updates, and calls for visibility into the version each tenant uses. The proposed SaleMaX control plane therefore records active category/config revisions and rollout state; feature flags select tested behavior but never substitute for entitlements. See [multitenant update guidance](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/updates).

These are architectural inputs, not a recommendation to migrate SaleMaX to AWS or Azure. Keep the existing Node/Express and MariaDB stack while strengthening its boundaries.

## Contract layers and precedence

1. Core: maintained inbox, QR/Meta adapters, flow executor, templates, campaigns, contacts, tasks, identity and audit. A category chooses reviewed core capabilities explicitly. A category-less legacy business keeps its original feature contract until reviewed mapping to a base category; do not auto-provision it into Training Center.
2. Category: immutable `{key, version}` module contracts, domain data model, typed defaults, available workflow handlers, navigation contributions, form/entity schemas and bilingual labels. Published versions are never overwritten. New module registration does not automatically enable old categories.
3. Commercial assignment: existing plan IDs and compatible adapters remain authoritative for the sold capability set and limits. No duplicate plan catalogue. A category contract does not automatically grant paid features.
4. Tenant configuration: immutable published revisions pinned to one tenant, category version and schema version. Typed permitted overrides include labels, optional fields, stage settings, guide copy, layout choices and registered workflow bindings. No arbitrary JavaScript, SQL, server paths, class names or unrestricted HTML.
5. Membership: owner-managed roles, scope and navigation further restrict the effective contract. A staff preference cannot change company-wide configuration or increase its privileges.

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
| Retail / supermarket | Product variants, stock movements, suppliers and POS integration; inventory is a ledger with concurrency control, not a renamed course table |
| Hotels | Rooms, availability, reservations and rate rules; allocation/overbooking needs database invariants |
| Restaurants | Menu, modifiers, orders, tables and kitchen workflow; the existing restaurant fixture is a test fixture, not this implementation |

Use dedicated tables and services for domain invariants. Use bounded, typed custom fields for customer-specific metadata and indexed promoted fields for important search/report dimensions. Do not store invoices, stock balances, medical records, or reservation constraints in an unrestricted JSON entity table. Reference another module through tenant-constrained foreign keys or validated service boundaries; category labels do not change financial meanings.

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
| Existing settings UI | Authenticated owner/staff EN/AR desktop/mobile, clear errors and permission denial, old settings preserved | Existing CRM appearance editor integrated; eight EN/AR desktop/mobile bearer/cookie browser fixtures pass; live acceptance pending |
| Effective runtime settings | Shared resolver adopted by real screens/APIs/workers; tenant revision cache invalidation | Published labels integrated in shared session and sidebar, including account-switch race protection; other modules/workers pending |
| Legacy/base CRM | Inventory legacy modules and ownership, approved mappings, no forced Training Center assignment | Pending |
| Bot/flow customization | Two tenants of same category produce different responses, other category unchanged, state/cache isolation and real channel acceptance | Partly existing; broader proof pending |
| Data and media isolation | Cross-tenant adversarial API/queue/socket/media tests with disposable database fixtures | Pending comprehensive audit |
| New categories | Real estate, clinic, retail, supermarket, hotel and restaurant domain modules integrated in existing panels | Pending; not delivered by adding names to a dropdown |
| Operational scale | Measured tenant load/fairness, recoverable backups, restore drill, rollout rings and health telemetry | Pending |
| Publication | Verified source push, targeted production backup/deploy, hashes, API/browser acceptance and deployment record | Category foundation deployed; tenant configuration and full objective still in progress |

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
renaming historical standard fields. Exports, search/report indexes, public forms,
bot collection and new industry invariants do not yet consume custom fields.

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
