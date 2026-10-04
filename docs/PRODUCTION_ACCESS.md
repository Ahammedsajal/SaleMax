# SaleMaX Production Access and Git Workflow

This file records the safe access and release process for the existing SaleMaX production deployment. The production release history and operational details live in ../DEPLOYMENT.md.

## Access boundary

- Production URL: https://crm.salemax.qa/
- Production host and deployment root are recorded in DEPLOYMENT.md; confirm they still match the intended target before every change.
- Use an authorized operator account and SSH identity from that operator's local SSH configuration or agent. Keep private keys, passwords, tokens, server environment files and recovery material out of this repository.
- The server stores runtime and database credentials under /opt/salemax/shared with restrictive permissions. Do not copy them into Git, logs, tickets or screenshots.
- server-access/ is intentionally excluded by .gitignore. Keep any operator-specific connection notes there with restrictive local permissions. Track only non-secret deployment facts and reviewed release evidence in this repository.
- Before changing production, verify the host identity and resolve /opt/salemax/current to the active release. Do not assume a successful Git push changed the running service.

## Required Git record for every production update

1. Check git status, fetch origin/main, and make the intended source or deployment-support changes in Ahammedsajal/SaleMax.
2. Run the applicable verification for the change. Keep production data, credentials, runtime state and backups outside the commit.
3. Commit and push the verified source changes. Record that commit SHA before deploying.
4. Deploy the reviewed source/artifact through the existing SaleMaX release process. When production needs generated or live-derived files missing from this checkout, document that difference and its artifact hash in the release entry; do not silently substitute an older local copy.
5. Verify the active release and the relevant app, database, API and authenticated browser behavior. Keep health checks, browser acceptance and device/provider checks distinct.
6. Append a dated entry to DEPLOYMENT.md with the source commit SHA, active release, migrations, backup and rollback references, verification performed, and any open gates. Never add secret values or customer data.
7. Commit and push the verified DEPLOYMENT.md entry. The production update is not fully recorded in Git until both the implementation and its release evidence are present.

For a production-only change with no tracked source change, commit the deployment record and a safe, reproducible patch or artifact reference when available. State explicitly when the deployed artifact cannot be reconstructed from the tracked source.
