# Tenant CRM domains and branding

Custom business hostnames attach to the existing SaleMaX/7Network CRM. The existing `/user`, `/user/login`, and agent entry points remain in use. CRM logo branding stays separate from the public website, training forms, and documents. Platform administration remains on the canonical 7Network host.

## Ownership and access rules

- Only a platform super-admin with a verified administrator MFA session can list business domains, attach a hostname, rotate its challenge, check DNS, select a primary hostname, or disable it. Domain setup appears in the existing `/admin?page=manage-users` screen. Business owners, staff, agents, and delegated platform staff cannot see or call the domain-management UI/API.
- A tenant can have up to ten active/pending/verified hostname aliases. One verified or active hostname can be marked primary. Disabled rows are retained; a disabled hostname may be reattached to the same tenant only after a new challenge is issued. A hostname cannot be assigned to another tenant while its history remains.
- Hostnames are normalized public DNS names outside `salemax.qa`. Both registrable root names (for example `example.qa`) and subdomains (for example `www.example.qa`) are allowed. IP literals, URLs, ports, wildcard names, and platform-owned names are rejected.
- Ownership uses a unique 256-bit 7Network TXT challenge at `_7network-verification.<hostname>` with a `7network-domain-verification=` value. Namecheap users enter only `_7network-verification` in Host; root/apex A records use Host `@`; subdomain CNAME Host values omit the domain suffix. Subdomains must CNAME to the retained production alias `crm.salemax.qa`; root/apex names must resolve by A record to an IPv4 address currently returned for the production CRM host. Only the token hash is stored. The raw TXT token is returned only on create or challenge rotation. Verification continues to accept already-issued `_salemax-verification` / `salemax-domain-verification=` challenges until they expire.
- DNS verification sets a row to `verified` and never grants traffic access. A host timer rechecks verified records and runs the existing hostname-specific Nginx/Certbot provisioning script. The domain reaches `active` only after HTTPS is installed and the app confirms it. Certbot renewal remains automatic through the host's renewal timer and managed Nginx reload hook.
- The Host header selects a candidate tenant. Canonical session tenant ID, reviewed legacy ownership mapping, active identity, active membership, active tenant, and role permissions still authorize each operation. Suspended tenants and inactive memberships fail closed on a custom host.
- DNS checks are rate-limited per hostname. Challenges expire after 24 hours. A super-admin can rotate a pending challenge. The 15-minute DNS audit timer checks active aliases and closes routing when ownership/target records go stale.
- Normal CRM navigation and login links are relative so they remain on the business hostname. Platform administration and public API routes are not routed through a tenant hostname. Root storefront rendering is not enabled in this stage; `/` remains closed until the storefront implementation is ready.
- CRM logos remain stored outside `client/public` under a persistent private directory. Logo reads require the active mapped hostname or a matching canonical tenant session. Training Center profile logos remain independent.
- Authenticated business API responses are excluded from service-worker caches. Domain administration and tenant CRM responses use `Cache-Control: no-store`.

## API surface

The domain-management API is under `/api/admin/tenant-domains`; every operation passes the existing administrator token/MFA checks and a second explicit `super_admin` role check. Responses are private and non-cacheable.

| Route | Purpose |
| --- | --- |
| `GET /api/admin/tenant-domains?q=` | Search linked business accounts and list hostname aliases |
| `POST /api/admin/tenant-domains` | Attach a hostname and return DNS instructions |
| `POST /api/admin/tenant-domains/:id/challenge` | Rotate a pending hostname's TXT challenge |
| `POST /api/admin/tenant-domains/:id/verify` | Verify TXT ownership and CNAME/A target |
| `POST /api/admin/tenant-domains/:id/primary` | Set the tenant's primary verified/active hostname |
| `POST /api/admin/tenant-domains/:id/disable` | Close hostname routing and retain its history |
| `GET /api/crm/branding` | Read the current tenant CRM logo |
| `GET /api/crm/tenant-context` | Minimal business name/logo on an active custom-host login |
| `PUT /api/crm/branding` | Upload/replace/remove the separate CRM logo |
| `GET /api/crm/logos/:tenantId/:filename` | Read a logo on matching hostname or canonical tenant session |

Business-domain create/verify/disable operations are no longer available through `/api/crm`. Logo uploads accept JPEG, PNG, or WebP, check file signatures, and are limited to 5 MiB. SVG and arbitrary external image URLs are not accepted.

## Host lifecycle

1. A super-admin opens **Business domains** from the existing Manage Users screen, selects a linked business account, and attaches its root or subdomain hostname. The TXT value is shown once; the screen also shows either the production A target or the `crm.salemax.qa` CNAME target.
2. The customer adds the TXT record and the appropriate A or CNAME record. Provider guidance shows relative Host labels (`_7network-verification`, `@`, or the subdomain label) alongside full record names and values. For an apex, replace any conflicting root redirect/A record only after saving its prior value for rollback. The super-admin checks DNS. The verified-domain timer rechecks the records and runs the safe existing Certbot/Nginx provisioner. It provisions only domains with a valid TXT proof and a matching live production target.
3. HTTPS activation changes the row to `active`. Until then, the custom hostname stays closed. `/user`, `/user/login`, and supported agent routes enter the existing app on that host; `/`, `/admin`, public forms, and public website routes remain closed in this storefront-development stage.
4. Super-admin can set a different verified/active alias as primary or disable an alias. Disabling closes app routing immediately and preserves its database history. Keep the managed HTTPS site while DNS still points to 7Network; after the customer removes the record, run `sudo /opt/salemax/current/deploy/tenant-domain-retire.sh <hostname>` to retire only the matching managed Nginx site/certificate.

Let's Encrypt renewal uses the existing host renewal timer. The provisioner installs the managed Nginx reload hook if none exists and refuses to overwrite a different hook or unrelated Nginx site.

## Migration and rollback

`20261124_tenant_crm_domains.sql` adds domain lifecycle and separate CRM branding storage. `20261125_tenant_crm_dns_rate_limit.sql` adds DNS-check throttling and health state. `20270102_tenant_crm_domain_aliases.sql` adds a nullable primary marker, removes the one-current-hostname constraint, and retains unique hostname ownership while allowing aliases.

The alias migration is forward-compatible and the new nullable marker is ignored by the previous application image. Application rollback restores the prior release/image and leaves the additive schema in place. Do not restore an old customer database or automatically remove domain history. Disabling a hostname closes routing; retire its Nginx site and certificate only after DNS no longer points to 7Network.

Production needs `/opt/salemax/shared/crm-tenant-logos` owned by the app container UID/GID (`1000:1000`) with mode `0700`, mounted as `/app/private/crm-tenant-logos`. Do not put these files in Git or the public media directory.

## Acceptance and remaining gates

Focused tests cover super-admin-only access, tenant-linked business listing, apex/subdomain validation, TXT/CNAME/A checks, active-host routing, wrong-tenant denial, stale DNS, and owner logo-screen compatibility. Production browser acceptance should verify that a super-admin can manage two businesses, business owners/staff/agents do not see domain management, English/Arabic and mobile layouts work, and an authenticated user from one tenant is denied on another tenant's host.

Production currently has no attached tenant domains. A real customer hostname must pass authoritative DNS, automated HTTPS, and authenticated browser acceptance before the feature can be called live-ready. Root storefront rendering remains a separate gate while storefront development continues.
