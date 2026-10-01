# TC00/TC01 source baseline — 1 October 2026

Authoritative source: `A:\Salemax - Training center\Salemax-Node`. The requested older `GCCBOT-Node/docs` location is a planning workspace; the audited version 1.1 plan lives in this application's `docs` directory.

## Verified

- Express/Node, MariaDB/mysql2, Socket.IO and existing messaging adapters; compiled React frontend in `client/public`.
- Dependency lock matches runtime manifest. Frontend manifest/shell assets and branding pass automated checks. These checks do not yet prove a fresh install/build.
- No editable frontend entrypoint or source map was found in this client directory or the inspected related locations. The separate newer `A:\Gccbot Updated\gccbot.com` product has a different backend and must not implicitly replace this application.
- Existing local runtime starts through `start-local.ps1`; Node binds 127.0.0.1:3010 and MariaDB 127.0.0.1:3307. Baseline health, public branding, theme and homepage returned HTTP 200; QR active connections were zero.
- Repaired the runner that selected a destructive rollback: forward discovery, checksums, history validation, advisory lock and per-statement failure tracking are implemented. Nine automated tests and separate real MariaDB 11.4 synthetic-data verification passed.
- Imported customer data was not migrated. Existing schemas still require reviewed ledger adoption before using the repaired runner.
- Removed a hardcoded Meta app secret, switched to META_APP_ID/META_APP_SECRET, required authenticated business access for exchange, and blocked exchange in local-only/unconfigured mode. No provider call was made. The provider owner should rotate the previously embedded secret before live Meta use; its value is never recorded in evidence.
- Git publication excludes environment files, databases, sessions, keys, activation state, logs, private archives and customer media. Only the SaleMaX logo is admitted from the media folder. The recognizable-secret scan is a publication aid, not a comprehensive security audit.

## Still required for TC00

Recover original editable frontend or maintainably recreate the same shell and route contracts with full EN/AR preservation. Verify isolated fresh checkout install/build/start with sanitized schema/bootstrap; runtime license metadata must be intentionally provisioned outside Git. Inventory legacy routes/guards/workflows. Review schema/adoption contracts under TC35. Record increment evidence before production cutover.

All 42 tickets remain tracked, including conditional TC27 gateway enablement and post-training-launch TC34 expansion. Full screens/functions, API documentation, user manual, financial correctness, provider evidence, load/restore and production release remain required. This increment does not close TC00 or the goal.
