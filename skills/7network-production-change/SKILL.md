---
name: 7network-production-change
description: Use for every production change to the 7Network platform. Keeps a verified, tracked deployment record synchronized across Windows and other checkouts.
---

# 7Network production change procedure

Use this procedure whenever a source change, configuration change, migration, asset update, or operational action changes production.

1. Read `docs/PRODUCTION_ACCESS.md`, the latest `DEPLOYMENT.md` entry, and `docs/7NETWORK_REBRAND.md`. Check the current Git status and fetch the configured remote. Work from the latest intended source baseline and isolate the change from unrelated local edits.
2. Confirm the production hostname, host identity, active release, app health, database/worker health, and available disk space. Treat the live release as authoritative; preserve live-derived files outside the intended change.
3. Make and verify the source change before deployment. Keep credentials, account/customer data, sessions, runtime files, and rollback material out of Git. Use synthetic disposable data for verification.
4. Before a production mutation, create a restrictive, targeted rollback snapshot containing the exact prior files/configuration/data that the change will touch, plus the prior release/service identity. Never assume a source push changed the running service.
5. Deploy only the reviewed source/artifact through the established release procedure. Apply migrations deliberately and check their recorded status. Verify the active release, health, affected public/API surfaces, relevant authenticated flows, and that unrelated services/data were not changed.
6. After live verification, append a dated `DEPLOYMENT.md` entry with the source commit SHA, active release, exact change, migration result, rollback directory/reference and restoration steps, verification evidence, and remaining gates. Do not include secrets or customer data.
7. Commit and push the implementation and verified deployment record to `Ahammedsajal/SaleMax`. Keep `docs/7NETWORK_REBRAND.md` current when the canonical assets, names, compatibility rules, or workflow change. This tracked procedure and ledger are the handoff for Windows and other machines; do not rely on personal local notes.

## Rebrand-specific rules

- Use `7Network` and `7Network Sales` in new user-facing text. Keep the approved globe, red 7, and seven network points intact.
- The domain remains `crm.salemax.qa` until a separate domain migration is authorized and ready. Retain current `SALEMAX_*` environment names, legacy URLs, and static path aliases during this brand-only rollout.
- Treat `7network_sales` as canonical and `salemax_sales` as a compatibility alias. Existing published plan versions and assignments retain their IDs and historical records.
- Never modify the compiled React bundle by hand. Update its maintained shell/hooks/assets and test existing entry points.
- Never rename tenant/customer business names, customer-owned logos, legal entity names, credentials, or communications as a side effect of the platform brand update.
