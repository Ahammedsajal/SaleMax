# Existing SaleMaX UI uplift

Requested outcome: eliminate repeated catalogue navigation and improve every existing authenticated section's design, layout and interaction quality. Preserve Sales/Training categories, current routes, features, role authority, tenant scope, financial rules and English/Arabic support. A shared stylesheet alone does not complete the requested screen-by-screen work.

## Design direction

Retain SaleMaX's berry identity, use restrained slate text and a soft canvas, white elevated surfaces, clear page headings, compact labelled metric cards, consistent 40–44px controls, usable tables, purposeful empty/error states and centered dialogs. Keep native sidebar collapse/mobile behavior. Use the actual existing shell and maintained screen modules; do not alter compiled React or create a replacement dashboard/login.

## Completion evidence required

For every screen: inspect its existing rendered state; improve its actual layout; exercise main controls and navigation; check populated, empty, loading and denied/error states where relevant; verify EN/AR, desktop/mobile, active navigation and no duplicate links; document authenticated API coverage separately from synthetic browser evidence. Publish verified increments with rollback and deployment records. Do not claim all sections complete from representative screenshots.

## Coverage ledger

| Section | Current work | Required next evidence |
| --- | --- | --- |
| Shared business sidebar/header | First foundation deployed; catalogue consumer markers corrected | Native desktop/mobile drawers, all locale/role combinations, search/collapse/keyboard, live user confirmation |
| Products & services | Existing catalogue styling pass; profile/student cloning denied for Sales | Main editor, price/media/publish workflow, populated/error/mobile states |
| Training Courses | Shared foundation applies | Catalogue/editor, batches/offers/media and permission layouts |
| Dashboard, Sales and Training | Shared foundation applies to existing iframe | Role-specific cards, charts, shortcuts; desktop/mobile EN/AR |
| Sales overview | Shared module foundation | Populated performance/priorities layout and interactions |
| Sales deals | Shared module foundation | Creation, review, approval dialogs, table/cards, errors |
| Sales targets/performance | Shared module foundation | Target editor, monthly controls, team hierarchy |
| Sales reports | Shared module foundation | Filters, exports, long tables, report permissions |
| Sales commissions/payouts | Ledger layout deployed; responsive dialog refinement in progress | Populated ledger, review/payout controls, mobile EN/AR; preserve separation of duties |
| Commission policy | Shared module foundation | Policy versions, editor, tier controls and confirmation |
| Sales finance | Shared module foundation | Invoice/receipt/allocation and reconciliation views |
| Organization | Shared module foundation | Reporting hierarchy and member controls |
| Sales audit | Shared module foundation | Filters, event details and readable chronology |
| Lead pipeline | Shared module foundation | Board/detail/forms, assignment, drag/drop, calls and follow-ups |
| Lead reports | Shared module foundation | Date filters, drilldown, charts and exporting |
| Inbox | Shell foundation | Chat list, conversation composer, attachments, detail panels and quick replies |
| Phonebook | Shell foundation | Search, contacts/import, detail and sharing dialogs |
| Calls & recordings | Shared module foundation | Calls, recordings, coaching and denied/no-provider states |
| Tasks | Shared module foundation | Board/list, editor, reminders and assignment |
| Training admissions/students | Clone markers corrected | Lists/detail/enrollment and status forms |
| Training finance | Shared control foundation | Invoices, installments, payments, receipts and review workflows |
| Forms/applications | Shared shell foundation | Form library/builder, applicant list/detail |
| Training profile | Catalogue marker isolation | Logo/contact/address and public preview controls |
| Team Access | Existing wide dialogs retained; shared surface styling | Role/member/create dialogs, mobile long permission lists, validation |
| WhatsApp QR | Shell foundation | Connection cards, pairing modal, sharing and status/error states |
| Meta WhatsApp | Shell foundation | Setup form, status/cards, provider validation |
| Templates | Shell foundation | Library/editor, samples, carousel/cards/media |
| Campaigns | Shell foundation | Builder, mapping, preview, queue/report states |
| Automation/Flows | Shell foundation | Canvas/node properties and responsive controls |
| Chatbots/FAQs | Shell foundation | Library/editor/import and errors |
| Notifications | Shell foundation | Feed, settings, unread/empty states |
| CRM appearance/settings | Shell foundation | Branding/domain form, validation and previews |
| Account/profile/sign-in | Shared root scope only | Existing account/login layouts and validation |
| Platform administration | Shared root scope only | Plan/user/staff screens and dialogs; preserve separate platform authority |

The shared foundation is deployed. A second refinement adds screen-specific layouts for Sales finance, deals/targets/reports, organization, audit, calls and tasks; material campaign/template controls, Team Access, Phonebook and FAQ surfaces follow the same design. A maintained synthetic browser runner covers 12 module routes with desktop populated/empty states, Arabic mobile states and denied mobile states. Deal cancellation/Escape/rejection payload and organization search/move-dialog cancellation are exercised. This synthetic evidence does not certify every provider or customer-data workflow. No section is marked fully accepted yet. Synthetic preview evidence and deployment facts are recorded in DEPLOYMENT.md when an increment is published. The active goal remains the entire requested uplift.

## Sales capability restoration

Release sales-messaging-ad72dee-20261019 restores QR, Meta connection, templates, campaign sending/dashboard, Flows and Chatbot/FAQs in the Sales registry and designated owner plan. All corresponding authenticated read APIs and chatbot runtime category resolution pass. Real campaign delivery and number pairing remain distinct provider acceptance steps. Campaign and template screens are now included in the priority design review.
