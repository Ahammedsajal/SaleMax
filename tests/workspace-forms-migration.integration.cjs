'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
module.exports=async function workspaceFormsMigrationIntegration(db,{t1,t2,i1,i2,connect}){
  const formId=crypto.randomUUID(),versionId=crypto.randomUUID(),submissionId=crypto.randomUUID();
  await db.query(`INSERT INTO sx_workspace_forms(id,tenant_id,slug,name_en,name_ar,draft_schema,created_by_identity_id,updated_by_identity_id) VALUES (?,?, 'contact-request','Contact request','طلب تواصل',?,?,?)`,[formId,t1,JSON.stringify({fields:[]}),i1,i1]);
  await db.query(`INSERT INTO sx_workspace_form_versions(id,tenant_id,form_id,version,slug,name_en,name_ar,schema_json,published_by_identity_id) VALUES (?,?,?,1,'contact-request','Contact request','طلب تواصل',?,?)`,[versionId,t1,formId,JSON.stringify({fields:[]}),i1]);
  const insertSubmission=`INSERT INTO sx_workspace_form_submissions(id,tenant_id,form_id,form_version,capture_mode,captured_by_identity_id,idempotency_hash,reference_code,submission_data,consent_text_en,consent_text_ar,consented_at) VALUES (?,?,?,?,'public',NULL,?,?,?,'Contact consent','موافقة التواصل',UTC_TIMESTAMP(3))`;
  await db.query(insertSubmission,[submissionId,t1,formId,1,'a'.repeat(64),'FORM00000001',JSON.stringify({contact_name:'Synthetic A'})]);
  await assert.rejects(db.query(insertSubmission,[crypto.randomUUID(),t2,formId,1,'b'.repeat(64),'FORM00000002',JSON.stringify({contact_name:'Synthetic B'})]),{code:'ER_NO_REFERENCED_ROW_2'});
  await assert.rejects(db.query(insertSubmission,[crypto.randomUUID(),t1,formId,1,'a'.repeat(64),'FORM00000003',JSON.stringify({contact_name:'Synthetic duplicate'})]),{code:'ER_DUP_ENTRY'});
  await assert.rejects(db.query(insertSubmission,[crypto.randomUUID(),t1,formId,2,'c'.repeat(64),'FORM00000004',JSON.stringify({contact_name:'Synthetic invalid version'})]),{code:'ER_NO_REFERENCED_ROW_2'});
  const [foreignForms]=await db.query('SELECT id FROM sx_workspace_forms WHERE tenant_id=?',[t2]);assert.equal(foreignForms.length,0);
  await db.query('INSERT INTO sx_workspace_form_rate_limits(tenant_id,form_id,visitor_hash,window_started_at,attempts) VALUES (?,?,?,UTC_TIMESTAMP(3),1)',[t1,formId,'d'.repeat(64)]);
  await assert.rejects(db.query('INSERT INTO sx_workspace_form_rate_limits(tenant_id,form_id,visitor_hash,window_started_at,attempts) VALUES (?,?,?,UTC_TIMESTAMP(3),1)',[t2,formId,'e'.repeat(64)]),{code:'ER_NO_REFERENCED_ROW_2'});

  const forms=require('../modules/platform/workspace-forms'),base=require('../modules/platform/categories').baseCrm;
  const {capabilities}=require('../modules/platform/policy'),{createCategoryRegistry}=require('../modules/platform/category-registry');
  const category=createCategoryRegistry([{...base,capabilities:[...base.capabilities,'portal.forms'],formsAdapter:'generic-lead-capture-v1'}],capabilities).get(base.key,base.version);
  const makeContext=(tenantId,identityId,membershipId,slug)=>({audience:'tenant',identity:{id:identityId},tenant:{id:tenantId,status:'active',categoryKey:base.key,categoryVersion:base.version},membership:{id:membershipId,tenantId,role:'owner',status:'active'},category,subscription:{status:'active',capabilities:[...category.capabilities]},slug});
  const ctxA=makeContext(t1,i1,crypto.randomUUID(),'synthetic-a'),ctxB=makeContext(t2,i2,crypto.randomUUID(),'synthetic-b');
  const input={slug:'service-contact',nameEn:'Service contact',nameAr:'تواصل الخدمات',schema:{titleEn:'Contact us',titleAr:'تواصل معنا',descriptionEn:'Tell us how to reach you.',descriptionAr:'أخبرنا كيف نتواصل معك.',consentTextEn:'I agree to be contacted.',consentTextAr:'أوافق على التواصل معي.',fields:[{key:'contact_name',labelEn:'Name',labelAr:'الاسم',required:true},{key:'phone',labelEn:'Phone',labelAr:'الهاتف',required:true},{key:'email',labelEn:'Email',labelAr:'البريد الإلكتروني',required:false},{key:'consent',labelEn:'Contact consent',labelAr:'الموافقة على التواصل',required:true}]}};
  const formA=await forms.create(db,ctxA,input),formB=await forms.create(db,ctxB,input);
  assert.notEqual(formA.id,formB.id);
  const listedA=await forms.list(db,ctxA),listedB=await forms.list(db,ctxB);
  assert.ok(listedA.some(row=>row.id===formA.id));assert.ok(!listedA.some(row=>row.id===formB.id));
  assert.ok(listedB.some(row=>row.id===formB.id));assert.ok(!listedB.some(row=>row.id===formA.id));
  await assert.rejects(forms.update(db,ctxA,formB.id,1,input),{code:'FORM_NOT_FOUND'});
  await assert.rejects(forms.publish(db,ctxA,formB.id,1),{code:'FORM_NOT_FOUND'});

  const writers=await Promise.all([connect(),connect()]);let writeResults;
  try{writeResults=await Promise.allSettled(writers.map((writer,index)=>forms.update(writer,ctxA,formA.id,1,{...input,nameEn:`Concurrent edit ${index+1}`})));}
  finally{await Promise.all(writers.map(writer=>writer.end()));}
  assert.equal(writeResults.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(writeResults.filter(result=>result.status==='rejected'&&result.reason.code==='STALE_REVISION').length,1);
  const publishedA=await forms.publish(db,ctxA,formA.id,2),publishedB=await forms.publish(db,ctxB,formB.id,1);
  assert.equal(publishedA.version,1);assert.equal(publishedB.version,1);

  const submissionA=crypto.randomUUID(),submissionB=crypto.randomUUID(),sameHash='f'.repeat(64);
  const addServiceSubmission=(id,tenantId,form)=>db.query(`INSERT INTO sx_workspace_form_submissions(id,tenant_id,form_id,form_version,capture_mode,captured_by_identity_id,idempotency_hash,reference_code,submission_data,consent_text_en,consent_text_ar,consented_at) VALUES (?,?,?,1,'public',NULL,?,?,?,'Contact consent','موافقة التواصل',UTC_TIMESTAMP(3))`,[id,tenantId,form.id,sameHash,'FORM00000002',JSON.stringify({contact_name:'Synthetic lead'})]);
  await addServiceSubmission(submissionA,t1,formA);await addServiceSubmission(submissionB,t2,formB);
  const submissionsA=await forms.submissions(db,ctxA),submissionsB=await forms.submissions(db,ctxB);
  assert.equal(submissionsA.total,2);assert.equal(submissionsB.total,1);
  assert.ok(submissionsA.items.every(row=>row.formId!==formB.id));assert.ok(submissionsB.items.every(row=>row.formId===formB.id));
  assert.equal((await forms.submissions(db,ctxA,{submissionId:submissionB})).total,0);

  return {workspaceFormsTenantForeignKeys:true,workspaceFormsSubmissionIdempotency:true,workspaceFormsVersionReference:true,workspaceFormsRateLimitTenantBinding:true,workspaceFormsServiceTwoTenantIsolation:true,workspaceFormsCrossTenantIdDenial:true,workspaceFormsConcurrentStaleWrite:true};
};
