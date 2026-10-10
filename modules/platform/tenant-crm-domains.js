'use strict';
const crypto=require('node:crypto');
const dns=require('node:dns').promises;
const {domainToASCII}=require('node:url');
const {parse:parseDomain}=require('tldts');
const uuid=()=>crypto.randomUUID();
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const ROOT_HOST='crm.salemax.qa';
const DNS_CHECK_COOLDOWN_SECONDS=30;
function normalizeHostname(value){
  if(typeof value!=='string'||value.length>253||value!==value.trim()||/[\s/@:#\\]/.test(value))fail('INVALID_HOSTNAME');
  const hostname=domainToASCII(value.replace(/\.$/,'').toLowerCase());
  if(!hostname||hostname.length>253||hostname===ROOT_HOST||hostname==='salemax.qa'||hostname.endsWith('.salemax.qa')||!hostname.includes('.'))fail('HOSTNAME_NOT_ALLOWED');
  const labels=hostname.split('.');
  if(labels.some(label=>!label||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname))fail('INVALID_HOSTNAME');
  const parsed=parseDomain(hostname,{allowPrivateDomains:true});
  if(parsed.isIp||!parsed.domain||!parsed.subdomain)fail('HOSTNAME_MUST_BE_SUBDOMAIN');
  return hostname;
}
function requestHost(req){try{return normalizeHostname(String(req.get('host')||'').replace(/:\d+$/,''));}catch{return null;}}
async function findHost(db,hostname){if(!hostname||hostname===ROOT_HOST)return null;const [[row]]=await db.query(`SELECT d.tenant_id AS tenantId,d.status,d.tls_ready_at AS tlsReadyAt,d.dns_health_status AS dnsHealthStatus,t.status AS tenantStatus
  FROM sx_tenant_crm_domains d JOIN sx_tenants t ON t.id=d.tenant_id WHERE d.hostname=? LIMIT 1`,[hostname]);return row||null;}
function middleware(pool){return async function tenantCrmHost(req,res,next){
  const host=requestHost(req);if(!host||host===ROOT_HOST)return next();
  let db;
  try{db=await pool.getConnection();const row=await findHost(db,host);db.release();db=null;
    if(!row)return next();
    if(row.status!=='active'||!row.tlsReadyAt||row.tenantStatus!=='active'||row.dnsHealthStatus==='stale')return res.status(410).type('text').send('This CRM domain is not active.');
    req.crmTenantDomain={hostname:host,tenantId:row.tenantId};
    const path=req.path||'/';
    const crmRoute=path==='/user'||path.startsWith('/user/')||path==='/agent'||path.startsWith('/agent/')||
      ['/api/user/','/api/agent/','/api/inbox/','/api/phonebook/','/api/chat_flow/','/api/templet/','/api/chatbot/','/api/broadcast/','/api/qr/','/api/ai/','/api/wa_call/','/api/pipeline/','/api/crm/'].some(prefix=>path.startsWith(prefix))||
      path==='/socket.io'||path.startsWith('/socket.io/');
    const asset=/\.(?:js|css|png|jpe?g|webp|ico|svg|woff2?|ttf|map|json|txt|pdf|mp4|webm|mp3|wav)$/i.test(path)&&req.method==='GET';
    if(!crmRoute&&!asset)return res.status(404).end();
    return next();
  }catch(error){if(db)db.release();if(error.code==='ER_NO_SUCH_TABLE')return next();return res.status(503).json({success:false,code:'DOMAIN_ROUTING_UNAVAILABLE'});}
};}
async function assertTenantHost(db,req,tenantId){
  if(!req.crmTenantDomain)return true;
  if(req.crmTenantDomain.tenantId!==tenantId)fail('CRM_DOMAIN_TENANT_MISMATCH',403);
  const row=await findHost(db,req.crmTenantDomain.hostname);
  if(!row||row.status!=='active'||!row.tlsReadyAt||row.tenantId!==tenantId||row.tenantStatus!=='active'||row.dnsHealthStatus==='stale')fail('CRM_DOMAIN_INACTIVE',403);
  return true;
}
async function assertLegacyHost(query,req,sourceTable,sourceId){
  if(!req.crmTenantDomain)return true;
  const rows=await query(`SELECT o.tenant_id AS tenantId,m.status AS membershipStatus,m.role,t.status AS tenantStatus,i.status AS identityStatus,
      d.status AS domainStatus,d.tls_ready_at AS tlsReadyAt,d.dns_health_status AS dnsHealthStatus
    FROM sx_legacy_ownership o JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id
    JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_identities i ON i.id=m.identity_id
    JOIN sx_tenant_crm_domains d ON d.tenant_id=o.tenant_id AND d.hostname=?
    WHERE o.source_table=? AND o.source_id=? LIMIT 2`,[req.crmTenantDomain.hostname,sourceTable,String(sourceId)]);
  const roles=sourceTable==='agents'?['agent']:['owner','manager','accountant'];
  if(rows.length!==1||rows[0].tenantId!==req.crmTenantDomain.tenantId||rows[0].membershipStatus!=='active'||rows[0].tenantStatus!=='active'||rows[0].identityStatus!=='active'||rows[0].domainStatus!=='active'||!rows[0].tlsReadyAt||rows[0].dnsHealthStatus==='stale'||!roles.includes(rows[0].role))fail('CRM_DOMAIN_TENANT_MISMATCH',403);
  return true;
}
function owner(ctx){if(ctx?.audience!=='tenant'||ctx.membership?.role!=='owner'||ctx.tenant?.id!==ctx.membership.tenantId)fail('PERMISSION_DENIED',403);}
function audit(db,ctx,action,resourceType,resourceId,changes){return db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
 VALUES (?,?,?,'identity',?,?,?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,action,resourceType,resourceId,JSON.stringify(changes),uuid()]);}
function systemAudit(db,tenantId,action,resourceId,changes){return db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,'system',?,'tenant-crm-domain',?,?,?)`,[uuid(),tenantId,action,resourceId,JSON.stringify(changes),uuid()]);}
async function getSettings(db,ctx){owner(ctx);const [[domain]]=await db.query(`SELECT id,hostname,status,dns_health_status AS dnsHealthStatus,dns_last_checked_at AS dnsLastCheckedAt,ownership_verified_at AS ownershipVerifiedAt,cname_verified_at AS cnameVerifiedAt,tls_ready_at AS tlsReadyAt,verification_expires_at AS verificationExpiresAt,created_at AS createdAt FROM sx_tenant_crm_domains WHERE tenant_id=? AND status IN ('pending','verified','active') LIMIT 1`,[ctx.tenant.id]);const [[branding]]=await db.query('SELECT logo_url AS logoUrl,revision,updated_at AS updatedAt FROM sx_tenant_crm_branding WHERE tenant_id=?',[ctx.tenant.id]);return {domain:domain?{...domain,revision:Number(branding?.revision||0)}:null,branding:branding||{logoUrl:'',revision:0},cnameTarget:ROOT_HOST};}
async function getBranding(db,ctx){if(ctx?.audience!=='tenant'||ctx.tenant?.id!==ctx.membership?.tenantId||ctx.membership?.status!=='active')fail('PERMISSION_DENIED',403);const [[branding]]=await db.query('SELECT logo_url AS logoUrl,revision FROM sx_tenant_crm_branding WHERE tenant_id=?',[ctx.tenant.id]);return {logoUrl:branding?.logoUrl||'',revision:Number(branding?.revision||0)};}
async function requestDomain(db,ctx,input){
  owner(ctx);const hostname=normalizeHostname(input?.hostname);await db.beginTransaction();
  try{await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[ctx.tenant.id]);const [current]=await db.query("SELECT id FROM sx_tenant_crm_domains WHERE tenant_id=? AND status IN ('pending','verified','active') FOR UPDATE",[ctx.tenant.id]);if(current.length)fail('DOMAIN_ALREADY_CONFIGURED',409);
  const [[existing]]=await db.query('SELECT id,tenant_id AS tenantId FROM sx_tenant_crm_domains WHERE hostname=? FOR UPDATE',[hostname]);if(existing&&existing.tenantId!==ctx.tenant.id)fail('HOSTNAME_ALREADY_CLAIMED',409);
  const id=existing?.id||uuid(),token=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(token).digest('hex');
  try{if(existing)await db.query(`UPDATE sx_tenant_crm_domains SET active_tenant_id=?,status='pending',verification_token_hash=?,verification_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),dns_check_after=NULL,dns_health_status='unknown',dns_last_checked_at=NULL,ownership_verified_at=NULL,cname_verified_at=NULL,tls_ready_at=NULL,created_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND tenant_id=?`,[ctx.tenant.id,hash,ctx.identity.id,id,ctx.tenant.id]);else await db.query(`INSERT INTO sx_tenant_crm_domains(id,tenant_id,hostname,active_tenant_id,status,verification_token_hash,verification_expires_at,created_by_identity_id) VALUES (?,?,?,?,'pending',?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),?)`,[id,ctx.tenant.id,hostname,ctx.tenant.id,hash,ctx.identity.id]);}
  catch(error){if(error.code==='ER_DUP_ENTRY')fail('HOSTNAME_ALREADY_CLAIMED',409);throw error;}
  await audit(db,ctx,'tenant.crm-domain.verification-requested','tenant-crm-domain',id,{hostname});await db.commit();
  return {id,hostname,status:'pending',txtName:`_salemax-verification.${hostname}`,txtValue:`salemax-domain-verification=${token}`,cnameName:hostname,cnameTarget:ROOT_HOST,expiresInHours:24};
  }catch(error){await db.rollback();throw error;}
}
async function rotateDomainChallenge(db,ctx,id){owner(ctx);if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))fail('INVALID_DOMAIN_ID');const token=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(token).digest('hex');await db.beginTransaction();try{const [[row]]=await db.query("SELECT id,hostname,status FROM sx_tenant_crm_domains WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE",[ctx.tenant.id,id]);if(!row)fail('DOMAIN_NOT_FOUND',404);if(row.status!=='pending')fail('DOMAIN_NOT_PENDING',409);await db.query("UPDATE sx_tenant_crm_domains SET verification_token_hash=?,verification_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),dns_check_after=NULL,dns_health_status='unknown',dns_last_checked_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status='pending'",[hash,ctx.tenant.id,id]);await audit(db,ctx,'tenant.crm-domain.challenge-rotated','tenant-crm-domain',id,{hostname:row.hostname});await db.commit();return {id,hostname:row.hostname,status:'pending',txtName:`_salemax-verification.${row.hostname}`,txtValue:`salemax-domain-verification=${token}`,cnameName:row.hostname,cnameTarget:ROOT_HOST,expiresInHours:24};}catch(error){await db.rollback();throw error;}}
async function checkDnsRecords({hostname,tokenHash},{resolveTxt=dns.resolveTxt,resolveCname=dns.resolveCname}={}){
  let txt=[],cnames=[];try{txt=(await resolveTxt(`_salemax-verification.${hostname}`)).map(parts=>parts.join(''));}catch{}
  const actual=txt.find(value=>value.startsWith('salemax-domain-verification='))?.slice('salemax-domain-verification='.length);
  const actualHash=actual?crypto.createHash('sha256').update(actual).digest('hex'):'';
  const txtOk=!!actualHash&&crypto.timingSafeEqual(Buffer.from(actualHash),Buffer.from(tokenHash));
  try{cnames=(await resolveCname(hostname)).map(value=>value.replace(/\.$/,'').toLowerCase());}catch{}
  const cnameOk=cnames.includes(ROOT_HOST);return {healthy:txtOk&&cnameOk,txtOk,cnameOk};
}
async function verifyDomain(db,ctx,id,{resolveTxt=dns.resolveTxt,resolveCname=dns.resolveCname}={}){
  owner(ctx);if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))fail('INVALID_DOMAIN_ID');
  await db.beginTransaction();let row;try{const [[locked]]=await db.query('SELECT id,tenant_id AS tenantId,hostname,status,verification_token_hash AS tokenHash,dns_health_status AS dnsHealthStatus,(verification_expires_at>UTC_TIMESTAMP(3)) AS validChallenge,(dns_check_after IS NULL OR dns_check_after<=UTC_TIMESTAMP(3)) AS canCheck FROM sx_tenant_crm_domains WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE',[ctx.tenant.id,id]);row=locked;if(!row)fail('DOMAIN_NOT_FOUND',404);if(!['pending','active'].includes(row.status)||(row.status==='pending'&&!Number(row.validChallenge)))fail('DOMAIN_CHALLENGE_EXPIRED',409);if(!Number(row.canCheck))fail('DOMAIN_DNS_RATE_LIMITED',429);await db.query(`UPDATE sx_tenant_crm_domains SET dns_check_after=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ${DNS_CHECK_COOLDOWN_SECONDS} SECOND),updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status IN ('pending','active')`,[ctx.tenant.id,id]);await db.commit();}catch(error){await db.rollback();throw error;}
  const records=await checkDnsRecords(row,{resolveTxt,resolveCname});
  await db.beginTransaction();try{const [[current]]=await db.query('SELECT status,verification_token_hash AS tokenHash,dns_health_status AS dnsHealthStatus,(verification_expires_at>UTC_TIMESTAMP(3)) AS validChallenge FROM sx_tenant_crm_domains WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);if(!current||!['pending','active'].includes(current.status)||current.tokenHash!==row.tokenHash)fail('DOMAIN_CHALLENGE_CHANGED',409);if(current.status==='pending'&&!Number(current.validChallenge))fail('DOMAIN_CHALLENGE_EXPIRED',409);
    if(!records.healthy){await db.query("UPDATE sx_tenant_crm_domains SET dns_health_status='stale',dns_last_checked_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",[ctx.tenant.id,id]);if(current.dnsHealthStatus!=='stale')await systemAudit(db,ctx.tenant.id,'tenant.crm-domain.dns-stale',id,{hostname:row.hostname,txtOk:records.txtOk,cnameOk:records.cnameOk});await db.commit();fail(records.txtOk?'DOMAIN_CNAME_NOT_VERIFIED':'DOMAIN_TXT_NOT_VERIFIED',409);}
    if(current.status==='pending'){await db.query("UPDATE sx_tenant_crm_domains SET status='verified',dns_check_after=NULL,dns_health_status='healthy',dns_last_checked_at=UTC_TIMESTAMP(3),ownership_verified_at=UTC_TIMESTAMP(3),cname_verified_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND tenant_id=? AND status='pending'",[id,ctx.tenant.id]);await audit(db,ctx,'tenant.crm-domain.dns-verified','tenant-crm-domain',id,{hostname:row.hostname,tlsReady:false});}
    else{await db.query("UPDATE sx_tenant_crm_domains SET dns_check_after=NULL,dns_health_status='healthy',dns_last_checked_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND tenant_id=? AND status='active'",[id,ctx.tenant.id]);if(current.dnsHealthStatus==='stale')await systemAudit(db,ctx.tenant.id,'tenant.crm-domain.dns-restored',id,{hostname:row.hostname});}
    await db.commit();return current.status==='active'?{id,hostname:row.hostname,status:'active',dnsHealthy:true,message:'DNS ownership and CRM routing are healthy.'}:{id,hostname:row.hostname,status:'verified',dnsHealthy:true,tlsReady:false,message:'DNS ownership and CNAME are verified. HTTPS setup is queued for SaleMaX operations.'};
  }catch(error){if(error.code==='DOMAIN_TXT_NOT_VERIFIED'||error.code==='DOMAIN_CNAME_NOT_VERIFIED'){throw error;}await db.rollback();throw error;}
}
async function removeDomain(db,ctx,id){owner(ctx);if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))fail('INVALID_DOMAIN_ID');await db.beginTransaction();try{await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[ctx.tenant.id]);const [[row]]=await db.query('SELECT id,hostname,status FROM sx_tenant_crm_domains WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',[id,ctx.tenant.id]);if(!row)fail('DOMAIN_NOT_FOUND',404);await db.query(`UPDATE sx_tenant_crm_domains SET active_tenant_id=NULL,status='disabled',updated_at=UTC_TIMESTAMP(3) WHERE id=? AND tenant_id=?`,[id,ctx.tenant.id]);await audit(db,ctx,'tenant.crm-domain.disabled','tenant-crm-domain',id,{hostname:row.hostname,previousStatus:row.status});await db.commit();return {id,hostname:row.hostname,status:'disabled'};}catch(error){await db.rollback();throw error;}}
async function activateAfterTls(db,hostname,{resolveTxt=dns.resolveTxt,resolveCname=dns.resolveCname}={}){
 hostname=normalizeHostname(hostname);const [[initial]]=await db.query("SELECT id,tenant_id AS tenantId,status,verification_token_hash AS tokenHash FROM sx_tenant_crm_domains WHERE hostname=? LIMIT 1",[hostname]);if(!initial||initial.status!=='verified')fail('DOMAIN_NOT_READY_FOR_TLS',409);const records=await checkDnsRecords({hostname,tokenHash:initial.tokenHash},{resolveTxt,resolveCname});if(!records.healthy)fail(records.txtOk?'DOMAIN_CNAME_NOT_VERIFIED':'DOMAIN_TXT_NOT_VERIFIED',409);await db.beginTransaction();try{const [[row]]=await db.query("SELECT id,tenant_id AS tenantId,status,verification_token_hash AS tokenHash FROM sx_tenant_crm_domains WHERE hostname=? LIMIT 1 FOR UPDATE",[hostname]);if(!row||row.status!=='verified'||row.tokenHash!==initial.tokenHash)fail('DOMAIN_NOT_READY_FOR_TLS',409);await db.query("UPDATE sx_tenant_crm_domains SET status='active',dns_health_status='healthy',dns_last_checked_at=UTC_TIMESTAMP(3),tls_ready_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='verified'",[row.id]);await systemAudit(db,row.tenantId,'tenant.crm-domain.https-activated',row.id,{hostname});await db.commit();return {hostname,status:'active'};}catch(error){await db.rollback();throw error;}
}
async function assertRetiredForOps(db,hostname,{resolveCname=dns.resolveCname}={}){hostname=normalizeHostname(hostname);const [[row]]=await db.query('SELECT status FROM sx_tenant_crm_domains WHERE hostname=? LIMIT 1',[hostname]);if(!row)fail('DOMAIN_NOT_FOUND',404);if(row.status!=='disabled')fail('DOMAIN_MUST_BE_DISABLED',409);let cnames=[];try{cnames=await resolveCname(hostname);}catch(error){if(!['ENODATA','ENOTFOUND'].includes(error.code))fail('DOMAIN_DNS_REMOVAL_UNVERIFIED',503);}if(cnames.some(value=>value.replace(/\.$/,'').toLowerCase()===ROOT_HOST))fail('DOMAIN_DNS_STILL_POINTS_TO_SALEMAX',409);return {hostname,status:'disabled',saleMaxCnameAbsent:true};}
async function auditActiveDns(db,{resolveTxt=dns.resolveTxt,resolveCname=dns.resolveCname}={}){const [rows]=await db.query("SELECT id,tenant_id AS tenantId,hostname,verification_token_hash AS tokenHash,dns_health_status AS dnsHealthStatus FROM sx_tenant_crm_domains WHERE status='active'");const results=[];for(const row of rows){const records=await checkDnsRecords(row,{resolveTxt,resolveCname}),next=records.healthy?'healthy':'stale';await db.beginTransaction();try{const [[current]]=await db.query("SELECT status,dns_health_status AS dnsHealthStatus FROM sx_tenant_crm_domains WHERE id=? FOR UPDATE",[row.id]);if(current?.status==='active'){await db.query('UPDATE sx_tenant_crm_domains SET dns_health_status=?,dns_last_checked_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status=\'active\'',[next,row.id]);if(current.dnsHealthStatus!==next)await systemAudit(db,row.tenantId,next==='stale'?'tenant.crm-domain.dns-stale':'tenant.crm-domain.dns-restored',row.id,{hostname:row.hostname,txtOk:records.txtOk,cnameOk:records.cnameOk});}await db.commit();results.push({hostname:row.hostname,status:current?.status==='active'?next:'not_active'});}catch(error){await db.rollback();throw error;}}return {checked:results.length,stale:results.filter(x=>x.status==='stale').length,results};}
async function publicBrand(db,hostname){const row=await findHost(db,hostname);if(!row||row.status!=='active'||!row.tlsReadyAt||row.tenantStatus!=='active'||row.dnsHealthStatus==='stale')return null;const [[brand]]=await db.query('SELECT logo_url AS logoUrl FROM sx_tenant_crm_branding WHERE tenant_id=?',[row.tenantId]);const [[tenant]]=await db.query('SELECT name FROM sx_tenants WHERE id=? AND status=\'active\'',[row.tenantId]);if(!tenant)return null;return {name:tenant.name,logoUrl:brand?.logoUrl||'',tenantId:row.tenantId};}
module.exports={ROOT_HOST,DNS_CHECK_COOLDOWN_SECONDS,normalizeHostname,requestHost,findHost,middleware,assertTenantHost,assertLegacyHost,getSettings,getBranding,requestDomain,rotateDomainChallenge,checkDnsRecords,verifyDomain,removeDomain,activateAfterTls,assertRetiredForOps,auditActiveDns,publicBrand};
