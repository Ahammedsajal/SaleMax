# SaleMaX user manual

Status: the upgrade is being implemented. This manual will document verified screens and real user journeys as they become available, including English/Arabic behavior. It is not a claim that planned features already work.

## Existing application remains the product

The upgrade extends the current SaleMaX admin and business panels. The intended plan destination is the existing Manage Plans screen at /admin?page=manage-plans; business/account assignment remains in Manage Users at /admin?page=manage-users. Preserve the existing /admin/login and /user/login entry points. Missing Courses, Finance, Reports and Forms functionality is added inside the current business panel. There is no new application or replacement shell.

The lab and preview instructions below describe isolated development verification, not the released user experience. In particular, the separate test plan page is superseded as a product destination. Backend functions must be connected to the existing screens before this manual can mark them available.

## Local verification environment

From the SaleMaX application directory, run `start-local.ps1` in PowerShell. Open http://127.0.0.1:3010/. The database binds to 127.0.0.1:3307. Run `stop-local.ps1` to stop this local environment. The imported training data is private and excluded from Git. Provider operations remain disconnected in local-only mode.

## Upgrade journeys to be documented

Super Admin and staff administration; business onboarding and plan assignment; team roles and seat limits; course/offer/batch setup; public and staff lead capture; assignments and follow-ups; sale approval; invoice and installment schedules; payment verification; receipt delivery; credits/refunds; reports; channel setup and delivery issues. Each journey requires tested screens, field guidance and recoverable error states before it is marked available.

## Initial Super Admin setup (operations only)

The initial canonical Super Admin must be created from a controlled terminal after the platform identity, security and verified-admin-link migrations have been applied. First verify which existing `/admin` account belongs to the product owner. Run `npm run bootstrap:super-admin -- --legacy-admin-id <id>`, type the requested confirmation phrase, enter the exact UID from that verified account's session, and enter its existing password at the hidden prompt. The command checks all three against the same legacy administrator row, creates the canonical owner and reviewed link in one transaction, and can succeed only once. It is not a routine deploy command. Do not use an employee account, guess by email, put credentials in shell arguments, or run it against the imported/production database before the release and owner-approval gates are satisfied.

After bootstrap, use the existing `/admin` login and the integrated Manage Plans **Verify access** flow to sign in as the canonical owner and enroll MFA. Save recovery codes outside the server and confirm their acknowledgement. Owner transfer/recovery and platform staff onboarding screens are not implemented yet; do not treat this bootstrap command as completing those workflows.

## Working login and MFA screens in the local lab

Run `npm run build:workspace`, then `./scripts/start-auth-lab.ps1` in PowerShell from the application folder. Open http://127.0.0.1:3016/. The script starts a separate database on loopback port 3309 and creates a synthetic-only database. It refuses an occupied port. Temporary test credentials are in the private, Git-ignored `database/local-runtime/auth-lab/access.json`; they are not production credentials. Each fresh lab start creates new test identities and removes its own synthetic database on a clean shutdown. No imported database or provider is used.

Open **/user** or **/user/login**, enter the test workspace name, email and password, then **Sign in**. The root URL redirects to /user. This page contains only business login: there is no SaleMaX administration tab or link. An incorrect password/workspace produces a helpful account error; the password show/hide control is available. Successful sign-in displays the canonical identity, role and business name returned by SQL. **Sign out** revokes that session. This screen proves authentication, not completed dashboard administration.

Open **/admin** or **/admin/login** for the platform test identity. This separate page is for the SaleMaX Super Admin and staff and has no business-workspace field. On first sign-in, scan the authenticator QR or enter its setup key, then enter the six-digit code. QR generation is local and the seed is not placed in a URL. Save the ten recovery codes using **Download recovery codes**, confirm **I saved my recovery codes**, then continue. Returning platform users see the authenticator challenge and can choose **Use a recovery code**. Each recovery code works once. The UI does not offer owner/MFA reset or silently replace an enrolled factor; those flows remain pending.

The routes preserve the existing product's /user and /admin separation. A session from the other audience does not display its identity or enter its MFA setup on the wrong login page. API authorization still checks the canonical audience, membership and MFA; hiding navigation is not the access boundary. These updated screens currently run in the isolated lab, and the production legacy routes remain preserved until the replacement release gates pass.

