#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run as root.' >&2; exit 2; }
[[ $(hostname) == carsqatar-prod-01 ]] || { echo 'Unexpected host; refusing domain provisioning.' >&2; exit 2; }
root=/opt/salemax
release=$(readlink -f "$root/current")
[[ -x "$release/deploy/tenant-domain-provision.sh" && -s "$release/deploy/compose.yml" ]] || { echo 'Active release is incomplete.' >&2; exit 2; }
exec 9>/run/lock/salemax-verified-tenant-domains.lock
flock -n 9 || exit 0
domains=$(docker exec salemax-app-1 node /app/scripts/tenant-crm-domain-ops.cjs list-verified)
while IFS= read -r host; do
  [[ -n "$host" ]] || continue
  [[ "$host" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] || { echo 'Invalid verified hostname returned; skipping.' >&2; continue; }
  if ! "$release/deploy/tenant-domain-provision.sh" "$host"; then
    echo "Automated HTTPS provisioning remains pending for ${host}." >&2
  fi
done <<< "$domains"
