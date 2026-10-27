# 7Network Production Access and Git Workflow

This file records the safe access and release process for 7Network. The public production URL is https://7network.live/. The production release history and operational details live in ../DEPLOYMENT.md.

The Linux deployment directory, Compose project, container names, and some environment variables still use legacy `salemax` identifiers. Keep those names when a command targets the current host; they are runtime compatibility identifiers and do not change the product name or public URL.

## Access boundary

- Public production URL: https://7network.live/
- Canonical production hostname: 7network.live.
- Production host and deployment root are recorded in DEPLOYMENT.md; confirm they still match the intended target before every change.
- Use an authorized operator account and SSH identity from that operator's local SSH configuration or agent. Keep private keys, passwords, tokens, server environment files and recovery material out of this repository.
- The server stores runtime and database credentials under /opt/salemax/shared with restrictive permissions. Do not copy them into Git, logs, tickets or screenshots.
- The local `7network-Server-Access/` folder is intentionally excluded from Git. Keep operator-specific connection notes there with restrictive local permissions. Track only non-secret deployment facts and reviewed release evidence in this repository.
- Before changing production, verify the host identity and resolve /opt/salemax/current to the active release. Do not assume a successful Git push changed the running service.

## Required Git record for every production update

1. Check git status, fetch origin/main, and make the intended source or deployment-support changes in Ahammedsajal/SaleMax.
2. Run the applicable verification for the change. Keep production data, credentials, runtime state and backups outside the commit.
3. Commit and push the verified source changes. Record that commit SHA before deploying.
4. Deploy the reviewed source/artifact through the existing 7Network release process. When production needs generated or live-derived files missing from this checkout, document that difference and its artifact hash in the release entry; do not silently substitute an older local copy.
5. Verify the active release and the relevant app, database, API and authenticated browser behavior. Keep health checks, browser acceptance and device/provider checks distinct.
6. Append a dated entry to DEPLOYMENT.md with the source commit SHA, active release, migrations, backup and rollback references, verification performed, and any open gates. Never add secret values or customer data.
7. Commit and push the verified DEPLOYMENT.md entry. The production update is not fully recorded in Git until both the implementation and its release evidence are present.

For a production-only change with no tracked source change, commit the deployment record and a safe, reproducible patch or artifact reference when available. State explicitly when the deployed artifact cannot be reconstructed from the tracked source.

## Product guidance and working across PCs

The canonical roadmap is `docs/7NETWORK_VISION_ROADMAP.md`; the reusable project skill is `skills/7network-product-direction/SKILL.md`. AGENTS.md requires future work to use them. Pull the latest `Ahammedsajal/SaleMax` main branch before working on another PC, preserving local edits first. The repository instructions work without a Mac-specific global skill link. Register the tracked skill directory in that machine's supported skill location if automatic discovery is desired; use its separately authorised production SSH identity.

Production stores a versioned, non-public guidance bundle at `/opt/salemax/shared/project-guidance/current`. MANIFEST.json identifies source commit and file hashes. This documentation pointer is separate from `/opt/salemax/current`, the application release pointer. Documentation publication does not rebuild the app or deliver planned features. Read DEPLOYMENT.md and inspect current runtime evidence before recovering source from production: overlay releases may contain only incremental files rather than a full checkout.

Prefer Git for source and roadmap synchronization. If recovering reviewed production source, compare it with the deployment record and merge deliberately. Never sync runtime/stack environment files, private keys, sessions, database files/dumps, customer documents/media or rollback backups into a source checkout or Git. The production bundle is an allowlist of project guidance, not a server backup.

## Production release retention

The live Compose configuration may reference multiple release directories. Preserve every path referenced by a running container, the current release symlink, and rollback snapshots inside the retention window. Do not use Docker system/image/volume pruning or remove shared/customer data as a release cleanup shortcut.

The production server installs `deploy/retain-production-releases.py` at `/opt/salemax/shared/maintenance/retain-production-releases.py`. It runs daily at 03:17 UTC through `/etc/cron.d/7network-release-retention`. Run it manually after a large rollout when appropriate. The default policy keeps live Compose/mount inputs, release paths referenced by rollback snapshots from the last 24 hours, and directories changed in the last hour. It defaults to dry-run; `--apply` deletes eligible release folders and journals each deletion under `/opt/salemax/shared/maintenance-release-retention-*`.

Older rollback snapshot folders remain stored, but their old release paths may be retired; use the recorded source commit/image identity to reconstruct an older release. Review the dry-run, eligible names and remaining rollback window on the verified `carsqatar-prod-01` host, and record the result in `DEPLOYMENT.md`.
