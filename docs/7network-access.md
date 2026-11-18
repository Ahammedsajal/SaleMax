# 7Network production access

This is the project entry point for production access from the authorized Mac. It contains connection metadata and commands only; it does not contain private-key material, passwords, tokens, runtime environment values, database credentials, or customer data.

## Production target

- Expected host identity: `carsqatar-prod-01`
- SSH account: `ubuntu`
- SSH address and port: `145.241.229.168:22`
- Public application origins: `https://7network.live`, `https://www.7network.live`, and the retained `https://crm.salemax.qa`
- Authorized Mac identity file: `~/.ssh/salemax-mac-20261003` (mode `0600`)
- Last verified from this Mac: 18 November 2026; SSH returned `carsqatar-prod-01`; `/opt/salemax/current` resolves to base release `/opt/salemax/releases/training-pipeline-correction-v3-9867ca72-20261104`. The Call Center and other app-only overlays are additional Compose inputs attached to the running container; the Zoiper display-label overlay is the current tail. The app is healthy on image `sha256:753d77d421b3160872df0812e7b38505a1db7104cdb9d6c8b17415b2420de667`; Asterisk is inactive/disabled with no SIP/ARI listeners.

Resolve the hostname and key from this file before connecting. Use the operator's local private key; never copy the key into this project, a chat, a ticket, or another machine. On another machine, use its separately authorized identity instead of assuming this key is available.

## Connect and verify

Interactive SSH:

```sh
ssh -i ~/.ssh/salemax-mac-20261003 -o IdentitiesOnly=yes ubuntu@145.241.229.168
```

For a non-interactive read-only access check, run:

```sh
ssh -i ~/.ssh/salemax-mac-20261003 -o IdentitiesOnly=yes -o BatchMode=yes ubuntu@145.241.229.168 'hostname; readlink -f /opt/salemax/current; docker ps --format "{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}"; df -h /; systemctl is-active asterisk || true'
```

Confirm the hostname is exactly `carsqatar-prod-01`, resolve the current symlink on every task, review the service state, and recheck disk before builds or releases. The active app may use several Compose overlays recorded on the running container; `/opt/salemax/current` can point only to the base release. Do not assume `/opt/salemax/current/deploy/compose.yml` exists or replace the active chain with that file. For a release change, use its reviewed helper and inspect the running container's Compose input label under the production lock. Do not print or copy either environment file. SSH access permits read-only inspection. A production mutation still needs to be within the user's explicit task.

## Server paths and boundaries

| Path | Purpose | Rule |
| --- | --- | --- |
| `/opt/salemax/current` | Symlink to base release | Resolve before every operation; production is not a Git checkout, and app overlays may be additional Compose inputs. |
| `/opt/salemax/releases/` | Versioned release source | Retain releases; compare the live release with the reviewed source. |
| `/opt/salemax/shared/runtime.env` | Runtime settings and credentials | Secret file; never print or copy wholesale. |
| `/opt/salemax/shared/stack.env` | Compose/runtime configuration | Secret file; pass only to the documented Compose command. |
| `/opt/salemax/shared/` | Persistent data, media, backups, and rollback snapshots | Inspect only task-relevant paths; preserve customer data and newer writes. |
| `/opt/salemax/current/deploy/compose.yml` | Base release Compose file, when present | Verify the file exists; do not treat it as the complete live chain when app overlays are attached. |
| `/etc/nginx/sites-available/salemax` | Application virtual hosts and proxy configuration | Back up and validate before any authorized edit. |
| `/etc/letsencrypt/live/crm.salemax.qa/` | TLS certificate and private key | Never copy the private key. |

This host also runs CarsQatar services. Do not run broad Docker cleanup, volume pruning, `docker compose down`, or host-wide restarts for a 7Network task. Never restore an old database over newer customer writes.

## Source of truth and deployment

- [`DEPLOYMENT.md`](../DEPLOYMENT.md) is the chronological release record; check its newest entry and independently inspect the active release and running image.
- [`PRODUCTION_ACCESS.md`](PRODUCTION_ACCESS.md) describes the tracked Git/release process.
- [`skills/7network-production-change/SKILL.md`](../skills/7network-production-change/SKILL.md) is the required workflow for production access and changes.

Production releases can contain live-derived files that differ from Git. Never overwrite production with a whole local checkout or assume a Git push deployed code. For authorized changes, make a targeted backup under `/opt/salemax/shared/`, use the established release process, apply only reviewed migrations/services, verify the exact live behavior, and record source/release hashes, rollback steps, health and open gates in `DEPLOYMENT.md`. Keep credentials, sessions, runtime files, customer data, media, and backups out of Git.
