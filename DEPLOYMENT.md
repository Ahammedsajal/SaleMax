# SaleMaX live deployment — 30 September 2026

## Chatbot theme alignment follow-up — 5 October 2026

- The existing four-pill Automation Flows/Guided/Hybrid/AI experience now detects SaleMaX's active light/dark mode for the chatbot tabs, bot list and editor overlays. The legacy Automation Flows canvas remains outside the chatbot theme selectors and unchanged. Guided Training Center setup continues to expose editable bilingual greeting/menu, course-list, course-detail, enquiry, fallback and staff-handoff copy; course facts still come from the published tenant Courses catalogue.
- Active release: `/opt/salemax/releases/chatbot-theme-detection-20261005` (confirmed via `/opt/salemax/current`). The deployed `chatbot-admin.js` and `training-sidebar.js` hashes match source: `461230db09b411da888da29402eb735aefb7aebd86876d561d68e521a91865eb` and `c3f602037211e2c383e5a871ab5f64f59a1d9ec7e36af60e0f5092befc9604f1`.
- Verification: production `/healthz` returns 200; app and database containers are healthy. Authenticated browser inspection confirmed the first Legacy pill/canvas remains present, Guided bot management loads, and the active Training Center bot's editor exposes English/Arabic greeting, menu, course-list text and preview controls. The editor was closed with Cancel. No bot text, assignments, AI provider, chat, WhatsApp session or customer data was changed; no migration ran.
- The corrected dark-mode selector uses a SaleMaX chatbot-specific root attribute populated from the existing theme preference/control. Automated source checks passed in the implementation run (full Node suite 199/199, focused chatbot screen contract 8/8, syntax and whitespace checks). These checks are source evidence; the production browser and health checks above are independent live evidence.
- Remaining business setup: publish courses and batches in Courses before the bot can show actual offerings. AI provider configuration/privacy notice and authorized real-channel delivery remain separate gates.

## Active chatbot profile editing — 5 October 2026

- Source commit: `66f2c3affb20d96658d6824dfefec9d73decbbf9` (pushed to `Ahammedsajal/SaleMax` main). It allows safe profile edits to active bots while locking channel assignments, provider credentials, token limits, and AI privacy confirmation until the bot is paused.
- Production release: `/opt/salemax/releases/chatbot-active-edit-20261005`; `/opt/salemax/current` resolves to this release. The release was copied from the previous active release to retain production-only files, then updated with `client/public/chatbot-admin.js`, `client/public/training-sidebar.js`, and `modules/platform/chatbot-router.js` from that source commit.
- Rollback: protected source files are in `/opt/salemax/shared/rollback-chatbot-active-edit-20261005`; the pre-deploy image is retained as `salemax-app:rollback-chatbot-active-edit-20261005` (image `sha256:edb724fba69fa808624d04e4b14f9e454e8fd61bfe7e996c86da71ba41cf30f7`). Atomically point `/opt/salemax/current` back to `/opt/salemax/releases/chatbot-localized-course-facts-20261005`, tag `salemax-app:rollback-chatbot-active-edit-20261005` as `salemax-app:latest`, then run `docker compose -p salemax --env-file /opt/salemax/shared/stack.env -f /opt/salemax/current/deploy/compose.yml up -d --no-build --no-deps --force-recreate app`.
- Migrations: none. Only `salemax-app-1` was recreated; `salemax-db-1` remained running. No bot profile, WhatsApp connection/session, number assignment, provider key, conversation, or customer record was changed.
- Deployed SHA-256: `chatbot-admin.js` `0fff737b2869055524b66fcd89b8a7084f9a2f68b558c5e11e4bf2be510709c1`; `training-sidebar.js` `609dcacd4e350160370fcb019206f6d797ac9a88077fc741e9fcbd0fec21cb85`; `chatbot-router.js` `5cd2ec77200d588ae0423036f63f41cf39edccc09c3a5ad6802ea4dff874f691`.
- Verification: `npm test` passes 198/198. The app and database containers are healthy and production `/healthz` returns 200. An authenticated browser reload confirms the existing SaleMaX sidebar and Legacy Automation Flows first tab/canvas are preserved; Guided, Hybrid AI, and AI Chatbot remain pill tabs. Guided Chatbot Edit is enabled for the active profile. The editor displayed the bilingual greeting/menu, course list, course details, enquiry, fallback and handoff controls. Read-only preview returned the configured welcome menu; the course-list preview accurately reported that there are currently no published courses for this tenant. The editor was cancelled without saving.
- Remaining gates: publish the Training Center course catalogue, configure and privacy-approve an AI provider, and verify real provider/channel delivery with an explicitly authorized customer-facing test. The synthetic MariaDB/transport tests exercise AI and Hybrid behavior but do not prove provider delivery.

Live URL: https://crm.salemax.qa/
Server: carsqatar-prod-01, 145.241.229.168 (Oracle ARM64)
Deployment root: /opt/salemax
Current release: /opt/salemax/releases/rebrand-20260930
Local project: A:\Salemax - Training center\Salemax-Node

