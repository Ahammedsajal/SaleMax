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

  const categories=require('../modules/platform/categories'),base=categories.baseCrm;
  const {capabilities}=require('../modules/platform/policy'),{createCategoryRegistry}=require('../modules/platform/category-registry');
  const category=createCategoryRegistry([{...base,capabilities:[...base.capabilities,'portal.forms'],formsAdapter:'generic-lead-capture-v1'}],capabilities).get(base.key,base.version);
  const original={getCategory:categories.getCategory};
  categories.getCategory=(key,version)=>key===base.key&&version===base.version?category:original.getCategory(key,version);
  const forms=require('../modules/platform/workspace-forms'),plans=require('../modules/platform/plans');
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

  const ownerUidA='synthetic-owner-a',ownerUidB='synthetic-owner-b',ownerUserA=990001,ownerUserB=990002;
  const sha=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
  const membershipA=crypto.randomUUID(),membershipB=crypto.randomUUID();
  const planA=crypto.randomUUID(),planB=crypto.randomUUID(),versionA=crypto.randomUUID(),versionB=crypto.randomUUID(),assignmentA=crypto.randomUUID(),assignmentB=crypto.randomUUID();
  await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'owner','active'),(?,?,?,'owner','active')",[membershipA,t1,i1,membershipB,t2,i2]);
  await db.query('INSERT INTO sx_plans(id,name) VALUES (?,?),(?,?)',[planA,'Synthetic generic CRM A',planB,'Synthetic Forms only B']);
  const roleLimits=JSON.stringify({owner:1,accountant:1,manager:1,agent:7});
  await db.query("INSERT INTO sx_plan_versions(id,plan_id,version,category_key,category_version,status,capabilities,role_limits,published_at) VALUES (?,?,1,?,1,'published',?,?,UTC_TIMESTAMP(3)),(?,?,1,?,1,'published',?,?,UTC_TIMESTAMP(3))",[versionA,planA,base.key,JSON.stringify(['portal.forms','crm.leads']),roleLimits,versionB,planB,base.key,JSON.stringify(['portal.forms']),roleLimits]);
  await db.query("INSERT INTO sx_plan_assignments(id,tenant_id,plan_version_id,role_limits,status,effective_from,expires_at) VALUES (?,?,?,?,'active',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 DAY)),(?,?,?,?,'active',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 DAY))",[assignmentA,t1,versionA,roleLimits,assignmentB,t2,versionB,roleLimits]);
  await db.query('INSERT INTO `user`(id,uid) VALUES (?,?),(?,?)',[ownerUserA,ownerUidA,ownerUserB,ownerUidB]);
  await db.query("INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash) VALUES ('user',?,?,?,?),('user',?,?,?,?)",[String(ownerUserA),t1,membershipA,sha(ownerUidA),String(ownerUserB),t2,membershipB,sha(ownerUidB)]);
  const pipelineCount=async()=>{const [[row]]=await db.query('SELECT COUNT(*) AS total FROM pipeline_leads WHERE uid_hash IN (?,?)',[sha(ownerUidA),sha(ownerUidB)]);return Number(row.total);};
  try{
    const entitlementA=await plans.loadEntitlements(db,t1),entitlementB=await plans.loadEntitlements(db,t2);
    assert.equal(entitlementA.status,'active');assert.ok(entitlementA.capabilities.includes('crm.leads'));
    const publicA=await forms.publicForm(db,ctxA.slug,'service-contact');assert.equal(publicA.tenant.slug,ctxA.slug);
    assert.equal(await forms.publicForm(db,ctxB.slug,'service-contact'),null,'public lookup must require both Forms and CRM Leads entitlements');
    const pool={async getConnection(){const connection=await connect();connection.release=()=>connection.end();return connection;}},publicToken='77777777-7777-4777-8777-777777777777',visitor='a'.repeat(64),campaign={utmSource:'synthetic',utmCampaign:'forms-integration',landingPage:'https://example.invalid/lead?secret=discarded'};
    const deniedPublic=await forms.submitPublic(pool,{tenantSlug:ctxB.slug,formSlug:'service-contact',submissionToken:'88888888-8888-4888-8888-888888888888',visitorHash:'b'.repeat(64),expectedFormVersion:1,values:{contact_name:'Denied synthetic',phone:'+12025550124',consent:true}}).then(()=>null,error=>error);
    assert.equal(deniedPublic?.code,'FORM_NOT_FOUND',deniedPublic?.message||'unentitled public submission unexpectedly succeeded');
    assert.equal(await pipelineCount(),0,'an unentitled tenant must not create a Pipeline lead');
    const publicResult=await forms.submitPublic(pool,{tenantSlug:ctxA.slug,formSlug:'service-contact',submissionToken:publicToken,visitorHash:visitor,campaignAttribution:campaign,expectedFormVersion:1,values:{contact_name:'Synthetic public lead',phone:'+12025550123',email:'public@example.invalid',consent:true}});
    assert.equal(publicResult.repeated,false);assert.equal(await pipelineCount(),1);
    const publicReplay=await forms.submitPublic(pool,{tenantSlug:ctxA.slug,formSlug:'service-contact',submissionToken:publicToken,visitorHash:visitor,expectedFormVersion:99,values:{}});
    assert.equal(publicReplay.repeated,true);assert.equal(publicReplay.leadId,publicResult.leadId);assert.equal(await pipelineCount(),1);
    const ownerSession={context:ctxA,ownerUid:ownerUidA};
    assert.equal((await forms.staffForm(db,ownerSession,'service-contact')).captureMode,'staff');
    const staffToken='99999999-9999-4999-8999-999999999999';
    const staffResult=await forms.submitStaff(db,ownerSession,'service-contact',{submissionToken:staffToken,expectedFormVersion:1,values:{contact_name:'Synthetic staff lead',phone:'+12025550125',consent:true}});
    assert.equal(staffResult.repeated,false);assert.equal(staffResult.collectorRole,'owner');assert.equal(await pipelineCount(),2);
    const staffReplay=await forms.submitStaff(db,ownerSession,'service-contact',{submissionToken:staffToken,expectedFormVersion:99,values:{}});
    assert.equal(staffReplay.repeated,true);assert.equal(staffReplay.leadId,staffResult.leadId);assert.equal(await pipelineCount(),2);
    const revokedSession={...ownerSession,context:{...ctxA,membership:{...ctxA.membership,status:'inactive'}}};
    const revokedError=await forms.submitStaff(db,revokedSession,'service-contact',{submissionToken:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',expectedFormVersion:1,values:{contact_name:'Revoked synthetic',phone:'+12025550127',consent:true}}).then(()=>null,error=>error);
    assert.equal(revokedError?.code,'TENANT_CONTEXT_REQUIRED');assert.equal(await pipelineCount(),2,'an inactive membership context must not create a Pipeline lead');
    const [captureRows]=await db.query('SELECT capture_mode,captured_by_identity_id,idempotency_hash,lead_id,submission_data,attribution_json,consent_text_en,consent_text_ar FROM sx_workspace_form_submissions WHERE tenant_id=? AND form_id=?',[t1,formA.id]);
    const publicRow=captureRows.find(row=>row.capture_mode==='public'&&row.lead_id===publicResult.leadId),staffRow=captureRows.find(row=>row.capture_mode==='staff'&&row.lead_id===staffResult.leadId);
    assert.ok(publicRow);assert.ok(staffRow);assert.equal(publicRow.idempotency_hash,sha(publicToken));assert.equal(staffRow.idempotency_hash,sha(`${i1}:${staffToken}`));
    assert.equal(JSON.parse(publicRow.attribution_json).landingPage,'https://example.invalid/lead');assert.equal(JSON.parse(publicRow.submission_data).contact_name,'Synthetic public lead');
    assert.equal(publicRow.captured_by_identity_id,null);assert.equal(staffRow.captured_by_identity_id,i1);assert.equal(staffRow.attribution_json,null);
    assert.equal(publicRow.consent_text_en,'I agree to be contacted.');assert.equal(staffRow.consent_text_ar,'أوافق على التواصل معي.');
    const [leadRows]=await db.query(`SELECT l.id,l.uid,l.source_type,l.contact_name,l.learner_name,l.mobile,l.qualification_data,c.display_name,c.normalized_phone,c.normalized_email
      FROM pipeline_leads l JOIN pipeline_contacts c ON c.uid_hash=l.uid_hash AND c.id=l.contact_id
      WHERE l.uid_hash=? ORDER BY l.created_at,l.id`,[sha(ownerUidA)]);
    assert.equal(leadRows.length,2);assert.equal(leadRows.find(row=>row.id===publicResult.leadId)?.source_type,'public_form');assert.equal(leadRows.find(row=>row.id===staffResult.leadId)?.source_type,'staff_form');
    const publicLead=leadRows.find(row=>row.id===publicResult.leadId),staffLead=leadRows.find(row=>row.id===staffResult.leadId);
    assert.equal(publicLead.uid,ownerUidA);assert.equal(publicLead.contact_name,'Synthetic public lead');assert.equal(publicLead.mobile,'+12025550123');assert.equal(publicLead.normalized_email,'public@example.invalid');
    assert.equal(JSON.parse(publicLead.qualification_data).campaign.utmCampaign,'forms-integration');assert.equal(JSON.parse(publicLead.qualification_data).campaign.landingPage,'https://example.invalid/lead');
    assert.equal(staffLead.contact_name,'Synthetic staff lead');assert.equal(staffLead.mobile,'+12025550125');assert.equal(staffLead.qualification_data,null);
    const [activities]=await db.query('SELECT lead_id,actor_type,actor_id,activity_type FROM pipeline_activity WHERE uid_hash=? AND lead_id IN (?,?)',[sha(ownerUidA),publicResult.leadId,staffResult.leadId]);
    assert.equal(activities.length,2);assert.ok(activities.some(row=>row.lead_id===publicResult.leadId&&row.actor_type==='system'&&row.actor_id===null));assert.ok(activities.some(row=>row.lead_id===staffResult.leadId&&row.actor_type==='identity'&&row.actor_id===i1));
    const [rateRows]=await db.query('SELECT attempts FROM sx_workspace_form_rate_limits WHERE tenant_id=? AND form_id=?',[t1,formA.id]);
    assert.equal(rateRows.length,2);assert.ok(rateRows.every(row=>Number(row.attempts)===1),'an idempotent replay must not consume another visitor-rate attempt');
    assert.equal((await forms.submissions(db,ctxA)).total,4);assert.equal((await forms.submissions(db,ctxB)).total,1);
    const failureToken='dddddddd-dddd-4ddd-8ddd-dddddddddddd',failureVisitor='e'.repeat(64);
    await db.query(`CREATE TRIGGER fail_synthetic_pipeline_activity BEFORE INSERT ON pipeline_activity FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic activity failure'`);
    try{
      const failure=await forms.submitPublic(pool,{tenantSlug:ctxA.slug,formSlug:'service-contact',submissionToken:failureToken,visitorHash:failureVisitor,expectedFormVersion:1,values:{contact_name:'Rollback synthetic',phone:'+12025550129',consent:true}}).then(()=>null,error=>error);
      assert.equal(failure?.code,'ER_SIGNAL_EXCEPTION');
    }finally{await db.query('DROP TRIGGER fail_synthetic_pipeline_activity');}
    assert.equal(await pipelineCount(),2,'Pipeline failure must roll back the lead, contact and activity transaction');
    const [[failedSubmission]]=await db.query('SELECT COUNT(*) AS total FROM sx_workspace_form_submissions WHERE tenant_id=? AND form_id=? AND idempotency_hash=?',[t1,formA.id,sha(failureToken)]);
    const [[failedRate]]=await db.query('SELECT COUNT(*) AS total FROM sx_workspace_form_rate_limits WHERE tenant_id=? AND form_id=? AND visitor_hash=?',[t1,formA.id,failureVisitor]);
    const [[contactCount]]=await db.query('SELECT COUNT(*) AS total FROM pipeline_contacts WHERE uid_hash=?',[sha(ownerUidA)]);
    assert.equal(Number(failedSubmission.total),0);assert.equal(Number(failedRate.total),0);assert.equal(Number(contactCount.total),2);
    await db.query("UPDATE sx_tenants SET status='suspended' WHERE id=?",[t1]);
    assert.equal(await forms.publicForm(db,ctxA.slug,'service-contact'),null,'a suspended tenant must not publish its generic form');
    const suspendedError=await forms.submitPublic(pool,{tenantSlug:ctxA.slug,formSlug:'service-contact',submissionToken:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',visitorHash:'d'.repeat(64),expectedFormVersion:1,values:{contact_name:'Suspended synthetic',phone:'+12025550128',consent:true}}).then(()=>null,error=>error);
    assert.equal(suspendedError?.code,'FORM_NOT_FOUND');assert.equal(await pipelineCount(),2,'a suspended tenant must not create a Pipeline lead');
    await db.query("UPDATE sx_tenants SET status='active' WHERE id=?",[t1]);
    await db.query('UPDATE sx_plan_assignments SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[assignmentA]);
    const expired=await plans.loadEntitlements(db,t1);assert.equal(expired.status,'expired');
    const expiredError=await forms.submitPublic(pool,{tenantSlug:ctxA.slug,formSlug:'service-contact',submissionToken:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',visitorHash:'c'.repeat(64),expectedFormVersion:1,values:{contact_name:'Expired synthetic',phone:'+12025550126',consent:true}}).then(()=>null,error=>error);
    assert.equal(expiredError?.code,'FORM_NOT_FOUND');assert.equal(await pipelineCount(),2,'an expired assignment must not create a new Pipeline lead');
  }finally{categories.getCategory=original.getCategory;}

  return {workspaceFormsTenantForeignKeys:true,workspaceFormsSubmissionIdempotency:true,workspaceFormsVersionReference:true,workspaceFormsRateLimitTenantBinding:true,workspaceFormsServiceTwoTenantIsolation:true,workspaceFormsCrossTenantIdDenial:true,workspaceFormsConcurrentStaleWrite:true,genericPublicSubmissionTransactional:true,genericPublicPipelineFailureRollsBackAllRows:true,genericPublicEntitlementDenial:true,genericPublicExpiredAssignmentDenial:true,genericPublicSuspendedTenantDenial:true,genericPublicIdempotencyAndRateSnapshot:true,genericPublicPipelinePersistence:true,genericStaffSubmissionTransactional:true,genericStaffRevokedMembershipContextDenial:true,genericStaffPipelinePersistenceAndIdentityAttribution:true,genericStaffIdentityAttributionAndReplay:true,actualPlanAssignmentResolver:true};
};
