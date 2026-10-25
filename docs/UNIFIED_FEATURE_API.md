# Shared business feature APIs

Owner, Manager, Accountant and Agent screens use one implementation for each
business feature. Add future changes to that implementation once.

| Feature | Common API | Compatibility aliases |
| --- | --- | --- |
| Current role and permitted actions | `/api/workspace/session` | None |
| Inbox course replies | `/api/workspace/inbox/course-replies` | `/api/inbox/course-replies`, `/api/agent/course-replies` |
| Phonebook | `/api/workspace/phonebook` | `/api/phonebook/workspace`, `/api/agent/phonebook` |
| Finance, invoices, payments and receipts | `/api/workspace/finance` | `/api/user/training/finance-policies`; its `/accountant` and `/canonical` prefixes are stripped before routing |
| Course catalogue | `/api/workspace/courses` | `/api/user/training/courses` |
| Products & services catalogue (7Network Sales and Retail / boutique) | `/api/workspace/products-services` | None |
| Retail branch inventory and orders | `/api/workspace/retail-orders` | None |
| Restaurant branch menus and priced modifiers | `/api/workspace/restaurant-menu` | None |
| Restaurant guest order requests and operations | `/api/workspace/restaurant-orders` | Guest host route `/api/public/website/restaurant-orders` |
| Students | `/api/workspace/students` | `/api/user/training/students` |
| Business profile | `/api/workspace/profile` | `/api/user/training/profile` |
| Tenant customization | `/api/workspace/customization` | `/api/crm/customization` |
| Business storefront and branch settings | `/api/workspace/storefront` | `/api/crm/storefront`; branch routes use the same router |
| Forms | `/api/workspace/forms` | `/api/user/training/forms` |

`business-feature-session.js` adapts existing bearer and business-cookie
authentication to one current tenant/member context. It validates verified
ownership mappings, active identity/membership/tenant state, role profiles,
delegations, configured screen access and current plan entitlements. Legacy
unmapped Phonebook accounts retain their existing account scope; training and
Finance services still require an enabled, linked business. No tenant is
silently provisioned and no subscription is bypassed.

Storefront branch settings remain business-owned and are edited in the existing
appearance screen. The branch API has an optional integer preparation estimate
from 0 to 240 minutes for the `restaurant_cafe` category; zero means no
estimate is configured. The editor and public projection gate this field to
that category, while staff-routing identifiers remain private. The category is
planable only through the existing audited platform category flow and remains
private. Migration `20270109_tenant_branch_prep_time.sql` adds the field with a
zero default so existing branches retain their current behavior.

`tenant-branches.js` also exposes a fail-closed restaurant ordering-hours
decision using the branch's IANA timezone and weekly opening slots. Empty or
invalid schedules and invalid timezones are treated as closed; when a nonzero
preparation estimate is configured, the estimated finish must not exceed the
current opening slot's closing time. This helper is a server-side policy
primitive for the restaurant order workflow; it does not itself expose a public
menu or accept orders.

Products & services reuse the course editor and catalogue handlers with the
`products.catalog` capability and `products.read` / `products.manage` permissions.
The Sales and Retail routers use fixed separate product tables through `product-catalog.js`;
Training Center APIs reject product-category sessions and product APIs reject
Training Center sessions. Existing courses and reply jobs are preserved. The shared Inbox reply
API chooses the catalogue from the current authenticated category and returns
`catalogKind`. The session contract supplies `quickReplyCatalog`; unsupported
categories do not mount the catalogue reply panel. Publishing, private media,
ordered sends, idempotency, conversation scope and revocation checks are shared.
Migration `20261215_category_product_catalog.sql` creates empty Sales tables and
adds the catalogue capability to existing Sales plan versions. It does not copy
Training Center courses or change customer records.

Retail order management uses `/api/workspace/retail-orders` through the same
`business-feature-session.js` context as other business modules. `GET /variants`
reads tenant product variants and stock; `POST /variants` creates a sellable
SKU and its initial branch stock in one transaction; `PUT /variants/:id`
updates sellable SKUs; `PUT /variants/:variantId/branches/:branchId/stock`
updates branch on-hand quantity with optimistic revision checks; `GET /orders`
lists permission-scoped guest orders; and `PUT /orders/:id` advances the
fulfillment state machine. `retail.orders` and `products.catalog` are separate
capabilities, so product management and assigned-order fulfillment remain
independently permissioned. No compatibility duplicate is mounted.

Public checkout is hosted only on an active, verified tenant domain. The
owner must publish the retail storefront and explicitly enable its product
catalogue. `GET /api/public/website/orders/catalog` reads available variants;
`POST /api/public/website/orders` validates guest consent, branch fulfillment
modes, price snapshots and stock under transaction before reserving inventory;
`POST /api/public/website/orders/returns` authenticates a guest using the
one-time access code whose hash is stored with the order. Cash on delivery and
manually verified bank transfer are supported; online settlement and payment
reconciliation are not part of this source slice.

