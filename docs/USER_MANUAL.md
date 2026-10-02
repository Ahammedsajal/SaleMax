# SaleMaX user manual

Status: the upgrade is being implemented. This manual will document verified screens and real user journeys as they become available, including English/Arabic behavior. It is not a claim that planned features already work.

## Existing application remains the product

The upgrade extends the current SaleMaX admin and business panels. The intended plan destination is the existing Manage Plans screen at /admin?page=manage-plans; business/account assignment remains in Manage Users at /admin?page=manage-users. Preserve the existing /admin/login and /user/login entry points. Missing Courses, Finance, Reports and Forms functionality is added inside the current business panel. There is no new application or replacement shell.

The lab and preview instructions below describe isolated development verification, not the released user experience. In particular, the separate test plan page is superseded as a product destination. Backend functions must be connected to the existing screens before this manual can mark them available.

## Local verification environment

From the SaleMaX application directory, run `start-local.ps1` in PowerShell. Open http://127.0.0.1:3010/. The database binds to 127.0.0.1:3307. Run `stop-local.ps1` to stop this local environment. The imported training data is private and excluded from Git. Provider operations remain disconnected in local-only mode.

## Upgrade journeys to be documented

Super Admin and staff administration; business onboarding and plan assignment; team roles and seat limits; course/offer/batch setup; public and staff lead capture; assignments and follow-ups; sale approval; invoice and installment schedules; payment verification; receipt delivery; credits/refunds; reports; channel setup and delivery issues. Each journey requires tested screens, field guidance and recoverable error states before it is marked available.

## Confirming an approved training sale (owner)

1. Open the existing business panel's Lead Pipeline and select the lead. Review the learner, payer, invoice email, course offer, discount, terms and installment schedule in Sale Review.
2. After the owner approves the review and the accountant has approved the business Finance profile, select **Confirm sale and issue invoice**. If the action is unavailable, read the readiness message; common causes are an unapproved finance profile, an issuer-role mismatch, a changed offer, or installments that do not equal the invoice total.
3. On success, the panel shows the invoice number and total. The lead moves to Won and the enrollment, invoice, receivable schedule and initial journal posting are committed together. A selected batch reserves one seat.
4. Repeating the same request does not create a second invoice. The current screen provides manual payment posting and an on-screen receipt after verification; invoice PDF/download, cash refunds, and customer email/WhatsApp delivery remain unavailable. The notification event is queued internally only; it is not sent.

The first conversion screen is an owner-issued flow. Although Finance policy can designate an accountant as issuer, the canonical accountant sale-conversion screen is still pending, so that setting cannot yet complete this journey. Batch reservation expiry is also pending a product policy decision.

## Issued invoices

Open **Finance settings** in the existing business workspace. The **Issued invoices** register lists recently issued invoices and lets an owner or accountant search by invoice number, learner, payer or invoice email, filter by status, and move through result pages. Select **View details** to see the legal seller and tax snapshot, course line, discounts, installment due dates, enrollment details and the balanced invoice journal entry. The register works in English and Arabic and keeps invoice amounts in QAR.

Invoice details now include a payment history, current verified amount collected, remaining balance, and receipts generated after verification. The owner or accountant records the amount received, method, Qatar-local receipt time and optional bank/cash reference. The record remains pending and does not change the invoice balance until an accountant verifies it. Duplicate references are flagged for review. After verification, the system allocates funds to the oldest open installments, posts the balanced entry and issues one receipt for that payment. Any amount beyond the invoice balance is shown as an unapplied customer deposit. An owner must provide a distinct second approval when the payment exceeds the threshold in the active finance policy.

### Record and verify a manual payment

Open **Finance settings → Issued invoices**, find the issued invoice and select **View details**. Enter the received QAR amount using up to two decimal places, choose cash, bank transfer, cheque or other, and select the Qatar-local date/time. Add the bank/cash reference when available; a duplicate warning means you should compare the original evidence before approval. Choose **Record payment for verification**. A pending record is visible in payment history but does not reduce the amount due.

