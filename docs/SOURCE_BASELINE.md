# TC00/TC01 source baseline — 1 October 2026

Authoritative source: `A:\Salemax - Training center\Salemax-Node`. The requested older `GCCBOT-Node/docs` location is a planning workspace; the audited version 1.1 plan lives in this application's `docs` directory.

## Verified

- Express/Node, MariaDB/mysql2, Socket.IO and existing messaging adapters; compiled React frontend in `client/public`.
- Dependency lock matches runtime manifest. Frontend manifest/shell assets and branding pass automated checks. A fresh GitHub clone at commit 8ecc197 installed 509 packages with npm ci, passed ten tests and separate MariaDB synthetic verification. Native wrtc/sharp/bcrypt loaded successfully. Its Node 20.19.5 server passed loopback health, branding, theme and homepage checks using supplied private local environment configuration and the existing sanitized local database. No runtime license was copied. This does not prove fresh tenant onboarding or an editable frontend build.
- No editable frontend entrypoint or source map was found in this client directory or the inspected related locations. The separate newer `A:\Gccbot Updated\gccbot.com` product has a different backend and must not implicitly replace this application.
- Existing local runtime starts through `start-local.ps1`; Node binds 127.0.0.1:3010 and MariaDB 127.0.0.1:3307. Baseline health, public branding, theme and homepage returned HTTP 200; QR active connections were zero.
- Repaired the runner that selected a destructive rollback: forward discovery, checksums, history validation, advisory lock and per-statement failure tracking are implemented. Ten automated tests and separate real MariaDB 11.4 synthetic-data verification passed. Cold startup exceeded the first smoke-test timeout; the controlled verifier now allows startup time, tracks child termination and stops only its own process. The latest verification passed.
- Imported customer data was not migrated. Existing schemas still require reviewed ledger adoption before using the repaired runner.
- Removed a hardcoded Meta app secret, switched to META_APP_ID/META_APP_SECRET, required authenticated business access for exchange, and blocked exchange in local-only/unconfigured mode. No provider call was made. The provider owner should rotate the previously embedded secret before live Meta use; its value is never recorded in evidence.
- Git publication excludes environment files, databases, sessions, keys, activation state, logs, private archives and customer media. Only the SaleMaX logo is admitted from the media folder. The recognizable-secret scan is a publication aid, not a comprehensive security audit.
- Structural inventory records 66 legacy tables, 651 columns and 203 index-column entries without reading customer rows, defaults or credentials. Regenerate with scripts/inventory-schema.cjs in the local-only environment. Canonical tenant mapping must account for legacy user/agent uid fields that are indexed but not unique.

## Still required for TC00

Upgrade this existing project and its current admin/user panels. Recover relevant frontend inputs where available, or extend existing source-controlled modules/hooks such as admin-actions and pipeline integration without replacing the shell or patching minified application logic. No recreated frontend project, duplicate plan catalogue or parallel login is authorized. Existing Manage Plans and Manage Users remain the plan/account integration points. Verify fresh checkout startup and each extended existing journey; runtime license metadata stays outside Git. Review legacy guards and schema/adoption contracts, and record evidence before production cutover.

All 42 tickets remain tracked, including conditional TC27 gateway enablement and post-training-launch TC34 expansion. Full screens/functions, API documentation, user manual, financial correctness, provider evidence, load/restore and production release remain required. This increment does not close TC00 or the goal.
