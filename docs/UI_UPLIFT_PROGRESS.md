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
| Templates | Existing editor header, accessible template name and connected marketing navigation deployed | Library, remaining editor stages, samples/carousel/media, complete native Arabic copy and provider submission |
| Campaigns and Campaign Dashboard | Dedicated header/action, connected permission-aware navigation, clearer metrics/tabs/table and empty-template actions deployed | Remaining mapping/preview/queue/detail and delivery states, native Arabic copy, actual provider acceptance |
| Automation/Flows | Shell foundation | Canvas/node properties and responsive controls |
| Chatbots/FAQs | Shell foundation | Library/editor/import and errors |
| Notifications | Shell foundation | Feed, settings, unread/empty states |
| CRM appearance/settings | Shell foundation | Branding/domain form, validation and previews |
| Account/profile/sign-in | Shared root scope only | Existing account/login layouts and validation |
| Platform administration | Shared root scope only | Plan/user/staff screens and dialogs; preserve separate platform authority |

The shared foundation is deployed. A second refinement adds screen-specific layouts for Sales finance, deals/targets/reports, organization, audit, calls and tasks; material campaign/template controls, Team Access, Phonebook and FAQ surfaces follow the same design. A maintained synthetic browser runner covers 12 module routes with desktop populated/empty states, Arabic mobile states and denied mobile states. Deal cancellation/Escape/rejection payload and organization search/move-dialog cancellation are exercised. This synthetic evidence does not certify every provider or customer-data workflow. No section is marked fully accepted yet. Synthetic preview evidence and deployment facts are recorded in DEPLOYMENT.md when an increment is published. The active goal remains the entire requested uplift.

## Sales capability restoration

Release sales-messaging-ad72dee-20261019 restores QR, Meta connection, templates, campaign sending/dashboard, Flows and Chatbot/FAQs in the Sales registry and designated owner plan. All corresponding authenticated read APIs and chatbot runtime category resolution pass. Real campaign delivery and number pairing remain distinct provider acceptance steps. Campaign and template screens are now included in the priority design review.

## Product catalogue follow-up

Deployed product-ui-8e1ea9b-20261019: category-specific catalogue statistics and product descriptions, hidden Training-only editor fields, sequential visible sections, styled confirmations and corrected Arabic desktop dialog bounds. Actual-shell browser tests cover EN/AR at 1440/390, counts/description rendering, reachable Close and cancelled deletion with no writes. Training editor helper tests continue to pass. Production catalogue data is unchanged.

## Campaign and template navigation follow-up

Deployed marketing-ui-b91b949-20261019: improved native marketing headers, Campaign Dashboard metric/tab/table presentation, Create campaign shortcut, and a shared marketing navigation strip connecting results, preparation and template creation. Only currently granted role/member destinations appear. Empty template lists offer permitted template/Meta setup actions. The native dashboard/list, campaign configuration wizard and template editor remain in place; the template name receives its missing accessible label. Added labels support Arabic and the layout follows persisted direction; untranslated native React copy remains a follow-up.

The actual compiled shell passes synthetic EN/AR desktop/mobile navigation, dashboard tab/list, approved-template selection, disabled incomplete send, template Next/Back preservation, empty/limited permissions and Agent identity/member restrictions, with no submissions or provider calls. Eight focused unit checks pass. Production health, release/container/public file hashes and the Sales owner's nine read-only feature endpoints pass; DB/worker containers are unchanged. Final customer-session visual acceptance and real provider delivery remain open. This increment does not complete the wider page-by-page goal.
