# SaleMaX SaaS Upgrade and Training Center Implementation Plan

Version 1.3 | Existing-project scope confirmed 1 October 2026 | Product owner and implementation team

## 1 Executive decision and product promise

**Upgrade the existing SaleMaX application into a category-based business SaaS, launching with a complete training-center sales and collections workspace.** Reuse its working modules, admin and user panels, messaging and agent experience. Add the missing requirements to this project and connect every enquiry to an accountable agent, a course, an enrollment, an invoice, an installment schedule, and verified receipts.

The customer promise is simple: **Know who is handling every lead, what needs to happen next, and what money is still due.** The main user should run their center from the existing business panel; an agent should start the day with a clear work queue; an accountant should reconcile collections without chasing spreadsheets. Upgrade the existing admin panel for owner and delegated staff operations, with Super Admin authority available only to the platform owner.

This plan is the build specification for the active upgrade. The Markdown and Word editions contain the same substantive plan, section summaries, implementation tickets, and acceptance criteria. Implementation proceeds in dependency order; the phase gates below define when each ticket and the complete release can be considered finished.

**Readiness verdict:** Ready to begin the gated implementation program, starting with the source and foundation work. It is not permission to skip frontend recovery, schema/API contract validation, accounting configuration or runtime acceptance. Sections 21–25 tighten the end-to-end contracts following the design audit. A plan can establish a scalable design; only implementation evidence can establish a reliable released system. New audit tickets TC35–TC41 are launch requirements except where explicitly conditional.

### Mandatory existing-project implementation scope

The owner confirmed that this is an upgrade of the supplied SaleMaX project. No new project, replacement application, recreated shell, separate CRM, duplicate plan catalogue, or parallel login is authorized. Preserve the existing backend, admin panel, user panel, working modules, navigation, branding and English/Arabic behavior. Improve existing screens in place; add screens only for requirements the application does not already provide, inside the appropriate existing panel.

Preserve the /admin and /admin/login entry points for platform administration, and /user and /user/login for business users. Business login must not offer an administration switch. Owner and staff permissions change what the existing admin panel permits; they do not require another application shell. Existing agent entry points remain compatible with the shared identity upgrade.

Start the plan work in the existing Manage Plans screen at /admin?page=manage-plans. Upgrade its current list, create/edit actions and assignment flow with categories, features, versioned contracts and role limits. Preserve existing commercial fields, plan IDs and assigned-user history through an explicit mapping. Do not implement a second catalogue at /admin/plans or make customers maintain two plan modules. Upgrade Manage Users and its current plan assignment at /admin?page=manage-users for category assignment and per-business limits.

| Requirement | Existing module to extend | Missing work to add there |
| --- | --- | --- |
| Super Admin and delegated staff | Existing /admin panel and administration routes | Owner-only authority, staff grants, audit, system health and bounded support access |
| Plans and role-seat limits | Existing Manage Plans and plan create/edit APIs | Category/features, account limits, draft/version/publication rules, impact review and preserved assignments |
| Business accounts and plan assignment | Existing Manage Users and update_plan flow | Business category, canonical ownership, role accounts and explicit assigned limits |
| Messaging and marketing | Existing inbox, QR, Meta, flows, chatbot, templates and campaigns | Scoped permissions, category/plan access and verified provider compatibility |
| Leads and sales | Existing Lead Pipeline, Phonebook, Agent Login and Agent Task | Required lead fields, course interest, outcomes, notes, follow-up and controlled sale conversion |
| Course catalogue | Add a Courses section to the existing /user panel | Course details, prices, offers, duration and enrollment links |
| Finance | Add a Finance section to the existing /user panel | Invoice, receivable, installment, payment verification, receipt and correction workflows |
| Reports | Add Reports to the existing /user panel and dashboards | Agent accountability, daily/weekly/monthly reports, schedules and delivery evidence |
| Lead forms | Extend existing contact/public-form integration where suitable | Configurable tenant-bound mobile/tablet forms linked to the existing pipeline |
| Later business categories | Existing category/feature layer and same panels | Category-specific menus and workflows without another SaaS project |

Use the isolated databases and API tests to verify behavior. Earlier standalone workspace/login/plan screens are test artifacts only and are not the final product or acceptance evidence for integration. Reuse their validated backend services where useful; refactor useful UI controls into the existing module rather than deploying those separate shells.

Missing original frontend source does not authorize rebuilding the whole UI. Recover relevant inputs where available, or extend the existing source-controlled screen hooks and modules without replacing the current shell or manually patching minified application logic. Record module-specific source limitations and continue useful backend and existing-module work. A ticket is complete only when its added behavior works through the corresponding existing screen with old functionality preserved.

### Delivery areas

| Area | Result |
| --- | --- |
| Platform | Owner-only Super Admin, delegated SaleMaX Staff Admin, tenant accounts, plans, limits, audit, health monitoring |
| Category system | Versioned business-category modules and server-enforced feature access; training center first |
| Training center | Owner, accountant, manager, and configurable agent seats; existing messaging features preserved |
| Sales | Unified lead record, assignment history, follow-ups, course offers, enrollment and conversion |
| Finance | Issued invoices, receivables, installments, verified payments, receipts, credits and refunds |
| Public portal | Branded mobile and tablet forms, staff capture mode, course enquiry and registration |
| Reports | Daily, weekly and monthly owner summaries by email and WhatsApp with delivery tracking |
| Sellability | Guided onboarding, focused role dashboards, bilingual design, demo data and evidence-backed sales material |

### Release boundaries

Launch includes the entire workflow requested above, including reporting automation, receipt delivery, course management, manual verified payments, and operational controls. Online gateway payments depend on merchant eligibility and provider testing. Attendance, certificates, instructor scheduling, student self-service, AI assistance, commissions, and restaurant functionality are later extensions unless explicitly pulled into scope. The first release is a sales and collections product, not a full learning management system or statutory general ledger.

## 2 Evidence and decisions before coding

**Summary:** Audit the actual source before choosing framework changes or promising compatibility. The architecture below is a target design, not a claim that the current backend already supports it.

The owner confirmed the application source as `A:\Salemax - Training center\Salemax-Node`. The chat's original `GCCBOT-Node` folder contains browser evidence only. A read-only source inspection on 1 October 2026 establishes the following baseline; no application code, customer records, providers or runtime settings were changed during planning.

| Verified source item | Finding | Upgrade implication |
| --- | --- | --- |
| `package.json` and `server.js` | SaleMaX Node 3.6 package; Express backend, Socket.IO, mysql2, Baileys and Nodemailer dependencies | Extend Node/Express and the existing channel adapters; dependency presence is not provider verification |
| `LOCAL-RUN.md` | Documents loopback app port 3010 and MariaDB port 3307; local providers disconnected | Preserve the local-only boundary; run baseline smoke in P0 before claiming runtime health |
| `routes/admin.js` | Existing admin plan/user operations and auto-login route | Refactor into owner/staff capabilities; replace silent support login with audited session flow |
| `middlewares/user.js`, `admin.js`, `agent.js` | Separate user/admin/agent tables and role checks; agent has `owner_uid` | Introduce shared identity/membership gradually, preserving legacy IDs and login compatibility |
| `middlewares/plan.js` | User-stored JSON plan and expiry checks; feature-specific flags | Map old flags to versioned entitlements; preserve assigned contracts during migration |
| `routes/agent.js` | Agent creation checks plan validity; inspected creation handler has no atomic role-seat limit | Add transactional role-specific seat enforcement and scoped agent-management operations |
| `routes/pipeline.js` and `helper/pipeline/leadPipeline.js` | Existing owner-scoped pipeline, inbound deduplication, activity and transaction helper | Extend this pipeline rather than build a parallel CRM; adapt stage conversion to finance invariants |
| Pipeline agent query | Allows unassigned or own leads in the board query | Define an explicit unassigned-claim permission; assignment must be atomic and audited |
| `database/migrate-pipeline.js` | Selects all date-prefixed SQL files including a matching rollback script containing DROP TABLE statements | Separate forward/rollback paths and introduce a migration ledger before executing migrations |
| `client/public` | Built JavaScript/CSS shell plus editable admin-actions and pipeline integration scripts; no JSX/TSX/source maps found in inspected client tree | Preserve the existing shell and extend source-controlled modules/hooks; recover relevant frontend inputs where available, without rebuilding the application or patching minified logic |
| Package scripts and folder | Generic test script intentionally fails; SSO scripts reference a tests directory not found in the inspected root | Establish real regression/integration commands and verify any missing test assets |
| Source directory | No `.git` metadata or AGENTS.md found in the inspected tree | Establish a scoped repository/history before implementation commits; exclude backups, sessions, data and secrets |

Existing route mounts include user, web, admin, phonebook, chat flow, inbox, templates, chatbot, broadcast, agent, QR, pipeline and additional integrations. These are source-backed route observations, not confirmation that every feature works. P0 must exercise the existing workflows and review the actual database schema without exposing sensitive data. The user's existing-feature list is the preservation requirement.

Authentication currently uses email/password-related JWT claims and some error responses echo token data. Replace these with stable user/session identifiers, limited claims and sanitized error responses during the identity upgrade. This observation is a design prerequisite, not a completed security audit. Revalidate tenant ownership on every existing mutation as well as new routes.

Do not substitute another SaleMaX/GCCBOT checkout for this product. Do not read or copy credentials or personal backup data into the plan. Preserve the existing project and its panels. Recover relevant frontend source where available; otherwise extend the existing maintained modules/hooks and document the affected component limitation. Recreating the shell or starting another frontend project is outside this upgrade's scope. Continue backend and existing-module work that does not depend on missing inputs.

### Recommended defaults

| Decision | Default for implementation | Revisit condition |
| --- | --- | --- |
| First market | Owner-confirmed Qatar first, QAR, Asia/Qatar, English and Arabic; country configurable | Expansion into another market |
| Business category | One primary category per tenant in release one | A business needs separately governed multi-category workspaces |
| Tenant boundary | One business is one tenant; branches remain within it | Separate legal entity or independent data ownership |
| Accounts | One tenant owner, one accountant, one manager, up to seven agents initially | SaleMaX staff assign an approved higher/lower limit |
| Stack | Extend verified Node/Express and MariaDB with modules and workers | Source audit proves a component cannot meet requirements |
| Payments | Verified cash/bank records first; provider adapter for online payments | Merchant account, settlement and sandbox tests approved |
| Tax and revenue | Configurable tax profiles and accountant-approved revenue policy | Launch jurisdiction and business rules confirmed |
| Branding | SaleMaX platform with tenant-branded forms and documents | Approved white-label plan |

Country, tax, invoice numbering, terms, retention and gateway selection are implementation decisions that must be recorded before their relevant release gates. They do not prevent building tenant isolation, courses, lead workflows or provider-free local tests.

## 3 Research translated into product choices

**Summary:** Combine the training-provider registration model with SaleMaX messaging, then differentiate through agent accountability and collections visibility.

Arlo's registration offering links forms, course registrations, invoicing and learner records, and supports course transfers and cancellations. This supports treating enrollment as its own record rather than making a pipeline column the only proof of a course sale. SaleMaX should connect its existing lead experience to that record and retain the sales history. [Arlo course registration](https://www.arlo.co/features/course-registration-software)

