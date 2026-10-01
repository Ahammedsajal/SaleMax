# Canonical authentication and MFA contract

Status: backend router/services implemented and verified through real HTTP against disposable MariaDB. Not mounted in `server.js`, not deployed, not yet a finished login screen or completed TC03. This is the planned shared replacement for legacy login, not an additional production identity system.

## Implementation and activation

`createAuthRouter({pool,key,origin,insecureLoopback:false})` in `modules/platform/auth-router.js` returns `router`, `guard` and `cookieName`. The host must mount the router under the eventual `/api/v1/auth` family and the guard before each new domain handler. It must also enforce that handler's role/capability/record permission; a valid session alone is not resource authorization. `guard` assigns a server-derived `req.businessContext`, not submitted request context.

Use a private mysql2 pool and a shared random secret Buffer of at least 32 bytes. The key must come from deployment secret management and be shared across app processes; do not generate a new key on every start. Backup/rotation must preserve MFA decryption keys. Versioned key rotation and recovery operations remain required before production activation.

HTTPS origin must match exactly with no trailing slash/path. Production cookie is `__Host-salemax_session`, Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain. The explicit loopback test option uses `salemax_dev_session` without Secure and rejects non-loopback origins. No bearer token is returned in JSON or stored in browser localStorage. Authentication responses are `Cache-Control:no-store`.

The current IP limiter uses `req.socket.remoteAddress`, deliberately ignoring submitted forwarded headers. Deployment behind a trusted reverse proxy needs an audited client-IP adapter/proxy configuration before activation; using a shared proxy address would throttle unrelated customers together. Do not trust arbitrary X-Forwarded-For. Server/browser TLS, CSP, distributed deployment, operational key rotation and graceful DB failures still require release verification.

## Implemented router endpoints

Paths below are relative to the unmounted router. They are tested handler contracts, not claims about currently live URLs.

| Method/path | Request | Response and behavior |
| --- | --- | --- |
| POST /login | JSON email/password/audience; tenant audience requires exactly one of canonical tenantId or workspace tenantSlug; exact Origin | 200 sets cookie, returns canonical context/csrfToken/mfaRequired; 401 AUTH_INVALID for credentials, inactive identity or invalid membership; 429 AUTH_RATE_LIMITED |
| GET /me | Session cookie | 200 context/csrfToken/mfaRequired; 401 AUTH_REQUIRED |
| POST /logout | Cookie, Origin, X-CSRF-Token | 204 revokes session and clears cookie; 403 CSRF_DENIED or ORIGIN_DENIED |
| POST /mfa/enroll | Recently password-authenticated platform session, cookie, Origin, CSRF; no body fields required | 200 one pending secret/otpauth URI/local qrDataUrl/enrolled:false; 409 MFA_ALREADY_ENROLLED prevents silent factor replacement |
| POST /mfa/verify | Same recent session plus JSON code or recoveryCode, Origin and CSRF | 200 verified:true; initial enrollment additionally returns ten recoveryCodes once and refreshes cookie to eight hours; 403 MFA_INVALID/MFA_NOT_ENROLLED/REAUTH_REQUIRED; 429 MFA_RATE_LIMITED |

All mutations reject an absent/foreign Origin. Cookie mutations also compare a session-bound HMAC CSRF token in constant time. Login has no prior cookie requirement but requires the exact Origin. JSON bodies are limited to 8 KiB; malformed JSON returns 400 INVALID_JSON, oversized JSON 413 BODY_TOO_LARGE. Unexpected errors are bounded 500 AUTH_UNAVAILABLE; SQL/password/stack details are not returned. `/me` supplies only canonical identity/membership/tenant fields, never password or token hashes.

