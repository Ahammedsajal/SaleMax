# SaleMaX implementation status

Full objective: implement the audited upgrade, preserve and improve the existing UI, verify every required screen/function locally, document APIs and user journeys, push intended changes to Ahammedsajal/SaleMax, and release verified updates at crm.salemax.qa.

## Evidence ladder

Planned -> Implementing -> Locally verified -> Staging verified -> Provider verified where applicable -> Release approved. A passing foundation test does not mark an entire ticket or the product complete.

## Existing-project scope correction on 1 October 2026

The owner explicitly requires additions and improvements to the existing SaleMaX project, with no replacement project, recreated shell, duplicate plans module or parallel login. Plan version 1.2 removes the frontend-recreation fallback and maps requirements to the existing panels and modules. Manage Plans at /admin?page=manage-plans and Manage Users at /admin?page=manage-users are the required plan/account destinations. Preserve /admin/login, /user/login and current route families.

Earlier standalone UI prototypes and the auth-lab plan page are test work, not the product implementation or integrated acceptance. The versioned plan, seat and auth services can be reused behind the existing module. Current working-tree HTTP/MariaDB checks additionally prove plan handlers, staff grant reload, paging/filtering and read-only assignment preview. The existing plan screen has not yet been connected to those services. Resume with that integration and legacy ownership/adoption; do not continue building another panel. No production upgrade has been deployed.

The version 1.2 Markdown and Word plan contents were synchronized, including the existing-module mapping, route policy and removal of shell-recreation instructions. Both copies in the application and original planning folder match by SHA-256. The packaged DOCX renderer failed because LibreOffice is unavailable on this host; Word text/structure checks pass, but visual layout verification remains pending and is not claimed complete.

## 1 October 2026 increment

TC00/TC01 started. Git initialized against the requested empty repository with private/runtime exclusions. Forward migration safety and ledger implemented. Ten automated tests passed; real MariaDB synthetic-database tests passed including repeat runs, two-connection locking and interrupted-DDL recovery gating. Baseline localhost health/branding/theme/homepage passed. Embedded legacy Meta app secret removed before publication. Static AST inventory now records 20 mounted families and 369 declared routes; requested feature preservation is mapped with runtime acceptance still pending. Fresh GitHub clone npm ci, ten tests, native dependencies, MariaDB synthetic checks and controlled localhost startup passed. Structural inventory captures 66 tables/651 columns without customer rows. Production has not been upgraded by this increment.

Added an editable standalone TC01 preview with six role fixtures, EN/AR layout, category-filtered navigation, scoped sample lead search/details and mobile keyboard controls. Its output is outside the production public directory and excluded from Docker. It is a synthetic prototype, not completed business screens. Added canonical identity/tenant/session/legacy-ownership DDL, permission primitives and a session loader; real disposable MariaDB tests verify cross-tenant/wrong-identity denial, owner constraints, live permission reload, revocation, disablement, credential-version invalidation, expiry, MFA age and reauthentication. Browser checks exercised all six roles, agent search/details, accountant projection, category switch, Arabic, phone menu/Escape and tablet layout. Current foundation contract and preview instructions are documented.

TC35 now also includes real SQL/service primitives for plan catalog versions, publication, assignment history and pending invitation seat reservations. Twenty-one automated tests and disposable MariaDB concurrency checks pass: two connections compete for the seventh agent seat, stale/published edits fail, new versions preserve prior assignments, unsafe downgrades roll back, expired reservations release capacity, and stale actor grants/expired entitlements deny new invitations. Successful changes have transactional redacted audit events. `PLAN_AND_SEAT_CONTRACT.md` records exact interfaces and remaining screen/auth/delivery prerequisites. This is not a completed plan-management or team onboarding journey.

Canonical auth router/services now pass real HTTP/MariaDB checks for password login, hashed opaque sessions, HttpOnly cookies, Origin/session-bound CSRF, logout revocation, shared login throttling, encrypted TOTP enrollment, MFA-required platform gates, replay protection and concurrent single-use recovery. 23 automated tests and six forward migrations pass; RFC TOTP vectors independently verify the algorithm. `AUTHENTICATION_CONTRACT.md` records exact routes and remaining activation requirements. The router is unmounted; this does not mark shared login UI, legacy compatibility or TC03 complete.

Maintained bilingual login/MFA screens now work against those real APIs and MariaDB in the synthetic auth lab (HTTP 3016, DB 3309). Browser evidence proves workspace-slug sign-in, meaningful invalid-login feedback, platform MFA enrollment, recovery-code acknowledgement, returning challenge/recovery option, logout, canonical identity display and Arabic narrow layout at actual 480 px. Setup secrets/recovery codes are omitted from evidence screenshots. Screens/handlers remain outside the production shell. User manual and OpenAPI reflect the verified login contract; actual 360 px, legacy replacement and subsequent business screens remain open.