Restaurant menu management uses `/api/workspace/restaurant-menu` through the
same business session and common browser API client. Owners and permitted
managers add existing active Products & services entries to active branches,
set branch-specific QAR prices and availability, and manage bilingual modifier
groups/options with selection bounds and price deltas. New entries start
unavailable. Mutations are tenant-scoped, audited and revision-checked. The
`restaurantMenu` session module is granted only when the category, current plan,
and `restaurant.menu` / `products.catalog` entitlements allow it. The
`restaurant_cafe` category is provisionable only through the existing audited
platform category flow and remains private (`public: false`). This screen does
not accept or confirm orders. Guest order-request handling is a separate API;
it is source-only and remains unavailable until publication readiness is
verified.

Restaurant order operations use `/api/workspace/restaurant-orders` with
category-specific `restaurant.orders.read` and `restaurant.orders.fulfill`
permissions, separate from Retail's generic order capability. Agents receive
only branch-routed requests; accountants receive financial order fields but no
guest contact, address or line-item details. Guest submissions use
`/api/public/website/restaurant-orders`, explicit consent, verified tenant
domain/origin checks, shared visitor rate limits, branch opening-hours checks,
idempotency and request-only status. The order and each selected bilingual
modifier/price are stored as snapshots. A staff member must accept a request
before it becomes confirmed. Guest ordering stays unavailable while the
category is private or its owner-published `showRestaurantMenu` flag is absent.
No kitchen/table capacity or online payment settlement is claimed.

Professional Services, Salon / spa and Home services guest requests post to
`/api/public/website/enquiries` on the verified tenant host. Home Services
publication requires a current `crm.leads` entitlement, at least one published
service, and an active public branch with on-site fulfillment and service
areas. Its visit/quote form requires a selected branch, a covered service area,
the service address, contact information and consent. The API validates the
service-area match and routes the resulting Pipeline lead to that branch's
configured agent. The full address is stored in the private lead activity;
preferred visit times remain requests and do not represent dispatch or
confirmed availability.

Fitness / coaching and Events / venues use the same public-enquiry endpoint,
service sections and branch routing. Fitness accepts a trial request or
consultation; events accept availability, registration-information or quote
requests. Requested dates and times are stored as lead qualification details.
No coach, class seat, venue, event capacity or attendee place is reserved, and
the storefront copy explicitly says these actions do not confirm attendance.

Bearer requests identify the current panel with `X-Salemax-Actor: agent` for
Agent credentials; existing Agent aliases identify the panel themselves.
Cookie writes require the existing CSRF token. All writes retain Origin checks.
An invalid/denied credential never falls back to a different account's cookie.
Services use the authenticated member for authority and audit attribution and
the verified business owner UID only to access the tenant's legacy records.

Use `window.SaleMaxWorkspace.request(module, path, {method, body})` in maintained
screen hooks. JSON and multipart requests share the same credential selection.
The `session()` contract exposes current module/action permissions; its short
client cache only reduces duplicate navigation reads. Every backend operation
rechecks access independently. New controls should use those permissions.

The existing Finance screen combines invoices, installments, payments and
receipts. Any of those screen assignments admits the shared screen; fixed role
and custom action permissions continue to constrain operations. Granting a
sidebar item does not turn an Agent into an Accountant. Manager and Accountant
direct-receipt authority remains in the shared payment service.

Published course replies are an Inbox operation. A member with Inbox reply
permission can select the business's published course information without
catalogue-edit access. Assigned-chat and explicitly shared QR-channel limits,
tenant filters, ordered sends, idempotent jobs and per-part session/permission
refreshes remain enforced. Shared Phonebooks remain read-only for recipients.

Compatibility URLs mount the same router instances; Finance actions register
once. Do not add separate owner/accountant/agent handlers for future features.
Keep role-specific differences in the policy/service contract and preserve
compatibility aliases for cached clients.

Regression gates: `tests/unified-feature-api.test.js`,
`tests/workspace-api-client.test.js`, and
`tests/unified-feature-sessions.integration.cjs`. The database integration
requires `UNIFIED_SYNTHETIC_ONLY=true`, creates and drops its own schema, uses
synthetic identities and a fake message transport, and must run on disposable
MariaDB infrastructure. It never sends WhatsApp messages.

## Agent access to the shared business shell

The existing Agent login opens the existing `/user` shell in Agent mode. A tab-local actor marker and an early credential adapter select only `wacrm_agent`; a separate business credential is preserved. Both bearer requests and the session contract keep the actual Agent membership and identity. `/api/user/get_me` and dashboard compatibility reads return a bounded Agent profile, never the owner row or owner credential fields. The Agent identity read also avoids falling back to a separate business cookie.

