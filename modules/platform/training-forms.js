'use strict';
const crypto=require('node:crypto');
const {decision}=require('./policy');
const plans=require('./plans');
const {trainingCenter}=require('./categories');
const pipeline=require('../../helper/pipeline/leadPipeline');
const uuid=()=>crypto.randomUUID();
const fail=code=>{throw Object.assign(new Error(code),{code});};
const keys=new Set(['contact_name','learner_name','phone','email','course_id','preferred_date','consent']);
function context(ctx){if(!ctx||ctx.audience!=='tenant'||ctx.tenant?.status!=='active'||ctx.membership?.status!=='active'||ctx.membership?.tenantId!==ctx.tenant?.id)fail('TENANT_CONTEXT_REQUIRED');const result=decision(ctx,{capability:'portal.forms',permission:'forms.manage'});if(!result.allowed)fail(result.code);}
function formInput(value){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_FORM');
  const slug=String(value.slug||'').trim().toLowerCase();
  if(!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(slug))fail('INVALID_FORM_SLUG');
  for(const key of ['nameEn','nameAr'])if(typeof value[key]!=='string'||!value[key].trim()||value[key].trim().length>120)fail('INVALID_FORM_NAME');
  const schema=value.schema;
  if(!schema||typeof schema!=='object'||Array.isArray(schema)||!Array.isArray(schema.fields)||schema.fields.length<2||schema.fields.length>16)fail('INVALID_FORM_SCHEMA');
  for(const key of ['titleEn','titleAr','descriptionEn','descriptionAr','consentTextEn','consentTextAr'])if(schema[key]!==undefined&&(typeof schema[key]!=='string'||schema[key].length>1000))fail('INVALID_FORM_SCHEMA');
  const seen=new Set();
  const fields=schema.fields.map(field=>{
    if(!field||typeof field!=='object'||Array.isArray(field)||!keys.has(field.key)||seen.has(field.key)||typeof field.required!=='boolean')fail('INVALID_FORM_FIELD');
    seen.add(field.key);
    for(const label of ['labelEn','labelAr'])if(typeof field[label]!=='string'||!field[label].trim()||field[label].trim().length>100)fail('INVALID_FORM_FIELD');
    return {key:field.key,required:field.required,labelEn:field.labelEn.trim(),labelAr:field.labelAr.trim()};
  });
  if(!seen.has('contact_name')||!fields.find(field=>field.key==='contact_name')?.required||!fields.some(field=>(field.key==='phone'||field.key==='email')&&field.required)||!seen.has('consent'))fail('FORM_REQUIRED_FIELDS_MISSING');
  const consent=fields.find(field=>field.key==='consent');if(!consent.required)fail('FORM_CONSENT_REQUIRED');
  const titleEn=String(schema.titleEn||value.nameEn).trim(),titleAr=String(schema.titleAr||value.nameAr).trim(),consentTextEn=String(schema.consentTextEn||'').trim(),consentTextAr=String(schema.consentTextAr||'').trim();
  if(!titleEn||!titleAr||!consentTextEn||!consentTextAr)fail('FORM_REQUIRED_FIELDS_MISSING');
  return {slug,nameEn:value.nameEn.trim(),nameAr:value.nameAr.trim(),schema:{titleEn,titleAr,descriptionEn:String(schema.descriptionEn||'').trim(),descriptionAr:String(schema.descriptionAr||'').trim(),consentTextEn,consentTextAr,fields}};
}
async function list(db,ctx){context(ctx);const [rows]=await db.query(`SELECT f.id,f.slug,f.published_slug AS publishedSlug,f.name_en AS nameEn,f.name_ar AS nameAr,f.draft_schema AS schemaJson,f.draft_revision AS draftRevision,f.published_version AS publishedVersion,f.published_draft_revision AS publishedDraftRevision,f.status,f.updated_at AS updatedAt,t.slug AS tenantSlug FROM sx_training_forms f JOIN sx_tenants t ON t.id=f.tenant_id WHERE f.tenant_id=? ORDER BY f.updated_at DESC,f.id`,[ctx.tenant.id]);return rows.map(row=>({...row,schema:typeof row.schemaJson==='string'?JSON.parse(row.schemaJson):row.schemaJson,schemaJson:undefined,draftRevision:Number(row.draftRevision),publishedVersion:row.publishedVersion==null?null:Number(row.publishedVersion),publishedDraftRevision:row.publishedDraftRevision==null?null:Number(row.publishedDraftRevision),hasUnpublishedChanges:row.publishedVersion!=null&&Number(row.publishedDraftRevision)!==Number(row.draftRevision),publicPath:row.publishedVersion==null?null:`/p/${row.tenantSlug}/forms/${row.publishedSlug}`}));}
async function create(db,ctx,input){context(ctx);const form=formInput(input);const id=uuid();await db.beginTransaction();try{await db.query(`INSERT INTO sx_training_forms(id,tenant_id,slug,name_en,name_ar,draft_schema,created_by_identity_id,updated_by_identity_id) VALUES (?,?,?,?,?,?,?,?)`,[id,ctx.tenant.id,form.slug,form.nameEn,form.nameAr,JSON.stringify(form.schema),ctx.identity.id,ctx.identity.id]);await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','training.form-created','training-form',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({slug:form.slug}),uuid()]);await db.commit();return {id,...form,draftRevision:1,status:'draft',publishedVersion:null};}catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('FORM_SLUG_EXISTS');throw error;}}
async function update(db,ctx,id,expectedRevision,input){context(ctx);if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail('INVALID_REVISION');const form=formInput(input);await db.beginTransaction();try{const [[current]]=await db.query('SELECT draft_revision,published_version FROM sx_training_forms WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);if(!current)fail('FORM_NOT_FOUND');if(Number(current.draft_revision)!==expectedRevision)fail('STALE_REVISION');await db.query(`UPDATE sx_training_forms SET slug=?,name_en=?,name_ar=?,draft_schema=?,draft_revision=draft_revision+1,updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?`,[form.slug,form.nameEn,form.nameAr,JSON.stringify(form.schema),ctx.identity.id,ctx.tenant.id,id]);await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','training.form-draft-updated','training-form',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({draftRevision:expectedRevision+1}),uuid()]);await db.commit();return {id,...form,draftRevision:expectedRevision+1,status:current.published_version==null?'draft':'published',hasUnpublishedChanges:current.published_version!=null};}catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('FORM_SLUG_EXISTS');throw error;}}
async function publish(db,ctx,id,expectedRevision){context(ctx);if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail('INVALID_REVISION');await db.beginTransaction();try{const [[form]]=await db.query('SELECT slug,name_en,name_ar,draft_schema,draft_revision,published_version,published_draft_revision,status FROM sx_training_forms WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);if(!form)fail('FORM_NOT_FOUND');if(Number(form.draft_revision)!==expectedRevision)fail('STALE_REVISION');if(form.published_version!=null&&Number(form.published_draft_revision)===expectedRevision){await db.commit();return {id,slug:form.slug,version:Number(form.published_version),status:'published',repeated:true};}const schema=typeof form.draft_schema==='string'?JSON.parse(form.draft_schema):form.draft_schema;const version=Number(form.published_version||0)+1;const publishedId=uuid();await db.query(`INSERT INTO sx_training_form_versions(id,tenant_id,form_id,version,slug,name_en,name_ar,schema_json,published_by_identity_id) VALUES (?,?,?,?,?,?,?,?,?)`,[publishedId,ctx.tenant.id,id,version,form.slug,form.name_en,form.name_ar,JSON.stringify(schema),ctx.identity.id]);await db.query(`UPDATE sx_training_forms SET published_version=?,published_draft_revision=?,published_slug=?,status='published',updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?`,[version,expectedRevision,form.slug,ctx.identity.id,ctx.tenant.id,id]);await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','training.form-published','training-form',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({version}),uuid()]);await db.commit();return {id,slug:form.slug,version,status:'published'};}catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('FORM_SLUG_EXISTS');throw error;}}
async function publicForm(db,tenantSlug,formSlug){if(typeof tenantSlug!=='string'||typeof formSlug!=='string'||!/^[-a-z0-9]{1,80}$/.test(tenantSlug)||!/^[-a-z0-9]{1,48}$/.test(formSlug))return null;const [[row]]=await db.query(`SELECT t.id AS tenant_id,t.name AS tenant_name,t.slug AS tenant_slug,f.id AS form_id,v.slug AS form_slug,v.name_en,v.name_ar,v.version,v.schema_json FROM sx_tenants t JOIN sx_training_forms f ON f.tenant_id=t.id AND f.status='published' JOIN sx_training_form_versions v ON v.tenant_id=f.tenant_id AND v.form_id=f.id AND v.version=f.published_version WHERE t.slug=? AND v.slug=? AND t.category_key='training_center' AND t.category_version=1 AND t.status='active' LIMIT 1`,[tenantSlug,formSlug]);if(!row)return null;const entitlements=await plans.loadEntitlements(db,row.tenant_id);if(!entitlements||!['active','trial','grace'].includes(entitlements.status)||!entitlements.capabilities.includes('portal.forms'))return null;const schema=typeof row.schema_json==='string'?JSON.parse(row.schema_json):row.schema_json;let courses=[];if(schema.fields.some(field=>field.key==='course_id')){const [items]=await db.query(`SELECT c.id,c.name_en AS nameEn,c.name_ar AS nameAr FROM sx_training_courses c WHERE c.tenant_id=(SELECT id FROM sx_tenants WHERE slug=?) AND c.status='active' AND EXISTS (SELECT 1 FROM sx_training_offers o WHERE o.tenant_id=c.tenant_id AND o.course_id=c.id AND o.status='active' AND (o.valid_from IS NULL OR o.valid_from<=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar'))) AND (o.valid_until IS NULL OR o.valid_until>=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar')))) ORDER BY c.name_en`,[tenantSlug]);courses=items;}return {tenant:{name:row.tenant_name,slug:row.tenant_slug},form:{slug:row.form_slug,nameEn:row.name_en,nameAr:row.name_ar,version:Number(row.version),schema},courses};}
function sha(value){return crypto.createHash('sha256').update(value).digest('hex');}
function cleanSubmission(schema,values){
  if(!values||typeof values!=='object'||Array.isArray(values))fail('INVALID_SUBMISSION');
  const allowed=new Set(schema.fields.map(field=>field.key));if(Object.keys(values).some(key=>!allowed.has(key)))fail('INVALID_SUBMISSION');
  const result={};
  for(const field of schema.fields){const value=values[field.key];if(value===undefined||value===null||value===''){if(field.required)fail('REQUIRED_FIELD_MISSING');continue;}
    if(field.key==='consent'){if(value!==true)fail('CONSENT_REQUIRED');result.consent=true;continue;}
    if(typeof value!=='string'||value.length>1000)fail('INVALID_SUBMISSION');const trimmed=value.trim();if(!trimmed){if(field.required)fail('REQUIRED_FIELD_MISSING');continue;}
    if(field.key==='contact_name'||field.key==='learner_name'){if(trimmed.length>255)fail('INVALID_SUBMISSION');result[field.key]=trimmed;}
    else if(field.key==='phone'){const phone=pipeline.normalizePhone(trimmed);if(!phone)fail('INVALID_PHONE');result.phone=phone;}
    else if(field.key==='email'){const email=pipeline.normalizeEmail(trimmed);if(!email)fail('INVALID_EMAIL');result.email=email;}
    else if(field.key==='course_id'){if(!/^[0-9a-f-]{36}$/i.test(trimmed))fail('INVALID_COURSE');result.course_id=trimmed;}
    else if(field.key==='preferred_date'){const parsed=/^\d{4}-\d{2}-\d{2}$/.test(trimmed)?new Date(trimmed+'T00:00:00Z'):null;if(!parsed||Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==trimmed)fail('INVALID_PREFERRED_DATE');result.preferred_date=trimmed;}
  }
  if(!result.contact_name||(!result.phone&&!result.email)||result.consent!==true)fail('REQUIRED_FIELD_MISSING');
  return result;
}
async function staffContext(db,actor){
  if(!actor||typeof actor.uid!=='string'||!['owner','manager','agent'].includes(actor.role))fail('PERMISSION_DENIED');
  const [rows]=await db.query(`SELECT u.id AS owner_id,u.uid,t.id AS tenant_id,t.slug AS tenant_slug,t.status AS tenant_status,t.category_key,t.category_version,m.id AS owner_membership_id,m.identity_id AS owner_identity_id,m.role AS owner_role,m.status AS owner_membership_status,i.status AS owner_identity_status,o.legacy_uid_hash
    FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
    JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
    JOIN sx_identities i ON i.id=m.identity_id WHERE u.uid=? LIMIT 2 FOR UPDATE`,[actor.uid]);
  if(rows.length!==1)fail('BUSINESS_LINK_INVALID');const row=rows[0];
  if(row.legacy_uid_hash!==sha(actor.uid)||row.owner_role!=='owner'||row.owner_membership_status!=='active'||row.owner_identity_status!=='active')fail('BUSINESS_LINK_INVALID');
  if(row.tenant_status!=='active'||row.category_key!==trainingCenter.key||Number(row.category_version)!==trainingCenter.version)fail('CATEGORY_UNAVAILABLE');
  let membership={id:row.owner_membership_id,tenantId:row.tenant_id,role:'owner',status:'active',delegatedPermissions:[]},identity={id:row.owner_identity_id};
  if(actor.role==='manager'){
    const [[manager]]=await db.query(`SELECT m.id,m.identity_id,o.legacy_uid_hash,i.email_normalized,i.status AS identity_status
      FROM user staff JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(staff.id AS CHAR) AND o.tenant_id=?
      JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id AND m.role='manager' AND m.status='active'
      JOIN sx_identities i ON i.id=m.identity_id
      WHERE staff.id=? AND staff.uid=? LIMIT 1 FOR UPDATE`,[row.tenant_id,actor.legacyUserId,actor.legacyUid]);
    if(!manager||manager.legacy_uid_hash!==sha(actor.legacyUid)||manager.identity_status!=='active'||manager.identity_id!==actor.identityId||manager.id!==actor.membershipId)fail('PERMISSION_DENIED');
    membership={id:manager.id,tenantId:row.tenant_id,role:'manager',status:'active',delegatedPermissions:[]};identity={id:manager.identity_id};
  }
  if(actor.role==='agent'){
    const [[agent]]=await db.query("SELECT id,uid FROM agents WHERE id=? AND owner_uid=? AND role='agent' AND is_active=1 LIMIT 1 FOR UPDATE",[actor.agentId,actor.uid]);
    if(!agent||String(agent.id)!==String(actor.agentId)||(actor.agentUid&&agent.uid!==actor.agentUid))fail('PERMISSION_DENIED');
    membership={id:`legacy-agent-${agent.id}`,tenantId:row.tenant_id,role:'agent',status:'active',delegatedPermissions:[]};
  }
  const subscription=await plans.loadEntitlements(db,row.tenant_id);
  const ctx={audience:'tenant',identity,tenant:{id:row.tenant_id,status:row.tenant_status,categoryKey:row.category_key,categoryVersion:Number(row.category_version)},membership,category:trainingCenter,subscription,runtimeReady:{}};
  const access=decision(ctx,{capability:'portal.forms',permission:'forms.capture'});if(!access.allowed)fail(access.code);
  return {...ctx,ownerUid:actor.uid,tenantSlug:row.tenant_slug};
}
async function publishedFormForTenant(db,tenantId,formSlug){
  if(typeof formSlug!=='string'||!/^[-a-z0-9]{1,48}$/.test(formSlug))fail('FORM_NOT_FOUND');
  const [[form]]=await db.query(`SELECT f.id AS form_id,v.version,v.slug,v.name_en,v.name_ar,v.schema_json
    FROM sx_training_forms f JOIN sx_training_form_versions v ON v.tenant_id=f.tenant_id AND v.form_id=f.id AND v.version=f.published_version
    WHERE f.tenant_id=? AND f.status='published' AND v.slug=? LIMIT 1 FOR UPDATE`,[tenantId,formSlug]);
  if(!form)fail('FORM_NOT_FOUND');return form;
}
async function staffForm(pool,actor,formSlug){
  const db=await pool.getConnection();try{const ctx=await staffContext(db,actor);const form=await publishedFormForTenant(db,ctx.tenant.id,formSlug);const definition=await publicForm(db,ctx.tenantSlug,form.slug);if(!definition)fail('FORM_NOT_FOUND');return {...definition,captureMode:'staff'};}finally{db.release();}
}
async function persistSubmission(db,{form,tenantId,uid,formSlug,submissionToken,values,captureMode,visitorHash,actor}){
  const entitlements=await plans.loadEntitlements(db,tenantId);if(!entitlements||!['active','trial','grace'].includes(entitlements.status)||!entitlements.capabilities.includes('portal.forms'))fail('FEATURE_UNAVAILABLE');
  const schema=typeof form.schema_json==='string'?JSON.parse(form.schema_json):form.schema_json;const data=cleanSubmission(schema,values);let courseTitle='';
  if(schema.fields.some(field=>field.key==='course_id')){
    if(!data.course_id&&schema.fields.find(field=>field.key==='course_id').required)fail('REQUIRED_FIELD_MISSING');
    if(data.course_id){const [[course]]=await db.query(`SELECT c.name_en FROM sx_training_courses c WHERE c.tenant_id=? AND c.id=? AND c.status='active' AND EXISTS (SELECT 1 FROM sx_training_offers o WHERE o.tenant_id=c.tenant_id AND o.course_id=c.id AND o.status='active' AND (o.valid_from IS NULL OR o.valid_from<=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar'))) AND (o.valid_until IS NULL OR o.valid_until>=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar')))) LIMIT 1`,[tenantId,data.course_id]);if(!course)fail('INVALID_COURSE');courseTitle=course.name_en;}
  }
  const tokenHash=sha(submissionToken),reference=crypto.randomBytes(6).toString('hex').toUpperCase(),submissionId=uuid();
  const [reservation]=await db.query(`INSERT IGNORE INTO sx_training_form_submissions(id,tenant_id,form_id,form_version,capture_mode,captured_by_type,captured_by_id,idempotency_hash,reference_code,submission_data,consent_text_en,consent_text_ar,consented_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,[submissionId,tenantId,form.form_id,form.version,captureMode,actor?.actorType||null,actor?.actorId||null,tokenHash,reference,JSON.stringify(data),schema.consentTextEn,schema.consentTextAr]);
  if(!reservation.affectedRows){const [[prior]]=await db.query('SELECT reference_code,lead_id FROM sx_training_form_submissions WHERE tenant_id=? AND form_id=? AND idempotency_hash=? LIMIT 1',[tenantId,form.form_id,tokenHash]);return {referenceCode:prior.reference_code,leadId:prior.lead_id,repeated:true};}
  if(visitorHash){const visitors=[visitorHash,sha('form:'+tenantId+':'+form.form_id)];for(const visitor of visitors){await db.query(`INSERT INTO sx_training_form_rate_limits(tenant_id,form_id,visitor_hash,window_started_at,attempts) VALUES (?,?,?,UTC_TIMESTAMP(3),1) ON DUPLICATE KEY UPDATE attempts=IF(window_started_at<TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(3)),1,attempts+1),window_started_at=IF(window_started_at<TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(3)),UTC_TIMESTAMP(3),window_started_at)`,[tenantId,form.form_id,visitor]);const [[limit]]=await db.query('SELECT attempts FROM sx_training_form_rate_limits WHERE tenant_id=? AND form_id=? AND visitor_hash=?',[tenantId,form.form_id,visitor]);if(Number(limit.attempts)>(visitor===visitorHash?10:500))fail('FORM_RATE_LIMITED');}}
  const lead=await pipeline.createManualLead({uid,actorType:captureMode==='public'?'system':actor.actorType,actorId:captureMode==='public'?null:actor.actorId,agentId:actor?.agentId,role:captureMode==='public'?'owner':actor.role,connection:db,input:{title:courseTitle||form.name_en,contactName:data.contact_name,learnerName:data.learner_name||data.contact_name,mobile:data.phone||'',email:data.email||'',sourceType:captureMode==='public'?'public_form':'staff_form'}});
  await db.query('UPDATE sx_training_form_submissions SET lead_id=? WHERE id=? AND tenant_id=?',[lead.id,submissionId,tenantId]);
  return {referenceCode:reference,leadId:lead.id,repeated:false};
}
async function submitPublic(pool,{tenantSlug,formSlug,submissionToken,values,visitorHash}){
  if(typeof submissionToken!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionToken)||typeof visitorHash!=='string'||!/^[0-9a-f]{64}$/.test(visitorHash))fail('INVALID_SUBMISSION');
  const db=await pool.getConnection();let begun=false;try{
    await db.beginTransaction();begun=true;
    const [[form]]=await db.query(`SELECT t.id AS tenant_id,t.slug AS tenant_slug,u.uid,own.legacy_uid_hash,f.id AS form_id,v.version,v.slug,v.name_en,v.name_ar,v.schema_json FROM sx_tenants t JOIN sx_training_forms f ON f.tenant_id=t.id AND f.status='published' JOIN sx_training_form_versions v ON v.tenant_id=f.tenant_id AND v.form_id=f.id AND v.version=f.published_version JOIN sx_legacy_ownership own ON own.tenant_id=t.id AND own.source_table='user' JOIN sx_memberships owner_membership ON owner_membership.tenant_id=own.tenant_id AND owner_membership.id=own.membership_id AND owner_membership.role='owner' AND owner_membership.status='active' JOIN user u ON CAST(u.id AS CHAR)=own.source_id WHERE t.slug=? AND v.slug=? AND t.category_key='training_center' AND t.category_version=1 AND t.status='active' LIMIT 1 FOR UPDATE`,[tenantSlug,formSlug]);
    if(!form)fail('FORM_NOT_FOUND');if(!form.legacy_uid_hash||sha(form.uid)!==form.legacy_uid_hash)fail('BUSINESS_LINK_INVALID');
    const result=await persistSubmission(db,{form,tenantId:form.tenant_id,uid:form.uid,formSlug,captureMode:'public',submissionToken,values,visitorHash});
    await db.commit();begun=false;return result;
  }catch(error){if(begun)try{await db.rollback();}catch{}if(error.code==='ER_DUP_ENTRY')fail('FORM_SUBMISSION_CONFLICT');throw error;}finally{db.release();}
}
async function submitStaff(pool,actor,formSlug,{submissionToken,values}){
  if(typeof submissionToken!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionToken))fail('INVALID_SUBMISSION');
  const db=await pool.getConnection();let begun=false;try{
    await db.beginTransaction();begun=true;const ctx=await staffContext(db,actor);const form=await publishedFormForTenant(db,ctx.tenant.id,formSlug);
    const result=await persistSubmission(db,{form,tenantId:ctx.tenant.id,uid:ctx.ownerUid,formSlug,submissionToken,values,captureMode:'staff',actor:{actorType:actor.role==='agent'?'agent':'user',actorId:actor.role==='agent'?String(actor.agentId):actor.role==='manager'?actor.identityId:actor.uid,agentId:actor.agentId,role:actor.role}});
    await db.commit();begun=false;return {...result,collectorRole:actor.role};
  }catch(error){if(begun)try{await db.rollback();}catch{}if(error.code==='ER_DUP_ENTRY')fail('FORM_SUBMISSION_CONFLICT');throw error;}finally{db.release();}
}
module.exports={formInput,list,create,update,publish,publicForm,cleanSubmission,submitPublic,staffForm,submitStaff};