Remaining immediate work: full TC35 domain/API/event contracts, TC00 legacy runtime preservation acceptance, actual authenticated onboarding and source-built business journeys. No training finance screen or new platform workflow is marked implemented. The original compiled application remains the active local/production UI; no new schema or prototype has been deployed to production.

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
| TC06 | Implementing | TC04 TC05 | Plan drafts/versions, assignments and impact preview; edits preserve existing plan contracts |
| TC07 | Implementing | TC03 TC06 | Existing agent creation, activation and deletion now honor linked-business role seats; invite delivery, acceptance, onboarding and all-role enforcement remain open |
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
| TC35 | Implementing | TC00 TC01 | Canonical identity/ownership DDL and session/policy primitives locally verified; full domain/API/event contracts and reviewed legacy backfill still required |
| TC36 | Planned | TC06 TC07 TC21 | Subscription lifecycle, renewal and continuity rules; expiry/suspension never deletes evidence or loses verified settlements |
| TC37 | Planned | TC02 TC08 TC21 | Worker leases, QR session ownership and multi-node Socket.IO routing; two processes cannot send/process the same business action concurrently |
| TC38 | Planned | TC16 TC19 TC21 | Secure customer invoice/receipt access without a learner portal; scoped expiring links cannot expose other documents or internal notes |
| TC39 | Planned | TC09 TC14 TC35 | Finance transition/reconciliation contract, recognition policy and approval evidence; synthetic edge cases reconcile before posting modules are enabled |
| TC40 | Planned | TC02 TC03 TC05 TC07 TC08 TC35 | Foundation gate for source/build/auth/tenant compatibility; legacy regression, direct-URL denials and feature readiness matrix pass |
| TC41 | Planned | TC00 TC37 | Release topology, capacity budget, private storage and isolation from other hosted products; measured failover/backpressure plan and clean release package |



## Existing catalogue integration increment — 1 October 2026

The existing `/api/admin/add_plan` and `/api/admin/edit_plan` now share a source-managed compatibility handler with field-level validation. It preserves routes, administrator middleware, IDs and commercial/feature fields. Fractional limits and malformed flags are rejected instead of truncated/coerced. The schema inventory identifies legacy `price` as BIGINT, so fractional catalogue prices explicitly fail before a write; decimal-money migration remains open. Assigned snapshots and canonical version contracts are not changed by these handlers.

26 automated tests pass. A disposable MariaDB run using the inventoried legacy plan structure additionally verifies actual create/edit, preserved IDs, disabled flags, trial price and no write for a fractional price. Six forward migrations and existing identity/plan/auth tests pass in the current worktree with customerDataTouched=false and externalWrites=false. Earlier unpublished platform-router tests remain working-tree evidence rather than published-release proof.

An inline editor is under development inside existing Manage Plans using maintained public hooks, without editing compiled React logic. Its authenticated existing-screen English/Arabic, responsive and navigation acceptance is not yet verified, so frontend changes remain unpublished. Category/seat/version adoption, Manage Users integration and the full remaining ticket ledger remain open. No production upgrade has been deployed.

## Existing Manage Plans screen increment — 1 October 2026

The existing compiled admin shell now loads a maintained inline plan editor at `/admin?page=manage-plans`. Its current Add New Plan and Edit Plan actions use the original `add_plan`/`edit_plan` endpoints. The existing sidebar, header, card catalogue and login remain in place; no minified React logic was edited and no second catalogue was added. The editor preserves IDs, commercial fields and feature flags, shows loading/save errors, focuses invalid fields, prevents duplicate submission, disables trial pricing and offers inline Keep editing/Discard changes choices.

Browser verification through the original shell and actual legacy routers/middleware on loopback 3017 proved an initially empty catalogue, authenticated creation, original-card rendering, edit-value reload, server validation with retained form values, changed title, trial zero price, disabled feature persistence, Arabic editor/labels, and both unsaved-change choices. English/Arabic desktop checks pass using disposable synthetic data. Phone/tablet verification remains pending: viewport set/reset calls timed out and observed width remained the normal desktop width. Do not claim 360 px acceptance from these checks. Dark-mode and subsequent category/role-limit/version controls remain open.

