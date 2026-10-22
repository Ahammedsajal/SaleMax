'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const forms=require('../modules/platform/workspace-forms');
const {capabilities}=require('../modules/platform/policy');
const base=require('../modules/platform/categories').baseCrm;
const {createCategoryRegistry}=require('../modules/platform/category-registry');
const category=createCategoryRegistry([{...base,capabilities:[...base.capabilities,'portal.forms'],formsAdapter:'generic-lead-capture-v1'}],capabilities).get(base.key,base.version);
const ctx={audience:'tenant',identity:{id:'identity-1'},tenant:{id:'tenant-1',status:'active',categoryKey:base.key,categoryVersion:base.version},membership:{id:'membership-1',tenantId:'tenant-1',role:'owner',status:'active'},category,subscription:{status:'active',capabilities:[...category.capabilities]}};
const input={slug:'contact-request',nameEn:'Contact request',nameAr:'طلب تواصل',schema:{titleEn:'Contact us',titleAr:'تواصل معنا',descriptionEn:'Tell us how to reach you.',descriptionAr:'أخبرنا كيف نتواصل معك.',consentTextEn:'I agree to be contacted.',consentTextAr:'أوافق على التواصل معي.',fields:[{key:'contact_name',labelEn:'Name',labelAr:'الاسم',required:true},{key:'phone',labelEn:'Phone',labelAr:'الهاتف',required:true},{key:'email',labelEn:'Email',labelAr:'البريد الإلكتروني',required:false},{key:'consent',labelEn:'Contact consent',labelAr:'الموافقة على التواصل',required:true}]}};
function fakeDb({formRow=null}={}){
  const calls=[];const db={calls,formRow,async beginTransaction(){calls.push({sql:'BEGIN'});},async commit(){calls.push({sql:'COMMIT'});},async rollback(){calls.push({sql:'ROLLBACK'});},async query(sql,params){calls.push({sql,params});if(sql.includes('FROM sx_workspace_forms WHERE tenant_id=? AND id=? FOR UPDATE'))return [[db.formRow].filter(Boolean)];return [[]];}};return db;
}
test('generic Forms require the exact declared adapter, category capability, tenant and plan access',()=>{
  assert.equal(forms.context(ctx),'generic-lead-capture-v1');
  assert.throws(()=>forms.context({...ctx,category:base}),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>forms.context({...ctx,subscription:{status:'active',capabilities:[]}}),{code:'FEATURE_UNAVAILABLE'});
  assert.throws(()=>forms.context({...ctx,category:{...category,capabilities:category.capabilities.filter(capability=>capability!=='crm.leads')}}),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>forms.context({...ctx,subscription:{...ctx.subscription,capabilities:ctx.subscription.capabilities.filter(capability=>capability!=='crm.leads')}}),{code:'FEATURE_UNAVAILABLE'});
  assert.throws(()=>forms.context({...ctx,membership:{...ctx.membership,role:'manager',customPermissions:['forms.manage']}}),{code:'PERMISSION_DENIED'});
  assert.throws(()=>forms.context({...ctx,membership:{...ctx.membership,tenantId:'tenant-2'}}),{code:'TENANT_CONTEXT_REQUIRED'});
});
test('shared Forms router selects the generic service only for its declared category adapter',()=>{
  const route=require('../modules/platform/training-form-router');
  assert.equal(route.formsServiceForCategory(category),forms);
  assert.notEqual(route.formsServiceForCategory(base),forms);
  assert.equal(route.formsServiceForCategory(base),require('../modules/platform/training-forms'));
  assert.equal(route.formsServiceForCategory(trainingCategory()),require('../modules/platform/training-forms'));
});
function trainingCategory(){return require('../modules/platform/categories').trainingCenter;}
test('generic draft create and update use isolated workspace tables and tenant predicates',async()=>{
  const db=fakeDb(),created=await forms.create(db,ctx,input);
  assert.equal(created.status,'draft');assert.equal(created.draftRevision,1);
  const insert=db.calls.find(call=>call.sql.startsWith('INSERT INTO sx_workspace_forms'));
  assert.ok(insert);assert.equal(insert.params[1],ctx.tenant.id);assert.equal(JSON.parse(insert.params[5]).templateKey,null);
  db.formRow={draft_revision:1,published_version:null};
  const updated=await forms.update(db,ctx,created.id,1,{...input,nameEn:'Contact request updated'});
  assert.equal(updated.draftRevision,2);assert.ok(db.calls.some(call=>call.sql.includes('WHERE tenant_id=? AND id=?')&&call.params.includes(ctx.tenant.id)));
  assert.ok(db.calls.some(call=>call.sql.includes("'workspace.form-created'")));
});
test('generic publishing appends immutable versions and rejects stale draft revisions',async()=>{
  const schema=require('../modules/platform/training-forms').formInput(input,'generic-lead-capture-v1').schema;
  const db=fakeDb({formRow:{slug:input.slug,name_en:input.nameEn,name_ar:input.nameAr,draft_schema:JSON.stringify(schema),draft_revision:3,published_version:null,published_draft_revision:null}});
  const published=await forms.publish(db,ctx,'11111111-1111-4111-8111-111111111111',3);
  assert.equal(published.version,1);assert.ok(db.calls.some(call=>call.sql.startsWith('INSERT INTO sx_workspace_form_versions')));assert.ok(db.calls.some(call=>call.sql.startsWith('UPDATE sx_workspace_forms')));
  const stale=fakeDb({formRow:{slug:input.slug,name_en:input.nameEn,name_ar:input.nameAr,draft_schema:JSON.stringify(schema),draft_revision:4,published_version:null,published_draft_revision:null}});
  await assert.rejects(forms.publish(stale,ctx,'11111111-1111-4111-8111-111111111111',3),{code:'STALE_REVISION'});assert.ok(stale.calls.some(call=>call.sql==='ROLLBACK'));
});
test('generic submission listing always scopes count and records to the current tenant',async()=>{
  const db=fakeDb();db.query=async(sql,params)=>{db.calls.push({sql,params});if(sql.includes('COUNT(*) total'))return [[{total:0}]];if(sql.includes('FROM sx_workspace_form_submissions s'))return [[]];return [[]];};
  const result=await forms.submissions(db,ctx,{search:'lead',from:'2026-10-01',to:'2026-10-22'});
  assert.equal(result.total,0);assert.equal(result.page,1);assert.equal(db.calls.filter(call=>call.sql.includes('sx_workspace_form_submissions')).every(call=>call.params.includes(ctx.tenant.id)),true);
  await assert.rejects(forms.submissions(db,ctx,{from:'2026-10-22',to:'2026-10-01'}),{code:'INVALID_DATE_RANGE'});
});
test('public generic submission validates the published contract, is idempotent and creates one Pipeline lead',async()=>{
  const crypto=require('node:crypto'),plans=require('../modules/platform/plans'),categories=require('../modules/platform/categories'),pipeline=require('../helper/pipeline/leadPipeline');
  const original={getCategory:categories.getCategory,entitlements:plans.loadEntitlements,createLead:pipeline.createManualLead};
  const genericCategory=createCategoryRegistry([{...base,capabilities:[...base.capabilities,'portal.forms'],formsAdapter:'generic-lead-capture-v1'}],capabilities).get(base.key,base.version);
  categories.getCategory=(key,version)=>key===base.key&&version===base.version?genericCategory:null;
  plans.loadEntitlements=async()=>({status:'active',capabilities:['portal.forms','crm.leads']});
  const leadId='22222222-2222-4222-8222-222222222222',createdLeads=[];
  pipeline.createManualLead=async input=>{createdLeads.push(input);return {id:leadId};};
  const schema=require('../modules/platform/training-forms').formInput(input,'generic-lead-capture-v1').schema;
  const ownerUid='synthetic-owner-uid';let prior=null;
  const formRow={tenant_id:'tenant-1',tenant_slug:'synthetic-a',tenant_name:'Synthetic A',category_key:base.key,category_version:base.version,uid:ownerUid,legacy_uid_hash:require('node:crypto').createHash('sha256').update(ownerUid).digest('hex'),owner_identity_status:'active',form_id:'11111111-1111-4111-8111-111111111111',version:1,slug:input.slug,form_slug:input.slug,name_en:input.nameEn,name_ar:input.nameAr,schema_json:JSON.stringify(schema)};
  const calls=[];let rollbacks=0,commits=0;const db={async beginTransaction(){},async commit(){commits++;},async rollback(){rollbacks++;},release(){},async query(sql,params){calls.push({sql,params});if(sql.startsWith('SELECT t.id AS tenant_id'))return [[formRow]];if(sql.startsWith('SELECT reference_code AS referenceCode'))return [[prior].filter(Boolean)];if(sql.startsWith('SELECT attempts'))return [[{attempts:1}]];return [[]];}};
  const pool={async getConnection(){return db;}};
  try{
    plans.loadEntitlements=async()=>({status:'active',capabilities:['portal.forms']});
    assert.equal(await forms.publicForm(db,'synthetic-a',input.slug),null,'public lookup requires the Pipeline entitlement as well as Forms');
    await assert.rejects(forms.submitPublic(pool,{tenantSlug:'synthetic-a',formSlug:input.slug,submissionToken:'55555555-5555-4555-8555-555555555555',visitorHash:'c'.repeat(64),expectedFormVersion:1,values:{contact_name:'Synthetic Lead',phone:'+12025550123',consent:true}}),{code:'FORM_NOT_FOUND'});
    assert.equal(createdLeads.length,0);
    plans.loadEntitlements=async()=>({status:'active',capabilities:['portal.forms','crm.leads']});
    const publicForm=await forms.publicForm(db,'synthetic-a',input.slug);assert.equal(publicForm.form.version,1);assert.equal(publicForm.tenant.slug,'synthetic-a');
    const result=await forms.submitPublic(pool,{tenantSlug:'synthetic-a',formSlug:input.slug,submissionToken:'33333333-3333-4333-8333-333333333333',visitorHash:'a'.repeat(64),expectedFormVersion:1,values:{contact_name:'Synthetic Lead',phone:'+12025550123',email:'lead@example.invalid',consent:true}});
    assert.equal(result.leadId,leadId);assert.equal(result.repeated,false);assert.equal(commits,1);assert.equal(createdLeads.length,1);assert.equal(createdLeads[0].input.sourceType,'public_form');
    assert.ok(calls.some(call=>call.sql.startsWith('INSERT INTO sx_workspace_form_submissions')&&call.params[1]==='tenant-1'));
    prior={referenceCode:'FORM00000001',leadId};
    const replay=await forms.submitPublic(pool,{tenantSlug:'synthetic-a',formSlug:input.slug,submissionToken:'33333333-3333-4333-8333-333333333333',visitorHash:'a'.repeat(64),expectedFormVersion:99,values:{}});
    assert.equal(replay.repeated,true);assert.equal(replay.leadId,leadId);assert.equal(createdLeads.length,1);assert.equal(commits,2);
    prior=null;
    await assert.rejects(forms.submitPublic(pool,{tenantSlug:'synthetic-a',formSlug:input.slug,submissionToken:'44444444-4444-4444-8444-444444444444',visitorHash:'b'.repeat(64),expectedFormVersion:2,values:{contact_name:'Synthetic Lead',phone:'+12025550123',consent:true}}),{code:'FORM_VERSION_CHANGED'});
    assert.equal(rollbacks,2);
  }finally{categories.getCategory=original.getCategory;plans.loadEntitlements=original.entitlements;pipeline.createManualLead=original.createLead;}
});
test('generic staff capture uses canonical membership scope, records identity and replays idempotently',async()=>{
  const plans=require('../modules/platform/plans'),categories=require('../modules/platform/categories'),pipeline=require('../helper/pipeline/leadPipeline');
  const original={getCategory:categories.getCategory,entitlements:plans.loadEntitlements,createLead:pipeline.createManualLead};
  const genericCategory=createCategoryRegistry([{...base,capabilities:[...base.capabilities,'portal.forms'],formsAdapter:'generic-lead-capture-v1'}],capabilities).get(base.key,base.version);
  categories.getCategory=(key,version)=>key===base.key&&version===base.version?genericCategory:null;
  plans.loadEntitlements=async()=>({status:'active',capabilities:['portal.forms','crm.leads']});
  const leadId='22222222-2222-4222-8222-222222222222',createdLeads=[];pipeline.createManualLead=async value=>{createdLeads.push(value);return {id:leadId};};
  const schema=require('../modules/platform/training-forms').formInput(input,'generic-lead-capture-v1').schema,session={context:{...ctx,category:genericCategory},actor:{id:17},ownerUid:'synthetic-owner-uid',agent:false};
  let prior=null,commits=0;const calls=[];const db={async beginTransaction(){},async commit(){commits++;},async rollback(){},async query(sql,params){calls.push({sql,params});if(sql.includes('FROM sx_tenants t JOIN sx_workspace_forms'))return [[{tenant_id:ctx.tenant.id,category_key:base.key,category_version:base.version,form_id:'11111111-1111-4111-8111-111111111111',version:1,name_en:input.nameEn,schema_json:JSON.stringify(schema)}]];if(sql.startsWith('SELECT reference_code AS referenceCode'))return [[prior].filter(Boolean)];if(sql.startsWith('INSERT IGNORE INTO sx_workspace_form_submissions'))return [{affectedRows:1}];return [[]];}};
  try{
    const canonicalOnlySession={...session,actor:null};
    const rendered=await forms.staffForm(db,canonicalOnlySession,input.slug);assert.equal(rendered.adapter,'generic-lead-capture-v1');assert.equal(rendered.captureMode,'staff');
    plans.loadEntitlements=async()=>({status:'active',capabilities:['portal.forms']});
    await assert.rejects(forms.submitStaff(db,canonicalOnlySession,input.slug,{submissionToken:'55555555-5555-4555-8555-555555555555',expectedFormVersion:1,values:{contact_name:'Staff lead',phone:'+12025550123',consent:true}}),{code:'FEATURE_UNAVAILABLE'});
    assert.equal(createdLeads.length,0,'staff Forms cannot create Pipeline leads without the lead entitlement');
    plans.loadEntitlements=async()=>({status:'active',capabilities:['portal.forms','crm.leads']});
    const result=await forms.submitStaff(db,canonicalOnlySession,input.slug,{submissionToken:'33333333-3333-4333-8333-333333333333',expectedFormVersion:1,values:{contact_name:'Staff lead',phone:'+12025550123',consent:true}});
    assert.equal(result.leadId,leadId);assert.equal(result.collectorRole,'owner');assert.equal(createdLeads.length,1);assert.equal(createdLeads[0].actorType,'identity');assert.equal(createdLeads[0].actorId,'identity-1');assert.equal(createdLeads[0].input.sourceType,'staff_form');
    assert.ok(calls.some(call=>call.sql.startsWith('INSERT IGNORE INTO sx_workspace_form_submissions')&&call.params[4]==='identity-1'));
    const firstTokenHash=calls.find(call=>call.sql.startsWith('INSERT IGNORE INTO sx_workspace_form_submissions')).params[5];prior={referenceCode:result.referenceCode,leadId};const replay=await forms.submitStaff(db,session,input.slug,{submissionToken:'33333333-3333-4333-8333-333333333333',expectedFormVersion:99,values:{}});assert.equal(replay.repeated,true);assert.equal(createdLeads.length,1);assert.equal(commits,2);
    prior=null;await forms.submitStaff(db,{...session,context:{...session.context,identity:{id:'identity-2'}}},input.slug,{submissionToken:'33333333-3333-4333-8333-333333333333',expectedFormVersion:1,values:{contact_name:'Second staff lead',phone:'+12025550124',consent:true}});const hashes=calls.filter(call=>call.sql.startsWith('INSERT IGNORE INTO sx_workspace_form_submissions')).map(call=>call.params[5]);assert.notEqual(hashes[0],hashes[1],'the same browser token must not replay another staff member\'s submission');assert.equal(createdLeads.length,2);
    await assert.rejects(forms.staffForm(db,{...session,context:{...session.context,membership:{...ctx.membership,role:'accountant'}}},input.slug),{code:'PERMISSION_DENIED'});
  }finally{categories.getCategory=original.getCategory;plans.loadEntitlements=original.entitlements;pipeline.createManualLead=original.createLead;}
});
test('generic staff lead search applies the authenticated agent assignment scope',async()=>{
  const agentCtx={...ctx,membership:{...ctx.membership,role:'agent'}},session={context:agentCtx,actor:{id:17},ownerUid:'synthetic-owner-uid',agent:true},calls=[];
  const db={async query(sql,params){calls.push({sql,params});if(sql.includes('FROM agents'))return [[{id:17}]];if(sql.includes('FROM pipeline_leads'))return [[{id:'lead-1',contactName:'Assigned lead',qualificationData:'{}'}]];return [[]];}};
  const rows=await forms.searchStaffLeads(db,session,'assigned');assert.equal(rows.length,1);
  const query=calls.find(call=>call.sql.includes('FROM pipeline_leads'));assert.match(query.sql,/AND l\.owner_agent_id=\?/);assert.equal(query.params.at(-1),17);
  const denied={...session,agent:false};await assert.rejects(forms.searchStaffLeads(db,denied,'assigned'),{code:'BUSINESS_LINK_INVALID'});
});
