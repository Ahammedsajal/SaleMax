'use strict';

const crypto=require('node:crypto');
const adapters=require('./form-category-adapters');
const {decision}=require('./policy');
const plans=require('./plans');
const leadFields=require('./lead-form-fields');
const trainingForms=require('./training-forms');
const formInput=trainingForms.formInput;
const uuid=()=>crypto.randomUUID();
const fail=code=>{throw Object.assign(new Error(code),{code});};

function context(ctx,permission='forms.manage'){
  if(!ctx||ctx.audience!=='tenant'||ctx.tenant?.status!=='active'||ctx.membership?.status!=='active'||ctx.membership?.tenantId!==ctx.tenant?.id)fail('TENANT_CONTEXT_REQUIRED');
  if(adapters.resolve(ctx.category)!=='generic-lead-capture-v1')fail('CATEGORY_UNAVAILABLE');
  const access=decision(ctx,{capability:'portal.forms',permission});if(!access.allowed)fail(access.code);
  const leadAccess=decision(ctx,{capability:'crm.leads',permission:'leads.manage'});if(!leadAccess.allowed)fail(leadAccess.code);
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
  if(!row)return null;const category=require('./categories').getCategory(row.category_key,Number(row.category_version));if(adapters.resolve(category)!=='generic-lead-capture-v1'||!category.capabilities.includes('portal.forms')||!category.capabilities.includes('crm.leads'))return null;
  const entitlements=await plans.loadEntitlements(db,row.tenant_id);if(!entitlements||!['active','trial','grace'].includes(entitlements.status)||!entitlements.capabilities.includes('portal.forms')||!entitlements.capabilities.includes('crm.leads'))return null;
  const schema=parse(row.schema_json);if(schema.templateKey) return null;
  return {adapter:'generic-lead-capture-v1',tenant:{name:row.tenant_name,companyName:row.tenant_name,centerNameEn:row.tenant_name,centerNameAr:row.tenant_name,logoUrl:'',addressEn:'',addressAr:'',slug:row.tenant_slug},form:{slug:row.form_slug,nameEn:row.name_en,nameAr:row.name_ar,version:Number(row.version),schema},courses:[]};
}

