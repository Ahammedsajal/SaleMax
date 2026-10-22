'use strict';

const crypto=require('node:crypto');
const adapters=require('./form-category-adapters');
const {decision}=require('./policy');
const plans=require('./plans');
const leadFields=require('./lead-form-fields');
const formInput=require('./training-forms').formInput;
const uuid=()=>crypto.randomUUID();
const fail=code=>{throw Object.assign(new Error(code),{code});};

function context(ctx,permission='forms.manage'){
  if(!ctx||ctx.audience!=='tenant'||ctx.tenant?.status!=='active'||ctx.membership?.status!=='active'||ctx.membership?.tenantId!==ctx.tenant?.id)fail('TENANT_CONTEXT_REQUIRED');
  if(adapters.resolve(ctx.category)!=='generic-lead-capture-v1')fail('CATEGORY_UNAVAILABLE');
  const access=decision(ctx,{capability:'portal.forms',permission});if(!access.allowed)fail(access.code);
  return 'generic-lead-capture-v1';
}
function parse(value){return typeof value==='string'?JSON.parse(value):value;}
function isoDate(value){return !value||(/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value);}

async function list(db,ctx){
  context(ctx);
  const [rows]=await db.query(`SELECT f.id,f.slug,f.published_slug AS publishedSlug,f.name_en AS nameEn,f.name_ar AS nameAr,f.draft_schema AS schemaJson,f.draft_revision AS draftRevision,f.published_version AS publishedVersion,f.published_draft_revision AS publishedDraftRevision,f.status,f.updated_at AS updatedAt,t.slug AS tenantSlug FROM sx_workspace_forms f JOIN sx_tenants t ON t.id=f.tenant_id WHERE f.tenant_id=? ORDER BY f.updated_at DESC,f.id`,[ctx.tenant.id]);
  return rows.map(row=>({...row,schema:parse(row.schemaJson),schemaJson:undefined,draftRevision:Number(row.draftRevision),publishedVersion:row.publishedVersion==null?null:Number(row.publishedVersion),publishedDraftRevision:row.publishedDraftRevision==null?null:Number(row.publishedDraftRevision),hasUnpublishedChanges:row.publishedVersion!=null&&Number(row.publishedDraftRevision)!==Number(row.draftRevision),publicPath:row.publishedVersion==null?null:`/p/${row.tenantSlug}/forms/${row.publishedSlug}`}));
}
async function leadFieldOptions(db,ctx){context(ctx);return leadFields.options(db,ctx);}
async function submissions(db,ctx,query={}){
  context(ctx);
  const limit=Math.min(100,Math.max(1,Number.parseInt(query.limit,10)||25)),page=Math.max(1,Number.parseInt(query.page,10)||1),search=String(query.search||'').trim().slice(0,120),from=String(query.from||''),to=String(query.to||''),submissionId=String(query.submissionId||'');
  if(!isoDate(from)||!isoDate(to)||(from&&to&&from>to))fail('INVALID_DATE_RANGE');
  const clauses=['s.tenant_id=?'],params=[ctx.tenant.id];
  if(submissionId){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId))fail('INVALID_SUBMISSION_ID');clauses.push('s.id=?');params.push(submissionId);}
  if(from){clauses.push("s.created_at>=TIMESTAMPADD(HOUR,-3,CONCAT(?,' 00:00:00'))");params.push(from);}
  if(to){clauses.push("s.created_at<TIMESTAMPADD(HOUR,-3,DATE_ADD(CONCAT(?,' 00:00:00'),INTERVAL 1 DAY))");params.push(to);}
  if(search){const term=`%${search.replace(/[\\%_]/g,'\\$&')}%`;clauses.push(`(s.reference_code LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(s.submission_data,'$.contact_name')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(s.submission_data,'$.phone')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(s.submission_data,'$.email')) LIKE ?)`);params.push(...Array(4).fill(term));}
  const where=clauses.join(' AND '),[[count]]=await db.query(`SELECT COUNT(*) total FROM sx_workspace_form_submissions s WHERE ${where}`,params);
  const [rows]=await db.query(`SELECT s.id,s.form_id AS formId,s.form_version AS formVersion,s.reference_code AS referenceCode,s.lead_id AS leadId,s.capture_mode AS captureMode,s.submission_data AS submissionData,s.attribution_json AS attributionJson,s.consent_text_en AS consentTextEn,s.consent_text_ar AS consentTextAr,s.consented_at AS submittedAt,v.name_en AS formNameEn,v.name_ar AS formNameAr,v.schema_json AS schemaJson FROM sx_workspace_form_submissions s JOIN sx_workspace_form_versions v ON v.tenant_id=s.tenant_id AND v.form_id=s.form_id AND v.version=s.form_version WHERE ${where} ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
  return {items:rows.map(row=>({...row,submissionData:parse(row.submissionData),attribution:parse(row.attributionJson),attributionJson:undefined,schema:parse(row.schemaJson),schemaJson:undefined})),businessProfile:{},page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit),search,from,to};
}
async function create(db,ctx,input){
  const adapter=context(ctx),form=formInput(input,adapter),id=uuid();await db.beginTransaction();
  try{await leadFields.validateDraft(db,ctx,form.schema.leadFields);await db.query(`INSERT INTO sx_workspace_forms(id,tenant_id,slug,name_en,name_ar,draft_schema,created_by_identity_id,updated_by_identity_id) VALUES (?,?,?,?,?,?,?,?)`,[id,ctx.tenant.id,form.slug,form.nameEn,form.nameAr,JSON.stringify(form.schema),ctx.identity.id,ctx.identity.id]);await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','workspace.form-created','workspace-form',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({slug:form.slug}),uuid()]);await db.commit();return {id,...form,draftRevision:1,status:'draft',publishedVersion:null};}
  catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('FORM_SLUG_EXISTS');throw error;}
}
async function update(db,ctx,id,expectedRevision,input){
  const adapter=context(ctx);if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail('INVALID_REVISION');const form=formInput(input,adapter);await db.beginTransaction();
  try{const [[current]]=await db.query('SELECT draft_revision,published_version FROM sx_workspace_forms WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);if(!current)fail('FORM_NOT_FOUND');if(Number(current.draft_revision)!==expectedRevision)fail('STALE_REVISION');await leadFields.validateDraft(db,ctx,form.schema.leadFields);await db.query(`UPDATE sx_workspace_forms SET slug=?,name_en=?,name_ar=?,draft_schema=?,draft_revision=draft_revision+1,updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?`,[form.slug,form.nameEn,form.nameAr,JSON.stringify(form.schema),ctx.identity.id,ctx.tenant.id,id]);await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','workspace.form-draft-updated','workspace-form',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({draftRevision:expectedRevision+1}),uuid()]);await db.commit();return {id,...form,draftRevision:expectedRevision+1,status:current.published_version==null?'draft':'published',hasUnpublishedChanges:current.published_version!=null};}
  catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('FORM_SLUG_EXISTS');throw error;}
}
async function publish(db,ctx,id,expectedRevision){
  context(ctx);if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail('INVALID_REVISION');await db.beginTransaction();
  try{const [[form]]=await db.query('SELECT slug,name_en,name_ar,draft_schema,draft_revision,published_version,published_draft_revision FROM sx_workspace_forms WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);if(!form)fail('FORM_NOT_FOUND');if(Number(form.draft_revision)!==expectedRevision)fail('STALE_REVISION');if(form.published_version!=null&&Number(form.published_draft_revision)===expectedRevision){await db.commit();return {id,slug:form.slug,version:Number(form.published_version),status:'published',repeated:true};}const schema=parse(form.draft_schema);await leadFields.validateDraft(db,ctx,schema.leadFields);const version=Number(form.published_version||0)+1;await db.query(`INSERT INTO sx_workspace_form_versions(id,tenant_id,form_id,version,slug,name_en,name_ar,schema_json,published_by_identity_id) VALUES (?,?,?,?,?,?,?,?,?)`,[uuid(),ctx.tenant.id,id,version,form.slug,form.name_en,form.name_ar,JSON.stringify(schema),ctx.identity.id]);await db.query(`UPDATE sx_workspace_forms SET published_version=?,published_draft_revision=?,published_slug=?,status='published',updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?`,[version,expectedRevision,form.slug,ctx.identity.id,ctx.tenant.id,id]);await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','workspace.form-published','workspace-form',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({version}),uuid()]);await db.commit();return {id,slug:form.slug,version,status:'published'};}
  catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('FORM_SLUG_EXISTS');throw error;}
}
async function publicForm(db,tenantSlug,formSlug){
  if(typeof tenantSlug!=='string'||typeof formSlug!=='string'||!/^[-a-z0-9]{1,80}$/.test(tenantSlug)||!/^[-a-z0-9]{1,48}$/.test(formSlug))return null;
  const [[row]]=await db.query(`SELECT t.id AS tenant_id,t.slug AS tenant_slug,t.name AS tenant_name,t.category_key,t.category_version,t.status AS tenant_status,f.id AS form_id,v.slug AS form_slug,v.name_en,v.name_ar,v.version,v.schema_json FROM sx_tenants t JOIN sx_workspace_forms f ON f.tenant_id=t.id AND f.status='published' JOIN sx_workspace_form_versions v ON v.tenant_id=f.tenant_id AND v.form_id=f.id AND v.version=f.published_version WHERE t.slug=? AND v.slug=? AND t.status='active' LIMIT 1`,[tenantSlug,formSlug]);
  if(!row)return null;const category=require('./categories').getCategory(row.category_key,Number(row.category_version));if(adapters.resolve(category)!=='generic-lead-capture-v1'||!category.capabilities.includes('portal.forms'))return null;
  const entitlements=await plans.loadEntitlements(db,row.tenant_id);if(!entitlements||!['active','trial','grace'].includes(entitlements.status)||!entitlements.capabilities.includes('portal.forms'))return null;
  const schema=parse(row.schema_json);if(schema.templateKey) return null;
  return {tenant:{name:row.tenant_name,companyName:row.tenant_name,centerNameEn:row.tenant_name,centerNameAr:row.tenant_name,logoUrl:'',addressEn:'',addressAr:'',slug:row.tenant_slug},form:{slug:row.form_slug,nameEn:row.name_en,nameAr:row.name_ar,version:Number(row.version),schema},courses:[]};
}

module.exports={context,list,leadFieldOptions,submissions,create,update,publish,publicForm};
