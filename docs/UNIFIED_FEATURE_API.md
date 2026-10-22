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
| Products & services catalogue (SaleMaX Sales) | `/api/workspace/products-services` | None |
| Students | `/api/workspace/students` | `/api/user/training/students` |
| Business profile | `/api/workspace/profile` | `/api/user/training/profile` |
| Tenant customization | `/api/workspace/customization` | `/api/crm/customization` |
| Forms | `/api/workspace/forms` | `/api/user/training/forms` |

`business-feature-session.js` adapts existing bearer and business-cookie
authentication to one current tenant/member context. It validates verified
ownership mappings, active identity/membership/tenant state, role profiles,
delegations, configured screen access and current plan entitlements. Legacy
unmapped Phonebook accounts retain their existing account scope; training and
Finance services still require an enabled, linked business. No tenant is
silently provisioned and no subscription is bypassed.

Products & services reuse the course editor and catalogue handlers with the
`products.catalog` capability and `products.read` / `products.manage` permissions.
The Sales router uses fixed separate product tables through `product-catalog.js`;
Training Center APIs reject Sales sessions and Sales APIs reject Training Center
sessions. Existing courses and reply jobs are preserved. The shared Inbox reply
API chooses the catalogue from the current authenticated category and returns
`catalogKind`. The session contract supplies `quickReplyCatalog`; unsupported
categories do not mount the catalogue reply panel. Publishing, private media,
ordered sends, idempotency, conversation scope and revocation checks are shared.
Migration `20261215_category_product_catalog.sql` creates empty Sales tables and
adds the catalogue capability to existing Sales plan versions. It does not copy
Training Center courses or change customer records.

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
`/api/pipeline` handlers share the same lead service; no duplicate custom-field CRUD
panel is introduced. The maintained Pipeline iframe loads `workspace-api.js` and
uses its shared credential/context adapter for the board, lead actions, settings,
filters, exports, reports, CSV import, follow-ups, and opening-message routing.
Cookie writes use the common CSRF path, and bearer requests keep the active panel
identity. Custom-field controls remain in the existing forms, with values validated
inside the scoped lead transaction. The source and production overlay are updated;
release deployment and authenticated English/Arabic browser acceptance remain open.

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
