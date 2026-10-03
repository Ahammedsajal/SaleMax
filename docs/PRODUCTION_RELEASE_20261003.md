# Optional customer integrations and completed training updates — 3 October 2026

Source `dcaf65b` is deployed at https://crm.salemax.qa in `/opt/salemax/releases/optional-integrations-dcaf65b`. This release includes all completed main-branch updates plus the verified staff-form, optional Turnstile, accountant/manager invitation and manager pipeline changes previously retained on the staff-capture branch. The eight unfinished platform prototype files are preserved locally and excluded.

Chat Widget, customer API access (QR REST, conversational/template APIs and API Dashboard), webhooks (management, automation and logs), and WhatsApp Warmer are disabled and hidden by default. Authorized administrators can enable each switch independently through **Manage Users → Optional features**, using the existing platform session/MFA, permissions, portfolio isolation and CSRF checks. Saves are versioned and audited. Disabling access blocks direct routes and runtime execution; plan limits and provider availability still apply when enabled. Internal training APIs remain available.

Live browser acceptance identified repeated Courses/Lead Forms navigation label writes that could keep mutation observers running. The final release writes labels only when they change. The compiled application shell was preserved.

Verification:

- Clean committed-release automated tests: 139/139 passed.
- Disposable local MariaDB workflow: 34 forward migrations passed, including default-off state, per-user opt-in/revocation, stale-save rejection, portfolio isolation and atomic audit records. Synthetic checks report `customerDataTouched=false` and `externalWrites=false`.
- Production preflight, private SQL backup and migration history/checksum checks completed. Production has 34 applied migrations; all table row counts in the final preflight snapshot (122 tables) remain unchanged except the migration ledger. No optional switch was enabled for a customer.
- Production baseline reads pass for profile, dashboard, agent tasks, phonebook and chatbot. API-key generation, widget management, warmer access and webhook management reject direct access with `FEATURE_DISABLED`. Anonymous admin settings access is rejected. The historical hard-coded QR diagnostic sender is retired.
- Live desktop (1440 px) and phone (390 px) checks confirm excluded sidebar entries are hidden, Dashboard remains, and direct Chat Widget navigation redirects to Dashboard. English and Arabic checks are recorded in the local verification artifacts.
- Nine public files have SHA-256 values matching the committed release. HTTPS health returns 200; both SaleMaX containers are healthy. Existing CarsQatar backend containers remain healthy and were not restarted.

Rollback files are private under `/opt/salemax/shared/rollback-optional-integrations-dcaf65b`: SQL dump, previous release/image references, environment, table counts, build/migration logs and verification results. The previous image is retained as `salemax-app:rollback-optional-integrations-dcaf65b`. An application rollback restores the saved image and symlink and recreates only the SaleMaX app. The two newly added migrations are additive; do not restore SQL over newer customer writes without a separate recovery review.

`LOCAL_ONLY_MODE=true` remains in production. No WhatsApp, email, payment or external CRM provider was enabled. This is a verified application release, not completion of all training-center tickets or proof of provider delivery. Turnstile remains optional and requires owner-configured provider credentials when enabled.
