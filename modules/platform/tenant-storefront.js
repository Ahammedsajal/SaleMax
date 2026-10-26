'use strict';
const crypto=require('node:crypto');
const businessProfile=require('./tenant-business-profile');
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
function owner(ctx){if(ctx?.audience!=='tenant'||ctx.membership?.role!=='owner'||ctx.tenant?.id!==ctx.membership.tenantId)fail('PERMISSION_DENIED',403);}
const uuid=()=>crypto.randomUUID();
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
function normalize(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_STOREFRONT');
  const color=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value.toLowerCase():null;
  const phone=clean(input.whatsappNumber,20).replace(/[\s()-]/g,'');
  if(phone&&!/^\+[1-9]\d{7,14}$/.test(phone))fail('INVALID_WHATSAPP_NUMBER');
  const email=clean(input.contactEmail,254);
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('INVALID_EMAIL');
  if(input.primaryColor&&!color(input.primaryColor)||input.accentColor&&!color(input.accentColor))fail('INVALID_BRAND_COLOR');
  return {version:1,headline:clean(input.headline,120),headlineAr:clean(input.headlineAr,120),tagline:clean(input.tagline,180),taglineAr:clean(input.taglineAr,180),description:clean(input.description,2000),descriptionAr:clean(input.descriptionAr,2000),about:clean(input.about,3000),aboutAr:clean(input.aboutAr,3000),contactPhone:clean(input.contactPhone,30),contactEmail:email,whatsappNumber:phone,primaryColor:color(input.primaryColor)||'#1768d4',accentColor:color(input.accentColor)||'#12c9f4',sections:Array.isArray(input.sections)?input.sections.slice(0,8).filter(x=>x&&['about','updates','events','courses','services','products','careers'].includes(x.type)).map(x=>({type:x.type,title:clean(x.title,100),titleAr:clean(x.titleAr,100),body:clean(x.body,1000),bodyAr:clean(x.bodyAr,1000)})):[]};
}
function parseJson(value,fallback=null){if(value==null)return fallback;try{return typeof value==='string'?JSON.parse(value):value;}catch{return fallback;}}
async function get(db,ctx){
  owner(ctx);
  const [[row]]=await db.query('SELECT enabled,draft_json AS draft,published_json AS published,revision,published_revision AS publishedRevision,published_at AS publishedAt FROM sx_tenant_storefronts WHERE tenant_id=?',[ctx.tenant.id]);
  if(!row||!Number(row.enabled))return {enabled:false,draft:null,published:null,revision:0,publishedRevision:null,publishedAt:null,history:[]};
  const [history]=await db.query('SELECT revision,published_at AS publishedAt,publication_type AS publicationType FROM sx_tenant_storefront_revisions WHERE tenant_id=? ORDER BY revision DESC LIMIT 20',[ctx.tenant.id]);
  return {enabled:true,draft:parseJson(row.draft,normalize({})),published:parseJson(row.published),revision:Number(row.revision||0),publishedRevision:row.publishedRevision==null?null:Number(row.publishedRevision),publishedAt:row.publishedAt||null,history};
}
async function lockEnabled(db,ctx){
  const [[row]]=await db.query('SELECT enabled,revision FROM sx_tenant_storefronts WHERE tenant_id=? FOR UPDATE',[ctx.tenant.id]);
  if(!row||!Number(row.enabled))fail('STOREFRONT_DISABLED',403);
  return row;
}
async function saveDraft(db,ctx,input){
  owner(ctx);const draft=normalize(input?.content),expected=Number(input?.expectedRevision);
  if(!Number.isSafeInteger(expected)||expected<0)fail('INVALID_REVISION');
  await db.beginTransaction();try{
    const row=await lockEnabled(db,ctx);if(expected!==Number(row.revision))fail('STALE_REVISION',409);
    const revision=expected+1;
    const [result]=await db.query('UPDATE sx_tenant_storefronts SET draft_json=?,revision=?,updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND enabled=1',[JSON.stringify(draft),revision,ctx.identity.id,ctx.tenant.id]);
    if(result.affectedRows!==1)fail('STOREFRONT_DISABLED',403);
    await audit(db,ctx,'tenant.storefront.draft-saved',revision);await db.commit();return {draft,revision};
  }catch(error){await db.rollback();throw error;}
}
async function publish(db,ctx,input){
  owner(ctx);const expected=Number(input?.expectedRevision);if(!Number.isSafeInteger(expected)||expected<1)fail('INVALID_REVISION');
  await db.beginTransaction();try{
    const row=await lockEnabled(db,ctx);
    const [[domain]]=await db.query("SELECT id FROM sx_tenant_crm_domains WHERE tenant_id=? AND status='active' AND is_primary=1 AND tls_ready_at IS NOT NULL AND dns_health_status='healthy' LIMIT 1 FOR UPDATE",[ctx.tenant.id]);
    if(!domain)fail('STOREFRONT_DOMAIN_REQUIRED',409);
    const [[current]]=await db.query('SELECT draft_json AS draft,published_json AS published,published_revision AS publishedRevision FROM sx_tenant_storefronts WHERE tenant_id=? AND enabled=1 FOR UPDATE',[ctx.tenant.id]);
    if(Number(row.revision)!==expected)fail('STALE_REVISION',409);
    const draft=parseJson(current?.draft);if(!draft)fail('STOREFRONT_DRAFT_REQUIRED',409);
    if(!draft.headline&&!draft.headlineAr&&!draft.tagline&&!draft.taglineAr&&!draft.description&&!draft.descriptionAr)fail('STOREFRONT_CONTENT_REQUIRED',409);
    if(current.published){const old=parseJson(current.published);await db.query("INSERT INTO sx_tenant_storefront_revisions(tenant_id,revision,content_json,publication_type,published_by_identity_id,published_at) VALUES (?,?,?,'publish',?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE content_json=VALUES(content_json),publication_type=VALUES(publication_type),published_by_identity_id=VALUES(published_by_identity_id),published_at=VALUES(published_at)",[ctx.tenant.id,Number(current.publishedRevision),JSON.stringify(old),ctx.identity.id]);}
    await db.query('UPDATE sx_tenant_storefronts SET published_json=draft_json,published_revision=revision,published_at=UTC_TIMESTAMP(3),updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND enabled=1',[ctx.identity.id,ctx.tenant.id]);
    await db.query("INSERT INTO sx_tenant_storefront_revisions(tenant_id,revision,content_json,publication_type,published_by_identity_id,published_at) VALUES (?,?,?,'publish',?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE content_json=VALUES(content_json),publication_type=VALUES(publication_type),published_by_identity_id=VALUES(published_by_identity_id),published_at=VALUES(published_at)",[ctx.tenant.id,expected,JSON.stringify(draft),ctx.identity.id]);
    await audit(db,ctx,'tenant.storefront.published',expected);await db.commit();return {published:true,revision:expected};
  }catch(error){await db.rollback();throw error;}
}
async function rollback(db,ctx){
  owner(ctx);await db.beginTransaction();try{
    const row=await lockEnabled(db,ctx);
    const [[current]]=await db.query('SELECT published_json AS published,published_revision AS publishedRevision FROM sx_tenant_storefronts WHERE tenant_id=? AND enabled=1 FOR UPDATE',[ctx.tenant.id]);
    if(!current?.published)fail('NO_PUBLISHED_STOREFRONT',409);
    const [[previous]]=await db.query('SELECT revision,content_json AS content FROM sx_tenant_storefront_revisions WHERE tenant_id=? AND revision<? ORDER BY revision DESC LIMIT 1 FOR UPDATE',[ctx.tenant.id,Number(current.publishedRevision)]);
    if(!previous)fail('NO_PREVIOUS_PUBLICATION',409);
    const content=parseJson(previous.content);if(!content)fail('INVALID_STOREFRONT_HISTORY',409);
    const revision=Number(row.revision)+1;
    await db.query('UPDATE sx_tenant_storefronts SET draft_json=?,published_json=?,revision=?,published_revision=?,published_at=UTC_TIMESTAMP(3),updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND enabled=1',[JSON.stringify(content),JSON.stringify(content),revision,revision,ctx.identity.id,ctx.tenant.id]);
    await db.query("INSERT INTO sx_tenant_storefront_revisions(tenant_id,revision,content_json,publication_type,published_by_identity_id,published_at) VALUES (?,?,?,'rollback',?,UTC_TIMESTAMP(3))",[ctx.tenant.id,revision,JSON.stringify(content),ctx.identity.id]);
    await audit(db,ctx,'tenant.storefront.rolled-back',Number(previous.revision));await db.commit();return {rolledBackTo:Number(previous.revision),revision,content};
  }catch(error){await db.rollback();throw error;}
}
async function publicBrand(db,hostname){
  const [[row]]=await db.query(`SELECT d.tenant_id AS tenantId,d.hostname AS hostname,d.is_primary AS isPrimary,primaryDomain.hostname AS primaryHostname,s.published_json AS content,s.published_revision AS revision
    FROM sx_tenant_crm_domains d JOIN sx_tenant_storefronts s ON s.tenant_id=d.tenant_id
    LEFT JOIN sx_tenant_crm_domains primaryDomain ON primaryDomain.tenant_id=d.tenant_id AND primaryDomain.is_primary=1 AND primaryDomain.status='active' AND primaryDomain.tls_ready_at IS NOT NULL
    WHERE d.hostname=? AND d.status='active' AND d.tls_ready_at IS NOT NULL AND d.dns_health_status<>'stale' AND s.enabled=1 AND s.published_json IS NOT NULL LIMIT 1`,[hostname]);
  if(!row)return null;const content=parseJson(row.content);if(!content)return null;
  const brand=await businessProfile.publicBrand(db,hostname);if(!brand||brand.tenantId!==row.tenantId)return null;
  return {...brand,content,revision:Number(row.revision||0),primaryHostname:row.primaryHostname||row.hostname};
}
async function audit(db,ctx,action,revision){await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity',?,'tenant-storefront',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,action,ctx.tenant.id,JSON.stringify({revision}),uuid()]);}
module.exports={normalize,get,saveDraft,publish,rollback,publicBrand};