`node scripts/existing-panel-smoke.cjs` also passes against that synthetic runtime: real administrator login, missing/invalid-token write denial, create/edit, invalid-field no-write, preserved ID, trial zero price, original compiled asset/editor references and lab scope rejection. 26 automated tests pass. Fixture credentials and screenshots remain ignored/private. Canonical ownership/plan adoption and Manage Users upgrade are the next integration work; TC06 remains incomplete. Production is unchanged.

## Existing Manage Users assignment backend — 1 October 2026

The existing `/api/admin/update_plan` handler now uses a connection-owned transaction and a seventh forward migration for assignment history. It preserves existing IDs and request/response compatibility, copies the catalogue row rather than trusting posted feature values, rejects missing/duplicate user identifiers, and stores exact previous and new plan/expiry snapshots. Optional idempotency and expected-state fields support reliable retry and competing-change rejection. Required tables must be InnoDB; a missing migration fails explicitly rather than creating untracked assignments. Metadata-only inspection confirms the imported local user/plan tables are InnoDB, without reading customer rows.

28 automated tests and seven forward migrations pass. Disposable real MariaDB evidence proves preserved historical snapshots, idempotent retry, competing stale-state rejection across two connections, rollback of history and user update together, and missing/duplicate-user denial. UI assignment preview/history controls, canonical ownership/category/version adoption, upgraded staff authorization and English/Arabic existing-screen acceptance remain pending. Original compiled callers remain compatible but do not yet supply idempotency/expected-state fields. Neither the new history table nor any upgrade code has been deployed/applied to imported or production databases.


## Existing Manage Users assignment screen — 1 October 2026

A maintained inline control now opens from the original Manage Users table's Plan column. It preserves the compiled shell, original list/account actions and legacy login, and uses actual administrator middleware with new context/preview reads and the existing transactional update_plan endpoint. It shows current contract and expiry, catalogue selection, read-only feature comparison, confirmation, loading/error states and recent history. It supplies account/catalogue state hashes and a stable confirmation UUID, disables concurrent submissions, reloads context after save, and refreshes the original table on return. User-list responses now exclude password/API-key/notification credential columns and safely display malformed legacy plan JSON without rewriting stored snapshots.

Authenticated browser checks on the disposable 3017 runtime proved English and Arabic entry, comparison, confirmation success, appended history and original-table refresh. A competing synthetic API assignment produced the visible stale-account error; Reload account recovered the current contract before another review. Arabic form has RTL direction and Qatar-local dates. Evidence screenshot is ignored at rebrand-evidence/existing-user-plan-ar-20261001.png. Real database integration verifies read-only preview, changed-catalogue rejection, duplicate UID read denial and the earlier transactional/history/concurrency invariants. Actual-router smoke also verifies credential-field exclusion and repeat confirmation. Phone/tablet and dark-mode acceptance are pending; no responsive claim is made.

TC06 remains Implementing. Canonical category/version/seat adoption, owner/staff grants and the legacy account editor's token-free alternate assignment action remain open. Original routes remain compatible; two added read endpoints bring the inventory to 371 declarations. Neither imported customer data nor production has been migrated or upgraded. Full training-center finance/report/form/category scope and release gates remain required.

Publication verification: an index-exported tree containing only tracked/staged files (excluding unpublished prototype changes and private runtime files) passed all 28 automated tests and the seven-migration real MariaDB integration. This separates the published assignment evidence from unrelated working-tree platform-router tests.


## Existing catalogue to versioned contract bridge — 1 October 2026

Implemented an eighth forward migration and catalogue bridge services linking existing numeric plan IDs to canonical versions without another editable catalogue. Draft creation captures exact commercial fields alongside training category/capabilities and all four role limits. Matching concurrent retries create one version and mapping. Publication rejects changed commercial data, canonical publication cannot bypass the linked review, and later catalogue edits preserve published commercial snapshots. Transactional audit failure rolls back the new draft and version allocation; InnoDB storage is required. No automatic legacy backfill or customer reassignment occurs.

These services require canonical MFA/permissions and are not enabled through ordinary legacy admin authorization. The existing Manage Plans category/version/role-limit controls and adapters are still pending. This is a prerequisite integration increment, not an implemented screen or completed TC06. Eight forward migrations and all 28 tests passed in the clean index-exported publication tree, excluding unrelated prototype changes. Real MariaDB checks include concurrent draft retry, publication freshness, frozen snapshots and audit-failure rollback; imported and production migrations remain unapplied. Full scope remains active.


## Existing Manage Plans protected contract controls — 1 October 2026

