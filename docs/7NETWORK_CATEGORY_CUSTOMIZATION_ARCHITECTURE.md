# 7Network category and tenant customization architecture

**Status:** architecture decision and implementation baseline, 21 October 2026  
**Scope:** evolve the current Node/Express CRM in place. Preserve the existing admin, business, and agent panels, legacy workflows, and customer data.

## Product and architecture decision

Build one modular CRM with shared platform services and independently gated business modules. Treat a **category as a versioned starting package**, not as a separate application or a collection of tenant-specific code forks. Treat each **tenant as an independently configured installation** of that package. Shared services such as contacts, conversations, QR/Meta, templates, flows, team, tasks, and reports can be used by any eligible category; vertical modules add their own concepts and workflows.

Compose access from independent controls:

```text
request allowed = active tenant
               AND category version includes the module
               AND current plan includes the capability
               AND tenant has enabled/configured it where opt-in applies
               AND member permission and record scope allow the action
```

Each control narrows access; tenant configuration, a menu choice, bot prompt, workflow or role grant must never add a capability absent from the pinned category and current plan. The API is authoritative. Hiding navigation is only a presentation choice.

Use a **modular monolith** in the current application for now. Its shared deployment, identity, provider integrations and MariaDB footprint are already established. Create code boundaries around domain modules inside the existing application before considering service extraction. A separate service or database stamp is justified only by measured scale, isolation, recovery or regulatory requirements—not by the existence of a new category.

