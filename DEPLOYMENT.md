# SaleMaX live deployment — 30 September 2026

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