DNS configured by owner: A record crm -> 145.241.229.168.
Nginx virtual host: /etc/nginx/sites-available/salemax, enabled under sites-enabled.
App: salemax-app-1, internal port 3010, host binding 127.0.0.1:3011.
Database: salemax-db-1, MariaDB 11.4, separate salemax database; no public database port.
Runtime and database credentials were generated specifically for this deployment and stored privately under /opt/salemax/shared with mode 600. Local Windows credentials were not reused.
Persistent media, themes, sessions and database files are under /opt/salemax/shared.

HTTPS: trusted Let's Encrypt certificate issued for crm.salemax.qa, expires 29 December 2026. Existing certbot.timer is active. Deployment renewal hook validates/reloads Nginx after renewal. The one-time DNS/HTTPS activation timer completed and disabled itself.
HTTP requests redirect to HTTPS (301). Homepage returns 200 over verified HTTPS.

Verified:
- Public browser homepage renders SaleMaX branding and both logos; canonical URL is https://crm.salemax.qa/; no old brand text detected in rendered homepage.
- Frontend API calls use https://crm.salemax.qa and return HTTP 200.
- Public sign-in page loads with the SaleMaX logo.
- Mobile at 390px: logo loaded, no horizontal overflow.
- Arabic with RTL enabled: Arabic text, RTL direction, logo loaded, no horizontal overflow.
- App and database containers healthy.
- Imported database matches local export: 66 tables, 61,844 rows, every table count matched. Import completed successfully.
- Authenticated admin read verified with an internally generated validation token; unauthenticated reads and invalid password login attempts were rejected. No known-password sign-in was performed and no account password was changed.
- Old external GCCBOT CRM SSO disabled for this deployment. Its switcher is hidden on crm.salemax.qa.
- CarsQatar API remained healthy; its existing containers were not restarted.

Operational boundaries:
- This is the supplied training copy, including its sanitized database and retained account/customer records. Existing application account passwords were retained.
- Provider tokens and SMTP/payment credentials remain disconnected. LOCAL_ONLY_MODE=true prevents background provider workers from starting. This verifies a hosted application, not WhatsApp/email/payment delivery.
- Server disk initially had about 667 MB free. Removed old unused Docker build cache and a regenerable webpack compile cache; no CarsQatar source, deployed standalone output, uploads, database, or rollback archives were removed. Final free space is about 2.2 GB; expand the server disk before substantial media growth.
- Historical source and private backups were excluded from the web-served deployment package; private SQL import is outside the public web root.
- Frontend React source was not supplied; this deploys the rebranded compiled frontend.

Manage services:
  docker compose -p salemax --env-file /opt/salemax/shared/stack.env -f /opt/salemax/current/deploy/compose.yml ps
  docker compose -p salemax --env-file /opt/salemax/shared/stack.env -f /opt/salemax/current/deploy/compose.yml up -d
  docker logs --tail 50 salemax-app-1

Verification helper: deploy/verify-runtime.cjs. Browser screenshot: rebrand-evidence/salemax-live-https.png.

## Team activation screen styling — 4 October 2026

- Source commit: `02a2d59` (pushed to `main`). Adds `client/public/team-activation.css` and its versioned stylesheet include. Styles apply only to the existing invitation activation screen; backend, authentication, password requirements and account activation are unchanged.
- Active release remains `/opt/salemax/releases/chatbot-guided-course-detail-20261004`. The stylesheet and narrowly patched live index were installed in this release and the running `salemax-app-1` container without restarting the service.
- Durable static overlay image: `salemax-app:team-activation-02a2d59` (`621e4a9ae850`), also tagged `salemax-app:latest` for container recreation. Built from the running container's existing base image with only the stylesheet and patched live index copied in. No runtime credentials were copied into the build context.
- Live-derived artifact: the deployed index preserves newer production scripts absent from this local index. Its SHA-256 is `824d2b2495e6bdbc6e619882b81a2c67db7096a1786176f31bd749b7ad1ce4f8`; the tracked local index is not a byte-for-byte copy. The exact patched index and overlay Dockerfile are retained with the protected rollback artifacts. Stylesheet SHA-256: `e57178e5464f6420ef8ae8e8b24bd9dfe77921498530356b77fa32be8a4c41e6`.
- Migrations: none. No account data or credentials changed during this styling release.
- Verification: English desktop and Arabic RTL at 390×844 inspected with synthetic local preview data. Production browser verifies the branded used-invitation state because the actual invitation had already been accepted. Public stylesheet hash matches the source and running container; served index includes `team-activation.css?v=20261004a`; `/healthz` returns HTTP 200; SaleMaX app and database containers remain healthy. Whitespace checks pass.
- Remaining verification: active invitation form styling is visually checked in the local preview, not on a new production invitation; no activation or password submission was repeated. The existing account activation behavior is unchanged. The whole legacy production release remains only partially reconstructible from this checkout; the overlay intentionally retains its current image and live index.
- Rollback: protected directory `/opt/salemax/shared/rollback-team-activation-02a2d59` retains `release-index.html` and `container-index.html`. Restore the former to the release's `client/public/index.html` and copy the latter into `salemax-app-1:/app/client/public/index.html`; retag `salemax-app:rollback-team-activation-02a2d59` as `salemax-app:latest`. Removing the stylesheet include disables all added styles; the unused CSS file may remain. No service restart is required for that rollback.

