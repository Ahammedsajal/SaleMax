'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
module.exports=async function workspaceFormsMigrationIntegration(db,{t1,t2,i1,i2}){
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
  return {workspaceFormsTenantForeignKeys:true,workspaceFormsSubmissionIdempotency:true,workspaceFormsVersionReference:true,workspaceFormsRateLimitTenantBinding:true};
};
