# SaleMaX production checkpoint — 2 October 2026

## Delegated SaleMaX Admin portfolios — 2 October 2026

Commit `1f38ea5` is deployed at `/opt/salemax/releases/admin-portfolios-1f38ea5` and is serving `https://crm.salemax.qa`. It extends the existing `/admin` platform panel with Super Admin-created SaleMaX Admin/Staff accounts, Admin reporting lines, customer portfolios, audited assignment, scoped user/plan/category/bot actions, Super Admin-only customer session access, and scoped/global statistics. The existing `/user` customer application remains separate. All seven pending migrations were applied after a preflight confirmed all 25 existing checksums, zero outbox/payment-allocation rows affected by new constraints, and a clean database backup.

Post-deploy checks: app container healthy; `/admin/login`, `/user/login`, and `/admin?page=manage-users` return HTTP 200; anonymous `/api/admin/get_users` returns `Administrator sign-in is required`; migration ledger has 32 applied entries ending in `20261022_platform_admin_portfolios.sql`. The live platform has one active Super Admin, zero delegated Admin/Staff accounts, and zero portfolio assignments. No existing customer was assigned or exposed. Initial Admin/Staff accounts still need to be created by the owner from the production Super Admin session after completing MFA.

Previous release: `/opt/salemax/releases/admin-mfa-96f4d37`, retained as `salemax-app:rollback-admin-portfolios-1f38ea5`. Database/runtime backup: `/opt/salemax/shared/rollback-admin-portfolios-1f38ea5/`; the SQL dump is gzip-verified and its SHA-256 is recorded in the server backup metadata. Restore the previous app image and symlink for application rollback. The migrations are additive; a full database restore would overwrite writes since the backup and needs a maintenance window. Production keeps `LOCAL_ONLY_MODE=true`; provider delivery remains disabled. This is the delegated-admin release, not completion of all training-center product work.

## Training Center catalogue publication — 2 October 2026

Using the production Super Admin session in the existing Manage Plans screen, published category-version 1 contracts for Trial (amount 0, 10 days), Gold Plan (350, 180 days), and Premium Plan (700, 365 days). Each retains role ceilings of owner 1, accountant 1, manager 1 and agent 7. Trial and Premium include the full current 24-capability Training Center bundle; Gold publishes the 15-feature Essentials bundle and leaves Meta/automation/campaign, installment/credit and scheduled-report capabilities out. Live MariaDB confirms all three version-1 contracts are `published`, the Gold/Premium/Trial price and duration snapshots match the existing legacy catalogue, agent limit is seven, and audit counts include three draft creations plus three publications. The category was already registered in the deployed application. No customer was assigned or changed, no legacy catalogue terms were edited, and provider delivery remains disabled.

## Administrator sign-in MFA release — 2 October 2026

Commit `96f4d37` is deployed at `/opt/salemax/releases/admin-mfa-96f4d37` and is serving `https://crm.salemax.qa`. The existing `/admin/login` now completes password verification, then asks linked platform administrators to enroll or verify their authenticator before opening the existing admin panel. MFA no longer lives in Manage Plans. The one successful check covers the full eight-hour platform session; logout, expiry or revocation requires another password and MFA sign-in. The server also rejects saved legacy admin tokens without the matching verified platform session. Existing unlinked administrator and `/user` login flows keep their current behavior.

The local `npm test` suite passes 116/116. A synthetic browser journey verified initial enrollment, OTP verification, recovery-code acknowledgement and entry to the existing admin route. Production app health is healthy; `/admin/login`, the new MFA script, and `/user/login` return HTTP 200 over HTTPS, and the served MFA script SHA-256 matches the release asset. Production sign-in enrollment itself remains for the owner to complete; no production OTP was entered by the agent. Previous release `/opt/salemax/releases/platform-20261002-5957274` and image `salemax-app:rollback-admin-mfa-96f4d37` are retained for application rollback. Production stays `LOCAL_ONLY_MODE=true`; providers were not enabled or contacted, and no category or plan assignment was changed.

Committed source `5957274` is deployed at https://crm.salemax.qa/user/login, superseding the earlier license and upgrade checkpoints below. The existing administrator login remains https://crm.salemax.qa/admin/login.