The original plan editor now embeds training-center capability selection, four role ceilings, mapped version history, draft creation and immutable publication review. Existing commercial save/card list/sidebar/login remain preserved. A ninth migration stores explicit reviewed administrator identity links; no owner is inferred from email or row order. Existing host activation is off by default. When activated, the existing administration namespace mounts canonical verification/MFA plus contracts guarded by both administrator identities, MFA, current staff grants and CSRF. Legacy token failures now remain bounded and omit echoed tokens/SQL errors.

Browser acceptance on synthetic port 3018 proves preserved legacy sign-in, in-editor platform verification, initial authenticator setup, saved recovery acknowledgement, real English draft/publication with six agents and one excluded feature, inherited subsequent values, unsaved discard protection, Arabic draft/publication with seven agents and preserved prior version, plus returning verification using the actual saved recovery code. The download event observer timed out, but the generated file was verified on disk and copied to ignored runtime storage; the new show/copy fallback still needs its own browser acceptance. No secrets appear in evidence screenshots. Arabic proof: rebrand-evidence/existing-plan-contract-ar-20261001.png. Phone/tablet/dark-mode, field-level server errors and further navigation/failure recovery remain open.

Real HTTP/MariaDB tests verify missing canonical session, MFA/CSRF denial, matching legacy/canonical mapping, draft/publication/list, immediate staff-grant revocation, disabled mapping denial and mutation rejection audit. All 28 tests and nine real MariaDB migrations passed in the clean index-exported publication tree, excluding unrelated prototype changes. Auth/contract body limits and strict path IDs also pass. TC03/TC06/TC40 remain incomplete: production account adoption, all legacy entry-point compatibility, canonical business assignment, role-limit enforcement and the remaining full training-center/release scope are required. Imported and production databases remain unchanged.


## Existing Manage Users business-contract assignment adapter — 1 October 2026

The existing Manage Users inline plan control now offers **Training-center contract**. Protected routes reuse the existing administrator sign-in plus canonical platform session, MFA, exact reviewed administrator link, current `plans.read`/`plans.assign` grants and CSRF checks. The form lists published versions for the linked category, previews frozen QAR terms, capabilities and actual active/pending team seats, enforces role ceilings, and requires explicit confirmation. It preserves the existing Manage Users page and legacy plan action. English and Arabic labels and RTL direction are implemented.

The assignment adapter links an explicit reviewed `user` ownership mapping to the existing legacy plan/version. Confirmation locks the legacy user and tenant, verifies its UID hash and active owner membership, reloads the published snapshot, validates category and seat limits, then writes the canonical assignment, legacy plan/expiry, both histories, idempotency ledger, tenant revision and audit event in one InnoDB transaction. Both expiry records derive from one database UTC timestamp. No email-based ownership inference occurs. Legacy writers and generic canonical plan assignment reject mapped accounts so those accounts use this adapter.

The tenth migration is additive. The 28 automated tests pass. Ten forward migrations pass against a disposable MariaDB database. Actual HTTP tests cover MFA/CSRF, reviewed linking, read-only preview, confirmation, retry and staff revocation; service tests cover state conflicts, seat/category ceilings, shared expiry, history, audit and both write guards. The local port-3018 fixture now includes a synthetic reviewed center and published contract. Phone/tablet/dark-mode, explicit legacy adoption/onboarding screens, remaining legacy role enforcement and full TC00–TC41 scope remain open. Imported customer data and production remain unchanged.

## Existing agent seat enforcement increment — 1 October 2026

The existing `/api/agent/add_agent`, `/change_agent_activeness`, and `/del_agent` routes now consult the canonical business contract when an explicit reviewed ownership link exists. New active agent accounts and reactivations enforce the assigned agent ceiling; deactivation frees capacity; deletion deactivates any explicitly linked canonical membership and owner-scopes the legacy mutation. Counts include active canonical agent memberships, pending reservations and active legacy accounts not represented by a canonical membership. Seat mutations share the tenant row lock used by invite reservations. Unlinked accounts and installations without the ownership migration preserve the existing route behavior; partial or inconsistent mapped state fails closed. The add route retains its response and adds current seat usage for linked accounts.

Verification: 28 automated tests pass. Ten forward migrations plus synthetic MariaDB tests pass, including two separate connections competing for the last of seven seats, rejection of the eighth, activation rejection while full, reactivation after a seat is released, deletion accounting, and legacy fallback for an unlinked account. `customerDataTouched=false` and `externalWrites=false`. TC07 remains Implementing: invitations, verified identity binding, delivery/acceptance, accountant and manager account lifecycle, and existing-screen English/Arabic/responsive verification remain required. The code requires applied migrations and explicit reviewed ownership linking before a tenant receives enforcement. No imported or production database was changed.