function staffSession(session){
  const ctx=session?.context;
  context(ctx,'forms.capture');
  if(!ctx.identity?.id||typeof session?.ownerUid!=='string'||!session.ownerUid)fail('BUSINESS_LINK_INVALID');
  if(ctx.membership.role==='agent'&&(!session.agent||!session.actor||!Number.isSafeInteger(Number(session.actor.id))))fail('BUSINESS_LINK_INVALID');
  return ctx;
}
async function staffForm(db,session,formSlug){
  const ctx=staffSession(session);
  if(typeof formSlug!=='string'||!/^[-a-z0-9]{1,48}$/.test(formSlug))fail('FORM_NOT_FOUND');
  const [[row]]=await db.query(`SELECT t.slug AS tenant_slug,t.name AS tenant_name,f.id AS form_id,v.slug AS form_slug,v.name_en,v.name_ar,v.version,v.schema_json
    FROM sx_tenants t JOIN sx_workspace_forms f ON f.tenant_id=t.id AND f.status='published'
    JOIN sx_workspace_form_versions v ON v.tenant_id=f.tenant_id AND v.form_id=f.id AND v.version=f.published_version
    WHERE t.id=? AND t.status='active' AND v.slug=? LIMIT 1`,[ctx.tenant.id,formSlug]);
  if(!row)fail('FORM_NOT_FOUND');
  const schema=parse(row.schema_json);if(schema.templateKey)fail('INVALID_FORM_SCHEMA');
  return {adapter:'generic-lead-capture-v1',captureMode:'staff',staff:{role:ctx.membership.role},tenant:{name:row.tenant_name,companyName:row.tenant_name,centerNameEn:row.tenant_name,centerNameAr:row.tenant_name,logoUrl:'',addressEn:'',addressAr:'',slug:row.tenant_slug},form:{slug:row.form_slug,nameEn:row.name_en,nameAr:row.name_ar,version:Number(row.version),schema},courses:[]};
}
async function searchStaffLeads(db,session,search){
  const ctx=staffSession(session),term=String(search||'').trim().slice(0,100);
  if(term.length<2)fail('SEARCH_TERM_TOO_SHORT');
  const uidHash=sha(session.ownerUid),like=`%${term.replace(/[\\%_]/g,'\\$&')}%`,params=[uidHash,like,like,like,like];
  let scope='';
  if(ctx.membership.role==='agent'){
    const [agents]=await db.query("SELECT id FROM agents WHERE id=? AND owner_uid=? AND role='agent' AND is_active=1 LIMIT 1",[Number(session.actor.id),session.ownerUid]);
    if(!agents.length)fail('PERMISSION_DENIED');
    scope=' AND l.owner_agent_id=?';params.push(Number(session.actor.id));
  }
  const [rows]=await db.query(`SELECT l.id,l.contact_name AS contactName,l.learner_name AS learnerName,l.mobile AS phone,c.normalized_email AS email,l.qualification_data AS qualificationData
    FROM pipeline_leads l LEFT JOIN pipeline_contacts c ON c.uid_hash=l.uid_hash AND c.id=l.contact_id
    WHERE l.uid_hash=? AND (l.contact_name LIKE ? OR l.learner_name LIKE ? OR l.mobile LIKE ? OR c.normalized_email LIKE ?)${scope}
    ORDER BY l.updated_at DESC,l.created_at DESC LIMIT 20`,params);
  return rows.map(row=>({...row,qualificationData:typeof row.qualificationData==='string'?JSON.parse(row.qualificationData):row.qualificationData||{}}));
}
async function scopedLead(db,session,leadId){
  const ctx=session.context,uidHash=sha(session.ownerUid);
  let assignmentScope='';const params=[uidHash,session.ownerUid,leadId];
  if(ctx.membership.role==='agent'){
    const agentId=Number(session.actor?.id);
    if(!Number.isSafeInteger(agentId)||agentId<1||typeof session.actor?.uid!=='string'||!session.actor.uid)fail('PERMISSION_DENIED');
    const [agents]=await db.query("SELECT id FROM agents WHERE id=? AND uid=? AND owner_uid=? AND role='agent' AND is_active=1 LIMIT 1",[agentId,session.actor.uid,session.ownerUid]);
    if(!agents.length)fail('PERMISSION_DENIED');
    assignmentScope=' AND owner_agent_id=?';params.push(agentId);
  }
  const [[lead]]=await db.query(`SELECT id,qualification_data FROM pipeline_leads WHERE uid_hash=? AND uid=? AND id=?${assignmentScope} LIMIT 1 FOR UPDATE`,params);
  if(!lead)fail('LEAD_NOT_ACCESSIBLE');
  return {lead,uidHash};
}
async function submitStaff(db,session,formSlug,{submissionToken,values,selectedLeadId,expectedFormVersion}={}){
  const ctx=staffSession(session);
  if(typeof submissionToken!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionToken))fail('INVALID_SUBMISSION');
  if(selectedLeadId!==undefined&&(typeof selectedLeadId!=='string'||!/^[0-9a-f-]{36}$/i.test(selectedLeadId)))fail('INVALID_SUBMISSION');
  require('./form-submission-version').normalize(expectedFormVersion);
  await db.beginTransaction();
  try{
    const [[form]]=await db.query(`SELECT t.id AS tenant_id,t.slug AS tenant_slug,t.name AS tenant_name,t.category_key,t.category_version,t.status AS tenant_status,
        f.id AS form_id,v.version,v.slug,v.name_en,v.name_ar,v.schema_json
      FROM sx_tenants t JOIN sx_workspace_forms f ON f.tenant_id=t.id AND f.status='published'
      JOIN sx_workspace_form_versions v ON v.tenant_id=f.tenant_id AND v.form_id=f.id AND v.version=f.published_version
      WHERE t.id=? AND t.status='active' AND v.slug=? LIMIT 1 FOR UPDATE`,[ctx.tenant.id,formSlug]);
    if(!form)fail('FORM_NOT_FOUND');
    const category=require('./categories').getCategory(form.category_key,Number(form.category_version));
    if(adapters.resolve(category)!=='generic-lead-capture-v1'||!category.capabilities.includes('portal.forms')||!category.capabilities.includes('crm.leads'))fail('FORM_NOT_FOUND');
    const entitlement=await plans.loadEntitlements(db,form.tenant_id);
    if(!entitlement||!['active','trial','grace'].includes(entitlement.status)||!entitlement.capabilities?.includes('portal.forms')||!entitlement.capabilities?.includes('crm.leads'))fail('FEATURE_UNAVAILABLE');
    const tokenHash=sha(`${ctx.identity.id}:${submissionToken}`);
    const [[prior]]=await db.query('SELECT reference_code AS referenceCode,lead_id AS leadId FROM sx_workspace_form_submissions WHERE tenant_id=? AND form_id=? AND idempotency_hash=? LIMIT 1 FOR UPDATE',[form.tenant_id,form.form_id,tokenHash]);
    if(prior){if(!prior.leadId)fail('FORM_SUBMISSION_CONFLICT');await scopedLead(db,session,prior.leadId);await db.commit();return {referenceCode:prior.referenceCode,leadId:prior.leadId,repeated:true};}
    require('./form-submission-version').assertCurrent(expectedFormVersion,form.version);
    const schema=parse(form.schema_json);if(schema.templateKey)fail('INVALID_FORM_SCHEMA');
    const data=trainingForms.cleanSubmission(schema,values,'generic-lead-capture-v1');
    const referenceCode=crypto.randomBytes(6).toString('hex').toUpperCase(),submissionId=uuid();
    const [reservation]=await db.query(`INSERT IGNORE INTO sx_workspace_form_submissions(id,tenant_id,form_id,form_version,capture_mode,captured_by_identity_id,idempotency_hash,reference_code,submission_data,attribution_json,consent_text_en,consent_text_ar,consented_at)
      VALUES (?,?,?,?,'staff',?,?,?,?,NULL,?,?,UTC_TIMESTAMP(3))`,[submissionId,form.tenant_id,form.form_id,form.version,ctx.identity.id,tokenHash,referenceCode,JSON.stringify(data),schema.consentTextEn,schema.consentTextAr]);
    if(!reservation.affectedRows){const [[replay]]=await db.query('SELECT reference_code AS referenceCode,lead_id AS leadId FROM sx_workspace_form_submissions WHERE tenant_id=? AND form_id=? AND idempotency_hash=? LIMIT 1',[form.tenant_id,form.form_id,tokenHash]);if(!replay?.leadId)fail('FORM_SUBMISSION_CONFLICT');await scopedLead(db,session,replay.leadId);await db.commit();return {referenceCode:replay.referenceCode,leadId:replay.leadId,repeated:true};}
    const customValues=schema.leadFields?leadFields.values(data.customFields):undefined;
    let leadId;
    if(selectedLeadId){
      const {lead,uidHash}=await scopedLead(db,session,selectedLeadId);leadId=lead.id;
      if(schema.leadFields){const qualification=require('./lead-field-runtime').qualification(lead.qualification_data);qualification.customFields=leadFields.save(schema.leadFields,customValues,qualification.customFields);await db.query('UPDATE pipeline_leads SET qualification_data=?,last_activity_at=UTC_TIMESTAMP(3) WHERE uid_hash=? AND uid=? AND id=?',[JSON.stringify(qualification),uidHash,session.ownerUid,leadId]);}
    }else{
      const agentId=ctx.membership.role==='agent'?Number(session.actor.id):undefined;
      const lead=await require('../../helper/pipeline/leadPipeline').createManualLead({uid:session.ownerUid,actorType:agentId?'agent':'identity',actorId:agentId?String(agentId):ctx.identity.id,agentId,role:ctx.membership.role,connection:db,captureFieldContract:leadFields.contract(schema.leadFields),input:{...(schema.leadFields?{customFields:{configurationRevision:schema.leadFields.configurationRevision,values:customValues}}:{}),title:form.name_en,contactName:data.contact_name,learnerName:data.contact_name,mobile:data.phone||'',email:data.email||'',sourceType:'staff_form'}});
      leadId=lead.id;
    }
    await db.query('UPDATE sx_workspace_form_submissions SET lead_id=? WHERE tenant_id=? AND form_id=? AND id=?',[leadId,form.tenant_id,form.form_id,submissionId]);
    await db.commit();return {referenceCode,leadId,repeated:false,collectorRole:ctx.membership.role};
  }catch(error){try{await db.rollback();}catch{}if(error.code==='ER_DUP_ENTRY')fail('FORM_SUBMISSION_CONFLICT');throw error;}
}

