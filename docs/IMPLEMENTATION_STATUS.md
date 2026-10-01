# SaleMaX implementation status

Full objective: implement the audited upgrade, preserve and improve the existing UI, verify every required screen/function locally, document APIs and user journeys, push intended changes to Ahammedsajal/SaleMax, and release verified updates at crm.salemax.qa.

## Evidence ladder

Planned -> Implementing -> Locally verified -> Staging verified -> Provider verified where applicable -> Release approved. A passing foundation test does not mark an entire ticket or the product complete.

## 1 October 2026 increment

TC00/TC01 started. Git initialized against the requested empty repository with private/runtime exclusions. Forward migration safety and ledger implemented. Nine automated tests passed; real MariaDB synthetic-database tests passed including repeat runs, two-connection locking and interrupted-DDL recovery gating. Baseline localhost health/branding/theme/homepage passed. Embedded legacy Meta app secret removed before publication. Production has not been upgraded by this increment.

Remaining immediate work: editable frontend recovery/recreation, fresh-checkout install/build verification, route/feature inventory and TC35 schema/API/permission contract pack. No training finance screen or new platform workflow is marked implemented. API documentation and user manual are started and explicitly describe their current limits.

## Ticket ledger

Execute by dependencies, not numeric order. TC34 is post-launch expansion; TC27 must pass before gateway checkout. All other plan requirements remain open until their acceptance evidence exists.

| Ticket | State | Dependencies | Required deliverable and acceptance |
| --- | --- | --- | --- |
| TC00 | Implementing | None | Source/runtime audit, editable frontend recovery, safe migration runner and scoped Git baseline; startup is reproducible, real tests exist and preservation status is recorded |
| TC01 | Implementing | TC00 | Owner/staff/tenant prototypes and EN/AR route map; requested features trace to screens and role landing pages |
| TC02 | Planned | TC00 TC35 | Tenant identity and resource constraints; another tenant's IDs fail across API/files/jobs/export/live updates |
| TC03 | Planned | TC02 | Shared login/memberships, owner-only Super Admin and MFA; tenant invite cannot create platform owner |
| TC04 | Planned | TC03 | Staff delegation and tenant console; staff can onboard/manage approved scope, denied elevation is audited |
| TC05 | Planned | TC02 | Versioned category/capability engine; dummy category has different menu and rejects training operations |
| TC06 | Planned | TC04 TC05 | Plan drafts/versions, assignments and impact preview; edits preserve existing plan contracts |
| TC07 | Planned | TC03 TC06 | Team invites and per-role limits; concurrent eighth agent fails under seven-seat entitlement |
| TC08 | Planned | TC01 TC05 | Existing feature wrappers and provider state labels; all requested legacy entries remain usable by permitted roles |
| TC09 | Planned | TC05 TC40 | Course/offer/batch CRUD with history and capacity; price edits cannot change issued invoice snapshots |
| TC10 | Planned | TC02 TC09 TC35 | Contact/opportunity model, timeline and dedupe; multiple learners sharing a phone remain distinguishable |
| TC11 | Planned | TC07 TC10 | Routing, assignments, outcomes and next actions; reassignments preserve first/closing agent history |
| TC12 | Planned | TC09 TC10 TC11 | Form editor, versioning and public capture; tampered tenant/course/agent fields cannot cross scope |
| TC13 | Planned | TC12 | Mobile/tablet staff/kiosk form and accessibility; phone, tablet and keyboard flows pass with clean reset |
| TC14 | Planned | TC09 TC10 | Sale review/approval contract; incomplete billing data or unapproved discount blocks conversion |
| TC15 | Planned | TC14 TC21 TC39 | Transactional enrollment/invoice conversion; concurrent and repeated confirmation produces one intended invoice |
| TC16 | Planned | TC15 TC39 | Invoice subledger, numbering and PDFs; balanced events, unique numbers and immutable issued snapshots |
| TC17 | Planned | TC16 | Installment schedules/rescheduling; exact totals, preserved paid items and no stale future reminders |
| TC18 | Planned | TC17 | Manual verification and payment allocations; partial/early/excess/cross-currency cases reconcile |
| TC19 | Planned | TC18 | Receipt generation and downloads; one receipt per posted payment, correct authorized allocations |
| TC20 | Planned | TC18 TC19 | Credits/refunds/reversals/disputes; posted records remain immutable and balances reconcile |
| TC21 | Planned | TC02 | Outbox, notification worker and event contract; retries/dead letters never duplicate business postings |
| TC22 | Planned | TC08 TC21 | Email/Meta adapters, consent and template readiness; sandbox evidence distinguishes accepted from delivered |
| TC23 | Planned | TC17 TC19 TC21 TC22 TC38 | Reminders and receipt copies; payment/opt-out/reschedule suppresses stale sends at dispatch |
| TC24 | Planned | TC11 TC20 | Report definitions and snapshots; fixture reconciles agent outcomes and billed/collected/outstanding totals |
| TC25 | Planned | TC21 TC22 TC24 | Daily/weekly/monthly schedules to main owner; timezone/retry/revised-period tests pass without duplicate run |
| TC26 | Planned | TC11 TC18 TC24 | Role dashboards and exception queues; every card drills into correctly scoped actionable records |
| TC27 | Planned | TC18 TC20 TC21 TC39 | Gateway adapter and reconciliation if launch-approved; signed duplicates/out-of-order events produce one correct payment |
| TC28 | Planned | TC04 TC21 TC25 | Owner health and staff incident views; injected failures create actionable alerts and bounded retries |
| TC29 | Planned | TC02 TC16 TC35 TC39 | Migration/backfill rehearsal and rollback; record counts, ownership and financial totals reconcile |
| TC30 | Planned | TC08–TC26 TC36 TC38 | EN/AR/RTL regression and accessibility; permitted roles pass all critical phone/tablet/desktop journeys |
| TC31 | Planned | TC28 TC29 TC30 TC37 TC41 | Load, isolation, security and restore evidence; documented targets pass or release remains gated |
| TC32 | Planned | TC23 TC25 TC31 | Pilot with 2–3 consenting centers, training and defect triage; end-to-end invoice/payment/report evidence accepted |
| TC33 | Planned | TC32 | Approved packaging, onboarding, support/runbooks and production rollout; explicit go/no-go record |
| TC34 | Planned | TC33 | Next-category contract proof and extension roadmap; core identity/billing stable and training regression passes |
| TC35 | Planned | TC00 TC01 | Schema/API/event contracts and legacy ownership mapping; reviewed DDL, payloads, permissions and synthetic fixtures exist before dependent modules |
| TC36 | Planned | TC06 TC07 TC21 | Subscription lifecycle, renewal and continuity rules; expiry/suspension never deletes evidence or loses verified settlements |
| TC37 | Planned | TC02 TC08 TC21 | Worker leases, QR session ownership and multi-node Socket.IO routing; two processes cannot send/process the same business action concurrently |
| TC38 | Planned | TC16 TC19 TC21 | Secure customer invoice/receipt access without a learner portal; scoped expiring links cannot expose other documents or internal notes |
| TC39 | Planned | TC09 TC14 TC35 | Finance transition/reconciliation contract, recognition policy and approval evidence; synthetic edge cases reconcile before posting modules are enabled |
| TC40 | Planned | TC02 TC03 TC05 TC07 TC08 TC35 | Foundation gate for source/build/auth/tenant compatibility; legacy regression, direct-URL denials and feature readiness matrix pass |
| TC41 | Planned | TC00 TC37 | Release topology, capacity budget, private storage and isolation from other hosted products; measured failover/backpressure plan and clean release package |
