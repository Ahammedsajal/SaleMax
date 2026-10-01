# Platform foundation contract — increment 1

Status: implemented database/policy/session primitives, locally verified with synthetic records. Not an activated platform login or completed TC35 contract pack. Main application routes still use legacy authentication. Never attach a browser-supplied preview context to a production request.

## Canonical identity and ownership

`20261001_platform_identity.sql` adds seven isolated `sx_` tables. Legacy tables remain unchanged by this file.

| Table | Ownership and invariant |
| --- | --- |
| sx_tenants | UUID business boundary; unique slug; trusted category key/version; country, currency, timezone and lifecycle |
| sx_identities | Global identity with unique normalized email; active status and credential version checked on every session lookup |
| sx_memberships | Tenant-local owner/accountant/manager/agent; one membership per identity per tenant; at most one active owner per tenant |
| sx_platform_memberships | Separate Super Admin/staff authority; at most one active Super Admin; tenant membership never grants platform authority |
| sx_sessions | Only SHA-256 token hashes persisted; audience and composite foreign keys bind tenant, member and identity; no raw bearer tokens in rows |
| sx_legacy_ownership | Source-table/source-ID namespace resolves each old record to one canonical tenant; optional member must belong to that same tenant |
| sx_audit_events | Identity/system actor and correlation ID; tenant FK; JSON changes must be redacted by the future write service |

The uniqueness constraints establish a maximum of one active owner, not existence of an owner. Provisioning/transfer must ensure an active tenant has an owner transactionally. Audit append-only application enforcement and restricted database roles remain pending. Email normalization must happen before identity creation; this migration does not normalize legacy emails.

## Session contract

`modules/platform/sessions.js` accepts only a 43-character base64url token representing the intended 32-byte random bearer token. Invalid syntax and missing hashes return null. The loader reloads identity, membership, tenant and platform membership from SQL on every call, rather than retaining roles inside a client token. Revocation, expiry, disabled identity, changed credential version, inactive membership and inactive tenant deny tenant access immediately.

Tenant result: `audience`, `sessionId`, `identity{id,displayName}`, `tenant{id,name,status,categoryKey,categoryVersion,revision,currency,timezone}`, `membership{id,tenantId,identityId,role,status,permissionVersion,delegatedPermissions}`. Platform result replaces tenant membership with platform role/grants and includes `mfaVerified` and `recentlyAuthenticated`. Password hashes and bearer-token hashes are not returned.

Platform policy requires MFA within 12 hours. Owner recovery/transfer, staff/category/provider/release administration, tenant category/owner changes and plan publishing also require authentication within five minutes. Future-dated verification timestamps cannot count as fresh authentication. Bootstrap, password verification, MFA enrollment/challenge, token issuance, rotation, secure cookies, CSRF, rate limiting and recovery are TC03 work still required before activating login.

The loader intentionally does not invent subscription entitlements. A request middleware must load the trusted versioned category and current published subscription assignment before invoking tenant policy. Subscription continuity during suspension/expiry, including reconciliation of verified settlements, remains TC36 work; this loader alone is not that lifecycle implementation.

## Authorization and projections

Effective access intersects tenant state, current membership, resource ownership, trusted category version, subscription capabilities, role/delegation and provider readiness. Feature visibility is not provider readiness. A resource from another business returns `RESOURCE_NOT_FOUND`, even to that business's owner. SQL list queries must apply scope before pagination/count/export; filtering a response after querying all businesses is not an acceptable implementation.

| Role | Current policy boundary |
| --- | --- |
| Business owner | Tenant administration and finance, never platform administration |
| Accountant | Finance; leads/contacts only when billing-linked; sales notes excluded by response projection |
| Manager | Tenant sales/assignments/forms; finance summary only; selected operational grants may be delegated |
| Agent | Assigned leads/conversations/tasks; own reports; no finance verification or team administration |
| SaleMaX staff | Explicit platform grants from a bounded allowlist, with MFA; no owner recovery/transfer |
| Super Admin | Known platform permissions, MFA and fresh authentication for sensitive changes |

Scopes `assigned`, `own`, `billing`, `summary`, `finance` and `sales` are returned to the caller. Every future repository and serializer must enforce them: an allowed decision does not authorize full rows. Runtime tests currently prove the policy and preview projections, not authorization of all 369 legacy routes, files, workers, exports or Socket.IO rooms.

## Category and route contract

`categories.js` supplies version 1 of `training_center`. `restaurant_fixture` is a private test manifest demonstrating that training routes disappear and training policy requests fail. It is not a released restaurant category. Customer category selection cannot load executable code.

`navigation.js` defines 26 bilingual training navigation items, including all 13 requested legacy entries. Its `/user/{key}` values are target routes; they are not yet active replacements for existing compiled screens. Role/category/plan checks determine navigation, while the same policy must guard eventual direct APIs independently.

## Migration/adoption gate

Do not apply the complete migration directory to the imported or production database yet. Earlier pipeline migrations predate the migration ledger and require an audited adoption baseline; otherwise existing objects can conflict. TC29 must map old ownership, reconcile counts and rehearse restore. New canonical tenant ownership must not be inferred from a submitted `uid` or merely a phone number. Ambiguous legacy ownership belongs in a review queue.

Current verification: 20 automated tests plus real MariaDB 11.4 synthetic integration covering four forward migrations, repeat/locking/failure recovery, cross-tenant and wrong-identity session FKs, cross-tenant legacy maps, single-owner constraints, immediate session invalidation, permission reload, MFA age and sensitive-action reauthentication. No imported customer data is touched.

## Remaining TC35 contracts

Plan versions/assignments and seat-reservation primitives are now recorded in `PLAN_AND_SEAT_CONTRACT.md`, with five migrations and 21 automated tests plus real transactional/concurrency checks. Their authenticated screens, invitation delivery/acceptance and full lifecycle remain open. Training course/offer/batch entities, contact/opportunity separation, sale approval and immutable invoice snapshots, journal transitions/reconciliation, installment/payment allocation rules, notification outbox/delivery events, secure document links, report period definitions, idempotency and full OpenAPI schemas remain open. Dependent product screens must not be enabled on the strength of this foundation alone.
