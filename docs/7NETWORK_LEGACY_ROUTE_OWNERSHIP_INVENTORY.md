# 7Network legacy route and tenant-policy inventory

**Audit date:** 21 October 2026  
**Purpose:** establish the enforcement boundary before exposing additional customer categories. This is a source inventory, not a claim that every route has passed a security review.

## Verified route topology

`server.js` calls `mountConfiguredUpgrade(app)` before its legacy API mounts. The upgrade then installs explicit routes for canonical business authentication, workspace feature/session and customization APIs, workspace phonebook/CRM, products and properties, training courses/students/finance/forms, chatbot profiles, recruitment, tasks and Call Center. Requests that do not match those explicit routes continue to the existing user, phonebook, flow, inbox, template, chatbot, campaign, agent, QR, AI, webhook, call and pipeline routers.

| Route family | Existing mount(s) | Current authorization path | Data ownership to preserve |
| --- | --- | --- | --- |
| Platform administration | `/api/admin`, selected `/api/admin/*` upgrade routes | Legacy admin middleware; selected new routes add canonical platform identity, MFA or staff policy | Platform identity and explicitly scoped support operations |
| Business and agent identity | `/api/user`, `/api/agent`, `/api/user/business-auth` | Legacy JWT/session middleware; selected agents are adapted through `agent-workspace-access`; mapped actors also pass `team-role-request-guard` | Legacy `user.uid` / `agents.owner_uid` links plus `sx_legacy_ownership` membership |
| Shared messaging and automation | `/api/inbox`, `/api/chat_flow`, `/api/chatbot`, `/api/templet`, `/api/broadcast`, `/api/qr`, `/api/telegram`, `/api/webhook`, `/api/wa_call` | Existing route-specific auth and `checkPlan`; canonical agent paths use `agent-workspace-access` with `policy.decision`; custom legacy roles use route-to-permission mapping | Legacy UID-owned flows, profile/config, channel and conversation records; newer bot profiles and QR shares have tenant IDs |
| Shared contacts and pipeline | `/api/phonebook`, `/api/pipeline` | Existing user/agent auth and route rules; canonical CRM, phonebook, tasks and pipeline adapters exist for selected paths | Legacy UID-owned records alongside new tenant-owned CRM/task/configuration records |
| Vertical modules | `/api/workspace/products-services`, `/api/workspace/properties`, `/api/workspace/courses`, `/api/workspace/students`, `/api/workspace/finance`, `/api/workspace/forms`, `/api/user/recruitment` | Explicit upgraded routers use business session plus category/plan/permission policy; exact gate varies by module | `sx_*` records carry `tenant_id`; category-specific queries and foreign keys must retain it |
| Static/published pages | public website, recruitment and training forms, property listings and customer documents | Public routes use per-feature lookup, origin/rate-limit controls where applicable; recheck each route individually | Public slug resolves a tenant; published version and linked records remain tenant-scoped |

## Confirmed policy gap and scope

The route map in `modules/platform/team-role-request-guard.js` primarily translates legacy paths to role permissions. It is not a complete tenant/category/plan feature manifest. In `authorizeLegacyMembership()`, an account with no custom role profile is allowed through this guard after the route's own legacy authentication (`if (!row.roleProfileId) return { allowed: true }`). For a mapped actor with a custom profile, an unmapped path is denied; for a source account with no `sx_legacy_ownership` row, `authorizeLegacyRequest()` returns allowed to preserve the legacy application. Therefore this middleware must not be described as a complete module authorization layer.

Selected canonical Agent requests do apply `policy.decision()` through `agent-workspace-access.js`. The upgraded vertical routers also apply modern policy. The remaining legacy owner routes continue to rely on their existing route-specific checks, which are not uniformly represented by `policy.decision()`. This is the exact boundary that needs route-by-route coverage work before a new category or a tenant-selectable module can be considered isolated end to end.

## Executable legacy route audit — 21 October 2026

`scripts/audit-legacy-route-policy.cjs` now parses the direct `./routes/*` mounts
in `server.js`, enumerates static Express route methods and aliases, and compares
the existing legacy role-permission resolver against a checked-in review
baseline. The route policy was extracted unchanged to
`modules/platform/legacy-route-policy.js` so tests and the audit can evaluate it
without loading the database-backed guard. `agent-workspace-access.js` and the
legacy team-role guard use the same alias canonicalizer.

The source audit finds 444 authenticated static route/mount bindings: 342 have
an existing `routePermission()` classification, 78 are separately guarded
platform-admin routes, and 24 authenticated business/identity routes have no
legacy role-permission mapping. They are retained as explicit
`review_required` entries in `scripts/legacy-route-policy-baseline.json`; a new
unmapped route or a dynamic route declaration makes the audit fail. The current
24 are two AI helper routes, eighteen legacy `/api/user` routes (billing,
account security/notifications, messaging and optional shared features), two
tenant log endpoints under `/api/v1`, and two SSO identity-bridge routes.