Password input is not trimmed and must fit bcrypt's 72-byte limit. Emails are trimmed/lowercased. New canonical hashes must use supported bcrypt cost 12–16; legacy lower-cost hashes need explicit rehash/adoption, not silently treating imported rows as canonical identities. Unknown and unsupported accounts still perform a dummy bcrypt comparison. Login verifies current identity/password/credential version again under a database lock before creating a random 32-byte opaque session. Database stores its SHA-256 hash only.

Password authentication selects exactly one tenant membership or the separate platform audience. Platform login produces a short 15-minute pending session with no MFA grant; the domain guard rejects it with MFA_REQUIRED. Tenant sessions expire after eight hours. Pending sessions may call only the authentication/MFA operations until verified. Fresh password authentication is required for MFA enrollment/challenge; it does not change the global sensitive-operation reauthentication rule.

Database-backed rate buckets HMAC account and socket-address identifiers, not plaintext email/IP. They count all login attempts, allowing eight/account and forty/address per fixed 15-minute window. All workers share buckets and acquire them in a stable lock order. Success does not erase rate history. Retention cleanup and production proxy limits remain operational work. MFA allows eight attempts per identity per 15-minute window; an invalid attempt commits its count before returning a denial, so rollback cannot defeat throttling.

## MFA storage and replay protection

Migration `20261001_platform_security.sql` adds rate buckets, encrypted MFA credentials and hashed single-use recovery codes. Credentials use a random 20-byte secret encrypted with AES-256-GCM, independent HKDF-derived key, random nonce and identity-bound associated data. Enrollment JSON exposes the seed only to the recent authenticated session for authenticator setup; no audit/log stores it. The browser UI must never keep it after enrollment or include it in evidence screenshots.

TOTP uses SHA1, six digits and a 30-second step with one adjacent step of clock tolerance. Verification persists the greatest accepted step under identity/session/credential locks; a used step cannot authenticate again. UTC epoch arithmetic is independent of SQL session timezone. Recovery codes contain 128 random bits, are stored as keyed hashes, and consume a row atomically. Concurrent uses cannot both succeed. Initial enrollment returns ten recovery codes once; later reads cannot retrieve them. Audit events contain enrollment/recovery booleans only.

Algorithm/reference verification: [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238) test vectors, including post-2038 values. Encryption uses [Node crypto APIs](https://nodejs.org/api/crypto.html). Cookie settings follow the [Express response API](https://expressjs.com/en/4x/api/response.html#res.cookie).

## Required screen and compatibility work

Maintained `signin.html/js/css` now implements bilingual workspace-slug/password sign-in, show/hide, error/waiting states, authenticator QR/setup/challenge, recovery option, code download with acknowledgement, signed-in identity and logout. The screen calls the actual canonical APIs in an isolated synthetic lab. QR uses an inline locally generated data image; secrets are not submitted through a GET URL or external QR provider. This does not complete legacy replacement or business navigation after login. Workspace-address resolution, verified multi-membership choices, full 360 px acceptance and reauthentication return journeys remain open. Do not enable a recovery bypass or reset another user's MFA through an ordinary profile screen.

TC03 remains open for identity/bootstrap adoption, MFA device replacement and audited owner recovery/transfer, password reset/change, all-session revocation, MFA/login UI, verified email/invite identity binding, and legacy user/admin/agent route/socket compatibility. Canonical middleware never creates a Super Admin membership from a login/invite request. The existing compiled login and password-claim JWT routes remain isolated legacy behavior pending the replacement gate; they are not claimed fixed by this unmounted router.

## Evidence

23 automated tests pass. Real MariaDB/HTTP integration verifies six migrations, valid/wrong/foreign-membership login, cookie attributes, no raw token/password JSON claims, missing/foreign-origin CSRF rejection, guard continuation, logout revocation, database throttling, encrypted enrollment, MFA-required denial then verified access, TOTP replay denial, recovery retry/concurrency denial and MFA attempt limits. Passwords, seeds, bearer tokens and recovery codes are generated inside the synthetic test and are never printed. No customer data/provider sends/production writes.
