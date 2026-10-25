#!/usr/bin/env bash
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then echo 'Run with sudo.' >&2; exit 2; fi
release=$(readlink -f /opt/salemax/current)
for file in tenant-domain-dns-audit.service tenant-domain-dns-audit.timer; do
  [[ -s "$release/deploy/$file" ]] || { echo "Missing managed unit: $file" >&2; exit 2; }
done
install -m 0644 "$release/deploy/tenant-domain-dns-audit.service" /etc/systemd/system/tenant-domain-dns-audit.service
install -m 0644 "$release/deploy/tenant-domain-dns-audit.timer" /etc/systemd/system/tenant-domain-dns-audit.timer
systemctl daemon-reload
systemctl enable --now tenant-domain-dns-audit.timer
systemctl status --no-pager tenant-domain-dns-audit.timer
