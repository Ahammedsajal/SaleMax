# SaleMaX user manual

Status: the upgrade is being implemented. This manual will document verified screens and real user journeys as they become available, including English/Arabic behavior. It is not a claim that planned features already work.

## Local verification environment

From the SaleMaX application directory, run `start-local.ps1` in PowerShell. Open http://127.0.0.1:3010/. The database binds to 127.0.0.1:3307. Run `stop-local.ps1` to stop this local environment. The imported training data is private and excluded from Git. Provider operations remain disconnected in local-only mode.

## Upgrade journeys to be documented

Super Admin and staff administration; business onboarding and plan assignment; team roles and seat limits; course/offer/batch setup; public and staff lead capture; assignments and follow-ups; sale approval; invoice and installment schedules; payment verification; receipt delivery; credits/refunds; reports; channel setup and delivery issues. Each journey requires tested screens, field guidance and recoverable error states before it is marked available.

## Working login and MFA screens in the local lab

Run `npm run build:workspace`, then `./scripts/start-auth-lab.ps1` in PowerShell from the application folder. Open http://127.0.0.1:3016/. The script starts a separate database on loopback port 3309 and creates a synthetic-only database. It refuses an occupied port. Temporary test credentials are in the private, Git-ignored `database/local-runtime/auth-lab/access.json`; they are not production credentials. Each fresh lab start creates new test identities and removes its own synthetic database on a clean shutdown. No imported database or provider is used.

Choose **Business account**, enter the test workspace name, email and password, then **Sign in**. An incorrect password/workspace produces a helpful account error; the password show/hide control is available. Successful sign-in displays the canonical identity, role and business name returned by SQL. **Sign out** revokes that session. This screen proves authentication, not completed dashboard administration.

Choose **SaleMaX administration** for the platform test identity. On first sign-in, scan the authenticator QR or enter its setup key, then enter the six-digit code. QR generation is local and the seed is not placed in a URL. Save the ten recovery codes using **Download recovery codes**, confirm **I saved my recovery codes**, then continue. Returning platform users see the authenticator challenge and can choose **Use a recovery code**. Each recovery code works once. The UI does not offer owner/MFA reset or silently replace an enrolled factor; those flows remain pending.

Use **العربية / English** for Arabic RTL or English. Requests show a waiting state and prevent concurrent clicks; errors distinguish invalid credentials, invalid/reused MFA codes, expiry and attempt limits. The local browser verified workspace login, platform enrollment, returning-user challenge/recovery option, required recovery acknowledgement, logout and Arabic layout at the available narrow 480 px viewport. Actual 360 px verification and production migration/legacy compatibility remain open.

Stop the lab terminal with Ctrl+C when finished. The script stops its own database process; it does not stop the main application on port 3010. Do not deploy the lab bootstrap/credentials or treat its synthetic Super Admin as the production owner account.

## Reviewing the workspace design locally

Run `npm run build:workspace`, then `npm run preview:workspace` from the application directory. Open http://127.0.0.1:3015/. This separate preview uses invented data and never connects to production accounts or providers. Stop its terminal with Ctrl+C when finished. It does not replace the original application at port 3010.

Use **Preview role** to inspect Super Admin, staff, business owner, accountant, manager and agent navigation. Owners see the training category's full menu. Agents see only assigned sample leads; accountants see only billing-linked samples with sales notes withheld. Search by learner/course, then use **Inspect** to view the scoped sample detail. Selecting another sidebar item opens its permission/readiness explanation: business actions are still being implemented.

Use **العربية / English** to switch language and layout direction. On a phone, open the navigation menu; the close button or Escape returns focus to the menu button. The work queue scrolls horizontally inside its card if needed. Use **Test category** to select the restaurant fixture and verify that training items disappear. This fixture demonstrates category isolation, not a usable restaurant product. Sample dashboard totals and permitted menu items are not proof that a course, invoice, payment or report workflow is ready.