## Owner Team access navigation — 4 October 2026

- Source commit: pending (`client/public/team-invitations.js`, `client/public/index.html`, and the sidebar contract in `tests/team-invitations.test.js`). The navigation observer now installs the Team access item as soon as the existing Agent Login row appears, on every user route. The versioned script URL is `team-invitations.js?v=20261004-team-access`.
- Production release: `/opt/salemax/releases/chatbot-guided-course-detail-20261004`; the underlying running image was not restarted. A durable overlay image was built from the exact running image with only `team-invitations.js` and the live-derived, version-bumped index copied in; `salemax-app:latest` points to the overlay for future container recreation. A rollback image and original files are kept at `/opt/salemax/shared/rollback-team-access-5140700`.
- The live-derived index retains production scripts missing from the checked-in copy. Active index SHA-256: `059fc4f7e2a062dc97247f82c0bb7df2a0ec7f629ca581017eaa7c8c16e55bcc`. Script SHA-256 in source, release, running container, and served URL: `7c7292fc49a399ed92e9ce31498c631ee14e3707ec081bd0cebcc8e8a671ff05`.
- Migrations and account/password changes: none for this navigation patch. The owner’s existing session remains intact.
- Verification: after a normal reload of the live owner dashboard (`/user`), accessibility inspection shows “Team access” immediately below “Agent Login”. The served script hash matches the release and container copy. Both SaleMaX containers are healthy. `git diff --check` passes. Automated tests were not run.
- Rollback: copy `/opt/salemax/shared/rollback-team-access-5140700/release-team-invitations.js` and `release-index.html` back into the production release. Restore `/opt/salemax/shared/rollback-team-access-5140700/container-team-invitations.js` and `container-index.html` inside `salemax-app-1`, and retag `salemax-app:rollback-team-access-5140700` as `salemax-app:latest`. No service restart is required.

## Invoice register and approved-sale invoice workspace — 4 October 2026

- Source commits: `e4ec262` (invoice register, approved-sale create flow, print/view actions and documentation) and `43c23cf` (canonical owner/accountant role follows the active invoice-issuer policy). Both are pushed to `main`.
- Active release: `/opt/salemax/releases/chatbot-guided-copy-editable-20261004`. The deployed index is derived from the exact live index to retain its newer production scripts. Its invoice script URL is `/training-finance.js?v=20261004-invoice-workspace`.
- Running overlay image: `salemax-app:invoice-workspace-43c23cf`, image `5b5ac1333b558b6d26a7a31c887457dd8d5c0fac866815a1a22d2cb3c1ea4243`; it layers the canonical issuer-role correction over `salemax-app:invoice-workspace-e4ec262` and the image that was running before this release. `salemax-app:latest` points to the new overlay for container recreation. Only the SaleMaX app container was recreated; the database and shared data were not modified.
- Deployed SHA-256: live-derived index `da2212e0e2ccdee75a3c1a5316768d5381384bcbeb5651680642a17963fe849e`; `training-finance.js` `e3f332e8dbd7b47c94fc09706431d2e72a7dbc21d561a0e4594c4ff5edbca3f8`; `training-finance-router.js` `f1cc8244f163b347efbe0c73f49793e4868aa93543ce1bc1152802497367ea4b`; `training-sale-reviews.js` `fa4b79df5aaa5327488894ea2873832cadd944e22aca2b7a60d76f78e5af26d1`. Release files, running-container files and the served frontend asset were hash-checked.
- Migrations: none. No invoices, payments, account records or other financial data were created or changed during deployment.
- Verification: JavaScript syntax checks and focused invoice/sale-review tests pass (7/7); `git diff --check` passes. Production `/healthz` is 200 and both app/database containers are healthy. The authenticated owner Finance screen renders the new Invoice register and **New invoice** action. The versioned production asset returns 200 and contains the new UI. Unauthenticated calls to the owner and canonical approved-sale endpoints return their authentication gates; no data is exposed.
- Remaining gate: the authenticated New invoice queue and a real approved-sale conversion were not exercised because no eligible approved sale was available for a safe production test. The UI directs users to Lead Pipeline when the queue is empty. The create operation uses the existing atomic conversion and must be verified with an eligible approved sale before claiming invoice issuance acceptance.
- Rollback artifacts: `/opt/salemax/shared/rollback-invoice-workspace-e4ec262` retains the original release/container files and `salemax-app:rollback-invoice-workspace-e4ec262` points to the pre-invoice image. `salemax-app:rollback-invoice-workspace-43c23cf` points to the first invoice-workspace image. Restore the `release-*` files to the active release, restore the corresponding `container-*` files or retag the selected rollback image as `salemax-app:latest`, then recreate only the app service with `docker compose -p salemax --env-file /opt/salemax/shared/stack.env -f /opt/salemax/current/deploy/compose.yml up -d --no-build --force-recreate app`.
