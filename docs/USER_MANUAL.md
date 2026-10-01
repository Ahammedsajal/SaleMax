# SaleMaX user manual

Status: the upgrade is being implemented. This manual will document verified screens and real user journeys as they become available, including English/Arabic behavior. It is not a claim that planned features already work.

## Existing application remains the product

The upgrade extends the current SaleMaX admin and business panels. The intended plan destination is the existing Manage Plans screen at /admin?page=manage-plans; business/account assignment remains in Manage Users at /admin?page=manage-users. Preserve the existing /admin/login and /user/login entry points. Missing Courses, Finance, Reports and Forms functionality is added inside the current business panel. There is no new application or replacement shell.

The lab and preview instructions below describe isolated development verification, not the released user experience. In particular, the separate test plan page is superseded as a product destination. Backend functions must be connected to the existing screens before this manual can mark them available.

## Local verification environment

From the SaleMaX application directory, run `start-local.ps1` in PowerShell. Open http://127.0.0.1:3010/. The database binds to 127.0.0.1:3307. Run `stop-local.ps1` to stop this local environment. The imported training data is private and excluded from Git. Provider operations remain disconnected in local-only mode.

## Upgrade journeys to be documented

Super Admin and staff administration; business onboarding and plan assignment; team roles and seat limits; course/offer/batch setup; public and staff lead capture; assignments and follow-ups; sale approval; invoice and installment schedules; payment verification; receipt delivery; credits/refunds; reports; channel setup and delivery issues. Each journey requires tested screens, field guidance and recoverable error states before it is marked available.

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

An inline bilingual editor is being integrated into this existing screen. Its browser acceptance, category/role-limit controls, canonical version publication and assignment impact review are still pending; this increment is not the completed training-center plan workflow.

## Using the upgraded existing plan editor

In the existing admin panel, open Manage Plans. Choose Add New Plan for a new catalogue entry or Edit Plan on a current card. The form opens within the current page, preserving the sidebar and header. Enter the title, description, duration, contact/QR limits and prices, then choose messaging features. Trial plans disable the price field and save a zero price. Save plan refreshes the original catalogue. A failed save keeps entered values and identifies invalid fields; correct them and retry.

Back to plans returns to the catalogue. If you have changed the form, choose Keep editing to retain the draft or Discard changes to return without saving. Arabic language selection displays the new controls in Arabic and gives the editor RTL direction. No new admin login or separate plans application is required.

This verifies the existing catalogue editor on desktop. Training-center category, role limits, immutable version publication and assignment impact review are still being connected, and phone/tablet acceptance remains pending.

## User plan assignment upgrade in progress

The existing Manage Users plan action remains the destination. Its upgraded backend records the previous plan and expiry when assigning a new server-loaded catalogue plan, and rejects missing users or invalid plan duration. Assignment history is recorded from activation onward; earlier changes are not reconstructed automatically. The history migration is required before activating this backend.

Assignment preview, history display and category/role limits are still being integrated into the existing screen. The original control does not yet provide the new retry/stale-state tokens. Do not treat this backend increment as the completed account-management workflow.


## Assigning a plan from the existing user table

Open the existing admin panel → Manage Users. In the user's Plan column, choose **Manage plan**. The inline form shows the account, current plan and expiry, and the latest 20 recorded assignments. Choose a catalogue plan, then **Review assignment** to compare duration, price, contact/QR limits and messaging features. Review makes no change. **Confirm plan assignment** assigns that catalogue snapshot and records history. The duration begins at confirmation; this action does not collect payment. **Back to users** returns to and refreshes the original table after a successful change.

If another administrator changes the account or catalogue during review, the confirmation is rejected. Choose **Reload account**, select the plan and review again. Connection/save errors preserve the selection; retrying the same confirmation cannot duplicate its recorded assignment. If the existing snapshot is malformed, the screen warns you and retains that exact prior snapshot in history on assignment. Earlier history is not reconstructed automatically. With no catalogue plans, create one in Manage Plans first.

Arabic controls include **إدارة الخطة**, **مراجعة التعيين**, **تأكيد تعيين الخطة** and **إعادة تحميل الحساب**. The inline form has RTL direction and Qatar-local dates. English/Arabic desktop review, confirmation, history and return-to-table have been verified with synthetic data. Phone/tablet and dark-mode acceptance remain open. Category, versioned entitlements, role limits and staff grants are still being connected; this increment does not complete account management.


## Category features and account limits in Manage Plans

In the existing Manage Plans screen, edit a saved catalogue plan. Save any price or commercial changes first. Its **Training-center features and account limits** section is inside the same editor. When platform adoption is activated, **Verify access** asks for your linked platform email/password and authenticator. Initial setup provides local QR/key and one-time recovery codes; download them or use **Show codes to copy**, save them privately and acknowledge before continuing. Returning access accepts the authenticator or a saved single-use recovery code. A missing verified link requires owner-assisted account adoption; legacy admin sign-in alone does not grant protected permissions.

Choose Training center, select features and enter the allowed owner/accountant/manager/agent counts. Owner stays one; the first draft proposes one accountant, one manager and seven agents. **Create contract draft** captures the saved catalogue details and those limits. New drafts start from the latest linked version. Unfinished changes trigger Keep editing/Discard changes when leaving or reloading. Review publication shows the frozen commercial terms, roles and features. **Publish reviewed version** freezes it; older versions remain visible. Publication requires fresh verification within five minutes and the publish grant, so use **Verify access again** if the action is unavailable.

Drafting/publication does not reassign businesses, create staff accounts, charge customers, enable unfinished modules or send provider messages. Business assignment and enforcement are being connected next. Arabic controls include **إنشاء مسودة عقد**, **مراجعة النشر** and **نشر الإصدار المراجع**. English/Arabic desktop drafting, publication, preserved versions and unsaved-change protection have been verified with synthetic data; phone/tablet and dark-mode acceptance remain pending.

The separate synthetic existing-panel lab can use port 3018 by setting SALEMAX_TEST_PANEL_PORT=3018 before running scripts/existing-panel-lab.cjs, with the disposable database engine already on loopback 3309. Its private access file is database/local-runtime/existing-panel-lab-3018/access.json. This lab runs the original shell and the protected handlers; it is not a replacement application or production onboarding procedure.