Platform activation follow-up: the owner-selected existing `admin@admin.com` account is now linked to an active canonical Super Admin after verified one-time credential/UID bootstrap. Platform APIs are enabled; no business user category/plan was changed. A private server-generated key and HTTPS origin are configured, and provider isolation remains enabled. Production sign-in and Secure/HttpOnly cookie checks pass; privileged plan access remains MFA_REQUIRED until the owner enrolls their authenticator in the existing Manage Plans editor. MFA has not been completed by the agent. Clean-release tests pass 99/99, legacy reads and original row counts pass, and unassigned users are denied training APIs. Current release: `/opt/salemax/releases/platform-20261002-5957274`; runtime backup: `/opt/salemax/shared/rollback-platform-20261002-5957274`; rollback image: `salemax-app:rollback-platform-20261002`. Restore the saved environment together with the old image/symlink if rolling back; preserve license storage. Older disabled-platform statements below describe earlier checkpoints.

License/support follow-up: the Node license endpoint now verifies against `https://crm.gccbot.com/api/admin/check_license_external?lang=English`. The owner-supplied license was accepted for `crm.salemax.qa`; live theme checks return `licenseRequired:false`. Activation metadata is mounted persistently from `/opt/salemax/shared/license`, does not store the license key, and must be retained across deployments. The help link now points to `https://wa.me/97455160323`. Clean-release tests pass 98/98, live support asset hashes match, and existing-user reads and original row counts still pass. No WhatsApp message was sent. Current release: `/opt/salemax/releases/license-20261002-248f1ab`; previous image retained as `salemax-app:rollback-license-20261002`. A rollback to pre-fix source requires carrying the activation record into that version's expected license location; otherwise its license prompt returns.

This is a verified checkpoint, not the completed full upgrade. Production preserves `LOCAL_ONLY_MODE=true` and the disabled `SALEMAX_PLATFORM_ENABLED` flag. Training APIs and contract management are uploaded but inactive pending verified owner bootstrap, configuration and acceptance. Providers remain disconnected as before. No user was assigned a training category or a new plan. Existing passwords and runtime credentials were preserved. Unfinished refunds and unrelated working-tree edits were excluded.

The Courses menu now requires authenticated category/entitlement access. General improvements remain inside the original application. The committed package includes training courses/forms, reporting, conversion, finance policies, invoice/payment/receipt, installment rescheduling and reviewed credit-note implementation; full screen acceptance, delivery, PDFs and other plan tickets remain open.

## Verified evidence

- Clean-release automated tests: 97/97; disposable synthetic MariaDB integration: 25 migrations; local baseline and syntax checks pass.
- Live existing-account profile, dashboard, agent tasks, phonebook and chatbot reads pass. Verification tokens were short-lived and never printed. Unauthenticated reads are denied.
- Original user/admin login pages and course asset return 200 over HTTPS. App/DB are healthy. CarsQatar services were not restarted.
- All 66 original tables retain their pre-release row counts; the resulting schema has 115 tables. These checks do not prove every write workflow or bilingual browser acceptance.
- Release: `/opt/salemax/releases/upgrade-20261002-572e36a`.
- Image: `sha256:deb069cbb8e83b7837ddd0e88c9273484b2e525a64a4acce7c26e4e8f6d1a58f`.
- Source archive SHA-256: `99ded947ec62462e558ec8bae808c415bc81dbfdf85173c7f38e42b7d4ea9b37`.
- Live Courses asset SHA-256: `66a10c49174e66bcc3cd997070bcd37a133b2917d44db3d5b5fd7acae489ec06`.

## Reviewed schema adoption

The migration runner stopped at discrepancies. Production already had `instance.inactiveSince` as nullable DATETIME. Its exact shape and migration checksum were verified under the migration lock, the remaining two retention statements applied, and the ledger reconciled.

Existing `pipeline_leads` used `utf8mb4_general_ci`; the new empty `pipeline_contacts` inherited `utf8mb4_uca1400_ai_ci`. After verifying no contacts or new lead links existed, only the empty new contacts table was converted to the existing collation before adding the composite tenant foreign key. Existing lead records were not rewritten. All 25 migrations are now applied; migration file contents/checksums were preserved.

## Recovery

Private backup directory: `/opt/salemax/shared/rollback-20261002-572e36a`, mode 700. Contains pre-release SQL dump, original runtime environment, old release/image references, original table counts and build/migration/recovery evidence. Secrets remain outside Git and web assets.

Previous release: `/opt/salemax/releases/rebrand-20260930`; previous image retained as `salemax-app:rollback-20261002`. Application rollback restores that image to `salemax-app:latest`, restores the current symlink and recreates only the SaleMaX app service. Additive tables may remain. A full database restore must account for post-backup writes and a maintenance window; do not blindly overwrite newer customer data.