For ordinary tenants, retain the current shared-database/pool model with explicit `tenant_id` ownership on tenant data and tenant-scoped queries. Do not create a table, schema, route tree or app fork per customer. Leave a future bridge/silo option for customers with documented isolation, region, key, backup/restore or noisy-neighbor requirements. AWS describes pool, bridge and silo as distinct trade-offs; Microsoft also cautions against per-tenant table proliferation and tenant-specific schema changes in a pooled relational database. These are especially relevant here because adding tables or columns per customer would make the current release/migration process harder to operate. [AWS SaaS storage partitioning](https://docs.aws.amazon.com/whitepapers/latest/multi-tenant-saas-storage-strategies/saas-partitioning-models.html), [Microsoft multitenant storage guidance](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/storage-data), [Microsoft multitenant architecture overview](https://learn.microsoft.com/en-us/azure/architecture/guide/saas-multitenant-solution-architecture/)

The security review reinforces an important distinction: putting a tenant key on rows is partitioning, not complete isolation. The trusted tenant identity and policy must carry through application services, files, caches, jobs and integrations, and must be tested as a tenant/role/resource authorization matrix. OWASP's multi-tenant guidance calls out these secondary boundaries and recommends explicit authorization-matrix testing; the route owner inventory below is a discovery aid, not proof of enforcement. [OWASP Multi-Tenant Application Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html), [AWS distinction between partitioning and isolation](https://docs.aws.amazon.com/prescriptive-guidance/latest/multi-tenancy-amazon-neptune/data-partitioning-models.html)

## Source architecture and current production baseline

The source has a real foundation for this model:

- `modules/platform/categories.js` defines version-pinned category manifests. The shared CRM capabilities are explicit; Training Center, 7Network Sales and Base CRM add different capability sets. Training Center v1 intentionally retains historical `sales.finance` and `hr.recruitment` capabilities for compatibility. Do not copy that exception into new categories; remove it only through a reviewed v2 adoption path.
- `modules/platform/category-registry.js` rejects duplicate versions, unknown/duplicate capabilities, invalid roles, catalogue mismatches, unsupported task adapters, and malformed migration identifiers. Registries are assembled from reviewed source, not tenant input.
- `modules/platform/module-registry.js` now defines reviewed module identities, exact capability sets, current screen keys, primary service pointers, data-boundary classifications, and per-module configuration-schema versions. Each first-party category pins module IDs and versions, and the category registry rejects missing modules, duplicate capability composition, or a module/capability mismatch. Existing navigation and the Manage Users screen catalog now only expose screens declared by the pinned category modules. Training Center v1's historical Sales Finance and recruitment capability exception is explicitly isolated in a compatibility-only module with no category screens.
- `modules/platform/policy.js` makes a decision against tenant/category version, subscription, permission, role and resource scope. A plan alone cannot authorize a capability absent from the category. Existing category/task tests now assert this cross-category denial.
- `modules/platform/tenant-customization.js` stores immutable, checksummed, tenant-owned revisions and validates their pinned category/version. Owners can draft, preview, publish and roll back. Schemas 1–5 retain their historical document shapes; schema 6 adds module-owned settings. Mutations use revision checks, transactions and audit records.
- `modules/platform/task-type-adapters.js` is a reviewed, versioned adapter boundary. Category manifests pin task adapters; a tenant can select only adapters already allowed by its category and plan.
- Chatbot profiles and channel assignments are stored with `tenant_id`, category key and category version. `chatbot-domain-packs.js` supplies category-versioned bot behavior, while profile settings hold tenant-specific answers and wording.
- `product-catalog.js` reuses maintained catalogue services while selecting product versus course storage from the authenticated category context.
- Existing panels and the older routes remain part of the product. The legacy user/agent-to-tenant adoption is incomplete, so the new policy layer is not yet proof that every legacy endpoint has the same gates.

The active production release was read-only verified on 21 October 2026 as `/opt/salemax/releases/7network-final-logo-060dee2-20261021`; the application is healthy and `/healthz` returns 200. Its `categories.js` hash is `ac830fc67f463730070c641b98bb27737a93ec5132e8f5905d568f4789303a78`. It contains Training Center, 7Network Sales, Base CRM, and a non-planable `restaurant_fixture`; Real Estate is absent. The current source branch contains a Real Estate v1 manifest marked non-planable, which is an implementation fixture, not evidence that the customer-ready Real Estate category is released. Do not deploy the source category list wholesale over the live release: reconcile its category set and preserve production-only branding and shell files first.

Tenant module activation is stored in immutable schema-5 revisions and enforced by shared policy for canonical and adapted legacy business contexts. The activation allow-list can only reference exact modules pinned to that tenant category; required setup modules stay enabled and compatibility-only grants remain locked on. Schema 6 introduces a declarative module-settings registry: the Real Estate fixture's versioned contract currently controls default transaction type and currency, and its existing property screen/API consumes those values as form defaults. Settings can never grant a capability or change record scope. Schemas 1–5 keep their prior canonical shape and checksums. This is a first module example, not complete API enforcement: legacy routes still need explicit module mapping and cross-category checks, and other modules still need their own settings contracts where the workflow calls for them. Domain behavior remains spread across capability checks, navigation metadata, catalogue selectors, category-specific adapters, and legacy routes. New categories should not be added until these ownership and compatibility rules are enforced consistently.

## Domain model and customization boundaries

Keep these concepts separate in code and data:

| Concept | Owns | Must not do |
| --- | --- | --- |
| Shared platform | Identity, tenant membership, permissions, inbox/channels, templates, automation runtime, task engine, audit, billing and shared CRM records | Assume every account has a vertical module or shared plan entitlement |
| Domain module | Its service, API routes, data contract, permission requirements, feature capability, navigation entry, supported config schema, migrations and tests | Reach into another module's tables or infer access from a menu item |
| Category package | A pinned list of reviewed module versions, default navigation/workflow, seat roles and onboarding choices | Fork the app or own customer-specific data |
| Plan | Billable capability and limits for a category/version | Grant a capability absent from that category or override member permissions |
| Tenant setup | Optional activation of eligible modules, branding, typed custom fields, pipeline choices, templates, bot profile and approved workflow settings | Supply executable code, SQL, arbitrary route names or new permissions |
| Membership/role | Who may read or change each resource and at what scope | Broaden tenant or plan access |

Use **capabilities** as the stable authorization/billing vocabulary and **module manifests** as the reviewed implementation metadata that binds capabilities to routes, screens, data owners, configuration versions and migration requirements. A category package composes module manifests. This avoids treating a long list of category-specific `if` statements as the extension API. Keep existing capability IDs and plan IDs compatible while moving route/navigation metadata behind the manifest registry.

Tenant module settings should be declarative, schema-validated and versioned. A tenant may enable an eligible module only when its pinned category and current plan permit it. Module-owned settings should be validated by that module's own versioned schema, stored with tenant and module identity, checksum/revision, actor, and audit record. Defaults must be deterministic. Unknown keys, capabilities, module versions, field types or workflow actions fail closed. Runtime handlers consume a normalized configuration object; they do not execute configuration as code.

For data, reuse shared contact/lead identity where useful, but keep domain records separate: a course enrollment is not a sales lead; a property is not a product; a patient is not a generic contact profile; a stock movement is not an invoice line. New module tables need `tenant_id`, tenant-scoped foreign keys where MariaDB permits them, unique constraints that include tenant, composite indexes beginning with tenant for common access paths, explicit data-retention/attachment ownership, and negative cross-tenant tests. Never add per-customer columns or tables. Store custom field definitions as typed tenant configuration and values in bounded JSON/side tables with validation and indexes for fields that must be queried.

## Category roadmap

Categories should be package presets assembled from reusable modules, not duplicated vertical applications:

- **Base CRM:** shared CRM, contacts, inbox, channel setup, templates, flows/chatbot, tasks, team and reports. This is the neutral offer for businesses that do not need a vertical package. Legacy accounts remain on their current contract until individually mapped and adopted.
- **7Network Sales:** Base CRM plus product/service catalogue, sales deals, targets, commissions and internal recruitment as separately permissioned modules. Keep “SaleMaX” only as a compatibility identifier where changing it would break stored assignments, routes or migrations; customer-facing branding says “7Network.”
- **Training Center:** Base CRM plus courses, offers, batches, enrollments, forms and training finance. Preserve the already assigned v1 contract and plan/customer history during future v2 cleanup.
- **Real Estate:** reuse CRM, team, tasks, inbox, and messaging; add property/listing, ownership/availability, viewing, offer and tenancy modules. Source-only Real Estate is not released; first finish the category/module manifest, tenant-scoped storage, query guards, plan and permission gates, and existing-panel workflow before enabling onboarding.
- **Dental/clinic:** begin with a reusable appointment/practitioner/service module only after agreeing the operational boundary. Patient records, treatment notes, attachments, consent, retention and access need stricter controls than generic lead fields. Dental and general clinic may share scheduling primitives but must not be forced into one medical record schema by category naming.
- **Retail/supermarket:** compose product catalogue, variants/SKU, stock, supplier/purchase, branch, price/promotion, POS and returns modules as requirements are validated. Training's course catalogue can inform reusable catalogue services, but course enrollment semantics must not leak into stock/order flows.
- **Hotel/restaurant:** validate whether the customer needs a reservation, room/occupancy, menu/order, kitchen, inventory or POS module. Reuse inventory and commerce primitives only where the invariants match. The current `restaurant_fixture` is test-only and does not prove a restaurant product.

Do not expose all proposed categories as selectable options at once. A category is sellable only after its modules pass the release gates below and the owner-approved plan, role, language and data-retention choices are recorded.

## Invariants and release gates

For every module and category version, verify:

1. Category capability, plan capability, tenant enablement and member permission are all tested independently. A larger plan must not unlock another category's module.
2. Every read, write, upload, download, background job, bot, webhook and realtime event resolves tenant identity from trusted session/channel ownership—not browser-supplied tenant IDs—and includes tenant scope in storage access.
3. Navigation visibility is not treated as authorization. Direct API and stale-session tests must deny disabled/foreign modules.
4. Category and module versions are pinned. No implicit “latest” lookup changes a live tenant. Version upgrades require impact review, mapping, rollback plan and explicit adoption.
5. Config writes are owner-authorized, bilingual where user-visible, bounded, validated, previewed, revision-checked, audited and reversible. Old configuration schemas remain readable until migrated.
6. Category-specific database work uses shared additive migrations and synthetic fixtures. Migration tests cover repeatability, rollback/restore, unique constraints, tenant filters and realistic tenant volume. Never apply a category migration to customer records during a feature-flag test.
7. Existing English/Arabic screens and the real authenticated workflow are tested inside the existing panels. API tests and a standalone fixture are necessary but do not prove integrated release acceptance.
8. Release proof separately records source commit, candidate/live release, image/container, migration state, rollback snapshot, unchanged unrelated services, health, exact feature behavior, and remaining gates in `DEPLOYMENT.md`.

## Ordered implementation plan

1. **Inventory and lock boundaries:** map each existing screen, API route, job, webhook, table, authorization helper and feature flag to shared platform or domain module. Identify legacy routes that bypass category/plan policy and map legacy accounts to a compatibility cohort. Add automated category/plan/tenant/member cross-product denial checks.
2. **Complete the module manifest registry:** move screen/API/data/config metadata into reviewed, versioned manifests while preserving current capability IDs and route behavior. Add boot-time validation for duplicate routes, unknown capabilities, missing policy, unowned tables, invalid configuration versions, and category references to unreviewed modules.
3. **Unify tenant configuration safely:** extend the existing immutable revision system with module activation and module-owned config schemas, retaining tenant/category pinning, compatibility, preview, optimistic concurrency, audit and rollback. Schema 6 now has the first Real Estate settings contract; add module contracts only alongside a real consuming workflow. Apply tenant activations at the shared authorization/context boundary so all modern APIs see the same result; do not rely on frontend filtering.
4. **Close legacy gaps:** migrate legacy route families to the shared tenant context and policy in small verified slices. Preserve existing sessions and assigned plans; adopt tenants through reviewed mappings and dual-read checks, not automatic recategorization.
5. **Complete one reference vertical:** finish Real Estate as the first new customer-selectable package because a source fixture already exists. Require cross-tenant integration tests and authenticated EN/AR acceptance in current `/user` screens before adding onboarding.
6. **Add clinical and commerce modules by validated workflow:** model appointment primitives and privacy controls, then reusable stock/order/branch workflows. Ship dental, clinic, retail, supermarket, hotel and restaurant presets only after each package passes the same gates.
7. **Automate provisioning, limits and operations:** category-aware onboarding, plan assignment, module-level seat/resource limits, metering, exports, tenant-scoped backup/restore, noisy-neighbor monitoring and opt-in dedicated stamps for justified customers.

The route inventory covers direct legacy routers and the static route factories mounted by `mount-existing-upgrade.js`. The upgraded factories now join to explicit module/platform owners, but route-to-table ownership, runtime policy evidence, direct legacy API migration, jobs, sockets, provider callbacks, and public/static route enforcement remain open. Module activation intersects the category pin, plan capabilities, tenant opt-in and member permission; a missing legacy activation document preserves the tenant's current category defaults. The next coding increment should verify mapped factories against service queries and negative cross-category/tenant tests, then extend the ownership contract to data tables and asynchronous/public surfaces. Module-owned settings remain incomplete outside the first Real Estate fixture contract. Do not add more category names to production until those contracts and the real existing-screen workflow pass.
