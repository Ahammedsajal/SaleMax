#!/usr/bin/env bash
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then echo 'Run with sudo.' >&2; exit 2; fi
host=${1:-}
if [[ ! $host =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] || [[ $host == *.salemax.qa ]] || [[ $host == salemax.qa ]]; then
  echo 'Invalid or reserved CRM hostname.' >&2; exit 2
fi
root=/opt/salemax
current=$(readlink -f "$root/current")
[[ -f "$current/scripts/tenant-crm-domain-ops.cjs" && -f "$current/deploy/nginx-https.conf" ]] || { echo 'Active release is incomplete.' >&2; exit 2; }
compose=(docker compose -p salemax --env-file "$root/shared/stack.env" -f "$root/current/deploy/compose.yml")
"${compose[@]}" exec -T app node /app/scripts/tenant-crm-domain-ops.cjs check "$host"
webroot=/var/www/salemax-acme
mkdir -p "$webroot/.well-known/acme-challenge"
site="/etc/nginx/sites-available/salemax-tenant-${host}"
enabled="/etc/nginx/sites-enabled/salemax-tenant-${host}"
temporary=$(mktemp)
backup=$(mktemp)
had_site=0
if [[ -e $site ]]; then cp -a "$site" "$backup"; had_site=1; fi
restore() {
  if [[ -f $backup && $had_site -eq 1 ]]; then cp -a "$backup" "$site"; else rm -f "$site"; fi
  if [[ $had_site -eq 0 ]]; then rm -f "$enabled"; fi
  nginx -t && systemctl reload nginx || true
  rm -f "$temporary" "$backup"
}
trap restore ERR
cat > "$temporary" <<EOF
# SaleMaX managed tenant CRM host: ${host}
server {
    listen 80;
    listen [::]:80;
    server_name ${host};
    location ^~ /.well-known/acme-challenge/ { root ${webroot}; }
    location / { return 404; }
}
EOF
if [[ $had_site -eq 1 ]] && ! grep -Fq "# SaleMaX managed tenant CRM host: ${host}" "$site"; then
  echo 'Refusing to replace an unrelated Nginx site file.' >&2; exit 2
fi
if [[ -e $enabled && ! -L $enabled ]]; then echo 'Refusing to replace a non-symlink Nginx site entry.' >&2; exit 2; fi
if [[ -L $enabled ]]; then
  target=$(readlink -f "$enabled" || true)
  if [[ $target != "$site" ]]; then echo 'Refusing to replace an unrelated Nginx site entry.' >&2; exit 2; fi
fi
cp "$temporary" "$site"
ln -sfn "$site" "$enabled"
if ! nginx -t; then restore; exit 1; fi
systemctl reload nginx
if ! certbot certonly --non-interactive --agree-tos --register-unsafely-without-email --webroot -w "$webroot" -d "$host" --cert-name "salemax-${host}"; then restore; exit 1; fi
cert="/etc/letsencrypt/live/salemax-${host}"
[[ -s "$cert/fullchain.pem" && -s "$cert/privkey.pem" ]] || { restore; echo 'TLS certificate files are missing.' >&2; exit 1; }
cat > "$temporary" <<EOF
# SaleMaX managed tenant CRM host: ${host}
server {
    listen 80;
    listen [::]:80;
    server_name ${host};
    location ^~ /.well-known/acme-challenge/ { root ${webroot}; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${host};
    ssl_certificate ${cert}/fullchain.pem;
    ssl_certificate_key ${cert}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    client_max_body_size 50m;
    location ^~ /api/user/training/courses/ {
        client_max_body_size 1025m;
        client_body_timeout 3600s;
        proxy_request_buffering off;
        proxy_pass http://127.0.0.1:3011;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_send_timeout 3600s;
        proxy_read_timeout 120s;
    }
    location / {
        proxy_pass http://127.0.0.1:3011;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }
}
EOF
cp "$temporary" "$site"
if ! nginx -t; then restore; exit 1; fi
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
hook=/etc/letsencrypt/renewal-hooks/deploy/30-salemax-nginx-reload.sh
if [[ -e $hook ]] && ! cmp -s "$current/deploy/reload-nginx-after-renewal.sh" "$hook"; then
  restore; echo 'An existing different renewal hook needs operator review.' >&2; exit 1
fi
if [[ ! -e $hook ]]; then install -m 0755 "$current/deploy/reload-nginx-after-renewal.sh" "$hook"; fi
systemctl reload nginx
trap - ERR
if ! "${compose[@]}" exec -T app node /app/scripts/tenant-crm-domain-ops.cjs activate-tls "$host"; then
  echo 'TLS proxy is installed; tenant routing remains closed until the verified activation command succeeds.' >&2
  exit 1
fi
rm -f "$temporary" "$backup"
echo "Tenant CRM hostname activated: ${host}"