AWS describes pooled, silo and bridge tenant models. A shared schema with explicit tenant boundaries is the recommended initial operating model; a future dedicated database option should use the same product and provisioning process. This is an architecture recommendation, not a requirement to host on AWS. [AWS SaaS partitioning](https://docs.aws.amazon.com/whitepapers/latest/multi-tenant-saas-storage-strategies/saas-partitioning-models.html)

PostgreSQL row security can reinforce application checks, but table owners and privileged roles can bypass normal policies. If PostgreSQL is selected after the source audit, use a restricted application database role and test its policies through real pooled connections. [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

WhatsApp's current policy requires recipient permission, approved templates for initiated platform messages and template use outside the 24-hour customer service window. Automated reminders therefore need consent, template readiness and explicit delivery states; the plan cannot promise unconditional WhatsApp delivery. Keep a clear human handoff in chatbot flows. [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy)

Payment providers may deliver duplicate or out-of-order webhook events. Our provider contract must support verified callbacks, deduplication and reconciliation rather than trust a browser success screen. Stripe documentation is a reference for this integration behavior, not a selection of Stripe for the launch country. [Stripe webhook guidance](https://docs.stripe.com/webhooks)

IFRS 15 relates revenue to the satisfaction of promised goods or services. The product must distinguish invoice issuance, payment collection and revenue recognition; a training course sold today may be delivered later. The applicable accounting policy must be agreed with the center's accountant. [IFRS 15 overview](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/)

Use WCAG 2.2 AA as the design acceptance target for accessible forms and dashboards. Keyboard use, labelled errors and readable contrast belong in the launch checks. [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)

For Qatar payments, shortlist SADAD hosted checkout for a provider evaluation: its developer portal documents merchant onboarding, test/live credentials and callback processing. Evaluate settlement, refunds, tenant merchant mapping, operational support and total cost before selecting it. The existing Stripe/Mercado Pago libraries do not establish Qatar merchant suitability. [SADAD developer portal](https://developer.sadad.qa/)

Qatar's NCSA publishes resources for the Personal Data Privacy Protection Law No. 13 of 2016. Use its compliance guidance when defining business/platform data responsibilities, notices, access and retention. Local professional review should confirm launch obligations; do not assert certification from this plan. [NCSA privacy compliance resource](https://www.ncsa.gov.qa/en/media/news/National%20Data%20Privacy%20Office%20launches%20the%20Organization%20Level%20Privacy%20Compliance%20Assessment%20Tool-299166)

### Product opportunities beyond the initial idea

1. **Today view:** combine unattended leads, overdue follow-ups, payments due and channel failures in an actionable owner dashboard.
2. **One customer timeline:** enquiries, WhatsApp conversations, assignments, notes, enrollments, invoices and receipts appear together with role-based visibility.
3. **Lost-lead recovery:** a manager sees neglected or stalled leads, chooses a recovery action and measures whether it converts; no uncontrolled bulk sending.
4. **Course demand view:** compare enquiries, enrollments, available seats and money collected per course, helping decide which batch to open next.
5. **Collection forecast:** show scheduled amounts due over the next seven and thirty days separately from guaranteed cash or earned revenue.
6. **Ready-to-use category kit:** seed sensible forms, stages, report schedules and reminder drafts so a center starts with working conventions.

These are original product recommendations informed by the workflow; they are not assertions of competitors' limitations or guaranteed business results.

## 4 Platform hierarchy and authority

**Summary:** Separate platform ownership, staff operations and tenant work. A tenant role must never imply platform access.

### Super Admin for the platform owner

Use the existing `/admin` panel and `/admin/login` entry point, with owner-only Super Admin permissions and owner-specific screens inside that panel. Only the owner identity has this role; no public registration, tenant invitation, staff promotion or ordinary profile editor can grant it. Require MFA, sensitive-action reauthentication, recovery codes, session revocation and owner-role transfer through a dedicated audited recovery procedure.

Super Admin sees platform health, tenant/account directories, categories, plans and plan versions, entitlement overrides, staff permissions, subscription status, provider health, queue failures, usage/cost trends, audit events, security sessions, export jobs and release controls. Tenant detail includes category, owner, seats by role, contacts, channel status, subscription, feature overrides and recent incidents.

Owner controls include tenant suspension/reactivation, controlled category changes, owner transfer, staff creation, plan publication, limit ceilings, feature releases, provider enablement, export initiation and retention/deletion workflows. Every high-impact change requires a reason and before/after audit data. Suspension should stop new outbound jobs and writes according to policy without deleting history. Financial evidence remains preserved.

Full control does not require storing plaintext passwords or routinely exposing all customer messages. Provide audited, time-limited support access with an explicit tenant banner; default to read-only. Log owner access to tenant data. A supervised write session requires a reason and reauthentication. Never imitate a tenant user invisibly.

### SaleMaX Staff Admin

Use the existing `/admin` panel and administration login with a delegated staff role and a permission-scoped menu. Staff manage tenant onboarding through Manage Users, plans through Manage Plans, account recovery assistance, approved plan assignments, seats within delegation, account status and support tickets. The owner grants granular permissions rather than a single unrestricted staff role. Staff cannot access owner-only Super Admin operations.

Recommended staff profiles: Account Operations can create tenants and assign published plans; Plan Operations can draft/version plans and publish only when delegated by the owner; Support can inspect connection metadata and request limited support access. A staff member may hold multiple profiles. Staff cannot grant Super Admin, modify owner recovery, view secrets, erase audit history, bypass a limit ceiling or change unapproved billing rules.

Plan changes show an impact preview: affected tenants, current usage, new limits, effective date and grandfathering. Assignment logs actor, tenant, plan version, dates, reason and override. Staff can make and manage plans as requested; owner-configured delegation determines whether they can publish globally.

### Tenant roles and default seats

| Role | Default count | Main responsibility | Scope |
| --- | --- | --- | --- |
| Business owner | 1 | Settings, team, business oversight, reports and financial approvals | Entire tenant |
| Accountant | 1 | Invoices, verified payments, receipts, reconciliation and credits | Tenant finance and required customer details |
| Manager | 1 | Assignments, pipeline, team performance, follow-up exceptions and course offers | Entire tenant sales operations |
| Agent | Up to 7 | Assigned conversations/leads, notes, follow-ups, offers and tasks | Assigned records; team sharing only by permission |

Limits are separate keys: `owners`, `accountants`, `managers`, `agents`, plus an optional total-seat ceiling. Limits count active users and unexpired pending invitations; deactivated accounts remain historically attributable. Seat reservations must be atomic so concurrent invitations cannot exceed seven. Downgrade never silently deletes users: warn, prevent new seats and require a deliberate deactivation plan. Tenant owners invite staff within their assigned limits and cannot enlarge their own entitlements.

The existing Agent Login entry remains available. It should resolve to the same identity and permissions system, with an agent-focused destination; avoid maintaining a separate password store. Existing credentials require an audited migration if the current system differs.

### Permission matrix

| Action | Owner | Accountant | Manager | Agent |
| --- | --- | --- | --- | --- |
| Tenant settings and team invitations | Yes within limits | No | Delegated only | No |
| Configure channels, flows, chatbot and campaigns | Yes | No | Explicit delegation | No by default |
| Lead access and assignment | All | Billing-related details | All and reassign | Assigned only |
| Notes and follow-up outcomes | All | Finance notes | All sales records | Assigned records |
| Course catalogue and batch editing | Yes | Read | Yes | Read |
| Quote and sale request | Yes | Read | Approve within policy | Request within price rules |
| Invoice issue and payment verification | Yes with finance permission | Yes | Read or request | No |
| Discount beyond configured threshold | Approve | Finance review | Request | Request |
| Refund or credit | Final approval | Prepare and post approved action | Request | No |
| Reports and exports | All | Finance | Team sales | Own performance only |

Permissions apply to fields, API operations, exports, files, live updates and background jobs. An agent must not obtain tenant finance totals through an export or hidden endpoint. Absence from a sidebar alone is never authorization.

## 5 Category modules and subscription entitlements

**Summary:** Category chooses the business workflow; plan chooses its available features and limits; role chooses the user's actions.

Effective access requires all of: active tenant and membership, supported category capability, effective subscription entitlement, role permission, record scope, and runtime readiness for external actions. Recheck at execution time for queued sends, reports and exports. Use a backend-generated capability response for navigation and an independent backend guard for each operation.

Separate shared capabilities such as `messaging.inbox`, `messaging.meta`, `crm.leads`, `team.tasks`, `reports.schedule` and `finance.receipts` from training capabilities such as `training.courses`, `training.batches` and `training.enrollments`. Use versioned module manifests with route contributions, default widgets, permission keys, form schema, event handlers and migration dependencies. The manifest is trusted deployed configuration, never arbitrary customer-supplied executable code.

A tenant record stores primary `category_key` and category version. Plan versions store capability keys and limits. Tenant overrides are effective-dated, reasoned and audited. Capability cache keys include tenant, membership and entitlement versions; invalidate them on plan, role or status changes. Publish plan versions immutably so editing a new plan does not secretly alter existing contracts.

Restaurant expansion later adds restaurant-owned tables, screens and events such as menu, orders and reservations. It reuses identity, billing, contact, notification and audit services; training courses and enrollments do not become restaurant objects. Prove this architecture with a non-public dummy category fixture that has different navigation and rejects training APIs.

Changing an active tenant's category is a migration operation, not a dropdown update: inventory existing records and contracts, preview unavailable features, export required history, obtain owner-controlled migration approval, map supported data and retain historical access. A staff admin cannot conceal finance records by switching categories.

### Sellable plan structure

| Proposed tier | Intended customer | Commercial distinction |
| --- | --- | --- |
| Essentials | Small center | Core messaging, leads, courses, forms, basic finance and owner reports |
| Growth | Center with sales team | More seats, automation, installments, team analytics and recovery queues |
| Scale | Larger or multi-branch center | More capacity, branch controls, integrations and enhanced support |

These names and bundles are proposals, not published offers or approved prices. Set actual prices after measuring support, hosting, messaging, email, storage and payment costs. Keep platform subscription invoices separate from the training center's learner invoices. Show third-party usage costs transparently; do not advertise unlimited messages or guaranteed delivery. Invoice and data export remain available under an agreed offboarding/read-only policy.

## 6 Navigation and screen specification

**Summary:** Retain every requested existing feature, introduce training and finance screens, and make each role's first screen immediately useful.

Extend the existing admin and user shells with tenant branding, role badge, language toggle, notification center and global search restricted to accessible records. Upgrade existing screen components and actions first. Missing features use proper routes and detail screens within those panels, preserving the current query-page navigation where applicable. Group the sidebar for readability while keeping existing entries and requested labels recognizable. New styling must fit the current UI; do not deploy the separate test workspace as its replacement.

| Group | Screens | Main behavior |
| --- | --- | --- |
| Overview | Dashboard | Role-specific work queue and exception cards |
| Conversations | Inbox, Add WhatsApp by QR, Link Meta WhatsApp | Existing experiences with connection state and ownership |
| Automation | Automation Flows, Chatbot, Create Meta Template | Preserve builders and extend approved training triggers |
| Marketing | Send Campaign, Campaign Dashboard | Preserve audience selection, consent checks and measured statuses |
| Sales | Lead Pipeline, Phonebook, Agent Login, Agent Task | Unified customer history, assignment and next action |
| Training | Courses, Batches, Enrollments | Course catalogue, offers, seats and enrollment status |
| Finance | Overview, Invoices, Installments, Payments, Receipts, Credits and Refunds | Receivables and collections with approval trails |
| Insights | Reports, Scheduled Reports | Daily, weekly, monthly views and recipient/delivery settings |
| Portal | Lead Forms, Form Submissions | Configure, preview, publish and inspect captured leads |
| Administration | Team and Roles, Business Settings, Subscription and Usage | Tenant configuration within platform entitlements |

Owner sees a business overview: new leads, unattended leads, overdue follow-ups, won enrollments, invoiced value, collected value, outstanding balance and payment exceptions. Actions lead to filtered lists rather than decorative graphs.

Manager sees team queue, agent availability, leads past SLA, conversion by course and stalled deals. Accountant sees payments awaiting verification, due installments, unapplied money, receipts and reconciliation issues. Agent sees assigned leads, unread conversations, tasks due and one prominent Next Action button.

### Critical screen contracts

**Lead detail:** customer header, stage, assigned agent, source, course interests, timeline, notes, follow-up date, offer/enrollment links and permitted financial status. A follow-up panel captures outcome, next action and due date in one save. Notes are timestamped and append-only with correction history; separate private internal notes from customer messages.

**Course detail:** active offers, batch dates, duration, delivery mode, current price, registration requirements and demand/collection summary. Retire a course without altering historical invoices.

**Invoice detail:** immutable issued snapshot, status, line items, tax, installments, payment allocation, remaining amount, audit trail and controlled credit/refund actions. Generate downloadable branded PDFs, including Arabic and English rendering.

**Forms editor:** safe field blocks, reorder, required rules, course selection, consent text, preview at phone/tablet width, saved draft and published version. Never require tenants to write HTML or SQL.

**Report detail:** period, metric definitions, filters, generation time, drill-down, schedule, recipients and delivery attempts. Differentiate failed generation from failed delivery.

### Design standard

Responsive layouts at 360, 768 and 1280 pixels; touch targets appropriate for phones/tablets; keyboard access and inline error summaries. Use English and Arabic translations with true RTL layout, correct mixed phone/email direction, locale dates, currency and document fonts. Use useful empty states, progress indicators, undo for reversible actions and explicit confirmation for posted finance changes. Aim for fewer fields during enquiry and progressive collection before enrollment.

## 7 Courses and the enrollment lifecycle

**Summary:** Model a reusable course, a priced offer and a scheduled batch separately so pricing changes and capacity do not corrupt existing sales.

Course fields: name in English/Arabic, code, description, outcomes, category, duration value/unit, delivery mode, level, prerequisites, brochure, active status and tax profile. Offers contain currency, list price, registration fee, inclusions, allowed discounts, validity dates and permitted installment templates. Batches contain course, branch, start/end dates, timetable, language, capacity, trainer reference and status.

Start with simple batches and capacity; full instructor/resource scheduling remains a later module. A course with no published batch can accept an enquiry or waiting-list registration, but it must not falsely promise a scheduled seat. Sale confirmation captures the selected offer version and batch or explicitly agreed unscheduled enrollment terms.

Enrollment states: requested, reserved, confirmed, cancelled, transferred and completed. Payment states are separate: unpaid, partially paid, paid, overdue, disputed, refunded. Define whether a deposit is required to confirm a seat. Reservation expiration and confirmation happen with database locking so concurrent requests cannot oversell a batch. The enrollment records learner and payer separately for parent or corporate payments.

Transfers preserve the original registration, record the new batch/course and calculate any approved credit or additional invoice. Cancellation records reason and policy; it never deletes issued invoices, receipts or history. No automatic full refund unless the documented policy and approval allow it.

## 8 Lead capture and agent accountability

**Summary:** Capture only enough data to start a conversation, then require the information needed for a defensible sale and invoice.

### Data requirements by step

| Step | Required | Optional or conditional |
| --- | --- | --- |
| Initial enquiry | Name, reachable phone or email, source, tenant form/version, course interest or Other | Preferred language, preferred contact time, branch, referral, marketing consent |
| Qualification | Assigned agent, course interest, outcome, next action when open | Budget, preferred batch, delivery mode, timeline, employer |
| Sale confirmation | Learner name, payer/billing name, valid contact, offer/batch, agreed price, currency, terms, schedule | Billing address, corporate reference, approved discount, tax identifier where required |
| Automated delivery | Valid destination and relevant consent/recipient settings | Missing email is visible; no invented address or misleading sent state |

Email is requested and validated before invoice/report email delivery, but an initial enquiry may be phone-only. Do not collect passport, national ID or sensitive identifiers by default. If legally necessary for a course, use restricted secure collection with a separate retention rule; do not request them in WhatsApp messages.

Normalize phone numbers with country context and store canonical E.164 where possible. Deduplicate inside the tenant using normalized phone/email plus reviewable matching; a shared family phone must not automatically merge different learners. One contact can have several course opportunities. Record original source and latest touch separately, including form, campaign, branch and authenticated referring agent.

Recommended pipeline: New → Assigned → Contacted → Qualified → Offer Sent → Decision Pending → Won or Lost. Follow-up is a due action across stages rather than the only place to find leads needing attention. Add unqualified and duplicate dispositions with reason. Won requires the sale transaction described in section 10. Lost requires a reason and optional permission-based future nurture.

Default routing uses a tenant-configured round-robin among eligible active agents, with branch/language/course filters and an unassigned fallback. Manager reassignment records from/to agent, time and reason. Assignment history lets reports distinguish first responder, current owner and closing agent. Working-hour SLAs are configurable; proposed starting values are fifteen minutes to first assignment and two business hours to first human response, then calibrate with the pilot.

Every agent outcome records contacted/not reached/interested/not interested/needs information/sale requested, note, and next action. Nonterminal leads require a follow-up date or explicit manager-approved no-follow-up reason. Disable silent deletion of notes, changes to assignment history and retrospective manipulation of timestamps. Lead merges keep aliases, activity and financial links.

## 9 Public portal and staff capture mode

**Summary:** Give each center a branded published form that works on mobile and tablets and submits safely into its own lead workflow.

Public route pattern `/p/{tenantSlug}/forms/{formSlug}` with optional verified custom domain later. The server resolves published tenant and form version; a submitted `tenant_id`, price, agent ID or course ID is never trusted. Public routes accept only allowlisted fields and valid selectable tenant-owned course options.

Templates: Quick Enquiry, Course Registration Interest, Walk-in Capture and Corporate Enquiry. Fields support text, phone, email, selection, date and consent checkbox; conditional visibility is allowlisted configuration. Save drafts, publish immutable versions, retain submitted consent wording/version and offer a receipt of enquiry. An enquiry acknowledgment is not a payment receipt or confirmed seat.

Staff mode is authenticated and automatically attributes the collecting employee; referral links may record source but cannot grant staff identity. For a shared reception tablet, use a restricted kiosk session, clear entered data after submission and offer no access to previous customers. Submission cannot become an invoice or payment without the authorized sale workflow.

Protect with rate limits per form/IP/tenant, honeypots, configurable bot challenge, payload limits and generic confirmation that does not reveal whether a phone already exists. Return a submission reference and deduplicate retries using a submission token. Record marketing consent independently from service contact preferences. Do not cache personal data in a service worker. Avoid local offline storage in release one; if the connection drops, show a safe retry state rather than falsely reporting success.

After submission: persist the submission and contact/lead transaction, record source, enqueue routing and permitted acknowledgment, show status to staff and preserve audit evidence. Form analytics distinguish views, submissions, qualified opportunities and enrollments; counts must not reveal other tenants.

## 10 Sale conversion and financial correctness

**Summary:** Confirming a sale creates enrollment and invoice records together; receiving a payment reduces receivables and creates a unique receipt. Never credit sales twice.

### The conversion transaction

The agent selects Confirm Sale or Request Sale Approval on the lead. A full review screen shows learner/payer details, selected offer and batch, agreed price/discount, tax profile, installment dates, invoice contact and terms. Field errors prevent incomplete conversion. Discounts over the configured threshold require manager/owner approval; invoice issue requires finance permission.

Within one database transaction, validate tenant and role, lock the capacity/lead revision, reserve or confirm enrollment, snapshot the offer, create and issue one invoice, create its installment schedule, link the opportunity, transition it to Won, write accounting events and add outbox jobs. A tenant-scoped idempotency key prevents a second click or timeout retry from producing a second invoice. If any mandatory step fails, the transaction rolls back. Notify customers only after commit.

A legitimate later sale for the same learner creates a new opportunity/enrollment. Reopening a converted lead must not erase the invoice or create duplicate revenue. Use correction or cancellation procedures.

Apply the conversion rule to the existing pipeline's drag/drop, stage-move API, chatbot/flow moves, bulk imports and any admin override. No alternate route may mark an opportunity Won without the required sale record. Map the current stages into the recommended stage semantics rather than overwrite tenant-customized stages blindly; historical Won entries remain explicitly tagged legacy/imported until reconciled.

### Posting model and revenue policy

| Event | Debit | Credit | Effect |
| --- | --- | --- | --- |
| Issued invoice where revenue is already earned | Accounts receivable | Revenue and applicable tax payable | Creates amount due |
| Issued invoice for training to be delivered later, where an unconditional receivable exists | Accounts receivable | Deferred revenue and applicable tax payable | Creates amount due, separates unearned value |
| Verified cash or bank payment allocated to invoice | Cash or bank, or gateway clearing | Accounts receivable | Reduces amount due; no second sales credit |
| Delivery earning deferred revenue | Deferred revenue | Revenue | Recognizes earned training revenue under approved policy |
| Payment before an issued invoice | Cash or bank | Customer deposit liability | Holds unapplied customer money |

These are illustrative posting rules, excluding special tax timing and contract cases. Accountant review must establish local tax treatment, when a receivable is unconditional, revenue policy, refunds and recognition schedule. Record balanced immutable journal entries as an operational subledger and export them for the accountant. Do not market the release as certified statutory accounting.

For gateway fees, retain gross customer payment, fee and net settlement separately: payment into clearing reduces receivables; settlement clears the provider balance and records fee expense. Do not reduce the customer's paid amount by the provider's fee.

### Invoice and installment rules

Draft invoices are editable; issued invoices have immutable numbering, line snapshots and totals. Numbering is unique per tenant/legal entity series and period, allocated safely under concurrency; voided numbers are retained. Correct issued documents through credit notes or explicit legally permitted amendment flows. PDF copies preserve the issued version, tenant identity, currency, payment terms, due dates and remaining balance.

Store money using currency-aware integer minor units or fixed decimal types, never floating point. Document rounding per line/tax and deterministic allocation of the final rounding difference. Installment totals equal invoice balance at issuance; installment states are pending, due, partial, paid, overdue or cancelled. Partial and early payments are allowed. Default allocation applies money to oldest open due items within the same currency; accountant can override with a recorded reason. Never allocate more than received or more than open debt. Excess is unapplied credit/customer deposit; no negative receivable hidden in the UI.

Rescheduling future installments creates a new schedule version, preserves paid portions and history, requires approval and changes pending reminder jobs. Do not create automatic late fees, financing charges or buy-now-pay-later lending in release one.

### Payment verification and receipts

Cash/bank: an authorized recorder creates a pending payment with method, date, reference and restricted proof. Accountant verifies; duplicate-reference warnings and permission rules protect against accidental double entry. Optional second approver applies above a tenant-configured amount. A screenshot is supporting evidence, not automatic proof of settlement.

Online: the customer uses hosted provider checkout owned by the training center's merchant account. Verified signed callbacks and server-side provider retrieval confirm amount, currency, merchant and invoice. A return URL alone never marks paid. Deduplicate both provider event IDs and underlying transaction IDs; reconcile unresolved and out-of-order events. Card data never enters SaleMaX form fields.

Only a posted verified payment creates a numbered receipt. One posted payment creates one receipt, even if allocated to several installments; receipt lists allocations, method, date, amount, invoice references and remaining balance. Queue separate authorized deliveries to customer, accountant and owner. Failed delivery does not undo a payment; the receipt remains downloadable and delivery can be retried without creating a new receipt.

Credits reduce the invoice under approval. A refund is a separate cash movement linked to the payment and credit decision. Failed provider refunds remain pending; do not label completed based on a request alone. Reversals reference the original posted entry; they never edit or delete it. Chargebacks are explicit dispute/reversal events with reconciled balance consequences.

### Acceptance example

Illustrative course price QAR 3,000, no tax assumed for this example only. Issue invoice TC-2026-000123 with three installments of QAR 1,000. Initial receivable is QAR 3,000. A verified QAR 1,000 payment produces one receipt and leaves QAR 2,000 due. A duplicate callback creates no extra payment or receipt. A later QAR 500 payment leaves QAR 1,500 due with the second installment partly paid. Deferred versus earned revenue follows the configured course-delivery policy independently of these collections.

## 11 Automation and dependable communication

**Summary:** Automate useful events through one notification service, with permission, consent and current financial state checked immediately before sending.

| Trigger | Recipients | Recommended behavior |
| --- | --- | --- |
| Form submitted | Customer and eligible sales queue | Acknowledge enquiry, route lead, create next action |
| Lead unattended or follow-up overdue | Agent, then manager | Internal alert with link and escalation rule |
| Invoice issued | Customer; owner/accountant copy by setting | Send invoice and schedule using eligible channels |
| Installment due | Customer and finance queue | Draft default offsets of 3 days before, due date, 3 and 7 days after |
| Verified payment posted | Customer, accountant, main owner | Deliver receipt and remaining balance |
| Daily, weekly, monthly report ready | Main owner | Email detailed report and WhatsApp summary/secure link |
| Channel or delivery failure | Tenant owner/manager and platform operations as relevant | Actionable issue with status and retry control |

Reminders are tenant-configurable and require approved templates/consent where applicable. Stop or recompute reminders after payment, credit, refund, cancellation, reschedule, dispute hold or opt-out. Re-read invoice and installment balances at dispatch to prevent stale reminders. A collection hold suppresses debt reminders without hiding debt from the accountant.

Submit each template for its appropriate purpose and provider classification. Do not assume an owner management report will automatically qualify as a utility template, or mix marketing offers into a payment receipt/reminder template. Display rejection or reclassification as a readiness issue and retain an eligible email delivery path.

Official Meta integration is the target for dependable scheduled external communication. Preserve the existing QR feature and clearly show its availability/reconnection state; do not represent QR sessions as equivalent to approved Meta Business Platform access. Do not silently switch a failed channel to QR or another recipient. Owner report destinations are separately verified and opted in.

Use transactional outbox records, asynchronous workers, bounded exponential retries and dead-letter review. Notification identity includes tenant, event, recipient, channel and document/report version. Provider acceptance is not final delivery: states include queued, processing, accepted, delivered, failed, suppressed and unknown. Preserve provider message IDs and callbacks. Unknown send outcomes require reconciliation before a blind resend; external exactly-once delivery cannot be guaranteed.

Email uses authenticated tenant/platform sender arrangements, bounce suppression and provider status logging. Email and WhatsApp successes are recorded separately. If one channel fails, retry the eligible failed channel and show partial delivery. Signed report/document links expire; detailed financial information requires authenticated access. Link prefetch must not consume a one-use token unexpectedly.

Extend existing flow builders with authorized training events rather than create a second automation engine. Prevent loops with event lineage, depth caps and per-tenant quotas. Imported templates or flows do not execute without validation and readiness checks.

## 12 Reports that answer management questions

**Summary:** Reports explain who handled each lead, what happened, what comes next and what was billed or collected. Each number must have a definition and drill-down.

### Metrics and definitions

| Metric | Definition and interpretation |
| --- | --- |
| New leads | New distinct opportunities created during the period; display contacts separately |
| Leads attended | Distinct leads with a qualifying human interaction logged during the period; automation excluded |
| First response time | Business-time difference from enquiry to first qualifying human response; median and P90 |
| Follow-up compliance | Tasks due in period completed on/before due time divided by tasks due; approved exclusions shown |
| Cohort conversion | Leads created in a period that reach Won by the stated cutoff divided by eligible leads in that cohort |
| Period wins | Enrollments won in the reporting period, regardless of when the lead was created |
| Invoiced value | Issued invoice value in period with credits shown separately; not cash or earned revenue |
| Collected value | Verified posted receipts during period; refunds/chargebacks and net collection shown separately |
| Outstanding | Issued open receivables at the report cutoff after allocations and credits |
| Overdue | Open installment balances past due at cutoff; current/future balances excluded |
| Course demand | Enquiries, qualified leads, confirmed enrollments, seats and collections by course |

Display booked value, invoiced value, cash collected and recognized revenue separately. Agents' conversion attribution must show first responder, closing agent and current assigned owner as different dimensions. Reassignment must not rewrite historical performance. Never compare new-lead counts with unrelated historical wins as if it were cohort conversion.

### Scheduled output

Daily proposed default: 20:00 tenant local time for that day's cutoff; summary includes new/attended/unattended leads, each agent's outcomes, overdue follow-ups, wins, collections, and tomorrow's actions. Weekly proposed default: Monday 08:00 for the previous configured Monday-to-Sunday week. Monthly proposed default: first calendar day 08:00 for the previous month. Tenant owner can change timezone, working week, cutoff and recipients; use IANA timezone identifiers and UTC storage.

Weekly adds funnel movement, agent trends, course demand, lost reasons, outstanding aging and source performance. Monthly adds course/batch performance, billed/collected/credited/refunded figures, collection forecast and comparisons to prior period. Aging buckets are not-due, 1–30, 31–60, 61–90 and over 90 days, calculated from installment due dates.

Lead-level drill-down contains source, course interest, current stage, assignment history, who attended and when, outcome, permitted notes, next action/date and sale/finance links. Owner and manager access differs from agent access; accountant gets finance-relevant detail without unrestricted private sales notes.

Each report stores tenant, schedule/version, period start/end, timezone, cutoff, generation timestamp, metric-definition version and snapshot identifier. Late data corrections create a revised version and explanation. A duplicate scheduler run must not send the same report twice. Before dispatch, verify current recipient role, email/phone and delivery permission. Main owner is the default recipient; manager/accountant are explicitly configured additions. The database stores report truth; WhatsApp is a concise summary and authenticated link, while email may include an authorized PDF/CSV attachment.

## 13 Architecture and data contracts

**Summary:** Extend the existing application as modules, place slow and external work in workers, and establish tenant and finance invariants before scaling.

### Logical components

Tenant UI, staff UI and owner UI use shared design components but different authorization scopes. Public forms have a limited public API. The backend contains Identity, Tenancy, Category/Entitlements, Messaging, CRM, Training, Finance, Reporting, Notifications and Audit modules. Workers handle delivery, document generation, scheduled reports, imports and reconciliation. A relational transactional database holds business records; object storage holds private documents; queue/cache supports background work and rate limits.

Use a modular monolith initially: one deployable core with documented module boundaries and independently scalable workers. Do not impose a framework rewrite or microservices migration until source evidence and measured load justify it. If the existing database is not PostgreSQL, preserve it when it can enforce required transactions, tenant constraints and indexing; PostgreSQL is an option, not a verified existing component.

For this source, keep MariaDB as the initial database. Use InnoDB transactions, tenant-aware keys/constraints and mysql2 pooled connection ownership. The existing `database/dbpromise.js` general query helper is insufficient by itself for a multi-statement finance transaction; reuse/adapt the pipeline's dedicated connection pattern so every statement, journal event and outbox insert commits together. MariaDB tenant isolation will rely on consistent application/query enforcement and constraints; PostgreSQL RLS is only an optional later architecture change.

Suggested source layout after the audit: shared policy/context middleware under `middlewares/`, domain services under `modules/tenancy`, `modules/training`, `modules/finance` and `modules/reporting`, additive route files under `routes/`, forward migrations under a dedicated tracked migration directory, worker entrypoints under `workers/`, and meaningful integration tests under `tests/`. Add shared event/notification services rather than another independent loop per new feature. Preserve `routes/pipeline.js` and its domain helper as the CRM extension point. The recovered frontend source should compile deterministically into `client/public`.

### Principal records

| Domain | Records and relationships |
| --- | --- |
| Platform | Tenant, CategoryVersion, PlanVersion, Subscription, EntitlementOverride, StaffDelegation |
| Identity | User, TenantMembership, RolePermission, Invitation, SeatReservation, Session |
| CRM | Contact, LearnerProfile, Opportunity, CourseInterest, AssignmentEvent, LeadActivity, Note, FollowUpTask |
| Training | Course, OfferVersion, Batch, Reservation, Enrollment, EnrollmentTransfer |
| Finance | Invoice, InvoiceLine, InstallmentScheduleVersion, Installment, Payment, PaymentAllocation, Receipt, CreditNote, Refund, JournalEntry/Line |
| Portal | Form, FormVersion, Submission, ConsentRecord, Attribution |
| Messaging | ChannelAccount, Conversation, Message, TemplateReference, Notification, DeliveryAttempt |
| Operations | OutboxEvent, WebhookReceipt, ReportSchedule, ReportSnapshot, ExportJob, AuditEvent |

All tenant-owned records include tenant ID, stable record ID and timestamps. Use tenant-aware foreign keys so an invoice cannot refer to another tenant's contact. Platform records have an explicitly separate scope. Contacts can have many opportunities; one enrollment has its invoice relationship; payments have many allocations; one posted payment has one receipt; issued invoice lines snapshot their offers rather than reference mutable current pricing.

Tenant context derives from authenticated membership, not an arbitrary header/body parameter. Platform support uses a distinct elevated audited context. Background jobs carry tenant and resource IDs, then independently load and validate resource ownership. Derive provider webhooks' tenant from the verified channel/merchant mapping, not an untrusted callback field.

Tenant scoping covers queries, uniqueness rules, cache keys, queue messages, object paths, search, exports and WebSocket subscriptions. Private objects require short-lived authorized download URLs. Cross-tenant document IDs must fail even when valid. Audit actor, tenant, action, reason, target, before/after safe fields and correlation ID; redact secrets and unnecessary personal data.

### Suggested API contracts

These are target contracts to map onto existing routes after P0, not existing endpoint claims. All authenticated mutations validate capability, role and resource scope.

| Method and route | Contract |
| --- | --- |
| GET `/api/v1/me/capabilities` | Effective category, permissions, limits, usage and readiness |
| POST `/api/v1/team/invitations` | Atomically reserve authorized seat; expiry and idempotency |
| GET/POST `/api/v1/training/courses` | Tenant catalogue; safe versioned offer editing |
| POST `/api/v1/leads/{id}/confirm-sale` | Expected record revision plus idempotency key; enrollment/invoice transaction |
| POST `/api/v1/finance/payments` | Pending manual payment with invoice/allocation request |
| POST `/api/v1/finance/payments/{id}/verify` | Authorized atomic posting, allocation and receipt |
| POST `/api/v1/finance/invoices/{id}/credit-notes` | Approved credit reason and immutable posting |
| POST `/api/v1/reports/schedules` | Valid recipient, timezone, cadence and period rules |
| POST `/public/v1/forms/{publishedId}/submissions` | Restricted public schema; server tenant binding |
| POST `/webhooks/{provider}` | Raw-body signature validation and unique event ingestion |

Use stable error codes: authentication required, forbidden scope, feature unavailable, limit exceeded, invalid finance state, stale revision, duplicate request and provider not ready. Read APIs paginate with bounded filters; export and report generation are asynchronous. Publish an OpenAPI contract after mapping to the actual application.

## 14 Scale security and operations

**Summary:** Scale measured workloads, protect neighboring tenants from heavy jobs and ensure the owner can observe failures before customers complain.

Proposed validation fixture: 100 tenants, 10 staff per tenant, 1 million total opportunities, 10,000 issued invoices per busy tenant, and 100 concurrent interactive users plus scheduled workers. These are test targets, not current capability claims. Initial acceptance targets under an agreed representative environment: P95 common reads under 500 ms, finance/form writes under 1 second excluding provider calls, and normal jobs picked up within 60 seconds. Capture hardware, dataset and test results before claiming these targets. Pilot availability objective is 99.5%; paid-service objective can move to 99.9% after operational evidence.

Index tenant plus common filters such as created date, assignee/stage, due date and invoice state. Paginate timelines and lists. Use scheduled aggregates for large reports, signed cached snapshots and bounded export sizes. Separate finance/report queues from bulk campaigns; enforce per-tenant concurrency and message quotas to reduce noisy-neighbor effects. Archive old activity according to policy without breaking audit references. Add read replicas, partitions or a dedicated tenant database only when actual measurements justify them.

Super Admin health includes webhook failures, channel disconnects, queue lag/dead letters, report lateness, receipt failures, unapplied payments, reconciliation mismatches, storage and provider usage. Alerts identify tenant, severity, correlation ID, runbook and safe corrective action. Staff see only their permitted operational detail.

Use TLS, encrypted backups/storage, secrets management, MFA for privileged roles, secure cookies, session revocation, CSRF protection for authenticated cookie mutations, input validation and upload restrictions. Validate signatures on provider webhooks; do not disable request protections across ordinary API routes. Rotate credentials without printing them in reports or logs. Financial changes and tenant exports remain auditable.

Configure retention by record class and jurisdiction; marketing-contact deletion must not blindly erase legally retained invoices. Define export/offboarding and anonymization procedures with the owner. Backup policy includes database point-in-time recovery where supported, daily object inventory and a tested restore. Proposed initial RPO 15 minutes and RTO 4 hours must be validated in a restore drill; they are not guarantees before the drill.

Deploy through separate development, staging and production environments. Use migrations that expand schema first, backfill tenant ownership, validate, then tighten constraints. Feature flags enable training modules only for pilot tenants. Rollback stops new jobs/features while preserving posted financial events; never roll back accounting by deleting journal records. Capture release version and migration version with evidence.

## 15 Implementation roadmap with release gates

**Summary:** Implement the shared platform before category workflows, then prove money and delivery correctness before selling the training-center release.

Estimated effort assumes an experienced small team and source availability: approximately 12–18 elapsed weeks with overlapping design, backend, frontend and QA work. This is a planning range, not a fixed quote. Existing architecture debt, provider approval and jurisdiction review can extend it. P0 replaces estimates with a source-backed work breakdown; provider waits should run alongside credential-free implementation.

Version 1.1 added seven foundation/operational tickets; version 1.2 confirms the existing-project integration requirement. Treat the earlier window as provisional: TC00 and TC35 must re-estimate the required module extensions, legacy route coverage and additional contracts before committing a delivery date. Prioritize reuse and avoid spending the schedule rebuilding panels or features already present. Record any source limitation against the affected module, not as permission for a replacement project.

| Phase | Approximate window | What we will do | Exit gate |
| --- | --- | --- | --- |
| P0 Baseline | First 1–2 weeks | Verify existing source/modules, recover relevant inputs where available, repair migrations and establish baseline | Reproducible baseline and existing-module extension map |
| P1 Shared platform | Weeks 2–4 | Tenant identity, owner/staff control, category manifests, plans and seats | Isolation, role and limit tests pass |
| P2 Training sales | Weeks 4–7 | Courses, batches, forms, assignment, timeline and follow-ups | Enquiry-to-approved-sale flow passes |
| P3 Finance | Weeks 7–10 | Conversion transaction, invoices, installments, payments and receipts | Reconciliation and concurrency tests pass |
| P4 Automation and reporting | Weeks 10–12 | Notification engine, schedules, reports and operational dashboards | Correct reports and provider-free delivery tests pass |
| P5 Pilot and launch | Weeks 12–15 | Provider sandbox, bilingual QA, migration, load and restore drill, pilot | Paid-launch checklist and owner release approval |
| P6 Expansion | After training release | Guided onboarding improvements, advanced modules and next category | Category contract proven without training regressions |

### Executable backlog

Each ticket requires an implementation summary, migrations, meaningful tests, screenshots where UI changes, and evidence links. Dependencies are ticket IDs. Effort is relative: S approximately 1–2 days, M approximately 3–5 days, L approximately 6–10 days after source audit. BE = backend, FE = frontend, QA = quality assurance, OPS = operations, PO = product owner. Actual assignments may combine roles.

| ID | Owner and effort | Dependencies | Deliverable and acceptance |
| --- | --- | --- | --- |
| TC00 | Lead engineer L | None | Audit the existing source/runtime and module extension points, safe migrations and scoped Git; recover relevant inputs without replacing the shell; startup and preservation evidence recorded |
| TC01 | FE and PO M | TC00 | Map requirements to existing admin/user screens and EN/AR navigation; retain panels and add only missing screens; prototypes are optional test aids, never the product destination |
| TC02 | BE L | TC00 TC35 | Tenant identity and resource constraints; another tenant's IDs fail across API/files/jobs/export/live updates |
| TC03 | BE M | TC02 | Shared login/memberships, owner-only Super Admin and MFA; tenant invite cannot create platform owner |
| TC04 | BE and FE L | TC03 | Staff delegation and tenant console; staff can onboard/manage approved scope, denied elevation is audited |
| TC05 | BE M | TC02 | Versioned category/capability engine; dummy category has different menu and rejects training operations |
| TC06 | BE and FE L | TC04 TC05 | Upgrade existing Manage Plans and Manage Users assignment with categories, features, role limits, versions and impact preview; preserve existing IDs, commercial fields and assigned contracts. Existing-account training-center provisioning is now one locally verified increment; complete browser acceptance, remaining adoption and assignment scenarios |
| TC07 | BE and FE M | TC03 TC06 | Team invites and per-role limits; concurrent eighth agent fails under seven-seat entitlement |
| TC08 | BE and FE M | TC01 TC05 | Existing feature wrappers and provider state labels; all requested legacy entries remain usable by permitted roles |
| TC09 | BE and FE L | TC05 TC40 | Course/offer/batch CRUD with history and capacity; price edits cannot change issued invoice snapshots |
| TC10 | BE and FE L | TC02 TC09 TC35 | Contact/opportunity model, timeline and dedupe; multiple learners sharing a phone remain distinguishable |
| TC11 | BE and FE M | TC07 TC10 | Routing, assignments, outcomes and next actions; reassignments preserve first/closing agent history |
| TC12 | BE and FE L | TC09 TC10 TC11 | Form editor, versioning and public capture; tampered tenant/course/agent fields cannot cross scope |
| TC13 | FE and QA M | TC12 | Existing published form now supports authenticated owner/agent capture with attributed, idempotent leads and a no-store clean-reset mode; phone, tablet, keyboard and screen-reader acceptance remains to be verified |
| TC14 | BE and PO M | TC09 TC10 | Sale review/approval contract; incomplete billing data or unapproved discount blocks conversion |
| TC15 | BE L | TC14 TC21 TC39 | Transactional enrollment/invoice conversion; concurrent and repeated confirmation produces one intended invoice |
| TC16 | BE and FE L | TC15 TC39 | Invoice subledger, numbering and PDFs; balanced events, unique numbers and immutable issued snapshots |
| TC17 | BE and FE M | TC16 | Installment schedules/rescheduling; exact totals, preserved paid items and no stale future reminders |
| TC18 | BE and FE L | TC17 | Manual verification and payment allocations; partial/early/excess/cross-currency cases reconcile |
| TC19 | BE and FE M | TC18 | Receipt generation and downloads; one receipt per posted payment, correct authorized allocations |
| TC20 | BE and FE L | TC18 TC19 | Credits/refunds/reversals/disputes; posted records remain immutable and balances reconcile |
| TC21 | BE L | TC02 | Outbox, notification worker and event contract; retries/dead letters never duplicate business postings |
| TC22 | BE and OPS L | TC08 TC21 | Email/Meta adapters, consent and template readiness; sandbox evidence distinguishes accepted from delivered |
| TC23 | BE M | TC17 TC19 TC21 TC22 TC38 | Reminders and receipt copies; payment/opt-out/reschedule suppresses stale sends at dispatch |
| TC24 | BE and FE L | TC11 TC20 | Report definitions and snapshots; fixture reconciles agent outcomes and billed/collected/outstanding totals |
| TC25 | BE and FE M | TC21 TC22 TC24 | Daily/weekly/monthly schedules to main owner; timezone/retry/revised-period tests pass without duplicate run |
| TC26 | FE M | TC11 TC18 TC24 | Role dashboards and exception queues; every card drills into correctly scoped actionable records |
| TC27 | BE and OPS L | TC18 TC20 TC21 TC39 | Gateway adapter and reconciliation if launch-approved; signed duplicates/out-of-order events produce one correct payment |
| TC28 | OPS and FE M | TC04 TC21 TC25 | Owner health and staff incident views; injected failures create actionable alerts and bounded retries |
| TC29 | BE and OPS L | TC02 TC16 TC35 TC39 | Migration/backfill rehearsal and rollback; record counts, ownership and financial totals reconcile |
| TC30 | FE and QA L | TC08–TC26 TC36 TC38 | EN/AR/RTL regression and accessibility; permitted roles pass all critical phone/tablet/desktop journeys |
| TC31 | QA and OPS L | TC28 TC29 TC30 TC37 TC41 | Load, isolation, security and restore evidence; documented targets pass or release remains gated |
| TC32 | PO and QA M | TC23 TC25 TC31 | Pilot with 2–3 consenting centers, training and defect triage; end-to-end invoice/payment/report evidence accepted |
| TC33 | PO and OPS M | TC32 | Approved packaging, onboarding, support/runbooks and production rollout; explicit go/no-go record |
| TC34 | BE and FE L | TC33 | Next-category contract proof and extension roadmap; core identity/billing stable and training regression passes |
| TC35 | Lead engineer and QA L | TC00 TC01 | Schema/API/event contracts and legacy ownership mapping; reviewed DDL, payloads, permissions and synthetic fixtures exist before dependent modules |
| TC36 | BE and FE M | TC06 TC07 TC21 | Subscription lifecycle, renewal and continuity rules; expiry/suspension never deletes evidence or loses verified settlements |
| TC37 | BE and OPS L | TC02 TC08 TC21 | Worker leases, QR session ownership and multi-node Socket.IO routing; two processes cannot send/process the same business action concurrently |
| TC38 | BE and FE M | TC16 TC19 TC21 | Secure customer invoice/receipt access without a learner portal; scoped expiring links cannot expose other documents or internal notes |
| TC39 | BE and accountant L | TC09 TC14 TC35 | Finance transition/reconciliation contract, recognition policy and approval evidence; synthetic edge cases reconcile before posting modules are enabled |
| TC40 | Lead engineer and QA M | TC02 TC03 TC05 TC07 TC08 TC35 | Foundation gate for source/build/auth/tenant compatibility; legacy regression, direct-URL denials and feature readiness matrix pass |
| TC41 | OPS and QA M | TC00 TC37 | Release topology, capacity budget, private storage and isolation from other hosted products; measured failover/backpressure plan and clean release package |

TC21 may begin after TC02 while training work proceeds; TC22 provider setup can progress alongside sales and finance. TC27 is required before enabling online checkout, but verified manual payments support an initial launch without online checkout. Daily/weekly/monthly owner reports and receipt copies remain launch requirements, not optional deferred items.

Execute by dependency order, not ticket number. TC35 precedes tenant implementation; TC40 gates category workflows; TC39 precedes live finance posting. The original backlog omitted TC21 from TC15 and TC19 from TC23; these are now corrected. TC34 remains post-launch expansion. TC35–TC41 are part of the launch, including multi-process tests even if the first pilot uses one application instance. A topological dependency check must reject unknown IDs and cycles whenever tickets change.

## 16 Migration and preservation strategy

**Summary:** Upgrade the existing shell and records in increments, with a rehearsal and reconciliation before production cutover.

P0 classifies each existing feature as verified, partially verified, unavailable or unknown. Preserve dashboard, inbox, QR link, Meta link, flows, chatbot, template creation, campaigns, campaign dashboard, pipeline, phonebook, agent login and agent tasks. Record actual routes, provider adapters, permission behavior and regression evidence; do not mark a feature preserved solely because its label appears.

Map existing main accounts to tenants and tenant owners. Map agents to memberships with stable historical actor references. Existing administrator maps to Super Admin only after owner identity confirmation; newly created SaleMaX staff get explicit staff roles. Never mass-upgrade historical admin-like accounts to platform owner.

Backfill tenant ownership on contacts, conversations, channels, campaigns and tasks. Quarantine orphaned or ambiguous records for review instead of guessing their business. Map existing course/custom fields only when semantics match. Do not invent invoices for historical Won leads; import historical sales through an explicitly approved opening-balance process with source references and accountant sign-off.

Rehearse using a protected staging copy. Compare counts by tenant, assignment history, attachments, contact dedupe, channel mappings and financial totals. Pilot tenant flags first; retain a backup and legacy data mapping. During cutover, pause only the necessary writes and jobs, migrate, reconcile and resume. Rollback keeps new posted finance evidence recoverable and does not corrupt the original data. Document cutover and incident procedures before launch.

## 17 Test scenarios and definition of done

**Summary:** A launch passes only when the complete journey and its failure cases are proven with roles, tenants, real database transactions and eligible providers.

### Required acceptance journeys

1. Platform owner creates delegated staff. Staff drafts a plan, assigns its approved version to a training center and sets one owner/accountant/manager plus seven agent seats. Two simultaneous invitations at the remaining seat produce one success. Staff and tenant users cannot enter Super Admin.
2. Owner publishes a bilingual lead form. Customer submits from phone; receptionist submits from tablet under their own staff session. Correct tenant/source/course attribution appears, duplicate retries do not multiply leads, and no sensitive previous entry remains on the kiosk.
3. Lead is routed, attended by an agent, noted, followed up and reassigned. Manager report correctly lists actor, outcome and overdue task without rewriting the first responder.
4. Agent requests a course sale. Missing details/over-limit discount are rejected. Approved confirmation creates one enrollment, invoice and exact schedule. Concurrent final-seat sales cannot oversell. Repeated conversion cannot duplicate invoice or accounting.
5. Accountant posts partial, early and overpayments. Receivable, allocations and unapplied balance reconcile. Receipt copies are queued for customer, accountant and owner, and duplicate callbacks or worker restarts do not create another receipt.
6. Paying an installment while its reminder is queued suppresses or updates the send. Opt-out, dispute hold and reschedule do the same. Failed message delivery appears accurately and leaves the financial record intact.
7. A refund/credit/cancellation and a transfer preserve history and produce correct remaining balances. Provider timeout remains pending until reconciled.
8. Daily, weekly and monthly owner reports contain correct fixture totals, notes/outcomes and follow-ups. Timezone cutoffs, repeated scheduling and revised reports are handled consistently across both delivery channels.
9. Tenant A attempts Tenant B's lead, invoice, download, export, channel, report and live subscription. Every request fails. Dummy restaurant-category tenant cannot view or call training features even using direct URLs.
10. Every requested legacy feature has a before/after regression check. Owner/accountant/manager/agent screens work in Arabic RTL and English at phone/tablet/desktop widths. Disabled memberships and plan changes revoke effective access.
11. Backup restore is executed and reconciled; load targets and queue fairness are measured. A channel failure, worker crash and unavailable document renderer produce recoverable actionable states.

Maintain an evidence ledger per ticket: code commit, test command/result, environment, schema version, screenshot/document sample, provider IDs where safe and outstanding gates. Local fake-provider success is local verification; it must never be labelled real delivery or production readiness.

### Paid launch gate

All TC00–TC26, TC28–TC33 and TC35–TC41 launch requirements pass, subject to the source-backed backlog refinement. TC27 passes before online checkout is enabled; TC34 remains post-launch. Accounting/tax/terms and invoice/receipt templates are reviewed for the launch jurisdiction; tenant consent and recipient settings are captured; email authentication and Meta templates are tested; privacy/offboarding policies are approved; restore/load evidence exists; no critical isolation or money defect remains; support escalation and owner production approval are recorded. The contract gates in section 21 are mandatory. A disabled provider cannot be described as launch-verified merely because local simulations pass.

## 18 Onboarding and commercial launch

**Summary:** Make the first customer reach value quickly with a guided setup and an end-to-end demo that matches tested functionality.

Guided tenant setup: business identity/language/timezone → assigned plan and seat limits → courses/offers and first batch → invite accountant/manager/agents → connect eligible WhatsApp/email → publish form → enter a demo enquiry → confirm a demo sale → verify a demo payment → preview the owner report. Display task readiness and help text; do not hide provider approval gaps behind a completed wizard.

Use isolated clearly marked demo tenants and synthetic learners to showcase the workflow. A strong five-minute sales demo follows one enquiry through agent follow-up, enrollment, invoice, partial payment, receipt and the owner's dashboard. Show the center's logo on forms/documents and the Arabic experience. Measure setup completion, time to first lead, time to first verified receipt and weekly owner activity in the pilot; treat proposed targets as hypotheses.

Create a concise feature sheet, onboarding checklist, support guide and recorded demo after functionality is verified. Remove unsupported landing-page claims such as unverified customer counts, testimonials, number-one rankings or delivery results. Sell measured outcomes and documented capabilities. Training centers should understand which support, seats, storage and third-party costs are included before subscription.

### Future roadmap after a stable launch

Learner self-service can show registrations, balances and receipt downloads with secure authentication. Later training modules add attendance, certificates, instructor scheduling, classroom capacity and learning integrations. AI assistance can suggest next actions and summarize permitted notes with human review and source traceability; it cannot autonomously mark paid, issue refunds or invent customer details. Restaurant discovery begins with an independently specified order/reservation workflow and its category contract, not a copy of the training dashboard.

## 19 How to execute this plan

**Summary:** Begin at TC00, finish each verified increment, and preserve the full launch scope until every required gate is closed.

Use the following instruction with an implementation agent or engineering team:

> Upgrade the verified source repository for this specific existing SaleMaX product. Read repository instructions and this plan first. Reuse the current admin/user panels and working modules; do not create a replacement project, shell, login, CRM or duplicate catalogue. Start plan work in existing Manage Plans and account assignment in existing Manage Users. Add only missing screens inside those panels. Record actual integration points and preserve old routes, IDs, fields, records and working journeys. Implement unblocked tickets in dependency order, using tested backend services behind the corresponding existing screens. Enforce tenant, category, role and plan constraints in the backend. Keep finance posting transactional and idempotent. Verify old and added functionality in English/Arabic, document evidence, and commit intended files. Test-only standalone screens do not count as integrated delivery. Do not expose secrets or claim provider verification from simulated tests. Continue useful work while external gates remain open, preserve the full scope, and release only after the paid-launch gate passes.

After source audit, create a live implementation status ledger with all TC IDs marked Planned, Implementing, Locally Verified, Staging Verified, Provider Verified where relevant, and Release Approved. Include blockers and exact evidence. Refine route/file locations and estimates; retain requirement traceability if a ticket is split. Plan refinement must not silently remove requested features.

### Requirement traceability

| User requirement | Specification | Implementation tickets |
| --- | --- | --- |
| Owner-only Super Admin with system control | Sections 4 and 14 | TC03 TC04 TC28 |
| Staff panel for plans/users/accounts | Sections 4 and 5 | TC04 TC06 TC07 |
| Category-specific scalable workspaces | Sections 5 and 13 | TC05 TC08 TC34 |
| Owner/accountant/manager and configurable agents | Section 4 | TC03 TC07 |
| Preserve all existing sidebar features | Sections 6 and 16 | TC08 TC30 |
| Lead ownership/outcomes/notes/follow-ups | Sections 8 and 12 | TC10 TC11 TC24 |
| Daily/weekly/monthly WhatsApp and email reports | Sections 11 and 12 | TC22 TC24 TC25 |
| Course details/pricing/duration connected to sales | Sections 7 and 10 | TC09 TC14 TC15 |
| Configurable mobile/tablet public forms | Section 9 | TC12 TC13 |
| Sale creates invoice and receivable | Section 10 | TC15 TC16 |
| Automated installments and intimations | Sections 10 and 11 | TC17 TC23 |
| Verified payment receipt to customer/accountant/owner | Sections 10 and 11 | TC18 TC19 TC22 TC23 |

## 20 Decisions to record before the relevant build gate

**Summary:** The implementation has working defaults, with a short list of owner/business decisions recorded at the point they become necessary.

| Decision | Recommended starting position | Needed by |
| --- | --- | --- |
| Specific source repository | Confirmed source `A:\Salemax - Training center\Salemax-Node`; recover frontend build inputs and establish Git history | P0 |
| First country and legal entity | Qatar confirmed; center legal/invoice identity still required | Invoice/provider design in P3 |
| Staff publishing authority | Staff drafts and assigns; owner-delegated publication | P1 |
| Course confirmation policy | Confirm on approved sale; configurable deposit requirement | P2–P3 |
| Tax/revenue/numbering policy | Accountant-reviewed configuration | P3 finance release |
| Manual payment approval threshold | Accountant verification; optional second approver | P3 |
| Gateway and merchant ownership | Center-owned merchant; hosted checkout | TC27 enablement |
| Report cutoffs and destinations | Main owner, verified email/WhatsApp, editable timezone | P4 |
| SaaS prices and usage charges | Measure pilot cost, approve plan versions | P5 commercial launch |
| Retention and support access | Jurisdiction-specific retention; auditable limited sessions | P5 |

## 21 Implementation readiness and contract gates

**Summary:** Distinguish a complete product blueprint from a module that is ready to code and a release that is ready to sell. No unresolved assumption should be silently converted into implementation behavior.

### Gate A before foundation implementation

TC00 establishes reproducible startup, safe migrations, scoped Git history and maintained extension points in the existing application. Recover relevant frontend source and lockfiles where available. If an input is missing, record the affected module limitation and use existing source-controlled integration scripts/components where suitable; do not recreate or replace the application shell. Existing admin/user panels, login routes, APIs and working features remain the integration baseline. No second CRM, tenant system, plan catalogue or disconnected login is allowed. Inspect source/licensing rights before distributing or selling modified software. No license-rights conclusion is implied by package metadata.

TC35 produces a version-controlled contract pack: proposed DDL and indexes, an entity relationship map, legacy ownership mapping, OpenAPI schemas, role/capability/record permissions, event schemas, state transitions and synthetic acceptance fixtures. An implementer should be able to derive request validation and tests from this pack without inventing the financial or tenancy behavior. These are outputs of the foundation stage, not artifacts falsely claimed to exist already.

### Gate B before each module implementation

Every ticket is Ready only when its dependencies, exact existing-module integration point, screen behavior, API request/response/error schemas, storage migration, permissions, empty/error states, side effects, recovery procedure and acceptance tests are recorded. Identify whether the work extends an existing screen or adds a missing screen inside an existing panel, and list the old behavior to preserve. For finance, include invariant equations and rounding examples. For providers, include capability, verification method, sandbox/live separation and known failure outcomes. A prototype or isolated API check does not prove delivery through the existing module.

Use a ticket record containing ID, requirement links, owner, dependencies, decisions, migration IDs, contract paths, test fixtures, expected evidence and outstanding gates. Source filenames proposed in section 13 must become exact after TC00. Preserve the complete requirement list as tickets split or estimates change.

### Gate C before connecting training workflows

TC40 proves owner/staff/tenant login and legacy role compatibility, plan/seat enforcement, route-based category isolation and navigation. Exercise every preserved feature through the actual app and APIs. List unsupported integrations and existing defects explicitly. Quarantine finance operations until their contracts and transaction services pass; do not activate an incomplete invoice button solely to make a demo appear complete.

### Gate D before finance and production delivery

TC39 defines the finance policies in section 22 and verifies exact synthetic balances. TC15–TC20 then prove real database transactions, concurrent requests, corrections and reconciliation. TC37 proves worker ownership and recovered socket authorization. TC38 proves customer document access. TC36 proves expiry/renewal behavior. TC41 proves deployment capacity and neighboring-product isolation. Real email/WhatsApp tests and any enabled payment gateway require their separate eligible provider evidence.

The design verdict after this audit is **Ready to start through these gates**. Source recovery, final schema/API contracts, accountant approval, hosting measurements and provider tests are still implementation work. There is no defensible promise of a perfect system before those results exist.

## 22 Finance state transitions and invariant contract

**Summary:** Define precisely which actions change money, which actor may perform them and how concurrent or corrective actions preserve the balances.

### Sale and invoice authority

Default agents request a sale; the manager approves eligible course/offer/discount/terms, and invoice issuance executes through the trusted finance service under the tenant's accountant/owner-approved issue policy. A center may choose accountant approval for every issue. The approval decision is stored with the offer/billing snapshot and approver. An agent does not receive a general ledger or arbitrary invoice permission merely because an approved sale can automatically issue an invoice. If no approved issue policy exists, the transaction waits for authorized finance approval and the lead remains pending rather than falsely Won.

Protect every legacy path that can close or reopen a lead: `moveLead`, `deleteStage` moving leads to Won, bulk import, manual creation into terminal stages, automation intent rules and inbound reopening. New course opportunities after a completed sale use a new opportunity ID or an explicitly versioned opportunity cycle. A fresh WhatsApp message must not reopen the financially completed sale and permit another invoice for the same enrollment. Assignment/merge logic cannot detach invoices from their originating tenant.

### State transitions

| Record | Allowed transitions | Required authority and evidence |
| --- | --- | --- |
| Sale request | Draft → pending approval → approved or rejected → converted | Agent creates; manager/finance policy approves; conversion transaction owns terminal write |
| Invoice | Draft → issued; issued documents settle or are reduced by credits | Authorized issue policy; issued line/tax/terms snapshot immutable |
| Payment | Pending → verified and posted, or rejected | Accountant/manual policy or verified provider event; unique receipt created only on post |
| Refund | Requested → approved → submitted → completed or failed | Separate approval; verified provider/cash evidence; pending requests do not reduce actual cash |
| Schedule | Original → superseded by approved version | Paid allocations retained; only eligible future amounts/dates change |
| Recognition entry | Approved scheduled amount → posted or reversed by linked entry | Accountant-approved delivery policy; verified delivery milestone; balanced immutable entry |

Invoice settlement labels are derived from open balance and due dates: unpaid, partly paid, paid, overdue or credited. They are not editable flags. An issued unpaid invoice is not erased or casually marked void; use an approved credit/reversal process appropriate to the applicable document rules. A draft cancellation creates no journal movement. Write-offs require a separately approved bad-debt journal policy; hiding a lead is not a write-off.

### Financial invariants

Invoice open receivable equals issued gross amount minus approved credits minus net posted payment allocations, with reversals applied once. Customer deposit/unapplied funds are a separate liability balance. Net collection equals posted gross payments minus completed refunds and posted chargebacks; gateway fees affect settlement/expense, not the customer's payment amount. Each payment's allocations plus unapplied amount equal its net available posted funds. Receipt totals reflect that payment, not the entire course price.

Every journal entry balances debits and credits in one currency. Each business posting references a stable event ID and has a uniqueness constraint on its posting type and source. Revenue recognition never exceeds approved eligible net course consideration; credits/cancellations update future recognition and reverse already recognized amounts through policy-governed entries. Proposed default is deferred revenue until documented course delivery, with any over-time schedule approved by the accountant. Do not infer earned revenue from a calendar date or payment alone.

Lock invoice, payment and allocation rows in a documented consistent order. Concurrent verification, refund, allocation and credit must re-read balances under the same transaction. Retry bounded deadlocks using the original idempotency key; retrying must not repeat external calls. Reject stale revisions with a conflict and an updated review screen. An idempotency key reused with a different payload is a conflict, not permission to apply changed amounts.

Test fixtures must include: exact installments with rounding; deposit before issue then allocation; partial/early/excess payments; duplicate manual references; two simultaneous verifications; credit after partial payment; completed refund after credit; refund failure; chargeback after settlement; schedule change after payment; canceled reserved enrollment; fee/net settlement differences; revenue recognition followed by course transfer/cancellation. Supply expected invoice, installment, deposit, receipt, clearing and journal totals for every step.

TC39 records the jurisdiction-specific decisions before enabling posting. P0/P1 work continues without those owner/accountant decisions. Multi-currency expansion adds currency-specific precision and explicit exchange-rate posting; cross-currency allocation remains rejected in the first release.

## 23 Subscription continuity and customer document access

**Summary:** SaaS account lifecycle must not lose existing financial evidence, and customers must be able to receive invoices and receipts without waiting for a learner portal.

### Platform subscription lifecycle

Default lifecycle: provisioned → trial or active → grace → expired read-only → archived under the retention policy. Suspension is a separate owner-controlled restriction with reason; renewal/reactivation rechecks category, seats, features and queued jobs. Proposed grace is seven days, configurable by approved plan. Staff manual renewal/assignment is sufficient for release one; SaaS checkout is a separate optional integration. Subscription payment, tenant course payment and their accounting records never share an invoice namespace or merchant mapping.

During grace, show expiry warnings and apply explicit plan policy. After ordinary expiry, block new campaigns, courses, public enrolment submissions, new sales and new seats. Preserve owner/accountant access to history and export. Proposed financial continuity window is thirty days: allow authorized verification of existing debt payments, correction/refund processing and transactional receipt delivery under the existing consent rules. Collection reminders and owner report sends require an explicit continuity entitlement rather than continuing by accident. Published forms display an unavailable message without revealing private account details.

Even after a tenant is restricted, receive and reconcile already initiated provider transactions and disputes into the appropriate ledger. Security suspension may prevent tenant login and outbound sending, but authorized platform operations still preserve and reconcile incoming settlement evidence. Never discard a signed callback because a marketing entitlement expired. Suspended memberships lose ordinary APIs and socket rooms immediately; privacy exports/support access follow owner-controlled procedures.

Downgrade detects active seats, channels, scheduled jobs and storage above new limits. Provide an impact preview and remediation date; disable new additions, preserve history and stop prohibited jobs after policy takes effect. Do not auto-delete learners, documents or sessions. Seat counting in release one uses one primary role per membership; delegated permissions do not create extra memberships or bypass role limits. Owner transfer is one transaction retaining exactly one active owner and verifying the new report recipient.

### Secure customer documents

Internal staff use authenticated role-scoped document routes. Customer invoice/receipt delivery in release one uses a narrowly scoped document grant bound to tenant, intended recipient and document version. It exposes only that invoice/receipt and approved payment instructions; it exposes no customer directory, notes, dashboard or other documents. Store only a hash of a cryptographically random token, support revocation, and use short-lived downloads issued after grant validation.

Proposed grant lifetime is seven days, configurable by document type; sensitive or disputed documents can require destination verification/OTP when an eligible provider exists. Display the intended recipient in masked form and request a new delivery when expired. Keep tokens and query strings out of access logs/analytics, set private/no-store and no-referrer behavior, and avoid third-party scripts on the document page. Preview/prefetch requests must not consume the grant. A recipient may forward a bearer link, so the UI and policy must accurately describe that access model; require verification when bearer access is unsuitable.

The invoice PDF is the issued snapshot. A receipt remains the payment snapshot with its allocation list and verification date. Current balance is separately labelled with an as-of timestamp so a stale receipt attachment cannot imply the current debt balance. Testing covers expired/revoked links, tampered tenant/document IDs, unauthorized asset access, forwarded-link policy, Arabic PDF rendering and delivery retries using the same document.

## 24 Worker topology and deployment scale contract

**Summary:** A stateless web tier alone cannot scale the existing process-local sockets, campaign loops and QR sessions. Define ownership and recovery before adding replicas.

The inspected `server.js` starts provider loops inside the web process when local-only mode is off. `loops/campaignBeta.js` uses a process-local Set for active campaigns. `socket.js` tracks its local server sockets and configures connection recovery with middleware skipping. The QR module stores active connections and timers in Maps and can persist session auth locally or in databases. These observations require a worker/topology upgrade; launching two copies of the current app is not proof of safe horizontal scaling.

### Initial release topology

Run distinct entrypoints for HTTP/socket requests, report/document jobs, notification/campaign jobs and QR session ownership. API replicas do not start campaigns, retention loops or QR sessions. The local training runtime remains provider-disabled. Live provider switches are granular and default off; turning off local-only mode must not unexpectedly activate old CRM provisioning, Telegram, warmer or AI/calling providers outside the approved launch scope.

Use MariaDB transactional outbox and job claim tables initially, with a bounded poller and durable leases. No required new queue vendor is assumed. Each claim contains owner ID, lease expiration, attempt count and monotonically increasing fence/version. Claim and lease renewals are atomic; workers abandon expired ownership. Completion updates check the fence so a stale worker cannot overwrite a newer attempt. Process at-least-once and deduplicate business outcomes. Unknown external send results reconcile before retry; leases cannot by themselves guarantee exactly-once provider sends. A queue service can replace transport later without changing event contracts. [AWS transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

Each QR account has one active connector owner with durable assignment, a lease and a controlled handover. Before handover, stop the old connection and ensure the prior owner is fenced; never run two Baileys connections against the same auth state. Store encrypted tenant/channel-bound auth in the chosen persistent store and define reconnect/session-loss recovery. Shared filesystem volumes alone do not provide exclusive ownership. QR outages must not change financial posting or convert a queued send to a different channel silently.

On lease loss, the connector stops new sends and disconnects. If a network partition prevents confirmation that the previous owner has stopped, keep takeover blocked until an orchestrator terminates the prior instance or operations verifies a safe handover. A database fence cannot force an already running external socket to close by itself. Test this ambiguous-ownership case explicitly rather than promise automatic QR failover in every outage.

Multi-node Socket.IO needs a compatible inter-node adapter and a deliberate load-balancing strategy. Use server-derived tenant/member/record rooms; moving JWTs to the auth payload must not permit client-selected unrestricted rooms. If HTTP long-polling remains enabled, configure affinity; a WebSocket-only deployment must be tested against target mobile networks. Select and pin an adapter with tested connection-recovery behavior. [Socket.IO multi-node guidance](https://socket.io/docs/v4/using-multiple-nodes/)

Check current membership and tenant status on connect, recovery and privileged events. Do not rely on the current middleware-skipping recovery configuration to enforce revocation. Test that a disabled agent cannot recover subscriptions or receive old queued events. Database truth survives a socket outage; clients refresh authorized data after reconnect rather than replaying unbounded private history.

### Migration and release discipline

MariaDB DDL can implicitly commit; a BEGIN/ROLLBACK wrapper is not a safe rollback strategy for schema changes. Use numbered forward migrations, a checksummed migration ledger, a migration lock and documented compensating/restore procedures. Forward discovery excludes rollback files. Test the runner against representative existing tables and interrupted migrations; adding an index to a large table needs a measured lock/time budget. [MariaDB implicit commits](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit)

Establish a canonical tenant ID mapped to legacy `user.uid` and pipeline `uid_hash` with an explicit unique mapping. Preserve existing owner and agent IDs as historical references. Queries must validate that the joined agent/contact/channel belongs to the same tenant; current global numeric IDs are not an isolation guarantee. Migrate memberships and resource ownership in stages with read comparison, quarantine ambiguous records and prevent concurrent old/new identity writers from disagreeing.

The checked-in deployment configuration currently defines one app and one MariaDB service with local persistent volumes and memory limits. `DEPLOYMENT.md` records shared Oracle hosting with another product and a small historical disk margin. These are local deployment-file observations and historical measurements, not a fresh host capacity audit. TC41 must measure current CPU, RAM, disk, IOPS, connections and neighboring-product budgets before choosing pilot capacity; do not load-test or alter that host under a document-only audit.

Production runtime owns only its tenant/product resources. Package allowlists exclude `.env`, backups, sessions, customer database files, QA artifacts and retained personal data. Put new finance PDFs and uploads in private object storage or a protected storage service, not the currently public media path. Scan sensitive uploads, restrict MIME/size, and enforce short-lived download authorization. Add separate liveness, database readiness and worker-heartbeat checks rather than using a public branding API as the only readiness signal.

### Load and recovery evidence

Keep the section 14 targets, but record separate tests for interactive reads/writes, two-node socket broadcasts, QR ownership handover, concurrent campaign claims, receipt generation and scheduled report bursts. Use synthetic data; public forms and provider workers must not contact retained customer records. Test worker crash after financial commit but before delivery, expired leases, unavailable queue/storage, one noisy tenant, DB connection exhaustion and restore of a posted-payment dataset.

Record accepted throughput per workload and resource use, not just a total user count. Define overload behavior: bounded payloads/queues, rate-limit responses, retry-after, delayed exports and visible delivery status. Reports/receipts get protected capacity ahead of bulk campaigns. Prove shared-host separation or move SaleMaX to its own approved infrastructure before advertising scale that exceeds the measured budget.

## 25 Audit findings and updated readiness verdict

**Summary:** The audit improves the specification while leaving implementation risks visible. Addressed in the plan means a rule and ticket exist; it does not mean the underlying code has been fixed.

| Finding | Priority | Required treatment and ticket |
| --- | --- | --- |
| Compiled frontend without all original build inputs | Limits affected component edits | Recover relevant inputs or extend maintained existing modules/hooks; preserve the shell and forbid replacement-project work; TC00 and TC40 |
| Forward migration runner can select DROP TABLE rollback file | Blocks migration execution | Safe discovery, checksum ledger and rehearsal; TC00 TC29 TC35 |
| Tenant mapping and legacy authentication lack a complete contract pack | High | Canonical tenant/membership mapping and all-route compatibility; TC02 TC03 TC35 TC40 |
| Process-local campaign/QR/socket state prevents assumed replica safety | High | Exclusive connector ownership, worker leases, inter-node socket adapter; TC37 TC41 |
| Sale/outbox and receipt/delivery dependencies omitted | High | Correct TC15 and TC23 dependency edges; graph validation |
| Existing terminal-stage and reopen paths can conflict with finance | High | Guard all close/reopen/stage-delete/import paths; TC15 TC39 |
| Finance described without sufficient correction/concurrency invariants | High | Formal transitions, locks, unique postings and edge-case fixtures; TC39 TC15–TC20 |
| Expiry/suspension/renewal behavior underspecified | High | Explicit continuity rules and settlement reconciliation; TC36 |
| Customer secure links conflicted with deferred learner portal | High | Document-scoped revocable access with accurate recipient model; TC38 |
| Hosting and performance assumptions lacked current resource measurements | High | Measured deployment and neighboring-product budgets; TC31 TC41 |
| Feature gates and estimates could be mistaken for runtime proof | High | Foundation, per-module, finance and paid-launch evidence gates; TC40 TC31 TC33 |

The original plan covers the requested product scope and is a useful implementation roadmap. Version 1.1 now adds the missing operating contracts and dependencies. Start at TC00 and TC35, then execute the validated dependency graph. Do not start by adding finance screens to compiled assets or by enabling providers on the existing deployed training copy.

The revised plan is ready to guide an end-to-end implementation through explicit gates. It is not yet a complete approved schema/API pack, a recovered frontend, a tested migration or a production-ready application. Those outputs have named owners, dependencies and acceptance criteria. Scalability and ease of use must be demonstrated through measured load, isolation, bilingual user journeys and the pilot; a document cannot guarantee perfection.


## 26 Implementation progress — existing platform staff slice

The first implementation slice extends the current `/admin?page=manage-users` screen with owner-managed platform staff invitations and access controls. It uses the existing `/admin/login` acceptance entry point, canonical platform identities, the reviewed legacy administrator mapping and the existing platform MFA boundary. It does not create another application, admin shell, login route, or customer/staff tenant account flow.

The slice includes the additive `20261002_platform_staff_invites.sql` migration, bounded and audited staff APIs, one-time SHA-256-hashed invitation tokens, 72-hour expiry/rotation/cancellation, safe reissue after cancellation, permission-scoped staff activation/deactivation and session revocation. The bilingual controls expose loading/error/empty/success states and disclose that link delivery is copy-only. API and user instructions are maintained in `docs/API_DOCUMENTATION.md` and `docs/USER_MANUAL.md`.

| Ticket | Current state | Evidence and remaining gate |
| --- | --- | --- |
| TC03 owner-only Super Admin/MFA | Implemented earlier; regression-covered | Synthetic bootstrap, audience/MFA/reauth checks and staff-denial tests pass. Existing imported-account adoption and release activation remain open. |
| TC04 platform staff delegation | Locally implemented; acceptance in progress | Backend and mounted routes, owner-only grant checks, transactional acceptance, audit/session revocation and existing Manage Users panel are implemented. `npm test` passes 44/44; all 11 isolated MariaDB migrations and the staff lifecycle pass. The existing `/admin/login` invite overlay is browser-verified in English and Arabic; authenticated staff-management screen acceptance and phone/tablet review remain required. Provider delivery is explicitly not implemented. |
| TC06 Manage Plans/Manage Users end-to-end | In progress | Plan editing/assignment and this staff panel are partial increments. Full category/feature/seat and original-screen acceptance remain open. |
| Full training-center launch | Not release-ready | Finance, courses, portal, scheduled notifications, wider role journeys, migration/adoption, provider evidence, load/restore, staging and owner production approval remain outstanding. |

This progress note records one implementation increment only. It does not mark TC03/TC04 complete, close TC00/TC35/TC40, or authorize production deployment.

## 28 Implementation progress — existing-user business provisioning

The existing Manage Users contract action now includes an in-place onboarding path for an eligible unlinked legacy account. An administrator with the required canonical MFA identity, reviewed legacy link and staff grants can review the account's existing assigned catalogue plan, select training-center owner/accountant/manager/agent limits, inspect a read-only preview and explicitly confirm. The existing account remains the sign-in; a new tenant and owner mapping are created without copying its legacy password. The operation atomically applies the published training-center contract to both canonical and legacy plan state and records history, audit and an idempotency receipt. Qatar defaults are QA, QAR and Asia/Qatar.

Verification is limited to 50 passing automated tests and the 13-migration disposable MariaDB integration. The suite calls the actual `/api/admin/business-contracts` HTTP handlers for options, preview, stale-preview conflict, confirmation and idempotent retry; it also checks atomic assignment, Qatar defaults, ownership mapping, audit, password non-copy and denied authorization. The isolated existing-panel smoke verifies the original shell, anonymous/invalid-admin denial, the additional platform-session gate and the legacy assignment guard. Browser review reached the existing Manage Users editor and confirmed the English missing-platform-session message; it did not complete MFA or the onboarding wizard, and Arabic onboarding acceptance remains open. This is a local implementation increment, not staging/production verification or deployment approval. Finance, courses, public forms, scheduled delivery, accountant/manager login lifecycle, broader category rollout, data backfill, remaining TC00–TC41 acceptance and release gates remain open.

## 27 Implementation progress — agent invitation API slice

The next increment extends the existing `/user` and `/agent` API surfaces, using the existing legacy agent login and tenant membership model. Migration `20261003_team_invitation_activation.sql` adds hashed, one-time activation data to the existing invitation reservation table. Owner actions verify the reviewed business-owner link, active training-center tenant, plan entitlement and agent seat limit; acceptance rechecks tenant, plan and seat capacity transactionally, then creates the compatible existing `agents` login plus canonical membership and ownership mapping. Accountant and manager roles remain unavailable because the existing business APIs do not yet enforce their distinct permissions.

The existing `/user` shell now exposes a bilingual Team Invitations screen adjacent to Agent Login, and a fragment link opens one-time activation over the same SaleMaX login shell. The view reports active agents, pending reservations, the assigned limit and available seats; concurrent attempts at the final seat are tested against synthetic MariaDB and only one can succeed. Local unit tests pass 55/55; the 13-migration synthetic MariaDB run covers hashed tokens, rotation invalidation, one-time agent activation, reissue after expiry, owner/tenant linking, seat usage and concurrent reservation. Authenticated owner acceptance in both languages and mobile/tablet review remain open. Delivery is copy-link only; email/WhatsApp dispatch and accountant/manager onboarding are not implemented. Git push and release gates remain open. Do not deploy this increment until those checks and release gates are complete.

## 29 Implementation progress — Reports page CSV export

The existing pipeline Reports view now exports the visible activity page to CSV with bilingual headings, UTF-8 BOM, quoted cells and spreadsheet-formula prefix neutralization. The export respects the already-filtered report response and does not silently fetch or expose other pages. The user manual and API documentation describe the exact page scope. `npm test` passes 50/50 and the report-screen source test passes 2/2. Authenticated browser download acceptance is still open. This remains one local improvement within TC24; scheduled delivery, finance data and all release gates remain incomplete.

\n

## Implementation increment record (1 October 2026)

This increment extends the current `/user/login` and agent login after their existing credential validation: only explicitly reviewed ownership mappings receive a canonical tenant session, with a fresh canonical password hash derived from the submitted password. The existing `/admin/platform-auth` path is platform-only; `/api/user/business-auth` is tenant-only and remains disabled by the platform feature flag. Existing legacy responses and routes remain for compatibility during phased migration. This is not a replacement login or a complete shared-identity migration. The current user-facing login has no workspace selector yet. Do not enable or deploy the bridge in production until mapping coverage, compatibility, security and all planned release gates pass.

Disposable MariaDB tests cover audience separation, tenant-owner session creation, password rehash behavior, origin rejection and hashed-only session persistence. Pipeline lead/activity writes explicitly use UTC timestamps to keep report cutoffs independent of database server timezone. The full training-center system remains incomplete; this slice advances TC03 only.

## Increment record: delegated legacy administrator controls (1 October 2026)

TC04 now has an additional safety layer in the existing admin middleware: linked staff must hold the explicit permission for supported legacy read/preview operations, and all other protected legacy actions are denied. Protected contract/onboarding APIs remain the route for mutations and check canonical identity, MFA, CSRF and granular permission. The old administrator-profile API returns only the signed-in row. Owner and unmapped-administrator compatibility is preserved. This does not classify routes that bypass the admin middleware and is not completion of TC04 or TC40.

The automated suite includes focused authorization cases; the disposable MariaDB HTTP test exercises the existing legacy route boundary. Full screen/role browser acceptance and unguarded-route classification remain open.

## Increment record: public settings secret boundary (1 October 2026)

TC00/TC03 route-preservation work now removes the Meta app secret from both existing public web-settings responses while retaining the public app ID required by existing login screens. The existing social-login settings route requires administrator authentication and is denied to delegated staff by default. The original-panel synthetic HTTP smoke covers the behavior. Other unguarded legacy route declarations still require classification; this does not close TC03 or TC40.


## 30 Implementation progress — training course catalogue foundation (1 October 2026)

This increment adds the first training-center course catalogue to the existing `/user` workspace and existing sidebar. Courses have bilingual names/descriptions, bounded search and pagination, draft/publish/retire lifecycle, duration and delivery mode, QAR price and registration-fee offers with immutable version history, and scheduled batches with capacity/reservation safeguards. The additive migration `20261005_training_catalogue.sql` uses tenant-scoped keys and foreign keys. The routes derive tenant scope from the authenticated legacy owner and reviewed ownership mapping, enforce active training-center plan capability and permission, same-origin mutation checks and audit events. API documentation and the user manual describe current behavior.

Verification: `npm test` passes 58/58. The 14-migration disposable MariaDB suite passes actual HTTP route, origin-denial, tenant-isolation, offer-history, batch-capacity, stale-revision and publish precondition checks; `customerDataTouched=false` and `externalWrites=false`. The existing compiled SaleMaX login/workspace was exercised with a synthetic business account: login, sidebar entry, empty catalogue, course creation and QAR display rendered. The new script recognizes the app's `Lang-Arabic` setting and requests RTL localization; after that fix, rendered Arabic screen acceptance still needs a fresh browser run. The synthetic legacy dashboard has unrelated denied routes in this limited fixture.

TC09 remains Implementing. Existing browser CRUD beyond create, Arabic visual verification, phone/tablet review, accountant/manager access, enrollments, sale/invoice snapshot integration, public lead forms, billing, communications and all other TC00–TC41 work remain open. This local slice is not production proof, deployment approval or completion of the full upgrade. Do not deploy before release gates pass.


## TC09 follow-on — bilingual learning metadata (1 October 2026)

The existing Courses create/edit forms now capture course level, learning outcomes in English and Arabic, and prerequisites in both languages. These fields persist as tenant-scoped catalogue metadata and remain separate from immutable offer versions. The API validates the level enumeration and limits each text field to 5,000 characters. Migration `20261006_training_course_learning_info.sql` adds backward-compatible columns with a general-level default; no existing course rows or customer records require conversion.

Unit and synthetic MariaDB acceptance verifies create/read/update persistence, Arabic text, level changes, malformed levels and oversized/wrong-type fields. The original shell integration remains the delivery path. Enrollment, sales/invoice snapshots, brochure storage, branch/trainer records, tax profiles, non-owner read permissions and bilingual/responsive browser acceptance remain open; TC09 remains Implementing.

## TC10 implementation progress — contacts and opportunities (1 October 2026)

This increment extends the existing SaleMaX lead pipeline in place. Each course opportunity can link to a tenant-owned contact; phone/email match suggestions are review-only; and staff may create a separate learner contact when family members share a phone. No existing leads are automatically merged. Implementation has disposable MariaDB evidence for tenant isolation, contact reuse, multiple opportunities and separate shared-phone learners. Historical contact migration/reconciliation, editable contact profiles, authenticated English/Arabic browser acceptance, and downstream enrollment/sales/finance integration remain open. TC10 is still in progress; this does not satisfy rollout or production gates.

## TC11 implementation progress — accountable follow-ups (1 October 2026)

The existing Lead Pipeline Reports view now includes a cross-stage follow-up queue with all, overdue and upcoming filters; Qatar-local due times; summary counts; pagination; opportunity links; and complete/reschedule actions. The current lead due time remains authoritative and actions preserve tenant and agent-assignment checks while adding timeline activity. Synthetic MariaDB verification covers role scope, rescheduling, completion, stale repeats and event history. No WhatsApp/email reminder is sent. Browser acceptance, delegated task ownership, historical assignment reporting, follow-up policy enforcement and reminder delivery remain open. TC11 remains in progress.

TC11 concurrency follow-on: each queue row now includes a six-digit database due-time revision. Complete/reschedule requests must return the revision they displayed; stale rows receive a conflict instead of completing a newer rescheduled follow-up. The locale-specific datetime control converts Qatar local time to an ISO offset timestamp. Disposable MariaDB verification covers stale revision denial. Browser interaction and user-facing acceptance remain open.

TC10 profile follow-on: the existing opportunity detail now edits the linked contact's shared name and email for the workspace owner, updates every linked activity timeline, and leaves those fields read-only for agents. Linked-contact phone edits are intentionally rejected until WhatsApp conversation relinking has an audited workflow. Shared-profile behavior has disposable MariaDB coverage; EN/AR browser acceptance remains open.

TC10 shared-profile follow-on: the existing lead detail uses the linked contact profile for name/email. Owner edits update the shared record and append activity to each linked opportunity; agent fields are read-only. Linked phone changes remain blocked until conversation ownership can be safely reassigned. Lead board, task queue and activity report now render the shared display name. Disposable MariaDB acceptance covers profile propagation, timeline evidence and agent denial; visual EN/AR acceptance remains outstanding.

## TC11 implementation progress — assignment attribution (2 October 2026)

Initial opportunity assignment and subsequent reassignment are now explicit activity events with immutable agent identifiers and names captured at the time. Stage-change activity already identifies the actor, allowing the Won transition to identify the closing agent. This extends the existing timeline and assignment transaction. Disposable MariaDB verification covers first assignee, reassignment, closing actor, tenant isolation and activity history. Manager task delegation, follow-up ownership/SLA and authenticated EN/AR browser acceptance remain open; TC11 remains Implementing.

## TC12 implementation progress — versioned lead-form editor (2 October 2026)

The existing `/user` shell now has a bilingual Lead Forms editor and responsive draft preview, server-validated field allowlists, tenant/category/plan/owner permission checks, revision-guarded draft updates, immutable publish snapshots, idempotent publish retry, and a public definition endpoint that resolves only the active training-center tenant's current published snapshot. Slugs, titles and copy change on the public endpoint only after publishing. Disposable MariaDB covers draft invisibility, frozen live snapshots during edits, URL change at publish, cross-tenant denial, and repeat-publish behavior. The API/manual describe that public submissions and customer-facing form page remain disabled; TC12 stays Implementing until secure public capture creates a contact/opportunity, has abuse controls and passes browser/mobile EN/AR acceptance.

TC12 public-capture follow-on (2 October 2026): The published `/p/{tenantSlug}/forms/{formSlug}` EN/AR responsive form now submits allowlisted fields to a transactional capture endpoint. It records exact consent wording and publication version, creates the contact and lead in the existing CRM pipeline, returns a random enquiry reference, and safely replays the same UUIDv4 submission without a duplicate lead. Same-origin checks, published-form/category/active-plan checks, Qatar course ownership/current-offer checks, a honeypot, hashed visitor throttling and a form-wide hourly cap are enforced server-side. The owner can open or copy the live URL from the existing Lead Forms list. The copy distinguishes enquiry acknowledgment from enrollment and payment. Optional Cloudflare Turnstile now renders in the bilingual form and fails closed on the server after hostname/action verification; keys remain unset and no live provider call was made. Real-browser keyboard/mobile/RTL review, production provider verification and customer acknowledgment delivery remain open; TC12 remains Implementing.

## TC13 implementation progress — authenticated staff form capture (2 October 2026)

The existing public form route now supports a staff mode selected by `?mode=staff`. Lead Forms adds an open/copy staff link for published forms. The existing pipeline authentication accepts the current workspace-owner or active-agent session; the server derives the tenant from its verified owner mapping, checks active category/plan and the `forms.capture` role permission, and resolves the published slug only within that tenant. Staff submissions validate the same published allowlist and consent, then create the lead/contact transactionally with `capture_mode='staff'`, the server-derived collector type/ID and the agent as owner for agent capture. Retries are idempotent. The page and authenticated form response are no-store, staff fields disable autocomplete, no customer fields enter browser storage, and a successful save presents a reset for the next customer. Local real-MariaDB HTTP tests verify agent authorization, attribution, assignment, retry and foreign-origin denial. Phone/tablet/keyboard/screen-reader walkthroughs and a real browser remain open; TC13 remains Implementing.

TC13 verification update (2 October 2026): `npm test` passes 112/112, local baseline routes pass, and isolated MariaDB acceptance passes all 28 forward migrations plus authenticated staff-form HTTP checks for agent access, collector attribution, agent self-assignment, retry idempotency and foreign-origin denial. The suite confirms `customerDataTouched=false` and `externalWrites=false`; it creates/drops only a synthetic test database. The existing Lead Pipeline labels staff/public form sources in English and Arabic, and its cached asset version is advanced. The local app database, production and providers were not written. Live authenticated browser, phone/tablet, keyboard and screen-reader acceptance remain open; this increment is not deployed and TC13 remains Implementing.

## TC07 follow-on — accountant and manager invitations (2 October 2026)

The existing `/user` Team access screen now offers accountant, manager and agent roles from the assigned plan's available seats, displays active/pending/limit/available counts per role, and presents the invited workspace/email/role before account activation. The existing one-time invitation tables and canonical tenant identities are reused. Seat usage is rechecked inside activation; accountants and managers receive canonical tenant memberships, while agents retain the compatible legacy agent identity and reviewed ownership link. The API adds a no-store invitation preview endpoint. No new application shell or login system is introduced.

Verification: `npm test` passes 112/112; the local baseline smoke passes with `externalWrites=false` and `customerDataTouched=false`; and the isolated MariaDB suite applies all 28 forward migrations and verifies accountant/manager plan-seat use, one-time acceptance, canonical membership, canonical tenant password login, agent compatibility, pending-seat accounting and final-seat concurrency. Syntax and whitespace checks pass. The team screen has not yet had authenticated browser acceptance in English/Arabic or phone/tablet testing; the route-level preview/accept HTTP behavior and accountant/manager login handoff need an integrated browser run. This increment is pushed to GitHub branch `tc13-staff-form-capture`; it is not production verification or deployment approval. TC07, TC03, the rest of TC00–TC41 and release gates remain open.
