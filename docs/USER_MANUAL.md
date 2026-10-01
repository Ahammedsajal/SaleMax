# SaleMaX user manual

Status: the upgrade is being implemented. This manual will document verified screens and real user journeys as they become available, including English/Arabic behavior. It is not a claim that planned features already work.

## Local verification environment

From the SaleMaX application directory, run `start-local.ps1` in PowerShell. Open http://127.0.0.1:3010/. The database binds to 127.0.0.1:3307. Run `stop-local.ps1` to stop this local environment. The imported training data is private and excluded from Git. Provider operations remain disconnected in local-only mode.

## Upgrade journeys to be documented

Super Admin and staff administration; business onboarding and plan assignment; team roles and seat limits; course/offer/batch setup; public and staff lead capture; assignments and follow-ups; sale approval; invoice and installment schedules; payment verification; receipt delivery; credits/refunds; reports; channel setup and delivery issues. Each journey requires tested screens, field guidance and recoverable error states before it is marked available.

## Reviewing the workspace design locally

Run `npm run build:workspace`, then `npm run preview:workspace` from the application directory. Open http://127.0.0.1:3015/. This separate preview uses invented data and never connects to production accounts or providers. Stop its terminal with Ctrl+C when finished. It does not replace the original application at port 3010.

Use **Preview role** to inspect Super Admin, staff, business owner, accountant, manager and agent navigation. Owners see the training category's full menu. Agents see only assigned sample leads; accountants see only billing-linked samples with sales notes withheld. Search by learner/course, then use **Inspect** to view the scoped sample detail. Selecting another sidebar item opens its permission/readiness explanation: business actions are still being implemented.

Use **العربية / English** to switch language and layout direction. On a phone, open the navigation menu; the close button or Escape returns focus to the menu button. The work queue scrolls horizontally inside its card if needed. Use **Test category** to select the restaurant fixture and verify that training items disappear. This fixture demonstrates category isolation, not a usable restaurant product. Sample dashboard totals and permitted menu items are not proof that a course, invoice, payment or report workflow is ready.
