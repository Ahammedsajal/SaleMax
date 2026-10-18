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