Use **العربية / English** for Arabic RTL or English. Requests show a waiting state and prevent concurrent clicks; errors distinguish invalid credentials, invalid/reused MFA codes, expiry and attempt limits. The local browser verified workspace login, platform enrollment, returning-user challenge/recovery option, required recovery acknowledgement, logout and Arabic layout at the available narrow 480 px viewport. Actual 360 px verification and production migration/legacy compatibility remain open.

Stop the lab terminal with Ctrl+C when finished. The script stops its own database process; it does not stop the main application on port 3010. Do not deploy the lab bootstrap/credentials or treat its synthetic Super Admin as the production owner account.

## Reviewing the workspace design locally

Run `npm run build:workspace`, then `npm run preview:workspace` from the application directory. Open http://127.0.0.1:3015/. This separate preview uses invented data and never connects to production accounts or providers. Stop its terminal with Ctrl+C when finished. It does not replace the original application at port 3010.

Use **Preview role** to inspect Super Admin, staff, business owner, accountant, manager and agent navigation. Owners see the training category's full menu. Agents see only assigned sample leads; accountants see only billing-linked samples with sales notes withheld. Search by learner/course, then use **Inspect** to view the scoped sample detail. Selecting another sidebar item opens its permission/readiness explanation: business actions are still being implemented.

Use **العربية / English** to switch language and layout direction. On a phone, open the navigation menu; the close button or Escape returns focus to the menu button. The work queue scrolls horizontally inside its card if needed. Use **Test category** to select the restaurant fixture and verify that training items disappear. This fixture demonstrates category isolation, not a usable restaurant product. Sample dashboard totals and permitted menu items are not proof that a course, invoice, payment or report workflow is ready.

## Existing Manage Plans validation upgrade

Use the existing admin panel → Manage Plans. Catalogue settings require a title, description and whole-number duration. Contact and QR limits must also be whole numbers; invalid values are rejected without saving. Trial plans have a zero price. The current catalogue supports whole-unit prices; decimal pricing is pending its database upgrade. Editing a catalogue row preserves its ID and does not rewrite previously assigned user-plan snapshots.

The bilingual inline editor preserves the existing catalogue actions. Versioned training-center contracts, role ceilings and publication are available to an explicitly linked administrator after the protected platform API is enabled and the administrator completes platform verification and MFA. Those routes are mounted in the existing application but remain disabled by default until account adoption and deployment prerequisites are complete. Desktop EN/AR acceptance is recorded below; phone/tablet and dark-mode checks remain open.

## Using the upgraded existing plan editor

In the existing admin panel, open Manage Plans. Choose Add New Plan for a new catalogue entry or Edit Plan on a current card. The form opens within the current page, preserving the sidebar and header. Enter the title, description, duration, contact/QR limits and prices, then choose messaging features. Trial plans disable the price field and save a zero price. Save plan refreshes the original catalogue. A failed save keeps entered values and identifies invalid fields; correct them and retry.

Back to plans returns to the catalogue. If you have changed the form, choose Keep editing to retain the draft or Discard changes to return without saving. Arabic language selection displays the new controls in Arabic and gives the editor RTL direction. No new admin login or separate plans application is required.

Training-center category, role limits and immutable version publication are available in the same editor. Business assignment is described below. Phone/tablet and dark-mode acceptance remain pending.

## User plan assignment upgrade in progress

The existing Manage Users plan action remains the destination. Its upgraded backend records the previous plan and expiry when assigning a new server-loaded catalogue plan, and rejects missing users or invalid plan duration. Assignment history is recorded from activation onward; earlier changes are not reconstructed automatically. The history migration is required before activating this backend.

If the account is already linked to a reviewed training-center business, the legacy catalogue preview and assignment are blocked to keep its business contract and account limits synchronized. Choose **Open training-center contract** in the message and continue with the reviewed contract preview. The preview does not change the account; confirm only after checking the category, role limits and current team usage.

The existing legacy assignment path shows a read-only catalogue comparison, recent assignment history and uses retry/stale-state tokens. It remains for accounts without a reviewed category link. Linked training centers use the versioned-contract action described below.


## Assigning a plan from the existing user table

Open the existing admin panel → Manage Users. In the user's Plan column, choose **Manage plan**. The inline form shows the account, current plan and expiry, and the latest 20 recorded assignments. Choose a catalogue plan, then **Review assignment** to compare duration, price, contact/QR limits and messaging features. Review makes no change. **Confirm plan assignment** assigns that catalogue snapshot and records history. The duration begins at confirmation; this action does not collect payment. **Back to users** returns to and refreshes the original table after a successful change.

