'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const recordings=require('../modules/platform/telephony-recordings');
const {getCategory}=require('../modules/platform/categories');

const tenantId='11111111-1111-4111-8111-111111111111';
const memberId='22222222-2222-4222-8222-222222222222';
const identityId='33333333-3333-4333-8333-333333333333';
function context(role='owner',overrides={}){return{audience:'tenant',identity:{id:identityId},tenant:{id:tenantId,status:'active',categoryKey:'7network_sales',categoryVersion:1},
  membership:{id:memberId,tenantId,role,status:'active'},category:getCategory('7network_sales',1),subscription:{status:'active',capabilities:['telephony.call-center']},...overrides};}

test('recording policy starts off, requires notice acknowledgement and retention, and is revision checked',async()=>{
  let expectedRevision=0,updates=[];
  const db={async query(sql,args=[]){updates.push({sql,args});
    if(sql.includes('SELECT enabled,notice_confirmed'))return[[]];
    if(sql.includes('SELECT revision FROM sx_telephony_recording_policies'))return[[{revision:expectedRevision}]];
    if(sql.includes('UPDATE sx_telephony_recording_policies')){expectedRevision++;return[{affectedRows:1}];}
    return[{affectedRows:1}];
  },async beginTransaction(){},async commit(){},async rollback(){}};
  assert.deepEqual(await recordings.getPolicy(db,context()),{enabled:false,noticeConfirmed:false,noticeVersion:1,retentionDays:null,revision:0});
  await assert.rejects(recordings.savePolicy(db,context(),{enabled:true,noticeConfirmed:false,retentionDays:30,expectedRevision:0}),{code:'RECORDING_POLICY_PREREQUISITES_REQUIRED'});
  const saved=await recordings.savePolicy(db,context(),{enabled:true,noticeConfirmed:true,retentionDays:30,expectedRevision:0});
  assert.equal(saved.enabled,true);assert.equal(saved.retentionDays,30);assert.equal(saved.revision,1);
  await assert.rejects(recordings.savePolicy(db,context(),{enabled:false,noticeConfirmed:true,retentionDays:30,expectedRevision:0}),{code:'STALE_RECORDING_POLICY'});
  const untouched={query(){throw new Error('denied recording-policy writes must not reach persistence');},beginTransaction(){throw new Error('must not begin a transaction');}};
  for(const role of ['manager','team_leader','agent']){
    const staff=context(role);staff.membership.customPermissions=['calls.recording.manage'];
    await assert.rejects(recordings.savePolicy(untouched,staff,{enabled:false,noticeConfirmed:false,retentionDays:null,expectedRevision:1}),{code:'PERMISSION_DENIED'});
  }
  assert.ok(updates.some(item=>item.sql.includes("'telephony.recording-policy.updated'")));
});
test('recording policy preserves access for the historical Sales category alias',async()=>{
 const owner=context('owner'),aliased={...owner,tenant:{...owner.tenant,categoryKey:'salemax_sales'}};
 assert.deepEqual(await recordings.getPolicy({query:async()=>[[]]},aliased),{enabled:false,noticeConfirmed:false,noticeVersion:1,retentionDays:null,revision:0});
});

test('recording begins only for a connected call under an enabled acknowledged policy and is idempotently reserved',async()=>{
  const callId=crypto.randomUUID(),bridgeId=crypto.randomUUID();let recordingRow=false,started=0;
  const db={async query(sql){
    if(sql.includes('FROM sx_telephony_recording_policies'))return[[{enabled:1,notice_confirmed:1,retention_days:30}]];
    if(sql.includes('FROM sx_telephony_calls'))return[[{status:'connected'}]];
    if(sql.includes('INSERT IGNORE INTO sx_telephony_call_recordings')){if(recordingRow)return[{affectedRows:0}];recordingRow=true;return[{affectedRows:1}];}
    return[{affectedRows:1}];
  },async beginTransaction(){},async commit(){},async rollback(){},release(){}};
  const pool={async getConnection(){return db;},async query(){return[{affectedRows:1}];}};
  const factory=async()=>({async recordBridge(actualBridge,name){started++;assert.equal(actualBridge,bridgeId);assert.equal(name,`salemax_${callId.replace(/-/g,'')}`);}});
  assert.deepEqual(await recordings.startForCall(pool,factory,tenantId,callId,bridgeId),{started:true,recordingName:`salemax_${callId.replace(/-/g,'')}`});
  assert.deepEqual(await recordings.startForCall(pool,factory,tenantId,callId,bridgeId),{started:false});
  assert.equal(started,1);
});

test('recording completion only marks the tenant-owned recording ready and duration stays bounded',async()=>{
  const updates=[],name=`salemax_${crypto.randomBytes(16).toString('hex')}`;
  const pool={async query(sql,args=[]){updates.push({sql,args});if(sql.includes('SELECT tenant_id,state,expires_at'))return[[{tenant_id:tenantId,state:'recording',expired:0}]];return[{affectedRows:1}];}};
  assert.equal(await recordings.handleFinished(pool,async()=>({}),{type:'RecordingFinished',recording:{name,duration:93}}),true);
  const update=updates.find(item=>item.sql.includes("SET state='ready'"));assert.ok(update);assert.equal(update.args[0],93);
  updates.length=0;
  await recordings.handleFinished(pool,async()=>({}),{type:'RecordingFinished',recording:{name,duration:999999}});
  assert.equal(updates.find(item=>item.sql.includes("SET state='ready'")).args[0],null);
});

test('recording playback requires the agent to own or be assigned to the call and records an audit event',async()=>{
  const callId=crypto.randomUUID(),audit=[];let foreign=false;
  const db={async query(sql,args=[]){
    if(sql.includes('SELECT c.id,c.started_by_membership_id'))return[[{id:callId,startedBy:foreign?'other-membership':memberId,answeredBy:null,queueId:null}]];
    if(sql.includes('FROM sx_telephony_call_legs'))return[[]];
    if(sql.includes('FROM sx_telephony_call_recordings'))return[[{id:crypto.randomUUID(),recordingName:'salemax_'+callId.replace(/-/g,''),state:'ready',expiresAt:new Date(Date.now()+60000)}]];
    if(sql.includes("'telephony.call-recording.played'")){audit.push(args);return[{affectedRows:1}];}
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const agent=context('agent');
  assert.equal((await recordings.openRecording(db,agent,callId)).state,'ready');assert.equal(audit.length,1);
  foreign=true;await assert.rejects(recordings.openRecording(db,agent,callId),{code:'PERMISSION_DENIED'});
});
