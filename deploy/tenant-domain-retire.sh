#!/usr/bin/env bash
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then echo 'Run with sudo.' >&2; exit 2; fi
host=${1:-}
if [[ ! $host =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] || [[ $host == *.salemax.qa ]] || [[ $host == salemax.qa ]]; then echo 'Invalid or reserved CRM hostname.' >&2; exit 2; fi
root=/opt/salemax; current=$(readlink -f "$root/current")
compose=(docker compose -p salemax --env-file "$root/shared/stack.env" -f "$root/current/deploy/compose.yml")
"${compose[@]}" exec -T app node - "$host" <<'NODE'
const dns=require('node:dns').promises;
const host=process.argv[2];
(async()=>{const pool=require('/app/database/config').promise();try{const [[row]]=await pool.query('SELECT status FROM sx_tenant_crm_domains WHERE hostname=? LIMIT 1',[host]);if(!row||row.status!=='disabled')throw Error('DOMAIN_MUST_BE_DISABLED');let aliases=[];try{aliases=await dns.resolveCname(host);}catch(e){if(!['ENODATA','ENOTFOUND','ESERVFAIL'].includes(e.code))throw e;}if(aliases.map(x=>x.replace(/\.$/,'').toLowerCase()).includes('crm.salemax.qa'))throw Error('REMOVE_CUSTOMER_CNAME_FIRST');console.log(JSON.stringify({hostname:host,status:row.status,dnsNoLongerPointsToSaleMaX:true}));}finally{await pool.end();}})().catch(e=>{console.error(JSON.stringify({success:false,code:e.message||'DOMAIN_RETIRE_BLOCKED'}));process.exitCode=1;});
NODE
site="/etc/nginx/sites-available/salemax-tenant-${host}"; enabled="/etc/nginx/sites-enabled/salemax-tenant-${host}"
[[ -L $enabled && $(readlink -f "$enabled") == "$site" ]] || { echo 'Managed Nginx tenant site was not found.' >&2; exit 2; }
rm "$enabled"; rm -f "$site"; nginx -t; systemctl reload nginx
certbot delete --non-interactive --cert-name "salemax-${host}"
echo "Retired tenant CRM hostname and certificate: ${host}"