The accountant opens the **Payments awaiting verification** queue, checks the invoice, amount, method, date and reference against the accounting/bank/cash evidence, then selects **Verify and issue receipt**. If the record is wrong, enter a reason and choose **Reject payment record**; rejected records do not post. The accountant cannot verify their own record if the approved policy requires a second approver above its threshold. In that case the owner opens Finance settings and selects **Second-approve and issue receipt** for the eligible item. The owner cannot reject payment records. Below or at the threshold, the accountant completes verification.

After posting, the invoice balance and installment states update. Choose **View receipt** in payment history to review the immutable receipt record and applied/unapplied amounts. The receipt is currently an on-screen record; PDF download, proof attachments and automatic email/WhatsApp delivery are not available. The customer is not notified by this workflow. Do not treat the initial payment record as a verified payment or send it as a receipt.

### Request an invoice credit

Open **Finance settings → Issued invoices → View details** and review the amount due after payments and prior credits. The owner or accountant can enter a QAR credit amount up to that balance and provide the reason, then choose **Request credit for accountant review**. A pending payment must be verified or rejected first, and only one credit request can await review per invoice. A different accountant or owner approves or rejects the request in **Credit notes awaiting review**. Approval creates a numbered credit note, allocates the adjustment across the remaining installments, and reduces the balance; it never edits the issued invoice or an existing receipt. The invoice detail retains the request, reason, reviewer and decision. A credit does not return cash: refunds and chargebacks have separate workflows and are not available yet.

### Change future installment dates

Open **Finance settings → Issued invoices**, choose **View details**, then expand **Request a future installment schedule change**. Only future installments that are still wholly unpaid can move. Paid and partly paid installments, and installments already due or overdue, stay in the schedule unchanged. A payment waiting for verification must be resolved first.

Enter one to twelve replacement dates in Qatar time and amounts that add up exactly to the eligible unpaid amount shown on the page. Add or remove a date as needed, enter the customer-agreed reason, then select **Submit schedule change for approval**. The request remains pending and the active dates do not change yet. A different owner or accountant reviews it in **Installment schedule changes awaiting approval**. Approve only after confirming the customer agreement; reject with a reason when the request is incorrect. An approved request creates a new schedule version and retains the replaced dates in history. A stale or changed schedule must be refreshed and reviewed again.

The request is audited and queues a schedule-change event, but automated reminders are not yet running; this screen does not send or cancel customer reminders. It does not add late fees or change the invoice total. English and Arabic controls are available in the existing Finance panel; authenticated browser and mobile acceptance are still pending.

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

Open **Lead Pipeline → Reports** in the existing business panel. Choose Daily, Weekly or Monthly, select a Qatar-local report date, then choose **Run report**. The summary separates leads created and touched, contact outcomes, notes and follow-up counts. The activity list shows when each lead was handled, who handled it, its outcome or internal note, and its next follow-up; select a lead to open its existing detail drawer. Owners see workspace activity and agents see only leads currently assigned to them. Use Previous/Next to review additional activity pages. **Export this page (CSV)** downloads the activity rows on the page you are viewing, with Arabic or English column labels. It does not export other pages. Loading, empty and retry states are shown in English and Arabic. Reports use the tenant timezone (Asia/Qatar for the Qatar launch). Scheduled WhatsApp/email delivery, manager/accountant role views and invoice/payment reconciliation are still open and are not included in these activity totals.

When adding a lead, enter the contact or payer details and the learner name separately. As you enter a phone or email, the existing pipeline checks for exact matches inside your business. Choose a suggested contact to add another course opportunity for that person. If the same phone belongs to another family member, keep **Create a separate contact / learner** selected; the two learners remain separate records. Review the name and contact details before saving. This workflow records the opportunity and its follow-up only; sale approval, enrollment and invoicing are separate steps still being implemented. Historical leads are not automatically merged.

