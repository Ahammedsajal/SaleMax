#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run as root.' >&2; exit 2; }
[[ $(hostname) == carsqatar-prod-01 ]] || { echo 'Unexpected host; refusing systemd installation.' >&2; exit 2; }
release=$(readlink -f /opt/salemax/current)
for file in tenant-domain-provision-verified.service tenant-domain-provision-verified.timer; do
  [[ -s "$release/deploy/$file" ]] || { echo "Missing managed unit: $file" >&2; exit 2; }
done
install -m 0644 "$release/deploy/tenant-domain-provision-verified.service" /etc/systemd/system/tenant-domain-provision-verified.service
install -m 0644 "$release/deploy/tenant-domain-provision-verified.timer" /etc/systemd/system/tenant-domain-provision-verified.timer
systemctl daemon-reload
systemctl enable --now tenant-domain-provision-verified.timer
systemctl status --no-pager tenant-domain-provision-verified.timer
