# SaleMaX production checkpoint — 2 October 2026

Committed source `572e36a` is deployed at https://crm.salemax.qa/user/login. The existing administrator login remains https://crm.salemax.qa/admin/login.

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