For an existing linked contact, the workspace owner can edit the shared name or email from any linked opportunity; the update appears across all those course opportunities and is recorded in each activity history. Agents can view these shared details but cannot edit them. Phone is read-only here because changing it needs a separate WhatsApp conversation-link review; older leads without a linked contact keep their existing phone-edit behavior.

Open **Lead Pipeline → Follow-ups** to work the next actions across every open stage. Owners see the business queue; agents see only follow-ups assigned to their own leads. Filter all open follow-ups, overdue items or upcoming items. Open the opportunity to review its history, use **Complete** after handling the action, or choose **Reschedule** and save the new Qatar-local date and time. Each completion or reschedule is added to the opportunity activity. A stale or already completed item must be refreshed before another update. English and Arabic controls are provided; scheduled reminders and manager assignment history are still being implemented.

Won is reserved for a properly reviewed sale. The current pipeline blocks moving or creating a lead in Won, prevents a Won lead from being moved or reopened through a later inbound message, and explains the restriction in English or Arabic. Open a lead drawer and use **Request sale review** to select a currently active course offer, optional open batch, learner and payer, invoice email, discount, agreed terms and installment dates. The screen shows the price, registration fee and installment total in QAR. Enter installments so their total exactly equals course price plus registration fee minus discount. Include a payer email or international phone number; the invoice email is required. Each request is saved as a versioned commercial snapshot and appears in the lead activity.

The workspace owner reviews each pending request and can approve or reject it; a rejection needs a reason. The owner may approve the entered course offer and terms, but this only records commercial approval. Qatar tax/finance policy has not yet been reviewed, so the screen clearly states that approval does not register the learner, reserve a batch seat, issue an invoice or receipt, send an email/WhatsApp message or move the opportunity to Won. The later enrollment/invoice workflow remains under implementation. If an offer, lead or batch changed while the form was open, refresh the drawer and submit a new review. Managers cannot approve until their authenticated role is implemented.

### Finance setup

Open **Finance settings** in the existing `/user` workspace. The owner can save a draft legal entity name, invoice prefix, optional registration/address details, tax treatment/rate, revenue-recognition method, invoice approver and optional second-approval threshold. Qatar/QAR is fixed for this first release; SaleMaX does not select a tax rate or assert that a tax treatment is legally correct. Confirm those entries with the center's accountant before submitting the version for review. A submitted version is locked while the accountant reviews it; the accountant uses a signed-in canonical tenant account to approve or return it with a reason. The previous approved version stays in effect until a replacement is approved.

The page shows policy history and a posting-readiness status. Accountant approval records policy; the implemented sale conversion and manual-payment transactions now create invoices, receivables, journals and receipts. Cash refunds, reversals, chargebacks, customer documents and external notifications remain unavailable. If the accountant cannot access the review page, the tenant accountant login/role must first be provisioned and activated; the owner cannot approve on their behalf.

### Inviting an agent (implementation in progress)

The training-center owner can open **Team Invitations** beside **Agent Login** in the existing business panel to invite an agent. The screen shows active agents, pending invitations, the plan limit and available seats; pending links reserve seats until cancelled or expired. Enter the agent email and create the invitation; copy the one-time link and send it using your approved channel. The link expires in seven days. The invitee opens the link, enters their name, Qatar phone number and a password of at least 12 characters, then uses the existing Agent Login entry point. Rotating an invitation invalidates the previous link; cancelling it prevents activation. The active contract's agent seat limit is checked both when inviting and when the invitee accepts, including simultaneous invitations. Automatic email/WhatsApp delivery and accountant/manager onboarding are not yet available.

### Training courses (implementation in progress)

In the existing `/user` panel, open **Courses** beside Agent Login. Choose **Add course** and enter the course code, English and Arabic names, duration, delivery mode and starting QAR price. Add an optional course level, learning outcomes and prerequisites in English and Arabic. Amount fields accept up to two decimal places; the API stores exact dirhams. Save creates a draft. Use **Manage** to correct course details, review past offer versions, append a new QAR price version, or schedule and edit an optional batch with dates, language and capacity. Older price versions remain in history; adding a new price marks the previous version retired. **Publish course** makes a draft active only when its price is valid for today's Qatar date. **Retire course** preserves its catalogue history and disables its editing controls. Search, tenant scope, validation and loading/empty/error states are provided. Only the mapped owner account can currently manage the catalogue. Sales conversion, enrollment capacity reservations, issued invoice snapshots and accountant/manager read journeys are not connected yet; treat this as catalogue setup, not learner registration or finance. Brochure upload, branch and trainer references, and tax profiles also remain open.

