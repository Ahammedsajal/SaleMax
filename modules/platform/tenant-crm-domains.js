'use strict';
const crypto=require('node:crypto');
const dns=require('node:dns').promises;
const {domainToASCII}=require('node:url');
const uuid=()=>crypto.randomUUID();
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const ROOT_HOST='crm.salemax.qa';
function normalizeHostname(value){
  if(typeof value!=='string'||value.length>253||value!==value.trim()||/[\s/@:#\\]/.test(value))fail('INVALID_HOSTNAME');
  const hostname=domainToASCII(value.replace(/\.$/,'').toLowerCase());
  if(!hostname||hostname.length>253||hostname===ROOT_HOST||hostname==='salemax.qa'||hostname.endsWith('.salemax.qa')||!hostname.includes('.'))fail('HOSTNAME_NOT_ALLOWED');
  const labels=hostname.split('.');
  if(labels.some(label=>!label||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname))fail('INVALID_HOSTNAME');
  return hostname;
}
function requestHost(req){try{return normalizeHostname(String(req.get('host')||'').replace(/:\d+$/,''));}catch{return null;}}
async function findHost(db,hostname){if(!hostname||hostname===ROOT_HOST)return null;const [[row]]=await db.query(`SELECT d.tenant_id AS tenantId,d.status,d.tls_ready_at AS tlsReadyAt
  FROM sx_tenant_crm_domains d WHERE d.hostname=? LIMIT 1`,[hostname]);return row||null;}
function middleware(pool){return async function tenantCrmHost(req,res,next){
  const host=requestHost(req);if(!host||host===ROOT_HOST)return next();
  let db;
  try{db=await pool.getConnection();const row=await findHost(db,host);db.release();db=null;
    if(!row)return next();
    if(row.status!=='active'||!row.tlsReadyAt)return res.status(410).type('text').send('This CRM domain is not active.');
    req.crmTenantDomain={hostname:host,tenantId:row.tenantId};
    const path=req.path||'/';
    const crmRoute=path==='/user'||path.startsWith('/user/')||path==='/agent'||path.startsWith('/agent/')||
      ['/api/user/','/api/agent/','/api/inbox/','/api/phonebook/','/api/chat_flow/','/api/templet/','/api/chatbot/','/api/broadcast/','/api/qr/','/api/ai/','/api/wa_call/','/api/pipeline/','/api/crm/'].some(prefix=>path.startsWith(prefix))||
      path==='/socket.io'||path.startsWith('/socket.io/')||path==='/healthz';
    const asset=/\.(?:js|css|png|jpe?g|webp|ico|svg|woff2?|ttf|map|json|txt|pdf|mp4|webm|mp3|wav)$/i.test(path)&&req.method==='GET';
    if(!crmRoute&&!asset)return res.status(404).end();
    return next();
  }catch(error){if(db)db.release();if(error.code==='ER_NO_SUCH_TABLE')return next();return res.status(503).json({success:false,code:'DOMAIN_ROUTING_UNAVAILABLE'});}
};}
async function assertTenantHost(db,req,tenantId){
  if(!req.crmTenantDomain)return true;
  if(req.crmTenantDomain.tenantId!==tenantId)fail('CRM_DOMAIN_TENANT_MISMATCH',403);
  const row=await findHost(db,req.crmTenantDomain.hostname);
  if(!row||row.status!=='active'||!row.tlsReadyAt||row.tenantId!==tenantId)fail('CRM_DOMAIN_INACTIVE',403);
  return true;
}
async function assertLegacyHost(query,req,sourceTable,sourceId){
  if(!req.crmTenantDomain)return true;
  const rows=await query(`SELECT tenant_id AS tenantId FROM sx_legacy_ownership WHERE source_table=? AND source_id=? LIMIT 2`,[sourceTable,String(sourceId)]);
  if(rows.length!==1||rows[0].tenantId!==req.crmTenantDomain.tenantId)fail('CRM_DOMAIN_TENANT_MISMATCH',403);
  return true;
}
function owner(ctx){if(ctx?.audience!=='tenant'||ctx.membership?.role!=='owner'||ctx.tenant?.id!==ctx.membership.tenantId)fail('PERMISSION_DENIED',403);}
function audit(db,ctx,action,resourceType,resourceId,changes){return db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
 VALUES (?,?,?,'identity',?,?,?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,action,resourceType,resourceId,JSON.stringify(changes),uuid()]);}
async function getSettings(db,ctx){owner(ctx);const [[domain]]=await db.query(`SELECT id,hostname,status,ownership_verified_at AS ownershipVerifiedAt,cname_verified_at AS cnameVerifiedAt,tls_ready_at AS tlsReadyAt,verification_expires_at AS verificationExpiresAt,created_at AS createdAt FROM sx_tenant_crm_domains WHERE tenant_id=? AND status IN ('pending','verified','active') LIMIT 1`,[ctx.tenant.id]);const [[branding]]=await db.query('SELECT logo_url AS logoUrl,revision,updated_at AS updatedAt FROM sx_tenant_crm_branding WHERE tenant_id=?',[ctx.tenant.id]);return {domain:domain?{...domain,revision:Number(branding?.revision||0)}:null,branding:branding||{logoUrl:'',revision:0},cnameTarget:ROOT_HOST};}
async function getBranding(db,ctx){if(ctx?.audience!=='tenant'||ctx.tenant?.id!==ctx.membership?.tenantId||ctx.membership?.status!=='active')fail('PERMISSION_DENIED',403);const [[branding]]=await db.query('SELECT logo_url AS logoUrl,revision FROM sx_tenant_crm_branding WHERE tenant_id=?',[ctx.tenant.id]);return {logoUrl:branding?.logoUrl||'',revision:Number(branding?.revision||0)};}
async function requestDomain(db,ctx,input){
  owner(ctx);const hostname=normalizeHostname(input?.hostname);await db.beginTransaction();
  try{await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[ctx.tenant.id]);const [current]=await db.query("SELECT id FROM sx_tenant_crm_domains WHERE tenant_id=? AND status IN ('pending','verified','active') FOR UPDATE",[ctx.tenant.id]);if(current.length)fail('DOMAIN_ALREADY_CONFIGURED',409);
  const [[existing]]=await db.query('SELECT id,tenant_id AS tenantId FROM sx_tenant_crm_domains WHERE hostname=? FOR UPDATE',[hostname]);if(existing&&existing.tenantId!==ctx.tenant.id)fail('HOSTNAME_ALREADY_CLAIMED',409);
  const id=existing?.id||uuid(),token=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(token).digest('hex');
  try{if(existing)await db.query(`UPDATE sx_tenant_crm_domains SET active_tenant_id=?,status='pending',verification_token_hash=?,verification_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),ownership_verified_at=NULL,cname_verified_at=NULL,tls_ready_at=NULL,created_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND tenant_id=?`,[ctx.tenant.id,hash,ctx.identity.id,id,ctx.tenant.id]);else await db.query(`INSERT INTO sx_tenant_crm_domains(id,tenant_id,hostname,active_tenant_id,status,verification_token_hash,verification_expires_at,created_by_identity_id) VALUES (?,?,?,?,'pending',?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),?)`,[id,ctx.tenant.id,hostname,ctx.tenant.id,hash,ctx.identity.id]);}
  catch(error){if(error.code==='ER_DUP_ENTRY')fail('HOSTNAME_ALREADY_CLAIMED',409);throw error;}
  await audit(db,ctx,'tenant.crm-domain.verification-requested','tenant-crm-domain',id,{hostname});await db.commit();
  return {id,hostname,status:'pending',txtName:`_salemax-verification.${hostname}`,txtValue:`salemax-domain-verification=${token}`,cnameName:hostname,cnameTarget:ROOT_HOST,expiresInHours:24};
  }catch(error){await db.rollback();throw error;}
}
async function rotateDomainChallenge(db,ctx,id){owner(ctx);if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))fail('INVALID_DOMAIN_ID');const token=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(token).digest('hex');await db.beginTransaction();try{const [[row]]=await db.query("SELECT id,hostname,status FROM sx_tenant_crm_domains WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE",[ctx.tenant.id,id]);if(!row)fail('DOMAIN_NOT_FOUND',404);if(row.status!=='pending')fail('DOMAIN_NOT_PENDING',409);await db.query('UPDATE sx_tenant_crm_domains SET verification_token_hash=?,verification_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status=\'pending\'',[hash,ctx.tenant.id,id]);await audit(db,ctx,'tenant.crm-domain.challenge-rotated','tenant-crm-domain',id,{hostname:row.hostname});await db.commit();return {id,hostname:row.hostname,status:'pending',txtName:`_salemax-verification.${row.hostname}`,txtValue:`salemax-domain-verification=${token}`,cnameName:row.hostname,cnameTarget:ROOT_HOST,expiresInHours:24};}catch(error){await db.rollback();throw error;}}
async function verifyDomain(db,ctx,id,{resolveTxt=dns.resolveTxt,resolveCname=dns.resolveCname}={}){
  owner(ctx);if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))fail('INVALID_DOMAIN_ID');
  const [[row]]=await db.query('SELECT id,tenant_id AS tenantId,hostname,status,verification_token_hash AS tokenHash,(verification_expires_at>UTC_TIMESTAMP(3)) AS validChallenge FROM sx_tenant_crm_domains WHERE tenant_id=? AND id=? LIMIT 1',[ctx.tenant.id,id]);
  if(!row)fail('DOMAIN_NOT_FOUND',404);if(row.status!=='pending'||!Number(row.validChallenge))fail('DOMAIN_CHALLENGE_EXPIRED',409);
  let txt=[],cnames=[];try{txt=(await resolveTxt(`_salemax-verification.${row.hostname}`)).map(parts=>parts.join(''));}catch(error){if(error.code!=='ENODATA'&&error.code!=='ENOTFOUND'&&error.code!=='ESERVFAIL')throw error;}
  const actual=txt.find(value=>value.startsWith('salemax-domain-verification='))?.slice('salemax-domain-verification='.length);
  const actualHash=actual?crypto.createHash('sha256').update(actual).digest('hex'):'';
  if(!actualHash||!crypto.timingSafeEqual(Buffer.from(actualHash),Buffer.from(row.tokenHash)))fail('DOMAIN_TXT_NOT_VERIFIED',409);
  try{cnames=(await resolveCname(row.hostname)).map(value=>value.replace(/\.$/,'').toLowerCase());}catch(error){if(error.code!=='ENODATA'&&error.code!=='ENOTFOUND'&&error.code!=='ESERVFAIL')throw error;}
  if(!cnames.includes(ROOT_HOST))fail('DOMAIN_CNAME_NOT_VERIFIED',409);
  await db.beginTransaction();try{const [[current]]=await db.query('SELECT status,verification_token_hash AS tokenHash,(verification_expires_at>UTC_TIMESTAMP(3)) AS validChallenge FROM sx_tenant_crm_domains WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);if(!current||current.status!=='pending'||!Number(current.validChallenge))fail('DOMAIN_CHALLENGE_EXPIRED',409);if(current.tokenHash!==row.tokenHash)fail('DOMAIN_CHALLENGE_CHANGED',409);const [updated]=await db.query(`UPDATE sx_tenant_crm_domains SET status='verified',ownership_verified_at=UTC_TIMESTAMP(3),cname_verified_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND tenant_id=? AND status='pending'`,[id,ctx.tenant.id]);if(updated.affectedRows!==1)fail('DOMAIN_CHALLENGE_CHANGED',409);await audit(db,ctx,'tenant.crm-domain.dns-verified','tenant-crm-domain',id,{hostname:row.hostname,tlsReady:false});await db.commit();}catch(error){await db.rollback();throw error;}
  return {id,hostname:row.hostname,status:'verified',tlsReady:false,message:'DNS ownership and CNAME are verified. HTTPS activation is now queued for SaleMaX operations.'};
}
async function removeDomain(db,ctx,id){owner(ctx);if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))fail('INVALID_DOMAIN_ID');await db.beginTransaction();try{await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[ctx.tenant.id]);const [[row]]=await db.query('SELECT id,hostname,status FROM sx_tenant_crm_domains WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',[id,ctx.tenant.id]);if(!row)fail('DOMAIN_NOT_FOUND',404);await db.query(`UPDATE sx_tenant_crm_domains SET active_tenant_id=NULL,status='disabled',updated_at=UTC_TIMESTAMP(3) WHERE id=? AND tenant_id=?`,[id,ctx.tenant.id]);await audit(db,ctx,'tenant.crm-domain.disabled','tenant-crm-domain',id,{hostname:row.hostname,previousStatus:row.status});await db.commit();return {id,hostname:row.hostname,status:'disabled'};}catch(error){await db.rollback();throw error;}}
async function activateAfterTls(db,hostname){
  hostname=normalizeHostname(hostname);await db.beginTransaction();try{const [[row]]=await db.query("SELECT id,tenant_id AS tenantId,status FROM sx_tenant_crm_domains WHERE hostname=? LIMIT 1 FOR UPDATE",[hostname]);if(!row||row.status!=='verified')fail('DOMAIN_NOT_READY_FOR_TLS',409);await db.query("UPDATE sx_tenant_crm_domains SET status='active',tls_ready_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='verified'",[row.id]);await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,'system','tenant.crm-domain.https-activated','tenant-crm-domain',?,?,?)`,[uuid(),row.tenantId,row.id,JSON.stringify({hostname}),uuid()]);await db.commit();return {hostname,status:'active'};}catch(error){await db.rollback();throw error;}
}
async function publicBrand(db,hostname){const row=await findHost(db,hostname);if(!row||row.status!=='active'||!row.tlsReadyAt)return null;const [[brand]]=await db.query('SELECT logo_url AS logoUrl FROM sx_tenant_crm_branding WHERE tenant_id=?',[row.tenantId]);const [[tenant]]=await db.query('SELECT name FROM sx_tenants WHERE id=? AND status=\'active\'',[row.tenantId]);if(!tenant)return null;return {name:tenant.name,logoUrl:brand?.logoUrl||'',tenantId:row.tenantId};}
module.exports={ROOT_HOST,normalizeHostname,requestHost,findHost,middleware,assertTenantHost,assertLegacyHost,getSettings,getBranding,requestDomain,rotateDomainChallenge,verifyDomain,removeDomain,activateAfterTls,publicBrand};
