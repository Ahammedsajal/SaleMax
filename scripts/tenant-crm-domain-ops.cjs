'use strict';
require('dotenv').config({quiet:true});
const domains=require('../modules/platform/tenant-crm-domains');
async function main(argv=process.argv.slice(2)){
 const [mode,rawHost,...extra]=argv;if(extra.length||!['check','activate-tls'].includes(mode))throw Object.assign(new Error('USAGE'),{code:'USAGE'});
 const hostname=domains.normalizeHostname(rawHost);const pool=require('../database/config').promise();const db=await pool.getConnection();
 try{
  if(mode==='check'){
   const [[row]]=await db.query('SELECT status,ownership_verified_at AS ownershipVerifiedAt,cname_verified_at AS cnameVerifiedAt FROM sx_tenant_crm_domains WHERE hostname=? LIMIT 1',[hostname]);
   if(!row||row.status!=='verified'||!row.ownershipVerifiedAt||!row.cnameVerifiedAt)throw Object.assign(new Error('DOMAIN_NOT_DNS_VERIFIED'),{code:'DOMAIN_NOT_DNS_VERIFIED'});
   console.log(JSON.stringify({hostname,status:row.status,dnsVerified:true}));return;
  }
  console.log(JSON.stringify(await domains.activateAfterTls(db,hostname)));
 }finally{db.release();await pool.end();}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({success:false,code:error.code||'DOMAIN_OPERATION_FAILED'}));process.exitCode=1;});
module.exports={main};
