# Shared business feature APIs

Owner, Manager, Accountant and Agent screens use one implementation for each
business feature. Add future changes to that implementation once.

| Feature | Common API | Compatibility aliases |
| --- | --- | --- |
| Current role and permitted actions | `/api/workspace/session` | None |
| ChatGPT MCP account connections and OAuth consent | `/api/workspace/chatgpt` | None; MCP protocol at `/mcp` |
| Inbox course replies | `/api/workspace/inbox/course-replies` | `/api/inbox/course-replies`, `/api/agent/course-replies` |
| Lead-linked Inbox unread state | `/api/workspace/inbox/lead-status?chatId=…` | `/api/inbox/lead-status?chatId=…` |
| QR Inbox groups | `/api/workspace/inbox/groups` | `/api/inbox/groups`, `/api/agent/inbox/groups` |
| Next active task for a lead | `/api/workspace/tasks/lead/:leadId/next` | `/api/pipeline/tasks/lead/:leadId/next`, `/api/user/training/tasks/lead/:leadId/next` |
| Phonebook | `/api/workspace/phonebook` | `/api/phonebook/workspace`, `/api/agent/phonebook` |
| Finance, invoices, payments and receipts | `/api/workspace/finance` | `/api/user/training/finance-policies`; its `/accountant` and `/canonical` prefixes are stripped before routing |
| Course catalogue | `/api/workspace/courses` | `/api/user/training/courses` |
| Products & services catalogue (SaleMaX Sales) | `/api/workspace/products-services` | None |
| Students | `/api/workspace/students` | `/api/user/training/students` |
| Business profile | `/api/workspace/profile` | `/api/user/training/profile` |
| Shared tenant AI settings | `/api/workspace/ai/settings` | `/api/user/chatbots/settings/provider` |
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

Lead detail may request `GET /api/workspace/inbox/lead-status?chatId=…` for one
conversation already linked to that lead. It requires `conversations.read` and
the current Inbox assignment or shared-channel scope. The response contains
only `{ available, unreadCount }`; it does not return message text or transcript
content. The lead API continues to expose conversation identifiers and inbound
timestamps only. The next-task endpoint rechecks `tasks.read`, lead access,
tenant, task participation and team scope before returning one active task,
its assignee labels, status and due date.

Compatibility URLs mount the same router instances; Finance actions register
once. Do not add separate owner/accountant/agent handlers for future features.
Keep role-specific differences in the policy/service contract and preserve
compatibility aliases for cached clients.

Shared AI provider settings are configured in the existing Business Profile.
They are tenant-wide, owner-managed, encrypted at rest, revisioned and audited;
the API never returns the provider key. AI-enabled features load the same tenant
configuration through `modules/platform/tenant-ai-settings.js` and reserve
against the same tenant daily token budget. Source integrations cover chatbot
replies, Inbox reply suggestions and translation, legacy AI_BOT flow nodes, and
text-based AI_TRANSFER flow nodes. Canonical Inbox requests ignore client-supplied
provider credentials. Compatibility paths for unmapped legacy accounts retain
their previous provider behavior until migrated. AI_TRANSFER media understanding
remains a separate integration gate and is not globally wired. Each AI feature
still requires its own workflow, role checks, source/permission validation and
evaluation before activation. The chatbot provider URL remains a compatibility
alias.

`GET /api/workspace/ai/settings` returns the active provider and metadata-only
status for each saved OpenAI, Gemini and DeepSeek profile. Owners use
`PUT /api/workspace/ai/settings` with `action: "save-provider"` to store or
replace one profile without switching, `action: "save-and-activate"` to save and
select it, or `action: "activate-provider"` to select a saved profile without
resending its key. The legacy default action still saves and activates. Active
provider changes apply to new AI requests; requests already in progress retain
their loaded configuration. Switching does not query live-bot state or require
pausing bots. Profile keys remain encrypted and are never returned. Expected
active/profile revisions prevent stale writes, and owner actions are audited.
`POST /api/workspace/ai/settings/test` tests a provider using an unsaved key or
the saved profile; it does not activate or persist settings. Usage and prompt
cache accounting remain shared across providers.

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


## ChatGPT MCP connector

`docs/CHATGPT_MCP_CONNECTOR.md` defines the first-release scope and product gates. The authenticated connection/consent/revocation UI uses the existing shared business session at `/api/workspace/chatgpt`. ChatGPT connects to the remote MCP endpoint at `/mcp` through the OAuth authorization-server endpoints under `/mcp/oauth/*` and the OAuth discovery documents under `/.well-known/*`.

The connector re-resolves the linked owner or agent on every tool request and checks current tenant, role, feature access, Inbox permission, task permission and connection revocation. `pipeline.read`, `conversations.read`, `tasks.read`, and `tasks.manage` are distinct grants. Conversation text requires a separate opt-in, current Inbox and per-chat checks, and returns up to 20 text messages without media or sender metadata. Message bodies may contain personal data. Do not add customer messaging or broad write tools through this connector without a reviewed action-specific approval and rollback design.

### Retail commerce

Business operations use `/api/workspace/retail` with the shared owner, staff and agent session adapter as Inventory. Requests are authenticated and `private, no-store`; tenant IDs come from the session context. Store configuration and product publication require owner permission. `GET/PUT /store` reads and saves link, public content, delivery fees/zones and the enable switch. `PUT /listings/:productId` selects the public catalog category, approved photo and publication flag. Saving a private product never publishes it.

`GET /orders`, `GET /drivers`, `PUT /orders/:id/driver` and `POST /orders/:id/status` are owner/manager order actions. `GET /deliveries` and its status and cash-receipt endpoints are restricted to the active assigned agent membership; service handlers recheck assignment and current order state. Pickup cash is recorded through `POST /orders/:id/cash-received` by a permitted owner/manager. Delivery cash uses `POST /deliveries/:id/cash-received` by the assigned driver. A full exact COD amount must be recorded before delivery or pickup can complete. Idempotency keys reject conflicting retries. `POST /orders/:id/returns` records item quantities, reason and an optional post-inspection restock for owner/manager roles; it does not initiate or post a refund.

Cash reconciliation is a separate `retail.finance` plan capability and `/user?page=retail-finance` navigation entry. Only owner and accountant roles may call `GET /finance` and `POST /finance/settlements`. Matching handovers settle receipts once. A variance is retained for review and does not clear the cash due. This screen is an operational cash ledger, not a general ledger or payment processor.

The public shop uses a separate minimal API beneath `/business/:storeSlug/shop`: `GET /catalog`, `GET /image/:productId/:photoId`, `POST /checkout` and `POST /track`. Catalog and image responses include only explicitly published products/photos, and require an enabled storefront plus current commerce entitlement. Checkout validates same-origin requests, availability, current price, delivery zone and idempotency. The tracking endpoint returns only order status by an unguessable order reference. Public responses are not cached. The release must not publish a pilot merchant or assign a plan as a deployment side effect.