If another administrator changes the account or catalogue during review, the confirmation is rejected. Choose **Reload account**, select the plan and review again. Connection/save errors preserve the selection; retrying the same confirmation cannot duplicate its recorded assignment. If the existing snapshot is malformed, the screen warns you and retains that exact prior snapshot in history on assignment. Earlier history is not reconstructed automatically. With no catalogue plans, create one in Manage Plans first.

Arabic controls include **إدارة الخطة**, **مراجعة التعيين**, **تأكيد تعيين الخطة** and **إعادة تحميل الحساب**. The inline form has RTL direction and Qatar-local dates. English/Arabic desktop review, confirmation, history and return-to-table have been verified with synthetic data. Phone/tablet and dark-mode acceptance remain open. Use the versioned-contract flow below for linked training centers.


## Category features and account limits in Manage Plans

In the existing Manage Plans screen, edit a saved catalogue plan. Save any price or commercial changes first. Its **Training-center features and account limits** section is inside the same editor. When platform adoption is activated, **Verify access** asks for your linked platform email/password and authenticator. Initial setup provides local QR/key and one-time recovery codes; download them or use **Show codes to copy**, save them privately and acknowledge before continuing. Returning access accepts the authenticator or a saved single-use recovery code. A missing verified link requires owner-assisted account adoption; legacy admin sign-in alone does not grant protected permissions.

Choose Training center, select features and enter the allowed owner/accountant/manager/agent counts. Owner stays one; the first draft proposes one accountant, one manager and seven agents. **Create contract draft** captures the saved catalogue details and those limits. New drafts start from the latest linked version. Use **Edit draft** to correct a draft's role limits or features before publishing; saving checks its revision so another administrator's update cannot be overwritten. Published versions cannot be edited. Unfinished changes trigger Keep editing/Discard changes when leaving or reloading. Review publication shows the frozen commercial terms, roles and features. **Publish reviewed version** freezes it; older versions remain visible. Publication requires fresh verification within five minutes and the publish grant, so use **Verify access again** if the action is unavailable.

Drafting/publication does not reassign businesses, create staff accounts, charge customers, enable unfinished modules or send provider messages. Assign a reviewed business separately using the flow below. Arabic controls include **إنشاء مسودة عقد**, **مراجعة النشر** and **نشر الإصدار المراجع**. English/Arabic desktop drafting, publication, preserved versions and unsaved-change protection have been verified with synthetic data; phone/tablet and dark-mode acceptance remain pending.

## Assign a published training-center contract to a reviewed business

In the existing admin panel, open **Manage Users** and choose **Manage plan** for the account. Choose **Training-center contract**. The form is available when the account has an explicit, owner-reviewed business link, your administrator is linked to a canonical platform identity, MFA is complete and your staff grant allows the action. If platform MFA is missing, open **Manage Plans**, choose **Verify access**, complete the authenticator or saved recovery code, and return to Manage Users. If the account has no reviewed ownership link, ask the platform owner to complete adoption; matching email addresses alone do not establish business ownership.

Select a published training-center contract. Review the frozen catalogue price in QAR, duration, current and proposed features, each role limit and the number of active members and pending invitations. The owner limit is one. Limits cannot exceed the published version or fall below seats already in use. **Review business assignment** changes nothing. **Confirm contract assignment** updates the existing account plan and expiry together with the canonical business access, then records both histories and the audit event. The expiry starts on confirmation; no payment is collected. Retrying the same confirmation after a connection loss returns its original result. If the account, team or plan changed after review, reload and review again.

Arabic controls use RTL layout. The form preserves the existing Manage Users page, account actions and return-to-table refresh. Assignment requires the tenth additive migration and the existing protected platform-administration activation. Production customer data is not automatically adopted by this migration.

The separate synthetic existing-panel lab can use port 3018 by setting SALEMAX_TEST_PANEL_PORT=3018 before running scripts/existing-panel-lab.cjs, with the disposable database engine already on loopback 3309. Its private access file is database/local-runtime/existing-panel-lab-3018/access.json. This lab runs the original shell and protected handlers.

### Platform staff invitations in the existing Manage Users screen

The SaleMaX owner can manage platform staff from the existing admin panel. Sign in at `/admin/login`, open **Manage Users**, and choose **Platform staff**. This button appears only after the existing administrator login; the protected API additionally requires the owner’s canonical platform identity, MFA and a recent verification. If prompted, complete the platform sign-in and authenticator check. Staff accounts cannot manage other platform staff or receive owner-only permissions.