Custom business roles may explicitly add modules to Manager, Team Leader and Agent seats. Default roles remain unchanged; an existing custom role gains no new grants automatically. Assigned conversations and own-report scopes remain scoped, plan/category limits still apply, and platform administration and financial separation-of-duty rules remain separate. The common policy authorizes each request against current role grants and assigned screens.

QR, Flow, Chatbot, Templates, Campaigns, Inbox and Pipeline compatibility routers also mount at `/api/workspace/channels/qr`, `/api/workspace/automation/flows`, `/api/workspace/automation/chatbot`, `/api/workspace/templates`, `/api/workspace/campaigns`, `/api/workspace/inbox` and `/api/workspace/pipeline`. They reuse the same handlers. Agent-created QR connections stay in the business channel inventory and receive an explicit creator membership grant. Agents can manage connections they created, see their permitted shared connections, and cannot delete another member's connection. The business QR plan limit is checked before creation. No owner pairing credentials are copied.

Verification covers the actual QR routes with a fake provider, real MariaDB sessions and permission changes, separate business/Agent credentials, and both bearer/cookie feature access. Actual WhatsApp pairing and messaging remain provider acceptance.


## Tenant customization publication

The existing CRM appearance screen uses the shared browser client for owner-only
configuration drafts, read-only preview, publication and rollback. The first typed
schema allows bilingual navigation labels; it rejects arbitrary keys, executable
content, unknown category screens and Sales-only label options inherited by the
historical Training Center v1 contract. Both bearer and cookie requests use the
same router/service, current session refresh, Origin checks and cookie CSRF.

Immutable database revisions and a per-tenant active/draft pointer retain category
and schema versions, canonical checksums and an audited monotonic revision. Writes
lock the tenant and recheck current owner membership and subscription before
checking the expected revision. Composite foreign keys prohibit pointers to
another tenant's revisions. Publication/rollback never modify another tenant.
The session contract returns only published labels for the caller's permitted
navigation. The sidebar keeps native route names and click handlers intact while
rendering custom labels separately. Client invalidation prevents an earlier
identity's in-flight session response from painting a later account's navigation.

Migration `20261220_tenant_customization.sql` adds two empty tables; no existing
business receives custom labels automatically. Configuration history is separate
from the commercial plan catalogue. Broader fields, workflows, bot behavior,
category adoption and new vertical modules remain subsequent implementation work.


Configuration schema 2 supports typed custom lead fields and is backward-compatible
with published schema 1 label documents. Existing `/api/workspace/pipeline` and
`/api/pipeline` create/update handlers share the same lead service; no duplicate
custom-field CRUD panel is introduced. The current Pipeline browser still uses its
legacy bearer request path. Custom-field controls are added to its existing forms,
and values are validated inside the scoped lead transaction. Canonical-cookie
Pipeline UI adoption remains a separate legacy migration gate.


## 7Network Sales ICP pilot

The Ideal Customer Profile screen is an internal pilot inside the existing `/user` shell. The maintained sidebar hook adds it only when the shared session contract includes the `icp` navigation key. Only the canonical `7network_sales@1` category receives the capability; all other categories and Sales Accountants are excluded by the shared server policy. Active owners, managers, team leaders and agents can read tenant-shared profiles. Only the owner can create or edit them. The screen uses the shared session and feature API, not a second login.

The browser client registers `icp` at `/api/workspace/icp`. The router uses the shared feature-session guard, so legacy business bearer, Agent bearer and canonical cookie credentials follow the same tenant and role checks. Writes retain current-session revalidation, Origin/CSRF protections and private no-store responses.

| Method and path | Purpose | Request |
| --- | --- | --- |
| `GET /api/workspace/icp/profiles` | List up to 100 tenant profiles, newest update first | None |
| `POST /api/workspace/icp/profiles` | Create a profile and audit event atomically | `{title, summary, document}` |
| `PUT /api/workspace/icp/profiles/:id` | Update with optimistic concurrency and audit event | `{title, summary, document, revision}` |

The typed document captures industry, geography, company size, revenue or budget range, business model, growth stage, priority needs, desired outcomes, buying triggers, decision roles, technology signals, budget evidence, exclusions, evidence or assumptions, and confidence (`hypothesis`, `needs_review`, or `validated`). Values have bounded lengths and list sizes. Profiles start as hypotheses; the workflow asks users to record the evidence behind each criterion and does not infer ICPs from customer data or score leads.

Migration `20261224_7network_sales_icp_profiles.sql` adds one tenant-scoped profile table with creator/updater identity attribution, a revision number, JSON document and newest-first index. It has no seed rows and does not alter plan entitlements or customer records. Stale writes return `STALE_ICP_PROFILE`; cross-tenant profile IDs resolve as not found. Follow-up work can add evidence-linked account samples and fit scoring after this internal pilot validates its criteria.