This is a migration backlog, not proof those routes lack all authorization.
The current `validateUser` path still performs authentication, ownership/session,
legacy optional-feature and route-specific checks. But a membership with a
custom role profile is denied with `TEAM_ROLE_ROUTE_UNMAPPED` when its route has
no mapping, regardless of whether the owner intended to grant an appropriate
existing permission. Default memberships with no custom role profile still use
the established compatibility path. The next change must classify each route's
data owner, module capability and safe role scope before adding mappings; billing,
self-security and platform identity actions must not be made available through
a generic tenant permission. Existing behavior remains unchanged by this
inventory.

Audit limits: this scanner covers static routes declared inside router files
directly mounted from `server.js` and recognizes named auth middleware. It does
not enumerate route factories mounted by `mount-existing-upgrade.js`,
programmatically generated route paths, background jobs, WebSocket events,
provider callbacks or static/public pages. The reported 444 count is a source
inventory, not a whole-application authorization audit. Tests currently assert
the review baseline is stable and canonical aliases resolve consistently.

## Upgraded router ownership inventory — source, 21 October 2026

The follow-up static scan parses router-factory mounts in
`modules/platform/mount-existing-upgrade.js`, follows imported and local
factory bindings, scopes declarations to the factory function and returned
router object, and joins literal route declarations to their configured path
prefixes. The scanner now inspects all `app.use()` arguments, so it does not
stop at an authentication/session middleware when the same mount also creates
its router inline. That correction surfaced the Tasks router, platform-access
router and Asterisk admin router: 54 additional route bindings. The current
inventory covers 36 router mounts across 25 modules and 451 mounted route
bindings, counting aliases separately, with no unresolved dynamic paths.

`modules/platform/upgraded-route-ownership.js` now assigns all 44 distinct
router/mount pairs to an explicit platform, identity, shared-module or
category-module owner. The join expands to every discovered route and carries
the registered module's capabilities, primary service pointer and current data
boundary classification. The ownership test rejects unowned bindings,
stale contracts, unknown module IDs, and category/module combinations not
present in the category registry. It also locks the catalogue boundary:
Training Center courses map to `training.core`, Sales products/services map to
`sales.products-services`, and properties map to `real-estate.properties`
only. These classifications still need exact SQL-table and query review.

All 451 bindings remain `review_required` for actual enforcement. The inventory
marks ownership as mapped while policy review remains unverified; ownership
is not a permission verdict. The scanner can identify some middleware names,
but cannot prove what inline middleware, closure wrappers, service-level
checks, or database filters enforce at runtime. Sixty-four bindings do not
expose a recognizable named guard in their route declaration; this is a
manual review queue, not a confirmed set of unprotected routes. The scan also
does not cover legacy direct mounts, public helpers that register routes on
the app, static pages, workers, sockets, provider callbacks, SQL data ownership,
or rendered screen behavior.

Next, review these route-to-service boundaries with module capability, owning
tables, trusted tenant-context source, member permission, and negative
cross-category/tenant tests. Then apply the same owner contract to direct
legacy routers, asynchronous paths and public/static routes. Do not turn the
scan's guard-name output or ownership metadata into automated grants or enforce
new category gates from this inventory alone.

A read-only production count found 3 active mapped tenants: 1 `7network_sales` and 2 `training_center`. All 3 have a legacy user mapping and a current active/trial plan assignment. These counts reduce uncertainty for the current tenant set, but do not make compatibility-only/unmapped legacy accounts safe to auto-adopt and do not prove every route is covered.

## Enforcement and migration plan

1. Build an executable inventory of every mounted legacy route and HTTP method. Join each route to a reviewed module, capability, permission, expected tenant/data owner, and current guard. Mark bootstrap, provider callback, public and static routes separately.
2. Add contract tests for every mounted prefix: shared modules must be present in Base CRM and eligible categories; vertical endpoints must reject a foreign category even if a plan includes the feature; unmapped legacy requests must remain in the compatibility path until their account mapping is reviewed.
3. Introduce an explicit per-route policy map for legacy handlers. Do not infer a capability from a permission when multiple modules share that permission. Include canonical and historical aliases in the same map. Fail closed only after the mapped route inventory is complete and the account's category/plan state has been reviewed.
4. Migrate one legacy family at a time to shared business context and the module policy. Preserve old UIDs and sessions through adapters, keep tenant scoping in queries, and test cross-tenant reads, writes, uploads, background jobs, WebSocket events and provider callbacks.
5. Keep an observed compatibility report for unmapped endpoints and legacy actors. Remove an adapter only after evidence shows all relevant actors and workflows use the canonical boundary.

## Verification required before another category is enabled

- Route enumeration matches Express mounts and routes, including aliases and callbacks.
- Each route has a test for supported category/plan and a negative test for an unsupported category or plan; member role and record scope are tested independently.
- Tenant-owned repositories use the authenticated tenant ID, never a tenant ID supplied by request JSON/query parameters.
- Legacy and canonical authentication reach the same capability decision without losing account/session compatibility.
- A synthetic tenant can be provisioned, exercised through the existing business and agent panels in English and Arabic, and removed without changing another tenant's records.
- Production data and schema inventory, rollback/restore evidence and authenticated live acceptance are complete for that vertical.
