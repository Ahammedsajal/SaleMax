#!/bin/bash
set -euo pipefail
exec 9>/run/salemax-https.lock
flock -n 9 || exit 0
if ! python3 - <<'PY'
import socket, sys
try:
    addresses = {a[4][0] for a in socket.getaddrinfo('crm.salemax.qa', 80, socket.AF_INET)}
except socket.gaierror:
    sys.exit(1)
sys.exit(0 if addresses == {'145.241.229.168'} else 1)
PY
then
    echo 'Waiting for crm.salemax.qa A record to point to this server.'
    exit 0
fi
if ! test -s /etc/letsencrypt/live/crm.salemax.qa/fullchain.pem; then
    certbot certonly --non-interactive --agree-tos --webroot -w /var/www/salemax-acme -d crm.salemax.qa --cert-name crm.salemax.qa
fi
cp /opt/salemax/current/deploy/nginx-https.conf /etc/nginx/sites-available/salemax.new
# Validate before changing the active virtual host.
cp /etc/nginx/sites-available/salemax /etc/nginx/sites-available/salemax.before-https
mv /etc/nginx/sites-available/salemax.new /etc/nginx/sites-available/salemax
if ! nginx -t; then
    cp /etc/nginx/sites-available/salemax.before-https /etc/nginx/sites-available/salemax
    exit 1
fi
systemctl reload nginx
systemctl disable --now salemax-https.timer
echo 'Trusted HTTPS activated for crm.salemax.qa.'
