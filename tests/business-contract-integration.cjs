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
  const [[version]]=await db.query("SELECT v.id,v.role_limits FROM sx_plan_versions v JOIN sx_legacy_plan_contracts c ON c.version_id=v.id WHERE v.status='published' ORDER BY v.published_at DESC LIMIT 1");
  assert.ok(version,'published existing-catalogue contract fixture');
  const uid='synthetic-linked-business-'+crypto.randomUUID(),oldExpiry=String(Date.now()+1000);
  const [created]=await db.query('INSERT INTO user(uid,name,plan,plan_expire) VALUES (?,?,?,?)',[uid,'Synthetic linked center',JSON.stringify(legacyPlan),oldExpiry]);
  await db.query("INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES ('user',?,?,?,?,UTC_TIMESTAMP(3))",[String(created.insertId),t2,m2,crypto.createHash('sha256').update(uid).digest('hex')]);
  await assert.rejects(guard.writeUnmapped(db,{uid,plan:legacyPlan,expiresAt:Date.now()+10000}),{code:'CANONICAL_ASSIGNMENT_REQUIRED'});
  const roleLimits={owner:1,accountant:1,manager:1,agent:7};
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
  await assert.rejects(plans.assign(db,actor,{tenantId:t2,planVersionId:version.id,roleLimits,durationDays:30}),{code:'MAPPED_TENANT_REQUIRES_CONTRACT_ASSIGNMENT'});
  await db.query(`CREATE TABLE agents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_uid VARCHAR(999) NOT NULL, uid VARCHAR(999) NOT NULL,
    email VARCHAR(999) NOT NULL, password VARCHAR(999) NOT NULL,
    name VARCHAR(999) NOT NULL, mobile VARCHAR(999) NOT NULL,
    comments TEXT NULL, role VARCHAR(32) NULL, is_active TINYINT NULL,
    mask_number TINYINT NOT NULL DEFAULT 0, allow_send_new_qr TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_synthetic_agent_uid(uid), KEY ix_synthetic_agent_owner(owner_uid)
  ) ENGINE=InnoDB`);
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
  return {businessLegacyCanonicalAssignmentAtomic:true,businessAssignmentIdempotent:true,businessAssignmentStateChecked:true,legacyWriteBlockedAfterReviewedMapping:true,mappedCanonicalAssignmentAdapterRequired:true,existingAgentCreationUsesCanonicalSevenSeatLimit:true,concurrentEighthAgentRejected:true,agentDeactivationReleasesSeat:true,agentDeletionKeepsSeatAccountingCorrect:true,unlinkedLegacyAgentCreationPreserved:true,agentSettingsAreOwnerScoped:true,foreignAgentAssignmentDenied:true,agentListOmitsPasswordHash:true};
};
