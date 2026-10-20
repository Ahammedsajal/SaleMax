# Production source reconciliation — 20 October 2026

The active source snapshot is `/opt/salemax/releases/recruitment-terminal-31a3645-20261020`. It contains 840 eligible source/frontend files, including maintained SQL migrations. Runtime credentials, sessions, private media, customer uploads, databases and source maps were excluded. Production remained healthy; this source-recovery step made no production change.

## Local workspace recovery

The primary workspace at `/Users/ahammed/Documents/ChatGPT/Salemax CRM` now has 27 missing files restored and 39 files updated from that snapshot. All 39 originals were copied into a separate backup and SHA-256 verified before replacement. Matching files were retained; 38 local project documentation/configuration files and one offloaded original were preserved. No local-only file was deleted, no Git reset occurred and staged changes were not cleared. Original staged contents remain in the Git index; the verified file backups retain the pre-sync working contents.

Snapshot, manifest, original-file backups, comparison and per-file journal are outside the repository at `/Users/ahammed/Salemax-sync/20261020-customization-baseline`. The single preserved offloaded file is `.htaccess`; it was not overwritten without a verified original backup. This recovery does not resolve the previous 19 October backup limitation.

## Git reconciliation

The clean implementation worktree initially lacked 20 production source files and differed in 117 files. The previous production snapshot separates later Git changes from subsequent live changes. Newer Git-only work and category-registry improvements are retained. Reviewed live recruitment, notification, phonebook, finance, pipeline, report, task and loader changes are recovered. Maintained source that changed on both sides is reconciled individually. The generated React shell/bundle remain paired in the local snapshot and are not edited as application logic or used to replace the maintained source.

The deployment helper `scripts/deploy-category-registry-overlay.cjs` changes only eight reviewed maintained files and two script cache references inside the current release's generated index. A production deployment must copy the current release and image, verify source/live parity of that allowlist, retain rollback material, and confirm that every other file is unchanged. No migration or tenant reassignment is part of that overlay. Tenant-customization persistence is a separate in-progress increment and must not be deployed before its migration and acceptance checks.

Verification results and the deployed release, when applicable, are recorded separately in `DEPLOYMENT.md`. This reconciliation does not claim completion of the scalable customization objective or the existing 42-ticket program.


## Verification evidence

A temporary container used the active application image's installed dependencies, an isolated network, and a read-only source mount. The focused reconciliation suite passed 126/132 checks. Five recruitment copy/return-contract test failures reproduce in a separate container mounted directly to the unchanged live release (17/22 passing); the sixth is an existing Tasks layout assertion against unchanged Git source. Category registry/version, permission, HTTP, catalogue, provisioning, finance, phonebook and other selected checks passed. Thirty-two changed/recovered JavaScript files passed syntax checks before the remaining baseline-source additions; the final syntax check covers all changed/recovered JavaScript again before publication. These checks do not substitute for rendered authenticated acceptance or provider delivery.
