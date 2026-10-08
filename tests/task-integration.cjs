'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const http=require('node:http');
const express=require('express');
const tasks=require('../modules/platform/task-management');
const {createTaskRouter}=require('../modules/platform/task-router');

module.exports=async(db,other,{tenantId,identityId,pool})=>{
  const uid=`synthetic-task-owner-${crypto.randomUUID()}`;
  const uidHash=crypto.createHash('sha256').update(uid).digest('hex');
  const owner={tenantId,uidHash,uid,role:'owner',actorType:'identity',actorId:identityId};
  const agentUid=`synthetic-task-agent-${crypto.randomUUID()}`;
  const [agentInsert]=await db.query("INSERT INTO agents(owner_uid,uid,email,password,name,mobile,role,is_active) VALUES(?,?,?,?,?,?,'agent',1)",[uid,agentUid,`${agentUid}@example.invalid`,'synthetic-task-hash','Synthetic Task Agent','00000000']);
  const agentId=Number(agentInsert.insertId);
  const secondAgentUid=`synthetic-task-agent-${crypto.randomUUID()}`;
  const [secondAgentInsert]=await db.query("INSERT INTO agents(owner_uid,uid,email,password,name,mobile,role,is_active) VALUES(?,?,?,?,?,?,'agent',1)",[uid,secondAgentUid,`${secondAgentUid}@example.invalid`,'synthetic-task-hash','Synthetic Second Task Agent','00000001']);
  const secondAgentId=Number(secondAgentInsert.insertId);
  const outsiderAgentUid=`synthetic-task-outsider-${crypto.randomUUID()}`;
  const [outsiderAgentInsert]=await db.query("INSERT INTO agents(owner_uid,uid,email,password,name,mobile,role,is_active) VALUES(?,?,?,?,?,?,'agent',1)",[uid,outsiderAgentUid,`${outsiderAgentUid}@example.invalid`,'synthetic-task-hash','Synthetic Unassigned Agent','00000002']);
  const outsiderAgentId=Number(outsiderAgentInsert.insertId);
  const observerId=crypto.randomUUID();
  await db.query('INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES(?,?,?,?)',[observerId,`${observerId}@example.invalid`,'Synthetic Task Observer','active']);
  await db.query('INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES(?,?,?,?,?)',[crypto.randomUUID(),tenantId,observerId,'manager','active']);
  const leadId=crypto.randomUUID();
  await db.query("INSERT INTO pipeline_leads(id,uid_hash,uid,identity_key,title,contact_name,mobile,stage_key,owner_agent_id,next_follow_up_at,last_activity_at) VALUES(?,?,?,?,?,?,'00000000','new',?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY),UTC_TIMESTAMP(3))",[leadId,uidHash,uid,crypto.createHash('sha256').update(leadId).digest('hex'),'Synthetic task lead','Synthetic learner',agentId]);
  const agent={...owner,role:'agent',actorType:'agent',actorId:String(agentId),agentId};
  const secondAgent={...owner,role:'agent',actorType:'agent',actorId:String(secondAgentId),agentId:secondAgentId};
  const outsiderAgent={...owner,role:'agent',actorType:'agent',actorId:String(outsiderAgentId),agentId:outsiderAgentId};
  const observer={...owner,role:'manager',actorType:'identity',actorId:observerId};
  const participants=[{actorType:'agent',actorId:String(agentId),role:'assignee'},{actorType:'agent',actorId:String(secondAgentId),role:'assignee'},{actorType:'identity',actorId:identityId,role:'observer'},{actorType:'identity',actorId:observerId,role:'observer'}];
  const created=await tasks.create(db,owner,{title:'Synthetic learner follow-up',taskType:'lead_follow_up',source:{type:'lead',id:leadId},participants});
  assert.equal(created.lead.id,leadId);assert.ok(created.dueAt,'lead follow-up due date is inherited');
  const agentDetail=await tasks.detail(db,agent,created.id);
  assert.equal(agentDetail.lead.id,leadId);assert.ok(agentDetail.task.assigned_at,'assignment timestamp is persisted');assert.ok(agentDetail.lead.activities.some(item=>item.activity_type==='task_created'));
  assert.deepEqual(agentDetail.participants.map(item=>item.role).sort(),['assignee','assignee','observer','observer']);
  assert.equal((await tasks.detail(db,secondAgent,created.id)).lead.id,leadId,'each assigned agent can see the full linked lead');
  await assert.rejects(tasks.detail(db,{...agent,tenantId:crypto.randomUUID()},created.id),{code:'TASK_NOT_FOUND'});
  const taskApp=express();taskApp.use('/tasks',createTaskRouter({pool,contextFor:async req=>req.get('x-test-actor')==='outsider'?outsiderAgent:owner}));
  const taskServer=http.createServer(taskApp);await new Promise((resolve,reject)=>{taskServer.once('error',reject);taskServer.listen(0,'127.0.0.1',resolve);});
  try{
    const taskUrl=`http://127.0.0.1:${taskServer.address().port}/tasks/${created.id}`;
    const ownerResponse=await fetch(taskUrl);assert.equal(ownerResponse.status,200,'owner can reach task detail through the existing route');
    for(const suffix of ['', '/events', '/notifications', '/messages']){
      const response=await fetch(taskUrl+suffix,{headers:{'X-Test-Actor':'outsider'}}),body=await response.json();
      assert.equal(response.status,403,`nonparticipant agent is denied direct ${suffix||'detail'} route access`);
      assert.equal(body.code,'PERMISSION_DENIED');
    }
  }finally{await new Promise(resolve=>taskServer.close(resolve));}

  const latest=await tasks.messages(db,owner,created.id,{latest:true});assert.deepEqual(latest.items,[]);
  const message=await tasks.addMessage(db,agent,created.id,'Synthetic appointment confirmed.');
  assert.equal(message.body,'Synthetic appointment confirmed.');
  const observerMessages=await tasks.messages(db,observer,created.id,{latest:true});assert.equal(observerMessages.items.length,1,'observers can read task chat');assert.equal(observerMessages.items[0].senderName,'Synthetic Task Agent','chat identifies the participant who sent each message');
  assert.equal((await tasks.messages(db,owner,created.id,{latest:true})).items.length,1);
  const mark=await tasks.markMessagesRead(db,owner,created.id,String(message.id));assert.equal(mark.lastReadMessageId,String(message.id));
  assert.equal((await tasks.list(db,owner,{scope:'mine'})).items.find(item=>item.id===created.id).unread_count,0);

  const edited=await tasks.edit(db,owner,created.id,{title:'Synthetic learner follow-up updated',taskType:'lead_follow_up',priority:'high',dueAt:null,source:{type:'lead',id:leadId},participants,expectedRevision:1});
  assert.equal(edited.revision,2);assert.equal(edited.priority,'high');
  const changes=await Promise.allSettled([
    tasks.updateStatus(db,owner,created.id,{status:'in_progress',expectedRevision:2,comment:'First concurrent transition'}),
    tasks.updateStatus(other,owner,created.id,{status:'blocked',expectedRevision:2,comment:'Competing transition'}),
  ]);
  assert.equal(changes.filter(result=>result.status==='fulfilled').length,1,'one competing status write commits');
  assert.equal(changes.filter(result=>result.status==='rejected'&&result.reason.code==='TASK_REVISION_CONFLICT').length,1,'losing stale revision is rejected cleanly');
  const [[afterRace]]=await db.query('SELECT status,revision,completed_at FROM sx_tasks WHERE tenant_id=? AND id=?',[tenantId,created.id]);
  assert.equal(Number(afterRace.revision),3);
  const [[statusEvents]]=await db.query("SELECT COUNT(*) AS n FROM sx_task_events WHERE tenant_id=? AND task_id=? AND event_type='status_changed' AND revision=3",[tenantId,created.id]);assert.equal(Number(statusEvents.n),1);
  const [[statusNotices]]=await db.query('SELECT COUNT(*) AS n FROM sx_task_notifications WHERE tenant_id=? AND task_id=? AND task_revision=3',[tenantId,created.id]);assert.equal(Number(statusNotices.n),8,'one email and WhatsApp intent for each assignee and observer');

  const completed=await tasks.updateStatus(db,agent,created.id,{status:'completed',expectedRevision:3,comment:'Synthetic follow-up complete'});assert.equal(completed.revision,4);
  const [[completion]]=await db.query('SELECT completed_at,revision FROM sx_tasks WHERE tenant_id=? AND id=?',[tenantId,created.id]);assert.ok(completion.completed_at,'completion timestamp is persisted');assert.equal(Number(completion.revision),4);
  const [[completionEvent]]=await db.query("SELECT occurred_at,to_status FROM sx_task_events WHERE tenant_id=? AND task_id=? AND revision=4 AND event_type='status_changed'",[tenantId,created.id]);assert.ok(completionEvent.occurred_at);assert.equal(completionEvent.to_status,'completed');
  const [[completionNotices]]=await db.query('SELECT COUNT(*) AS n FROM sx_task_notifications WHERE tenant_id=? AND task_id=? AND task_revision=4',[tenantId,created.id]);assert.equal(Number(completionNotices.n),8);
  for(let i=0;i<105;i++)await db.query("INSERT INTO sx_task_events(tenant_id,task_id,revision,actor_type,actor_id,event_type,details_json) VALUES(?,?,0,'system',NULL,'synthetic_archive','{}')",[tenantId,created.id]);
  const recentHistory=await tasks.eventHistory(db,agent,created.id,{limit:100});assert.equal(recentHistory.items.length,100);assert.equal(recentHistory.hasMore,true);assert.ok(recentHistory.nextCursor);
  const olderHistory=await tasks.eventHistory(db,observer,created.id,{before:recentHistory.nextCursor,limit:100});assert.equal(olderHistory.items.length,10);assert.equal(olderHistory.hasMore,false);
  const detailHistory=await tasks.detail(db,agent,created.id);assert.equal(detailHistory.events.length,100);assert.equal(detailHistory.eventsHasMore,true);
  for(let i=0;i<105;i++)await db.query("INSERT INTO sx_task_notifications(tenant_id,task_id,task_revision,recipient_type,recipient_id,channel,status) VALUES(?,?,?,'identity',?,'email','accepted')",[tenantId,created.id,500+i,`synthetic-notice-${i}`]);
  const recentNotices=await tasks.notificationHistory(db,agent,created.id,{limit:100});assert.equal(recentNotices.items.length,100);assert.equal(recentNotices.hasMore,true);
  const olderNotices=await tasks.notificationHistory(db,observer,created.id,{before:recentNotices.nextCursor,limit:100});assert.equal(olderNotices.items.length,37);assert.equal(olderNotices.hasMore,false);
  const detailNotices=await tasks.detail(db,agent,created.id);assert.equal(detailNotices.notifications.length,100);assert.equal(detailNotices.notificationsHasMore,true);
  const removed=await tasks.remove(db,owner,created.id,4);assert.equal(removed.deleted,true);assert.equal(removed.revision,5);
  await assert.rejects(tasks.detail(db,agent,created.id),{code:'TASK_NOT_FOUND'});
  const [[deleted]]=await db.query('SELECT deleted_at FROM sx_tasks WHERE tenant_id=? AND id=?',[tenantId,created.id]);assert.ok(deleted.deleted_at);
  return {taskCreateWithLead:true,multiRoleParticipants:true,participantLeadContext:true,participantChatAndReadCursor:true,nonparticipantDirectRoutesDenied:true,revisionCheckedEdit:true,concurrentStatusSerialization:true,historyAndNotificationPagination:true,historyAndNotificationAtomicity:true,softDelete:true,syntheticTaskData:true,externalWrites:false};
};
