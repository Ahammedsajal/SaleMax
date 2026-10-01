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