### Lead Forms (in progress)

In `/user`, choose **Lead Forms** beside Agent Login. Create a form with a short lowercase link slug, English and Arabic form names/headlines/descriptions, and the fields your intake needs. Contact name, at least one required contact method (phone or email), and explicit service-contact consent are mandatory. Optional fields include learner name, course, preferred date and the other contact method. Preview shows the current draft. **Save draft** keeps the editor's current version; **Publish new version** freezes an immutable public definition. Future edits do not change the live page until you publish again. Use **Open form** on a published form row to review and copy its URL. The customer page switches between English and Arabic and shows a success reference after submission. A submission creates a contact and a new lead in the existing pipeline; the reference confirms enquiry receipt only. It does not register a learner, reserve a seat, issue an invoice or payment receipt, or send an email/WhatsApp acknowledgment. Keep the copy clear about these limits while sales and finance steps are being completed.

### Set up an existing user as a training-center business

In the existing `/admin` panel, open **Manage Users** and choose **Manage plan** for the user's existing account. When your platform staff grant includes tenant creation and plan assignment, the account has a valid email and assigned catalogue plan, and that plan has a published training-center contract, the panel offers **Set up training-center business**. This action links the existing account to a training-center workspace; it does not create another business login or send an invitation.

Review the business display name and role account limits. The owner limit is fixed at one; accountant, manager and agent limits can be selected up to the published contract ceiling. **Review setup** is read-only and shows the user, category, current plan's frozen QAR terms, enabled capabilities and each proposed limit. If the plan is missing, assign it through the existing workflow and publish its reviewed training-center contract in Manage Plans first. Existing linked users, duplicate SaleMaX identities and accounts without an eligible email are blocked with a recoverable message.

Choose **Create business and assign plan** only after reviewing the preview. SaleMaX creates the Qatar workspace (QAR, Qatar and Asia/Qatar defaults), owner membership, reviewed link and canonical/legacy plan assignment in one transaction. The existing `/user/login` remains the sign-in route; the canonical identity does not copy or replace the user's legacy password. Users therefore continue using the existing business login. The operation is idempotent if the same confirmation is retried after a lost response. This step creates the workspace and plan link only; it does not create staff logins, invitations, courses, invoices or send messages. Production adoption still requires the reviewed migrations, administrator link and release gates.

\n

## Login compatibility during the phased upgrade

Continue to use the existing `/user/login` or agent login. For an account already linked to a reviewed training-center workspace, a successful legacy password check also starts its business session; no separate login page is introduced. Accounts without a reviewed link keep their current behavior. The business screen does not include a SaleMaX administration switch; platform administrators continue through `/admin/login`.

The canonical tenant-session API is disabled in normal configurations until the platform feature flag and deployment keys/origin are set. The first-login bridge creates a fresh canonical password hash from the password just entered after the existing legacy check. It does not copy stored legacy password hashes. This compatibility phase still returns the legacy API session for older screens and does not mean all APIs have moved to canonical authorization. Staff and customers should continue using current login flows until the release notes announce the full migration.

When using **Platform staff** access, the existing Manage Users list requires the `View businesses` permission. Staff may preview plan changes when their grants allow it, but legacy administrator write buttons are not a bypass: account and plan changes must use the protected contract/onboarding flows. The legacy administrator profile endpoint returns the current signed-in account only. The existing-route audit is ongoing, so do not treat this staff screen as completion of all platform permissions.

Public login and branding settings no longer include the Meta application secret. Super Admins can review social-login configuration in the existing admin settings after signing in; delegated staff do not receive that secret.