function sha(value){return crypto.createHash('sha256').update(value,'utf8').digest('hex');}
async function submitPublic(pool,{tenantSlug,formSlug,submissionToken,values,visitorHash,campaignAttribution,expectedFormVersion}){
  if(typeof submissionToken!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionToken)||typeof visitorHash!=='string'||!/^[0-9a-f]{64}$/.test(visitorHash))fail('INVALID_SUBMISSION');
  require('./form-submission-version').normalize(expectedFormVersion);
  campaignAttribution=trainingForms.cleanCampaignAttribution(campaignAttribution);
  const db=await pool.getConnection();let begun=false;
  try{
    await db.beginTransaction();begun=true;
    const [[form]]=await db.query(`SELECT t.id AS tenant_id,t.slug AS tenant_slug,t.category_key,t.category_version,u.uid,own.legacy_uid_hash,m.identity_id AS owner_identity_id,i.status AS owner_identity_status,f.id AS form_id,v.version,v.slug,v.name_en,v.name_ar,v.schema_json FROM sx_tenants t JOIN sx_legacy_ownership own ON own.tenant_id=t.id AND own.source_table='user' JOIN sx_memberships m ON m.tenant_id=own.tenant_id AND m.id=own.membership_id AND m.role='owner' AND m.status='active' JOIN sx_identities i ON i.id=m.identity_id JOIN user u ON CAST(u.id AS CHAR)=own.source_id JOIN sx_workspace_forms f ON f.tenant_id=t.id AND f.status='published' JOIN sx_workspace_form_versions v ON v.tenant_id=f.tenant_id AND v.form_id=f.id AND v.version=f.published_version WHERE t.slug=? AND t.status='active' AND v.slug=? LIMIT 1 FOR UPDATE`,[tenantSlug,formSlug]);
    if(!form)fail('FORM_NOT_FOUND');
    const category=require('./categories').getCategory(form.category_key,Number(form.category_version));
    if(adapters.resolve(category)!=='generic-lead-capture-v1'||!category.capabilities.includes('portal.forms')||!category.capabilities.includes('crm.leads'))fail('FORM_NOT_FOUND');
    if(!form.legacy_uid_hash||sha(form.uid)!==form.legacy_uid_hash||form.owner_identity_status!=='active')fail('BUSINESS_LINK_INVALID');
    const entitlements=await plans.loadEntitlements(db,form.tenant_id);if(!entitlements||!['active','trial','grace'].includes(entitlements.status)||!entitlements.capabilities.includes('portal.forms')||!entitlements.capabilities.includes('crm.leads'))fail('FORM_NOT_FOUND');
    const tokenHash=sha(submissionToken);
    const [[prior]]=await db.query('SELECT reference_code AS referenceCode,lead_id AS leadId FROM sx_workspace_form_submissions WHERE tenant_id=? AND form_id=? AND idempotency_hash=? LIMIT 1 FOR UPDATE',[form.tenant_id,form.form_id,tokenHash]);
    if(prior){await db.commit();begun=false;return {referenceCode:prior.referenceCode,leadId:prior.leadId,repeated:true};}
    require('./form-submission-version').assertCurrent(expectedFormVersion,form.version);
    const schema=parse(form.schema_json);if(schema.templateKey)fail('INVALID_FORM_SCHEMA');
    const data=trainingForms.cleanSubmission(schema,values,'generic-lead-capture-v1');
    const visitors=[visitorHash,sha('form:'+form.tenant_id+':'+form.form_id)];
    for(const visitor of visitors){
      await db.query(`INSERT INTO sx_workspace_form_rate_limits(tenant_id,form_id,visitor_hash,window_started_at,attempts) VALUES (?,?,?,UTC_TIMESTAMP(3),1) ON DUPLICATE KEY UPDATE attempts=IF(window_started_at<TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(3)),1,attempts+1),window_started_at=IF(window_started_at<TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(3)),UTC_TIMESTAMP(3),window_started_at)`,[form.tenant_id,form.form_id,visitor]);
      const [[limit]]=await db.query('SELECT attempts FROM sx_workspace_form_rate_limits WHERE tenant_id=? AND form_id=? AND visitor_hash=?',[form.tenant_id,form.form_id,visitor]);
      if(Number(limit.attempts)>(visitor===visitorHash?10:500))fail('FORM_RATE_LIMITED');
    }
    const submissionId=uuid(),referenceCode=crypto.randomBytes(6).toString('hex').toUpperCase();
    await db.query(`INSERT INTO sx_workspace_form_submissions(id,tenant_id,form_id,form_version,capture_mode,captured_by_identity_id,idempotency_hash,reference_code,submission_data,attribution_json,consent_text_en,consent_text_ar,consented_at) VALUES (?,?,?,?,'public',NULL,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,[submissionId,form.tenant_id,form.form_id,form.version,tokenHash,referenceCode,JSON.stringify(data),campaignAttribution?JSON.stringify(campaignAttribution):null,schema.consentTextEn,schema.consentTextAr]);
    const uidHash=sha(form.uid),customValues=schema.leadFields?leadFields.values(data.customFields):undefined;
    const lead=await require('../../helper/pipeline/leadPipeline').createManualLead({uid:form.uid,actorType:'system',actorId:null,role:'owner',connection:db,captureFieldContract:leadFields.contract(schema.leadFields),input:{...(schema.leadFields?{customFields:{configurationRevision:schema.leadFields.configurationRevision,values:customValues}}:{}),title:form.name_en,contactName:data.contact_name,learnerName:data.contact_name,mobile:data.phone||'',email:data.email||'',sourceType:'public_form',qualificationData:campaignAttribution?{campaign:campaignAttribution}:undefined}});
    await db.query('UPDATE sx_workspace_form_submissions SET lead_id=? WHERE tenant_id=? AND form_id=? AND id=?',[lead.id,form.tenant_id,form.form_id,submissionId]);
    await db.commit();begun=false;return {referenceCode,leadId:lead.id,repeated:false};
  }catch(error){if(begun)try{await db.rollback();}catch{}if(error.code==='ER_DUP_ENTRY')fail('FORM_SUBMISSION_CONFLICT');throw error;}finally{db.release();}
}

module.exports={context,list,leadFieldOptions,submissions,create,update,publish,publicForm,staffForm,searchStaffLeads,scopedLead,submitStaff,submitPublic};
