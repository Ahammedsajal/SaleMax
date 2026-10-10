# Tenant CRM domains and branding

This contract adds tenant-owned CRM hostnames and a separate CRM logo inside the existing SaleMaX `/user` workspace. It does not rebrand SaleMaX public pages or training forms/documents, and it does not create another application or login.

## Ownership and access rules

- One pending, verified, or active CRM hostname is allowed per tenant. Disabled hostnames remain as history; a tenant may later connect a different hostname.
- A hostname must be a normalized public subdomain outside `salemax.qa`. Apex/root domains and `*.salemax.qa` are rejected.
- Host ownership requires a unique 256-bit TXT challenge and a direct CNAME to `crm.salemax.qa`. The raw challenge is returned only when issued or refreshed; only its SHA-256 hash is stored.
- DNS verification sets the row to `verified`. It never grants access. The hostname reaches `active` only after the SaleMaX operator provisions and validates HTTPS.
- The Host header selects a candidate tenant. Canonical session tenant ID, reviewed legacy ownership mapping, identity, membership and role permissions still authorize each operation.
- Existing user and agent login/middleware and Socket.IO handshakes enforce the custom hostname's tenant binding. Platform administration, public forms and public website pages are not routed through custom tenant hostnames.
- CRM logos are stored outside `client/public` under a persistent private directory. Logo reads require the active mapped hostname or a matching canonical tenant session. Training Center public-profile logos remain independent.
- Authenticated business API responses are excluded from service-worker caches. Tenant CRM origins do not persist dashboard or login responses offline.

## API surface

All owner settings are served inside `/api/crm` and the current `/user?page=crm-appearance` view.

| Route | Purpose | Access |
| --- | --- | --- |
| `GET /api/crm/appearance` | Domain state and CRM branding revision | Tenant owner canonical session |
| `GET /api/crm/branding` | CRM logo for the current business panel | Active tenant canonical session |
| `GET /api/crm/tenant-context` | Minimal business name/logo for a verified custom-domain sign-in page | Active custom hostname only |
| `POST /api/crm/domains` | Start a DNS challenge | Tenant owner, CSRF protected |
| `POST /api/crm/domains/:id/challenge` | Rotate an expired/lost pending challenge | Tenant owner, CSRF protected |
| `POST /api/crm/domains/:id/verify` | Check TXT and CNAME records, transition pending to verified | Tenant owner, CSRF protected |
| `DELETE /api/crm/domains/:id` | Disable routing and preserve history | Tenant owner, CSRF protected |
| `PUT /api/crm/branding` | Upload/replace/remove the separate CRM logo | Tenant owner, CSRF protected |
| `GET /api/crm/logos/:tenantId/:filename` | Read an uploaded CRM logo | Matching active hostname or matching canonical tenant session |

Logo uploads accept JPEG, PNG, or WebP, check file signatures, and are limited to 5 MiB. SVG and arbitrary external image URLs are not accepted.

## Host lifecycle

1. Owner enters a subdomain in CRM Appearance. SaleMaX issues a TXT value and displays a CNAME target.
2. Owner adds the TXT record at `_salemax-verification.<hostname>` and the CNAME `<hostname> → crm.salemax.qa`.
3. Owner selects **Check DNS records**. TXT hash and CNAME are checked; on success the state is `verified`.
4. A SaleMaX operator runs `sudo /opt/salemax/current/deploy/tenant-domain-provision.sh <hostname>`. The script requires a verified database row, creates a hostname-specific HTTP challenge site, obtains a Let's Encrypt certificate, validates and reloads Nginx, and then marks TLS ready. The custom Nginx site proxies only to the existing CRM application. The app rejects `/admin`, public forms, and other public-website routes on this hostname.
5. The host middleware serves the existing CRM shell. The custom login is tenant-forced; users and agents must have active reviewed ownership for that tenant. Every canonical API request repeats the tenant/session check.
6. Owner removes the hostname in CRM Appearance to disable database routing immediately. Keep the HTTPS site/certificate while the customer's DNS still points to SaleMaX so visits receive a valid-TLS inactive response. After the customer removes the CNAME, an operator runs `sudo /opt/salemax/current/deploy/tenant-domain-retire.sh <hostname>` to remove the Nginx site and certificate.

Let's Encrypt renewal uses its saved webroot authenticator. Provisioning installs a safe Nginx reload deploy hook if none exists and refuses to overwrite a different existing hook.

## Migration and rollback

Migration `20261124_tenant_crm_domains.sql` adds hostname lifecycle/history and separate CRM branding storage. Its generated unique key allows only one current hostname per tenant while retaining any number of disabled historical rows.

Database rollback is intentionally not an automated `DROP TABLE`: preserve disabled and active tenant-domain history. Application rollback disables the UI/routes; keep the migration and private logo volume. If a custom hostname must be taken out of service, disable it through the owner workflow first, then retire its Nginx site/certificate only after DNS no longer targets SaleMaX.

Production needs `/opt/salemax/shared/crm-tenant-logos` owned by the app container UID/GID (`1000:1000`) with mode `0700`, mounted as `/app/private/crm-tenant-logos`. Do not put these files in Git or the public media directory.

## Acceptance and remaining infrastructure gate

Disposable MariaDB integration covers challenge hashing, DNS verification, HTTPS state transition, matching/mismatched tenant host checks, disablement, ownership collision, and replacement history. Browser acceptance must verify the existing `/user` appearance screen, sign-in logo, dashboard shell logo, team inheritance, Arabic layout, wrong-tenant denial and the unchanged public website.

Activating one real customer hostname also requires the customer's chosen DNS hostname and DNS changes. Without that hostname, code can be deployed but no tenant certificate, live login, or end-to-end custom-domain browser proof can be claimed.
