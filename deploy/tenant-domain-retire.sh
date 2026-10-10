#!/usr/bin/env bash
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then echo 'Run with sudo.' >&2; exit 2; fi
host=${1:-}
if [[ ! $host =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] || [[ $host == *.salemax.qa ]] || [[ $host == salemax.qa ]]; then
  echo 'Invalid or reserved CRM hostname.' >&2; exit 2
fi
root=/opt/salemax
current=$(readlink -f "$root/current")
[[ -f "$current/scripts/tenant-crm-domain-ops.cjs" ]] || { echo 'Active release is incomplete.' >&2; exit 2; }
exec 9>"/run/lock/salemax-tenant-domain-retire-${host}.lock"
flock -n 9 || { echo 'Retirement is already running for this hostname.' >&2; exit 2; }
compose=(docker compose -p salemax --env-file "$root/shared/stack.env" -f "$root/current/deploy/compose.yml")
"${compose[@]}" exec -T app node /app/scripts/tenant-crm-domain-ops.cjs check-retire "$host"

site="/etc/nginx/sites-available/salemax-tenant-${host}"
enabled="/etc/nginx/sites-enabled/salemax-tenant-${host}"
cert_name="salemax-${host}"
cert_dir="/etc/letsencrypt/live/${cert_name}"
cert_ref="/etc/letsencrypt/live/${cert_name}/"
if [[ -e $site ]]; then
  [[ -f $site && ! -L $site ]] || { echo 'Refusing to remove a non-regular managed site file.' >&2; exit 2; }
  grep -Fqx "# SaleMaX managed tenant CRM host: ${host}" "$site" || { echo 'Refusing to remove an unrelated Nginx site.' >&2; exit 2; }
  grep -Fq "$cert_ref" "$site" || { echo 'Managed Nginx site does not reference its expected certificate.' >&2; exit 2; }
fi
if [[ -e $enabled || -L $enabled ]]; then
  [[ -L $enabled && $(readlink -f "$enabled" || true) == "$site" ]] || { echo 'Refusing to remove an unrelated Nginx site entry.' >&2; exit 2; }
fi
if [[ -d $cert_dir ]]; then
  mapfile -t references < <(grep -RFl -- "$cert_ref" /etc/nginx 2>/dev/null || true)
  for reference in "${references[@]}"; do
    [[ $reference == "$site" || $reference == "$enabled" ]] || { echo 'Certificate is referenced by another Nginx configuration.' >&2; exit 2; }
  done
fi

backup=$(mktemp -d "$root/shared/domain-retirement-${host}-XXXXXXXX")
chmod 0700 "$backup"
if [[ -f $site ]]; then cp -a "$site" "$backup/site.conf"; fi
if [[ -L $enabled ]]; then cp -a "$enabled" "$backup/site-enabled"; fi
chmod 0700 "$backup"

restore_nginx() {
  if [[ -f $backup/site.conf ]]; then cp -a "$backup/site.conf" "$site"; fi
  if [[ -L $backup/site-enabled ]]; then cp -a "$backup/site-enabled" "$enabled"; fi
  nginx -t && systemctl reload nginx || true
}
if [[ -L $enabled ]]; then rm "$enabled"; fi
if [[ -f $site ]]; then rm "$site"; fi
if ! nginx -t; then restore_nginx; exit 1; fi
if ! systemctl reload nginx; then restore_nginx; exit 1; fi

if [[ -d $cert_dir ]]; then
  certbot delete --non-interactive --cert-name "$cert_name"
fi
printf 'Tenant CRM domain retired: %s\nProtected cleanup record: %s\n' "$host" "$backup"
