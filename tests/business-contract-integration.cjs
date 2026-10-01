'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const contract=require('../modules/platform/business-contract-assignment');
const {trainingCenter}=require('../modules/platform/categories');
const plans=require('../modules/platform/plans');
const guard=require('../modules/platform/legacy-ownership-guard');
module.exports=async(db,other,{t2,i1,m2},pool)=>{
  const actor={audience:'platform',identity:{id:i1},membership:{role:'super_admin',status:'active'},mfaVerified:true,recentlyAuthenticated:true};
  const [[legacyPlan]]=await db.query('SELECT * FROM plan LIMIT 1');
  const [[version]]=await db.query("SELECT v.id,v.role_limits,v.capabilities FROM sx_plan_versions v JOIN sx_legacy_plan_contracts c ON c.version_id=v.id WHERE v.status='published' ORDER BY v.published_at DESC LIMIT 1");
  assert.ok(version,'published existing-catalogue contract fixture');
  const uid='synthetic-linked-business-'+crypto.randomUUID(),oldExpiry=String(Date.now()+1000);
  const [created]=await db.query('INSERT INTO user(uid,name,plan,plan_expire) VALUES (?,?,?,?)',[uid,'Synthetic linked center',JSON.stringify(legacyPlan),oldExpiry]);
  await db.query("INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES ('user',?,?,?,?,UTC_TIMESTAMP(3))",[String(created.insertId),t2,m2,crypto.createHash('sha256').update(uid).digest('hex')]);
  await assert.rejects(guard.writeUnmapped(db,{uid,plan:legacyPlan,expiresAt:Date.now()+10000}),{code:'CANONICAL_ASSIGNMENT_REQUIRED'});
  const roleLimits=typeof version.role_limits==='string'?JSON.parse(version.role_limits):version.role_limits;
  const review=await contract.preview(db,actor,{userId:created.insertId,planVersionId:version.id,roleLimits});
  assert.equal(review.readOnly,true);assert.equal(review.canAssign,true);assert.equal(review.durationDays,30);
  const request={userId:created.insertId,planVersionId:version.id,roleLimits,expectedState:review.expectedState,requestId:crypto.randomUUID()};
  await assert.rejects(contract.assign(db,actor,{...request,expectedState:'0'.repeat(64)}),{code:'STALE_ASSIGNMENT'});
  const first=await contract.assign(db,actor,request);
  const replay=await contract.assign(other,actor,request);assert.equal(replay.replayed,true);assert.equal(replay.id,first.id);
  const [[user]]=await db.query('SELECT plan,plan_expire FROM user WHERE id=?',[created.insertId]);assert.equal(JSON.parse(user.plan).id,legacyPlan.id);assert.ok(Number(user.plan_expire)>Date.now());
  const entitlement=await plans.loadEntitlements(db,t2);assert.equal(entitlement.assignmentId,first.id);assert.deepEqual(entitlement.roleLimits,roleLimits);
  const [[history]]=await db.query('SELECT previous_expiry,assigned_expiry FROM sx_legacy_plan_assignments WHERE id=?',[first.legacyAssignmentId]);assert.equal(history.previous_expiry,oldExpiry);assert.equal(Number(history.assigned_expiry),Number(user.plan_expire));
  const [[canonicalExpiry]]=await db.query("SELECT CAST(TIMESTAMPDIFF(MICROSECOND,'1970-01-01 00:00:00',expires_at)/1000 AS UNSIGNED) AS epoch FROM sx_plan_assignments WHERE id=?",[first.id]);assert.equal(Number(canonicalExpiry.epoch),Number(history.assigned_expiry));
  const [[ledger]]=await db.query('SELECT COUNT(*) n FROM sx_legacy_contract_assignments WHERE request_id=?',[request.requestId]);assert.equal(ledger.n,1);
  const [[audit]]=await db.query("SELECT COUNT(*) n FROM sx_audit_events WHERE tenant_id=? AND action='legacy-business.contract-assigned'",[t2]);assert.equal(audit.n,1);
  const initialCapabilities=typeof version.capabilities==='string'?JSON.parse(version.capabilities):version.capabilities;
  const formsPlan=require('../modules/platform/catalogue-bridge');
  const formsDraft=await formsPlan.createDraft(db,actor,{legacyPlanId:Number(legacyPlan.id),requestId:crypto.randomUUID(),categoryKey:'training_center',categoryVersion:1,capabilities:[...new Set([...initialCapabilities,'portal.forms'])],roleLimits});
  await formsPlan.publish(db,actor,{legacyPlanId:Number(legacyPlan.id),versionId:formsDraft.id,revision:formsDraft.revision});
  const formsReview=await contract.preview(db,actor,{userId:created.insertId,planVersionId:formsDraft.id,roleLimits});
  await contract.assign(db,actor,{userId:created.insertId,tenantId:formsReview.tenantId,planVersionId:formsDraft.id,roleLimits,durationDays:formsReview.durationDays,expectedState:formsReview.expectedState,requestId:crypto.randomUUID()});
  const trainingForms=require('../modules/platform/training-forms');
  const [[formMembership]]=await db.query('SELECT identity_id FROM sx_memberships WHERE id=?',[m2]);
  const formContext={audience:'tenant',identity:{id:formMembership.identity_id},tenant:{id:t2,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:m2,tenantId:t2,role:'owner',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['portal.forms']}};
  const formSeed={slug:'course-enquiry',nameEn:'Course enquiry',nameAr:'استفسار عن دورة',schema:{titleEn:'Ask about a course',titleAr:'استفسر عن دورة',descriptionEn:'Contact us',descriptionAr:'تواصل معنا',consentTextEn:'Contact me about this enquiry',consentTextAr:'تواصلوا معي بخصوص هذا الاستفسار',fields:[{key:'contact_name',labelEn:'Name',labelAr:'الاسم',required:true},{key:'phone',labelEn:'Phone',labelAr:'الهاتف',required:true},{key:'consent',labelEn:'Contact permission',labelAr:'الموافقة على التواصل',required:true}]}};
  const form=await trainingForms.create(db,formContext,formSeed);assert.equal(await trainingForms.publicForm(db,'synthetic-b','course-enquiry'),null,'draft forms are not visible publicly');
  const firstPublish=await trainingForms.publish(db,formContext,form.id,1);assert.equal(firstPublish.version,1);assert.equal((await trainingForms.publish(db,formContext,form.id,1)).repeated,true,'publish retries do not create duplicate versions');
  const publicV1=await trainingForms.publicForm(db,'synthetic-b','course-enquiry');assert.equal(publicV1.form.schema.titleEn,'Ask about a course');
  const changedForm={...formSeed,slug:'course-intake-v2',nameEn:'Course intake',schema:{...formSeed.schema,titleEn:'Register your interest'}};
  await trainingForms.update(db,formContext,form.id,1,changedForm);assert.equal((await trainingForms.publicForm(db,'synthetic-b','course-enquiry')).form.schema.titleEn,'Ask about a course','editing drafts leaves the live public form unchanged');assert.equal(await trainingForms.publicForm(db,'synthetic-b','course-intake-v2'),null);
  const foreignTenant='00000000-0000-4000-8000-000000000001';
  await assert.rejects(trainingForms.update(db,{...formContext,tenant:{...formContext.tenant,id:foreignTenant},membership:{...formContext.membership,tenantId:foreignTenant}},form.id,2,changedForm),{code:'FORM_NOT_FOUND'});
  await trainingForms.publish(db,formContext,form.id,2);assert.equal(await trainingForms.publicForm(db,'synthetic-b','course-enquiry'),null);assert.equal((await trainingForms.publicForm(db,'synthetic-b','course-intake-v2')).form.schema.titleEn,'Register your interest');
  const [[formVersions]]=await db.query('SELECT COUNT(*) AS n FROM sx_training_form_versions WHERE tenant_id=? AND form_id=?',[t2,form.id]);assert.equal(Number(formVersions.n),2);
  const token=crypto.randomUUID(),visitorHash='d'.repeat(64);const submitted=await trainingForms.submitPublic(pool,{tenantSlug:'synthetic-b',formSlug:'course-intake-v2',submissionToken:token,values:{contact_name:'Public synthetic learner',phone:'+97450000101',consent:true},visitorHash});assert.equal(submitted.repeated,false);assert.match(submitted.referenceCode,/^[A-F0-9]{12}$/);
  const repeatedSubmission=await trainingForms.submitPublic(pool,{tenantSlug:'synthetic-b',formSlug:'course-intake-v2',submissionToken:token,values:{contact_name:'Should not duplicate',phone:'+97450000102',consent:true},visitorHash});assert.equal(repeatedSubmission.referenceCode,submitted.referenceCode);assert.equal(repeatedSubmission.repeated,true);
  const [[publicLead]]=await db.query("SELECT source_type,uid,contact_name FROM pipeline_leads WHERE id=?",[submitted.leadId]);assert.equal(publicLead.source_type,'public_form');assert.equal(publicLead.uid,uid);assert.equal(publicLead.contact_name,'Public synthetic learner');
  const express=require('express'),web=express(),server=web.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  try{
    const port=server.address().port,origin=`http://127.0.0.1:${port}`;web.use('/api/public/training/forms',require('../modules/platform/training-form-router').createPublicTrainingFormRouter({app:web,pool,rateKey:Buffer.from('synthetic-form-rate-key'),origin}));
    const endpoint=origin+'/api/public/training/forms/synthetic-b/course-intake-v2';const publicResponse=await fetch(endpoint);assert.equal(publicResponse.status,200);const publicDefinition=await publicResponse.json();assert.equal(publicDefinition.data.form.schema.titleEn,'Register your interest');
    const headers={'Content-Type':'application/json',Origin:origin,'X-Forwarded-For':'198.51.100.77'};const postData=()=>({submissionToken:crypto.randomUUID(),values:{contact_name:'Browser API learner',phone:'+97450000201',consent:true},website:''});
    const httpSubmission=await fetch(endpoint+'/submissions',{method:'POST',headers,body:JSON.stringify(postData())});assert.equal(httpSubmission.status,201);const httpReceipt=await httpSubmission.json();assert.match(httpReceipt.data.referenceCode,/^[A-F0-9]{12}$/);
    const deniedOrigin=await fetch(endpoint+'/submissions',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:JSON.stringify(postData())});assert.equal(deniedOrigin.status,403);
    const rateCodes=[];for(let n=0;n<10;n++){const response=await fetch(endpoint+'/submissions',{method:'POST',headers,body:JSON.stringify(postData())});rateCodes.push(response.status);}assert.deepEqual(rateCodes,[201,201,201,201,201,201,201,201,201,429]);
  }finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  await assert.rejects(plans.assign(db,actor,{tenantId:t2,planVersionId:version.id,roleLimits,durationDays:30}),{code:'MAPPED_TENANT_REQUIRES_CONTRACT_ASSIGNMENT'});
  await db.query(`CREATE TABLE agents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_uid VARCHAR(999) NOT NULL, uid VARCHAR(999) NOT NULL,
    email VARCHAR(999) NOT NULL, password VARCHAR(999) NOT NULL,
    name VARCHAR(999) NOT NULL, mobile VARCHAR(999) NOT NULL,
    comments TEXT NULL, role VARCHAR(32) NULL, is_active TINYINT NULL,
    mask_number TINYINT NOT NULL DEFAULT 0, allow_send_new_qr TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_synthetic_agent_uid(uid), KEY ix_synthetic_agent_owner(owner_uid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const seats=require('../modules/platform/legacy-agent-seats');
  const agentAccess=require('../modules/platform/legacy-agent-access');
  const legacyAgents=[];
  for(let n=0;n<6;n++){
    const agent={uid:`synthetic-old-agent-${n}-${crypto.randomUUID()}`,email:`old-${n}-${crypto.randomUUID()}@example.invalid`};
    const [inserted]=await db.query('INSERT INTO agents(owner_uid,uid,email,password,name,mobile,is_active) VALUES (?,?,?,?,?,?,1)',[uid,agent.uid,agent.email,'synthetic-hash','Synthetic Agent','00000000']);
    legacyAgents.push({id:inserted.insertId,uid:agent.uid});
  }
  const newAgent=()=>({uid:crypto.randomUUID(),email:`new-${crypto.randomUUID()}@example.invalid`,password:'synthetic-hash',name:'Synthetic New Agent',mobile:'00000000',comments:''});
  const [raceA,raceB]=[newAgent(),newAgent()];
  const race=await Promise.allSettled([
    seats.createIfMapped(pool,uid,raceA),
    seats.createIfMapped(pool,uid,raceB),
  ]);
  assert.equal(race.filter(result=>result.status==='fulfilled').length,1,`one connection consumes the final agent seat: ${race.map(result=>result.status==='rejected'?result.reason.code||result.reason.message:'fulfilled').join(',')}`);
  assert.equal(race.filter(result=>result.status==='rejected'&&result.reason.code==='AGENT_SEAT_LIMIT').length,1,'the concurrent eighth agent is rejected');
  const successful=race.find(result=>result.status==='fulfilled').value;
  assert.equal(successful.used,7);assert.equal(successful.limit,7);
  await assert.rejects(seats.createIfMapped(pool,uid,newAgent()),{code:'AGENT_SEAT_LIMIT'});
  const unlinkedUid=`unlinked-${crypto.randomUUID()}`;
  await db.query('INSERT INTO user(uid,name,plan,plan_expire) VALUES (?,?,?,?)',[unlinkedUid,'Unlinked synthetic center',JSON.stringify(legacyPlan),String(Date.now()+1000)]);
  assert.deepEqual(await seats.createIfMapped(pool,unlinkedUid,newAgent()),null,'unlinked legacy accounts preserve their existing creation route');
  await seats.updateIfMapped(pool,uid,legacyAgents[0].uid,false);
  const afterRelease=await seats.createIfMapped(pool,uid,newAgent());assert.equal(afterRelease.used,7);
  await assert.rejects(seats.updateIfMapped(pool,uid,legacyAgents[0].uid,true),{code:'AGENT_SEAT_LIMIT'});
  await seats.deleteIfMapped(pool,uid,legacyAgents[1].uid);
  await seats.updateIfMapped(pool,uid,legacyAgents[0].uid,true);
  const [[remaining]]=await db.query('SELECT COUNT(*) n FROM agents WHERE owner_uid=? AND (is_active IS NULL OR is_active<>0)',[uid]);assert.equal(Number(remaining.n),7);
  const foreignAgentUid=`foreign-agent-${crypto.randomUUID()}`;
  await db.query('INSERT INTO agents(owner_uid,uid,email,password,name,mobile,is_active) VALUES (?,?,?,?,?,?,1)',[`another-owner-${crypto.randomUUID()}`,foreignAgentUid,`foreign-${crypto.randomUUID()}@example.invalid`,'synthetic-secret-hash','Foreign Agent','00000000']);
  await assert.rejects(agentAccess.setOwnerFlag(pool,uid,foreignAgentUid,'maskNumber',true),{code:'AGENT_NOT_FOUND'});
  const [[foreign]]=await db.query('SELECT mask_number FROM agents WHERE uid=?',[foreignAgentUid]);assert.equal(Number(foreign.mask_number),0);
  await agentAccess.setOwnerFlag(pool,uid,legacyAgents[0].uid,'allowSendNewQr',true);
  assert.equal((await agentAccess.findOwnedAgent(pool,uid,foreignAgentUid)),null);
  assert.equal((await agentAccess.findOwnedAgent(pool,uid,legacyAgents[0].uid,{activeOnly:true})).uid,legacyAgents[0].uid);
  const ownedAgents=await agentAccess.listOwnedAgents(pool,uid);assert.ok(ownedAgents.length===7);assert.equal(Object.hasOwn(ownedAgents[0],'password'),false);assert.equal(Object.hasOwn(ownedAgents[0],'owner_uid'),false);
  const leadPipeline=require('../helper/pipeline/leadPipeline');
  const pipelineUidHash=crypto.createHash('sha256').update(uid).digest('hex');
  const assignedLead=crypto.randomUUID(),unassignedLead=crypto.randomUUID(),foreignAssignedLead=crypto.randomUUID();
  for(const [leadId,title,ownerAgentId] of [[assignedLead,'Assigned synthetic lead',legacyAgents[0].id],[unassignedLead,'Unassigned synthetic lead',null],[foreignAssignedLead,'Other agent synthetic lead',legacyAgents[2].id]]){
    await db.query(`INSERT INTO pipeline_leads(id,uid_hash,uid,identity_key,title,stage_key,owner_agent_id,last_activity_at)
      VALUES (?,?,?,?,?,'new',?,UTC_TIMESTAMP(3))`,[leadId,pipelineUidHash,uid,crypto.createHash('sha256').update(leadId).digest('hex'),title,ownerAgentId]);
  }
  const agentBoard=await leadPipeline.getBoard({uid,role:'agent',agentId:Number(legacyAgents[0].id),pool});
  assert.deepEqual(agentBoard.leads.map(lead=>lead.id),[assignedLead],'agent boards exclude unassigned and other agents leads');
  assert.equal(await leadPipeline.getLead(uid,unassignedLead,{role:'agent',agentId:Number(legacyAgents[0].id),pool}),null);
  assert.equal(await leadPipeline.getLead(uid,foreignAssignedLead,{role:'agent',agentId:Number(legacyAgents[0].id),pool}),null);
  assert.equal((await leadPipeline.getLead(uid,assignedLead,{role:'agent',agentId:Number(legacyAgents[0].id),pool})).id,assignedLead);
  const agentLeadActor={uid,role:'agent',agentId:Number(legacyAgents[0].id),actorType:'agent',actorId:String(legacyAgents[0].id)};
  await assert.rejects(leadPipeline.updateLead({...agentLeadActor,id:unassignedLead,input:{note:'should not be stored'},pool}),{status:403});
  await assert.rejects(leadPipeline.updateLead({...agentLeadActor,id:foreignAssignedLead,input:{note:'should not be stored'},pool}),{status:403});
  await assert.rejects(leadPipeline.moveLead({...agentLeadActor,id:foreignAssignedLead,stageKey:'contacted',pool}),{status:403});
  await assert.rejects(leadPipeline.updateLead({...agentLeadActor,id:assignedLead,input:{outcome:'made_up'},pool}),{status:400});
  await assert.rejects(leadPipeline.updateLead({...agentLeadActor,id:assignedLead,input:{outcome:'follow_up_scheduled'},pool}),{status:400});
  const [[forbiddenNotes]]=await db.query("SELECT COUNT(*) n FROM pipeline_activity WHERE uid_hash=? AND lead_id IN (?,?) AND summary='should not be stored'",[pipelineUidHash,unassignedLead,foreignAssignedLead]);assert.equal(Number(forbiddenNotes.n),0);
  await leadPipeline.updateLead({...agentLeadActor,id:assignedLead,input:{note:'Reached learner',outcome:'interested',followUpRequired:true,nextFollowUpAt:'2026-10-02T09:00:00Z'},pool});
  const [[outcomeEvent]]=await db.query("SELECT activity_type,details FROM pipeline_activity WHERE uid_hash=? AND lead_id=? AND activity_type='contact_outcome' ORDER BY id DESC LIMIT 1",[pipelineUidHash,assignedLead]);
  assert.equal(outcomeEvent.activity_type,'contact_outcome');assert.deepEqual(JSON.parse(outcomeEvent.details),{outcome:'interested',followUpRequired:true,nextFollowUpAt:'2026-10-02 09:00:00.000'});
  await leadPipeline.moveLead({...agentLeadActor,id:assignedLead,stageKey:'contacted',pool});
  const reportService=require('../helper/pipeline/reports');
  const today=require('moment-timezone').tz('Asia/Qatar').format('YYYY-MM-DD');
  const activityReport=await reportService.getActivityReport({pool,uid,role:'agent',agentId:Number(legacyAgents[0].id),period:'daily',at:today,timezone:'Asia/Qatar'});
  assert.equal(activityReport.summary.outcomes,1,JSON.stringify(activityReport.summary));assert.equal(activityReport.summary.notes,1);assert.equal(activityReport.summary.leadsTouched,1);assert.equal(activityReport.summary.followUpsRequired,1);
  assert.equal(activityReport.items.length,2);assert.ok(activityReport.items.every(item=>item.attendedBy==='Synthetic Agent'));
  await assert.rejects(reportService.getActivityReport({pool,uid,role:'accountant'}),{status:403});
  const followUps=await leadPipeline.getFollowUps({uid,role:'agent',agentId:Number(legacyAgents[0].id),pool});
  assert.equal(followUps.total,1);assert.equal(followUps.items[0].lead_id,assignedLead);assert.equal(followUps.summary.total,1);
  await assert.rejects(leadPipeline.resolveFollowUp({...agentLeadActor,id:foreignAssignedLead,action:'complete',expectedDueAt:'2026-10-01 08:00:00.000000',pool}),{status:403});
  const oldDueRevision=followUps.items[0].due_revision;
  await leadPipeline.resolveFollowUp({...agentLeadActor,id:assignedLead,action:'reschedule',at:'2026-10-03T09:00:00Z',expectedDueAt:oldDueRevision,pool});
  const rescheduled=await leadPipeline.getFollowUps({uid,role:'agent',agentId:Number(legacyAgents[0].id),period:'upcoming',pool});
  const [[rescheduledDb]]=await db.query('SELECT DATE_FORMAT(next_follow_up_at,\'%Y-%m-%d %H:%i:%s\') AS due FROM pipeline_leads WHERE uid_hash=? AND id=?',[pipelineUidHash,assignedLead]);
  assert.equal(rescheduled.total,1);assert.equal(rescheduledDb.due,'2026-10-03 09:00:00');
  await assert.rejects(leadPipeline.resolveFollowUp({...agentLeadActor,id:assignedLead,action:'complete',expectedDueAt:oldDueRevision,pool}),{status:409});
  await leadPipeline.resolveFollowUp({...agentLeadActor,id:assignedLead,action:'complete',expectedDueAt:rescheduled.items[0].due_revision,pool});
  await assert.rejects(leadPipeline.resolveFollowUp({...agentLeadActor,id:assignedLead,action:'complete',expectedDueAt:rescheduled.items[0].due_revision,pool}),{status:409});
  assert.equal((await leadPipeline.getFollowUps({uid,role:'agent',agentId:Number(legacyAgents[0].id),pool})).total,0);
  await db.query(`CREATE TABLE phonebook(id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,name VARCHAR(255) NOT NULL,uid VARCHAR(999) NOT NULL) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE contact(id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(999) NOT NULL,phonebook_id INT NOT NULL,phonebook_name VARCHAR(255) NOT NULL,name VARCHAR(255) NOT NULL,mobile VARCHAR(64) NOT NULL,var1 TEXT NULL,var2 TEXT NULL,var3 TEXT NULL,var4 TEXT NULL,var5 TEXT NULL,createdAt DATETIME NULL) ENGINE=InnoDB`);
  const inboundPhone='+97450000123';
  const inbound=await leadPipeline.captureQrMessage({uid,chatId:'synthetic-inbound-chat',message:{key:{id:'synthetic-inbound-message-1',remoteJid:'97450000123@s.whatsapp.net'},messageTimestamp:Date.now()},normalizedMessage:{route:'INCOMING',senderMobile:inboundPhone,senderName:'Inbound learner',msgContext:{text:{body:'Hello'}}}});
  const [[inboundLead]]=await db.query('SELECT contact_id, mobile FROM pipeline_leads WHERE uid_hash=? AND id=?',[pipelineUidHash,inbound.leadId]);
  assert.ok(inboundLead.contact_id);assert.equal(inboundLead.mobile,inboundPhone);
  const inboundDuplicate=await leadPipeline.captureQrMessage({uid,chatId:'synthetic-inbound-chat',message:{key:{id:'synthetic-inbound-message-2',remoteJid:'97450000123@s.whatsapp.net'},messageTimestamp:Date.now()},normalizedMessage:{route:'INCOMING',senderMobile:inboundPhone,senderName:'Inbound learner',msgContext:{text:{body:'Another message'}}}});
  assert.equal(inboundDuplicate.leadId,inbound.leadId,'repeat inbound messages retain the contact/opportunity relationship');
  await db.query("UPDATE pipeline_leads SET status='won',stage_key='won',closed_at=UTC_TIMESTAMP(3) WHERE uid_hash=? AND id=?",[pipelineUidHash,inbound.leadId]);
  const inboundAfterWon=await leadPipeline.captureQrMessage({uid,chatId:'synthetic-inbound-chat',message:{key:{id:'synthetic-inbound-message-3',remoteJid:'97450000123@s.whatsapp.net'},messageTimestamp:Date.now()},normalizedMessage:{route:'INCOMING',senderMobile:inboundPhone,senderName:'Inbound learner',msgContext:{text:{body:'New course question'}}}});
  assert.equal(inboundAfterWon.leadId,inbound.leadId);const [[wonAfterInbound]]=await db.query('SELECT status,stage_key FROM pipeline_leads WHERE uid_hash=? AND id=?',[pipelineUidHash,inbound.leadId]);assert.equal(wonAfterInbound.status,'won');assert.equal(wonAfterInbound.stage_key,'won','new inbound messages cannot reopen a converted opportunity');
  const familyPhone='+97455123456';
  const contactA=await leadPipeline.createManualLead({uid,role:'owner',actorType:'user',actorId:'synthetic-owner',input:{title:'Java evening course',contactName:'Family payer',learnerName:'Aisha Learner',mobile:familyPhone,email:'Payer@Example.invalid',stageKey:'new'},pool});
  const contactB=await leadPipeline.createManualLead({uid,role:'owner',actorType:'user',actorId:'synthetic-owner',input:{title:'English weekend course',contactName:'Family payer',learnerName:'Omar Learner',mobile:familyPhone,email:'payer@example.invalid',stageKey:'new'},pool});
  const repeatOpportunity=await leadPipeline.createManualLead({uid,role:'owner',actorType:'user',actorId:'synthetic-owner',input:{title:'Java advanced course',contactName:'Family payer',learnerName:'Aisha Learner',mobile:familyPhone,contactId:contactA.contactId,stageKey:'new'},pool});
  assert.notEqual(contactA.contactId,contactB.contactId,'a family member sharing a phone can remain a distinct contact');
  assert.equal(repeatOpportunity.contactId,contactA.contactId,'one contact can hold multiple course opportunities');
  const matches=await leadPipeline.findContactMatches({uid,phone:familyPhone,email:'PAYER@example.invalid',pool});
  assert.equal(matches.length,2,'contact match suggestions are tenant scoped and deduplicated by record');
  await leadPipeline.updateLead({uid,id:contactA.id,input:{contactName:'Updated family payer',contactEmail:'updated-payer@example.invalid'},actorType:'user',actorId:'synthetic-owner',role:'owner',pool});
  const refreshedOpportunity=await leadPipeline.getLead(uid,repeatOpportunity.id,{role:'owner',pool});
  assert.equal(refreshedOpportunity.relationship_name,'Updated family payer');assert.equal(refreshedOpportunity.contact_email,'updated-payer@example.invalid');
  const profileSearch=await leadPipeline.getBoard({uid,role:'owner',filters:{search:'Updated family payer',limit:50},pool});
  assert.deepEqual(profileSearch.leads.map(item=>item.id).sort(),[contactA.id,repeatOpportunity.id].sort(),'board search and names use the current shared contact profile');
  const [[profileHistory]]=await db.query("SELECT COUNT(*) n FROM pipeline_activity WHERE uid_hash=? AND lead_id IN (?,?) AND activity_type='contact_profile_updated'",[pipelineUidHash,contactA.id,repeatOpportunity.id]);
  assert.equal(Number(profileHistory.n),2,'shared contact edits append history to each linked opportunity');
  await assert.rejects(leadPipeline.updateLead({uid,id:contactA.id,input:{mobile:'+97450000999'},actorType:'user',actorId:'synthetic-owner',role:'owner',pool}),{status:409});
  const assignedSharedOpportunity=await leadPipeline.createManualLead({uid,role:'owner',actorType:'user',actorId:'synthetic-owner',input:{title:'Assigned shared contact course',contactId:contactA.contactId,contactName:'Updated family payer',learnerName:'Aisha Learner',mobile:familyPhone,email:'updated-payer@example.invalid',ownerAgentId:legacyAgents[0].id,stageKey:'new'},pool});
  const initialAssignment=(await leadPipeline.getLead(uid,assignedSharedOpportunity.id,{role:'owner',pool})).activities.find(activity=>activity.activity_type==='lead_assigned');
  assert.equal(initialAssignment.details.toAgentId,Number(legacyAgents[0].id),'initial assignment history identifies the first assigned agent');
  await leadPipeline.updateLead({uid,id:assignedSharedOpportunity.id,input:{ownerAgentId:legacyAgents[4].id},actorType:'user',actorId:'synthetic-owner',role:'owner',pool});
  const afterReassignment=await leadPipeline.getLead(uid,assignedSharedOpportunity.id,{role:'owner',pool});
  const reassignment=afterReassignment.activities.find(activity=>activity.activity_type==='lead_reassigned');
  assert.equal(reassignment.details.fromAgentId,Number(legacyAgents[0].id));assert.equal(reassignment.details.toAgentId,Number(legacyAgents[4].id));
  await assert.rejects(leadPipeline.moveLead({uid,id:assignedSharedOpportunity.id,stageKey:'won',actorType:'agent',actorId:String(legacyAgents[4].id),role:'agent',agentId:Number(legacyAgents[4].id),pool}),{status:409,code:'SALE_CONFIRMATION_REQUIRED'});
  await assert.rejects(leadPipeline.createManualLead({uid,role:'owner',actorType:'user',actorId:'synthetic-owner',input:{title:'Unapproved won opportunity',stageKey:'won'},pool}),{status:409,code:'SALE_CONFIRMATION_REQUIRED'});
  await leadPipeline.moveLead({uid,id:assignedSharedOpportunity.id,stageKey:'contacted',actorType:'agent',actorId:String(legacyAgents[4].id),role:'agent',agentId:Number(legacyAgents[4].id),pool});
  const stageHistory=(await leadPipeline.getLead(uid,assignedSharedOpportunity.id,{role:'owner',pool})).activities.find(activity=>activity.activity_type==='stage_changed'&&activity.details.stageTo==='contacted');
  assert.equal(stageHistory.actor_id,String(legacyAgents[4].id),'agent stage-change history remains attributable');
  await assert.rejects(leadPipeline.updateLead({...agentLeadActor,id:assignedSharedOpportunity.id,input:{contactName:'Agent attempted shared edit'},pool}),{status:403});
  await assert.rejects(leadPipeline.createManualLead({...agentLeadActor,input:{title:'Unauthorized contact link',contactId:contactB.contactId,stageKey:'new'},pool}),{status:404});
  const reassignedAgentActor={...agentLeadActor,agentId:Number(legacyAgents[4].id),actorId:String(legacyAgents[4].id)};
  const assignedContact=await leadPipeline.createManualLead({...reassignedAgentActor,input:{title:'Agent owned learner course',contactName:'Agent contact',learnerName:'Assigned learner',mobile:familyPhone,stageKey:'new'},pool});
  const agentMatches=await leadPipeline.findContactMatches({uid,role:'agent',agentId:Number(legacyAgents[4].id),phone:familyPhone,pool});
  assert.deepEqual(agentMatches.map(contact=>contact.id).sort(),[assignedContact.contactId,contactA.contactId].sort(),'agents can match contacts only where they own an assigned opportunity');
  assert.deepEqual(await leadPipeline.findContactMatches({uid:`foreign-${uid}`,phone:familyPhone,pool}),[],'contact matches cannot reveal another workspace');
  const linkedLead=await leadPipeline.getLead(uid,repeatOpportunity.id,{role:'owner',pool});
  assert.equal(linkedLead.contact_id,contactA.contactId);assert.equal(linkedLead.learner_name,'Aisha Learner');
  return {businessLegacyCanonicalAssignmentAtomic:true,businessAssignmentIdempotent:true,businessAssignmentStateChecked:true,legacyWriteBlockedAfterReviewedMapping:true,mappedCanonicalAssignmentAdapterRequired:true,existingAgentCreationUsesCanonicalSevenSeatLimit:true,concurrentEighthAgentRejected:true,agentDeactivationReleasesSeat:true,agentDeletionKeepsSeatAccountingCorrect:true,unlinkedLegacyAgentCreationPreserved:true,agentSettingsAreOwnerScoped:true,foreignAgentAssignmentDenied:true,agentListOmitsPasswordHash:true,agentBoardExcludesUnassignedLeads:true,agentBoardExcludesOtherAgentsLeads:true,agentWriteAndMoveRecheckAssignmentInsideTransaction:true,assignedAgentNoteFollowupAndStageUpdateWorks:true,approvedSaleRequiredBeforeWon:true,wonOpportunityNotReopenedByInbound:true,agentReassignmentHistoryRetained:true,versionedTrainingFormDraftsAndPublishing:true,publicFormPublishedVersionIsImmutable:true,trainingFormPublishIsIdempotent:true,trainingFormsAreTenantScoped:true,publicFormSubmissionCreatesPipelineLead:true,publicSubmissionTokenIdempotency:true,publicRateLimitsAndConsentEvidence:true,publicFormDefinitionHttpRoute:true,publicFormSubmissionHttpRoute:true,sameOriginGuardAndVisitorRateLimit:true,structuredLeadOutcomeRequiresValidFollowup:true,agentScopedDailyActivityReportReconcilesOutcomesAndNotes:true,oneContactSupportsMultipleCourseOpportunities:true,sharedFamilyPhoneCanHaveDistinctLearners:true,contactMatchSuggestionsAreTenantScoped:true,agentContactSuggestionsRespectLeadAssignment:true,inboundWhatsAppCreatesContactLinkedOpportunity:true,inboundRetriesRetainContactRelationship:true};
};
