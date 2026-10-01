# SaleMaX rebranding — 30 September 2026

Project: A:\Salemax - Training center\Salemax-Node
Local preview: http://127.0.0.1:3010/
Target public domain: https://salemax.qa/

Implemented:
- SaleMaX app name, frontend fallback copy, website title, description, canonical and Open Graph domain metadata.
- All 13 translation files, including English and Arabic, use SaleMaX and info@salemax.qa.
- Burgundy brand theme selected through the existing theme manager. Rotating homepage hero uses the brand palette.
- Logo lockup, square icon, favicon, Apple touch icon and PWA icons prepared from the supplied brand reference. Built-in imagegen was used to isolate the horizontal lockup and square app icon, preserving the supplied spelling, ribbon shape and colors; PNG outputs were packaged into required icon sizes.
- Homepage/header/footer, sign-in logo, compact shell/loader icons and pipeline branding updated.
- Local web settings, FAQ and testimonial brand content updated transactionally. Original content backed up privately.
- Frontend API/socket URLs use the current site origin instead of gccbot.com. This allows the same frontend to work locally and when hosted at salemax.qa.
- Package renamed salemax-node. Local start/stop scripts and MariaDB data-directory paths updated for Salemax-Node. App restarted from the new folder.
- Historical inactive frontend bundles archived privately. Active bundle: main.73648acf.js.

Verification:
- JavaScript syntax checks passed for the active compiled bundle, server, pipeline and migration scripts.
- Manifest entrypoints all exist.
- Local /healthz, /api/web/get_web_public and /api/theme/get-theme-config returned HTTP 200 with success=true; name=SaleMaX, logo=salemax-logo.png, primary=#A8003B.
- Browser confirmed API calls use 127.0.0.1:3010.
- English mobile homepage at 390 px: logo loads, no old brand in visible copy, no horizontal overflow.
- Arabic mobile homepage with app_direction=rtl: Arabic text, RTL, logo loads, no old brand, no horizontal overflow.
- Desktop login: new logo loads; dark mode changes background to rgb(13,17,23), logo remains visible, no horizontal overflow.
- Unauthenticated pipeline access redirects to sign-in as before.

Boundaries and remaining work:
- Public deployment/DNS/TLS for salemax.qa has not been performed. Hosting server and DNS account details are required; requested in chat.
- Windows holds the original workspace folder open. All project files were moved into Salemax-Node; the old GCCBOT-Node folder only contains files created by the active browser verification tool. Remove that leftover folder after this chat/browser workspace releases it.
- Frontend source was not included in this training copy. Changes were applied to the supplied compiled frontend and settings; a source build cannot be run here. Repeat these changes in the React source before a future upstream rebuild.
- Existing CRM endpoint paths, external CRM hostname, authentication storage keys, database identifiers and signed license metadata remain compatible. Branding them internally requires coordinating the other service; blind renaming would break existing connections.
- Provider workers remain disabled in local training mode. Existing bundled Stripe loading still makes automatic Stripe browser requests; this work did not enable payments or perform transactions.
- Existing marketing statistics, sample testimonials, SLA/security claims and plans were retained; this branding check does not verify those claims.

Rollback files: private-backups/rebrand-20260930/
Evidence screenshots: rebrand-evidence/

Continuation audit:
- Sidebar/pipeline helper namespaces and admin helper CSS classes now use salemax names; all three helper JavaScript files passed syntax checks.
- Ancillary gbot/Miracle source folder renamed to salemax/Miracle after confirming there are no imports referencing its old path.
- Helper script cache versions updated so browsers fetch the rebranded helpers.
- Rebranding script now preserves the existing SaleMaX theme when rerun, including its verified dark-mode contrast adjustments.
- Fresh health, web-public branding and theme API checks passed.
- Fresh public lookup for salemax.qa returned DNS server failure; public availability remains unverified. Web lookup also could not access the domain. This does not establish that the domain is unregistered or prove which DNS account owns it.
- Automatic approval review rejected the old-workspace cleanup command as blocked by policy; no cleanup was executed. The original folder remains in place with browser tool output.
- Hosting and DNS destination details requested in chat have not yet been provided. Public deployment remains pending.

Live deployment update:
- Owner selected crm.salemax.qa and added its DNS A record. Live app is deployed under /opt/salemax on the Oracle CarsQatar host.
- HTTPS, redirect, rendered branding, API connectivity, mobile/RTL and database/authentication checks passed. See DEPLOYMENT.md for exact evidence and operations.
- The earlier hosting/DNS blocker is resolved. Old workspace browser-output folder remains a session artifact; application source is in Salemax-Node.