To invite someone, enter their work email, select only the platform permissions they need, and choose **Create staff invitation**. Use **Copy setup link** and share it with that person through a channel you control. SaleMaX does not send the link by email or WhatsApp yet. The link works once and expires after 72 hours. It is shown only when first created; use **Create new link** from the invitation list to invalidate the old link and copy a replacement. Expired pending invitations can also be renewed. Cancelled invitations cannot be used; if you invite the same email again, SaleMaX safely reissues the cancelled pending account.

The recipient opens the link, enters their display name and a password of at least 12 characters, and activates access. This setup appears as an overlay on the existing `/admin/login` route. They then sign in through the existing administrator login and configure MFA before using platform functions. Do not send the one-time link in a public channel. If it is exposed, cancel the invitation or create a replacement link immediately.

The **Current staff** list lets the owner change an employee’s allowed permissions or disable platform access. Saving changes revokes all active platform sessions, so the staff member must authenticate again. Re-enabling access does not restore any revoked session. Use **Reload staff** to refresh the list. In Arabic, the same controls use RTL layout and translated labels. This screen only manages SaleMaX platform staff; it does not create a training-center tenant employee or agent account.

Invitation delivery is copy-link only in this release slice. Automatic email/WhatsApp delivery, tenant staff onboarding, full mobile/tablet review and production activation are still open implementation/release work.

### Agent seats for linked training centers

After an account has an explicit reviewed business link and an active training-center contract, the existing agent endpoints enforce the assigned agent limit. Under the initial seven-agent contract, the owner can create up to seven active agent accounts. When no seats remain, the API returns a clear limit message and directs the owner to SaleMaX staff to review the assigned plan. Deactivating an agent frees a seat; deleting an agent removes its legacy login and deactivates any linked canonical membership. Reactivating an agent checks capacity again. Accounts without reviewed ownership linking keep their existing legacy behavior during phased adoption.

This increment enforces active agent seats in the existing API, including concurrent creates. The new invitation flow adds link-based acceptance, but automatic email/WhatsApp delivery, full lifecycle/concurrency verification, authenticated English/Arabic review and other role onboarding remain in progress. It requires the existing ownership and contract migrations for linked accounts. Staff setup and role-specific journeys remain in progress.

### Agent access to the existing lead pipeline

Agents now see and open only leads specifically assigned to their own agent account. Unassigned leads and another agent's leads are denied by the existing pipeline API even if an agent knows the record ID. Owners continue to work across their business leads. In an existing lead's detail drawer, choose a contact outcome and save it with the lead; select **Follow-up required** and enter the next follow-up date and time when it applies. Follow-up-scheduled and call-requested outcomes preselect that requirement, and the form blocks saving until a date is entered. Each saved outcome becomes a separate activity entry for reporting; adding an internal note remains a separate action. Authenticated browser acceptance of the new controls in both languages remains open. An accountable follow-up task queue and assignment history are still being implemented.

Open **Lead Pipeline → Reports** in the existing business panel. Choose Daily, Weekly or Monthly, select a Qatar-local report date, then choose **Run report**. The summary separates leads created and touched, contact outcomes, notes and follow-up counts. The activity list shows when each lead was handled, who handled it, its outcome or internal note, and its next follow-up; select a lead to open its existing detail drawer. Owners see workspace activity and agents see only leads currently assigned to them. Use Previous/Next to review additional activity pages. Loading, empty and retry states are shown in English and Arabic. Reports use the tenant timezone (Asia/Qatar for the Qatar launch). Scheduled WhatsApp/email delivery, manager/accountant role views and invoice/payment reconciliation are still open and are not included in these activity totals.

### Inviting an agent (implementation in progress)

The training-center owner can open **Team Invitations** beside **Agent Login** in the existing business panel to invite an agent. Enter the agent email and create the invitation; copy the one-time link and send it using your approved channel. The link expires in seven days. The invitee opens the link, enters their name, Qatar phone number and a password of at least 12 characters, then uses the existing Agent Login entry point. Rotating an invitation invalidates the previous link; cancelling it prevents activation. The active contract's agent seat limit is checked both when inviting and when the invitee accepts. Automatic email/WhatsApp delivery and accountant/manager onboarding are not yet available.

\n