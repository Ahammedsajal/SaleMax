# TC01 feature preservation map

This maps the requested existing features to inspected route families. Static route declarations and compiled labels are evidence of interfaces, not proof of working interactions. Status below remains **runtime acceptance pending** until permitted roles complete the actual bilingual journeys. Exact declarations are in `LEGACY_ROUTE_INVENTORY.json`; regenerate with `node scripts/inventory-routes.cjs`.

| Requested feature | Existing integration boundary | Required preservation acceptance |
| --- | --- | --- |
| Dashboard | /api/user/get_dashboard, compiled /user shell | Role totals, filters, drill-down and empty/error states reconcile with scoped records |
| Inbox | /api/inbox and existing QR/Meta helpers | Scoped conversations, assignment, history and channel readiness; verified send path when provider is enabled |
| Add WhatsApp by QR | /api/qr | Connect/state/disconnect/recovery and exclusive session ownership; local mode remains disabled |
| Link Meta WhatsApp | /api/user Meta routes | Authenticated setup, provider readiness and verified business/channel ownership |
| Automation Flows | /api/chat_flow | Preserve editor, save, validation and tenant-scoped execution; bounded external work |
| Chatbot | /api/chatbot | Preserve setup, changes and enabled/disabled states; valid scoped flows |
| Create Meta Template | /api/user template routes, /api/templet | Editor variables, category, rejection/approval and actual submission status |
| Send Campaign | /api/broadcast | Audience, template, consent, quotas, schedule and unique worker claims |
| Campaign Dashboard | /api/broadcast/dashboard and campaign detail | Actual provider statuses, failure/retry, filters and export |
| Lead Pipeline | /api/pipeline, editable client/public/pipeline | Ownership, stages, movement and activity; finance-safe terminal stages |
| Phonebook | /api/phonebook | Contacts/groups/import, validation, duplicates and tenant-scoped access |
| Agent Login | /api/agent/login, /agent/login shell | Stable membership/session migration, scoped identity and immediate revocation |
| Agent Task | /api/user task routes and /api/agent task routes | Assignment, due dates, completion and distinct role access |

## Guard mapping limits

Twenty mounted families contain 369 statically declared router routes, plus four direct app routes. Guard names in the inventory describe only declaration syntax. A route with no listed guard may inherit router-level validation or perform inline checks; a route with a guard may still have incorrect resource scope. The full TC35 permission matrix must inspect global/router middleware, callbacks, SQL ownership, exports and socket events. No unsupported provider feature is classified verified based on this inventory.

## Frontend preservation

The existing shell mounts /admin, /user and /agent routes and their login/public routes. These panels are the product to upgrade. Recover relevant frontend inputs where available and extend maintained modules/hooks without replacing the shell or manually patching minified application logic. A missing source file does not authorize a new frontend project, rebuilt shell, disconnected CRM/login, duplicate catalogue or substitution with the separate newer GCCBOT product.

## Required existing-module integration

Upgrade Manage Plans at /admin?page=manage-plans, including its current create/edit actions and commercial fields. Reuse /api/admin/add_plan, edit_plan and get_plans boundaries through compatible adapters to the versioned services. Connect category/capability and role-limit changes to the existing module and preserve plan IDs and assigned contracts through reviewed mapping.

Upgrade Manage Users at /admin?page=manage-users and its current /api/admin/update_plan assignment flow for business categories, owners and assigned limits. Preserve the admin/user login separation. New Courses, Finance, Reports and Forms screens belong inside the current business panel. Existing messaging, pipeline, contacts and agents are extended rather than recreated.

The isolated workspace/login/plan pages are development test artifacts only. Backend tests remain useful, but no ticket is integrated or complete until its functions work through the corresponding existing screen with regression evidence.
