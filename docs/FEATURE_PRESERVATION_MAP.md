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

The compiled shell mounts /admin, /user and /agent routes and related login/public routes. Internal panels depend on the compiled application rather than separate editable screen modules. Original frontend recovery remains open; if unavailable, maintainably recreate this same shell and migrate panels only when source-controlled replacement journeys pass. Do not introduce a disconnected CRM/login or replace this app with the separate newer GCCBOT product.
