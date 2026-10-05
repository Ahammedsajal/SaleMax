const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const plans=require('../modules/platform/plans');
const {trainingCenter}=require('../modules/platform/categories');
module.exports=async function verifyPlans(db,other,{t1,i1,m1}){
  const platform={audience:'platform',identity:{id:i1},mfaVerified:true,recentlyAuthenticated:true,membership:{role:'super_admin',status:'active'}};
  const input={name:'Synthetic training plan',categoryKey:'training_center',categoryVersion:1,capabilities:['team.members','training.courses','tenant.settings','automation.chatbot'],roleLimits:{owner:1,accountant:1,manager:1,agent:7}};
  const continuing=await plans.createDraft(db,platform,{...input,name:'No repeated MFA fixture'});
  await plans.publish(db,{...platform,recentlyAuthenticated:false},continuing.id,continuing.revision);
  const draft=await plans.createDraft(db,platform,input);
  const changed=await plans.updateDraft(db,platform,draft.id,1,input);
  await assert.rejects(plans.publish(db,platform,draft.id,1),{code:'STALE_REVISION'});
  await plans.publish(db,platform,draft.id,changed.revision);
  await assert.rejects(plans.updateDraft(db,platform,draft.id,3,input),{code:'PUBLISHED_PLAN_IMMUTABLE'});
  const assigned=await plans.assign(db,platform,{tenantId:t1,planVersionId:draft.id,roleLimits:input.roleLimits,durationDays:30});
  await db.query("UPDATE sx_memberships SET role='owner' WHERE id=?",[m1]);
  const tenant={audience:'tenant',identity:{id:i1},tenant:{id:t1,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:m1,tenantId:t1,role:'owner',status:'active',delegatedPermissions:[]},category:trainingCenter,subscription:await plans.loadEntitlements(db,t1)};
  for(let n=0;n<6;n++){
    const id=crypto.randomUUID();await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES (?,?,'Synthetic agent','active')",[id,`agent${n}@example.invalid`]);
    await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role) VALUES (?,?,?,'agent')",[crypto.randomUUID(),t1,id]);
  }
  const requests=[{requestKey:crypto.randomUUID(),email:'LAST-A@example.invalid',role:'agent'},{requestKey:crypto.randomUUID(),email:'last-b@example.invalid',role:'agent'}];
  const race=await Promise.allSettled([plans.reserveInvite(db,tenant,requests[0]),plans.reserveInvite(other,tenant,requests[1])]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  const rejected=race.find(r=>r.status==='rejected');assert.equal(rejected.reason.code,'SEAT_LIMIT_EXCEEDED');
  const winner=race.findIndex(r=>r.status==='fulfilled');
  const repeat=await plans.reserveInvite(db,tenant,requests[winner]);assert.equal(repeat.repeated,true);assert.equal(repeat.id,race[winner].value.id);
  await assert.rejects(plans.reserveInvite(db,tenant,{...requests[winner],email:'changed@example.invalid'}),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(plans.reserveInvite(db,tenant,{requestKey:crypto.randomUUID(),email:'owner@example.invalid',role:'owner'}),{code:'INVALID_INVITE_ROLE'});
  const impact=await plans.previewAssignment(db,platform,{tenantId:t1,planVersionId:draft.id,roleLimits:{...input.roleLimits,agent:6}});
  assert.equal(impact.previewOnly,true);assert.equal(impact.used.agent,7);assert.equal(impact.canAssign,false);assert.deepEqual(impact.blockers,['SEATS_IN_USE:agent']);
  assert.equal((await plans.loadEntitlements(db,t1)).assignmentId,assigned.id);
  await assert.rejects(plans.assign(db,platform,{tenantId:t1,planVersionId:draft.id,roleLimits:{...input.roleLimits,agent:6},durationDays:30}),{code:'SEATS_IN_USE'});
  assert.equal((await plans.loadEntitlements(db,t1)).assignmentId,assigned.id);
  // New versions never rewrite an existing tenant's published contract.
  const second=await plans.createDraft(db,platform,{...input,planId:draft.planId,roleLimits:{...input.roleLimits,agent:9}});
  assert.equal(second.version,2);await plans.publish(db,platform,second.id,1);
  assert.equal((await plans.loadEntitlements(db,t1)).roleLimits.agent,7);
  const replacement=await plans.assign(db,platform,{tenantId:t1,planVersionId:second.id,roleLimits:{...input.roleLimits,agent:8},durationDays:30});
  assert.equal((await plans.loadEntitlements(db,t1)).assignmentId,replacement.id);
  const [[prior]]=await db.query('SELECT status FROM sx_plan_assignments WHERE id=?',[assigned.id]);assert.equal(prior.status,'superseded');
  await db.query('UPDATE sx_team_invites SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[repeat.id]);
  // Expired reservations release seats and retain their history.
  const smaller=await plans.assign(db,platform,{tenantId:t1,planVersionId:draft.id,roleLimits:input.roleLimits,durationDays:30});
  const renewed=await plans.reserveInvite(db,tenant,{requestKey:crypto.randomUUID(),email:requests[winner].email,role:'agent'});
  assert.equal(renewed.status,'pending');
  const [[expired]]=await db.query('SELECT status FROM sx_team_invites WHERE id=?',[repeat.id]);assert.equal(expired.status,'expired');
  await db.query("UPDATE sx_memberships SET role='agent',delegated_permissions='[]' WHERE id=?",[m1]);
  await assert.rejects(plans.reserveInvite(db,tenant,{requestKey:crypto.randomUUID(),email:'denied@example.invalid',role:'manager'}),{code:'FEATURE_UNAVAILABLE'});
  await db.query("UPDATE sx_memberships SET role='owner' WHERE id=?",[m1]);
  await db.query("UPDATE sx_identities SET status='disabled' WHERE id=?",[i1]);
  await assert.rejects(plans.reserveInvite(db,tenant,{requestKey:crypto.randomUUID(),email:'disabled@example.invalid',role:'manager'}),{code:'PERMISSION_DENIED'});
  await db.query("UPDATE sx_identities SET status='active' WHERE id=?",[i1]);
  await db.query('UPDATE sx_plan_assignments SET effective_from=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 DAY),expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY) WHERE id=?',[smaller.id]);
  assert.equal((await plans.loadEntitlements(db,t1)).status,'expired');
  await assert.rejects(plans.reserveInvite(db,tenant,{requestKey:crypto.randomUUID(),email:'expired@example.invalid',role:'manager'}),{code:'FEATURE_UNAVAILABLE'});
  const [[audit]]=await db.query("SELECT COUNT(*) AS n FROM sx_audit_events WHERE action='team.invite-reserved'");assert.equal(audit.n,2);
  return {publishedPlansImmutable:true,versionEditsPreserveAssignments:true,concurrentFinalSeat:true,pendingInvitesReserveSeats:true,idempotentInviteReservation:true,downgradeProtectsSeats:true,expiredInvitesReleaseSeats:true,liveRoleRevocation:true,expiredPlanBlocksInvites:true,transactionalAudit:true};
};
