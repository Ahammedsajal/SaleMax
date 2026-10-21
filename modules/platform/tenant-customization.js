'use strict';
const crypto = require('node:crypto');
const {decision} = require('./policy');
const fail = (code,status=400) => {throw Object.assign(new Error(code),{code,status});};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const defaults = () => ({schemaVersion:4,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null});
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function authorize(ctx) {
  const result=decision(ctx,{capability:'tenant.settings',permission:'tenant.manage'});
  if(!result.allowed || ctx.membership?.role!=='owner' || !ctx.identity?.id) fail(result.allowed?'PERMISSION_DENIED':result.code,403);
}
function fieldsFor(ctx) {
  // Historical Training Center v1 accidentally inherited these two grants.
  // Do not expose Sales-only screens as new customization options; retaining
  // the published entitlement contract does not make those screens compatible.
  return require('./navigation').items.filter(item=>item.sidebar!==false&&ctx.category?.capabilities.includes(item.capability)&&
    !(ctx.category.key==='training_center'&&['sales.finance','hr.recruitment'].includes(item.capability)));
}
function categoryNavigationKeys(ctx) {
  return new Set(fieldsFor(ctx).map(item=>item.key));
}
function normalize(ctx,input) {
  const allowedKeys=input?.schemaVersion===4?['schemaVersion','navigationLabels','leadFields','hiddenNavigation','enabledTaskTypes']:input?.schemaVersion===3?['schemaVersion','navigationLabels','leadFields','hiddenNavigation']:input?.schemaVersion===2?['schemaVersion','navigationLabels','leadFields']:['schemaVersion','navigationLabels'];
  if(!plain(input)||Object.keys(input).some(key=>!allowedKeys.includes(key))||![1,2,3,4].includes(input.schemaVersion)||!plain(input.navigationLabels))fail('INVALID_CUSTOMIZATION');
  const allowed=categoryNavigationKeys(ctx);
  const labels={};
  for(const key of Object.keys(input.navigationLabels).sort()) {
    const value=input.navigationLabels[key];
    if(!allowed.has(key)||!plain(value)||Object.keys(value).length!==2||!['en','ar'].every(lang=>Object.hasOwn(value,lang)&&typeof value[lang]==='string'&&value[lang].trim().length>0&&value[lang].length<=80&&!/[<>\u0000-\u001f\u007f]/.test(value[lang])))fail('INVALID_CUSTOMIZATION_LABEL');
    labels[key]={en:value.en.trim(),ar:value.ar.trim()};
  }
  const leadFields=input.schemaVersion===2?require('./lead-field-contract').definitions(input.leadFields):null;
  const schema3LeadFields=input.schemaVersion>=3?require('./lead-field-contract').definitions(input.leadFields):null;
  const hiddenNavigation=input.schemaVersion>=3?input.hiddenNavigation:[];
  if(!Array.isArray(hiddenNavigation)||hiddenNavigation.length>allowed.size||new Set(hiddenNavigation).size!==hiddenNavigation.length||hiddenNavigation.some(key=>typeof key!=='string'||!allowed.has(key)))fail('INVALID_CUSTOMIZATION_NAVIGATION');
  const taskAdapters=require('./task-type-adapters');
  const taskOptions=taskAdapters.configurable(ctx);
  const enabledTaskTypes=input.schemaVersion===4?input.enabledTaskTypes:null;
  if(enabledTaskTypes!==null&&(!Array.isArray(enabledTaskTypes)||enabledTaskTypes.length>taskOptions.length||new Set(enabledTaskTypes).size!==enabledTaskTypes.length||enabledTaskTypes.some(key=>typeof key!=='string'||!taskOptions.some(item=>item.key===key))))fail('INVALID_CUSTOMIZATION_TASK_TYPES');
  const fields=schema3LeadFields||leadFields;
  if(fields?.length&&!ctx.category?.capabilities.includes('crm.leads'))fail('CATEGORY_UNAVAILABLE',409);
  return {schemaVersion:input.schemaVersion,navigationLabels:labels,...(fields?{leadFields:fields}:{}),...(input.schemaVersion>=3?{hiddenNavigation:[...hiddenNavigation].sort()}:{ }),...(input.schemaVersion===4?{enabledTaskTypes:enabledTaskTypes===null?null:[...enabledTaskTypes].sort()}:{})};
}
const checksum = doc => crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex');
function decode(ctx,row) {
  if(!row)return null;
  if(row.category_key!==ctx.tenant.categoryKey||Number(row.category_version)!==ctx.tenant.categoryVersion||![1,2,3,4].includes(Number(row.schema_version)))fail('CUSTOMIZATION_VERSION_MISMATCH',409);
  const document=normalize(ctx,typeof row.document==='string'?JSON.parse(row.document):row.document);
  if(document.schemaVersion!==Number(row.schema_version)||checksum(document)!==row.checksum)fail('CUSTOMIZATION_INTEGRITY_ERROR',503);
  return {id:row.id,revision:Number(row.revision),kind:row.kind,document,checksum:row.checksum,createdAt:row.created_at};
}
async function revision(db,ctx,id) {
  if(!id)return null;
  const [[row]]=await db.query('SELECT * FROM sx_tenant_customization_revisions WHERE tenant_id=? AND id=?',[ctx.tenant.id,id]);
  if(!row)fail('CUSTOMIZATION_NOT_FOUND',404);
  return decode(ctx,row);
}
async function state(db,ctx) {
  authorize(ctx);
  const [[head]]=await db.query('SELECT revision,active_id,draft_id FROM sx_tenant_customization_heads WHERE tenant_id=?',[ctx.tenant.id]);
  const [history]=await db.query("SELECT id,revision,checksum,created_at AS createdAt FROM sx_tenant_customization_revisions WHERE tenant_id=? AND kind='published' AND category_key=? AND category_version=? ORDER BY revision DESC LIMIT 20",[ctx.tenant.id,ctx.tenant.categoryKey,ctx.tenant.categoryVersion]);
  const active=await revision(db,ctx,head?.active_id),draft=await revision(db,ctx,head?.draft_id);
  if(active&&active.kind!=='published'||draft&&draft.kind!=='draft')fail('CUSTOMIZATION_INTEGRITY_ERROR',503);
  return {revision:Number(head?.revision||0),active,draft,history,
    defaults:defaults(),fields:fieldsFor(ctx).map(item=>({key:item.key,label:item.label})),taskTypes:require('./task-type-adapters').configurable(ctx).map(item=>({...item,planAvailable:require('./task-type-adapters').supports(ctx,item.key)}))};
}
function preview(ctx,document) {authorize(ctx);return {document:normalize(ctx,document),readOnly:true};}
async function mutate(db,ctx,{expectedRevision,document,targetId},action) {
  authorize(ctx);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)fail('INVALID_CUSTOMIZATION_REVISION');
  if(!['draft','publish','rollback'].includes(action))fail('INVALID_CUSTOMIZATION_ACTION');
  const normalized=action==='draft'?normalize(ctx,document):null;
  if(action==='rollback'&&!uuid(targetId))fail('INVALID_CUSTOMIZATION_REVISION');
  await db.beginTransaction();
  try {
    const [[tenant]]=await db.query('SELECT category_key,category_version,status FROM sx_tenants WHERE id=? FOR UPDATE',[ctx.tenant.id]);
    if(!tenant||tenant.status!=='active')fail('ACCOUNT_INACTIVE',403);
    if(tenant.category_key!==ctx.tenant.categoryKey||Number(tenant.category_version)!==ctx.tenant.categoryVersion)fail('CUSTOMIZATION_VERSION_MISMATCH',409);
    const [[member]]=await db.query("SELECT m.role,m.status,i.status AS identityStatus FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id WHERE m.tenant_id=? AND m.id=? AND m.identity_id=? FOR UPDATE",[ctx.tenant.id,ctx.membership.id,ctx.identity.id]);
    if(!member||member.role!=='owner'||member.status!=='active'||member.identityStatus!=='active')fail('PERMISSION_DENIED',403);
    const subscription=await require('./plans').loadEntitlements(db,ctx.tenant.id);
    if(subscription&&(subscription.categoryKey!==ctx.tenant.categoryKey||Number(subscription.categoryVersion)!==ctx.tenant.categoryVersion))fail('CUSTOMIZATION_VERSION_MISMATCH',409);
    authorize({...ctx,subscription});
    const [[head]]=await db.query('SELECT revision,active_id,draft_id FROM sx_tenant_customization_heads WHERE tenant_id=? FOR UPDATE',[ctx.tenant.id]);
    if(Number(head?.revision||0)!==expectedRevision)fail('STALE_CUSTOMIZATION_REVISION',409);
    const [[rate]]=await db.query('SELECT COUNT(*) AS total FROM sx_tenant_customization_revisions WHERE tenant_id=? AND created_at>TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(3))',[ctx.tenant.id]);
    if(Number(rate.total)>=120)fail('CUSTOMIZATION_RATE_LIMITED',429);
    let next=normalized,sourceId=null;
    if(action!=='draft') {
      sourceId=action==='publish'?head?.draft_id:targetId;
      const source=await revision(db,ctx,sourceId);
      if(!source||source.kind!==(action==='publish'?'draft':'published'))fail('CUSTOMIZATION_NOT_FOUND',404);
      next=source.document;
    }
    const id=crypto.randomUUID(),kind=action==='draft'?'draft':'published',digest=checksum(next);
    await db.query('INSERT INTO sx_tenant_customization_revisions(id,tenant_id,category_key,category_version,schema_version,revision,kind,document,checksum,created_by_identity_id) VALUES (?,?,?,?,?,?,?,?,?,?)',[id,ctx.tenant.id,ctx.tenant.categoryKey,ctx.tenant.categoryVersion,next.schemaVersion,expectedRevision+1,kind,JSON.stringify(next),digest,ctx.identity.id]);
    if(!head)await db.query('INSERT INTO sx_tenant_customization_heads(tenant_id,revision) VALUES (?,0)',[ctx.tenant.id]);
    if(kind==='draft')await db.query('UPDATE sx_tenant_customization_heads SET revision=revision+1,draft_id=? WHERE tenant_id=?',[id,ctx.tenant.id]);
    else await db.query('UPDATE sx_tenant_customization_heads SET revision=revision+1,active_id=?,draft_id=NULL WHERE tenant_id=?',[id,ctx.tenant.id]);
    await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity',?,'tenant-customization',?,?,?)",[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,`tenant.customization.${action}`,id,JSON.stringify({revision:expectedRevision+1,checksum:digest,sourceId}),crypto.randomUUID()]);
    await db.commit();
    return {revision:expectedRevision+1,id,kind,document:next};
  } catch(error) {await db.rollback();throw error;}
}
async function effective(db,ctx) {
  // For internal runtime consumers. Authenticated context is mandatory; no
  // tenant ID supplied by a browser can select a different configuration.
  if(ctx?.audience!=='tenant'||ctx.tenant?.id!==ctx.membership?.tenantId||ctx.tenant?.status!=='active'||ctx.membership?.status!=='active')fail('PERMISSION_DENIED',403);
  const [[head]]=await db.query('SELECT revision,active_id FROM sx_tenant_customization_heads WHERE tenant_id=?',[ctx.tenant.id]);
  const active=await revision(db,ctx,head?.active_id);
  if(active&&active.kind!=='published')fail('CUSTOMIZATION_INTEGRITY_ERROR',503);
  return {revision:active?active.revision:0,document:active?.document||defaults()};
}
function visibleNavigationKeys(keys,document){const hidden=new Set(Array.isArray(document?.hiddenNavigation)?document.hiddenNavigation:[]);return keys.filter(key=>!hidden.has(key));}
function visibleNavigation(rows,document){const visible=new Set(visibleNavigationKeys(rows.map(item=>item.key),document));return rows.filter(item=>visible.has(item.key));}
module.exports={authorize,normalize,checksum,decode,defaults,state,preview,mutate,effective,visibleNavigation,visibleNavigationKeys};
