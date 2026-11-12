'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {resolveLeadLink,resolveOutboundRecipient,findUniqueLeadLinkByNumber,resolveAccessibleLeadLinkByNumber,accessibleLeadIds,phoneDigitsForMatch,
  phoneDigitsCandidatesForMatch}=require('../modules/platform/telephony-call-leads');
const {AsteriskCallControl}=require('../modules/platform/asterisk-call-control');
const gatewayPorts=require('../modules/platform/asterisk-gateway-ports');
const {salemaxSales}=require('../modules/platform/categories');

const tenantId='11111111-1111-4111-8111-111111111111';
const leadId='22222222-2222-4222-8222-222222222222';
const secondLeadId='33333333-3333-4333-8333-333333333333';
const ownerUid='owner-uid';
const uidHash=crypto.createHash('sha256').update(ownerUid).digest('hex');
function context(role='owner'){
  return {tenant:{id:tenantId,categoryKey:'7network_sales'},membership:{id:`${role}-membership`,role}};
}
function dbFor(role,{ownerCount=1,agentCount=1,leadOwnerAgentId=41,leadMobile='+919876543210',leadSuppressed=false}={}){
  return {async query(sql){
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[...Array(ownerCount)].map(()=>({uid:ownerUid,legacyUidHash:uidHash})),[]];
    if(sql.includes('SELECT a.id,a.uid,o.legacy_uid_hash'))return [[...Array(agentCount)].map((_,index)=>({id:41+index,uid:'agent-uid',legacyUidHash:crypto.createHash('sha256').update('agent-uid').digest('hex')})),[]];
    if(sql.includes('SELECT DISTINCT a.id,a.uid,o.legacy_uid_hash'))return [[{id:41,uid:'agent-uid',legacyUidHash:crypto.createHash('sha256').update('agent-uid').digest('hex')}],[]];
    if(sql.includes('SELECT id,owner_agent_id,mobile FROM pipeline_leads'))return [[{id:leadId,owner_agent_id:leadOwnerAgentId,mobile:leadMobile}],[]];
    if(sql.includes('FROM pipeline_activity'))return [[...(leadSuppressed?[{id:1}]:[])],[]];
    throw new Error(`Unexpected lead authorization query: ${sql}`);
  }};
}

test('owner can link a lead from the same business to a call',async()=>{
  const result=await resolveLeadLink(dbFor('owner'),context('owner'),leadId);
  assert.deepEqual(result,{leadId,leadUidHash:uidHash,destination:'+919876543210'});
});

test('agent can link only leads assigned to its active 7Network membership',async()=>{
  const result=await resolveLeadLink(dbFor('agent'),context('agent'),leadId);
  assert.deepEqual(result,{leadId,leadUidHash:uidHash,destination:'+919876543210'});
  await assert.rejects(resolveLeadLink(dbFor('agent',{leadOwnerAgentId:99}),context('agent'),leadId),{code:'CALL_LEAD_NOT_ACCESSIBLE'});
});

test('Sales outbound calls require an accessible lead and use its server-side phone',async()=>{
  let queried=false;const noLeadDb={async query(){queried=true;return [[],[]];}};
  await assert.rejects(resolveOutboundRecipient(noLeadDb,context('agent'),{destination:'+919999999999'}),{code:'OUTBOUND_LEAD_REQUIRED'});
  assert.equal(queried,false,'unlinked Sales calls are rejected before any call setup query');
  const recipient=await resolveOutboundRecipient(dbFor('agent'),context('agent'),{leadId,destination:'+919999999999'});
  assert.equal(recipient.destination,'+919876543210');
  assert.equal(recipient.leadLink.leadId,leadId);
});

test('Sales outbound calls are blocked after the lead has a recorded do-not-call outcome',async()=>{
  await assert.rejects(resolveOutboundRecipient(dbFor('agent',{leadSuppressed:true}),context('agent'),{leadId}),{code:'CALL_LEAD_DO_NOT_CALL'});
});

test('Asterisk call origination rejects an unlinked 7Network Sales call before database or PBX work',async()=>{
  let accessed=false;const control=new AsteriskCallControl({pool:{async getConnection(){accessed=true;throw new Error('unexpected database access');}}});
  const callContext={audience:'tenant',identity:{id:'agent-identity'},tenant:{id:tenantId,status:'active',categoryKey:'7network_sales',categoryVersion:1},
    membership:{id:'agent-membership',tenantId,role:'agent',status:'active'},category:salemaxSales,subscription:{status:'active',capabilities:['telephony.call-center']}};
  await assert.rejects(control.originateOutbound(callContext,{destination:'+919999999999',clientType:'mobile'}),{code:'OUTBOUND_LEAD_REQUIRED'});
  assert.equal(accessed,false);
});

test('Sales lead calls reject missing or non-E.164 numbers',async()=>{
  await assert.rejects(resolveLeadLink(dbFor('agent',{leadMobile:''}),context('agent'),leadId),{code:'CALL_LEAD_PHONE_INVALID'});
  await assert.rejects(resolveLeadLink(dbFor('agent',{leadMobile:'00919876543210'}),context('agent'),leadId),{code:'CALL_LEAD_PHONE_INVALID'});
});

test('non-Sales categories retain manual outbound destinations',async()=>{
  const regular={...context('owner'),tenant:{id:tenantId,categoryKey:'training_center'}};
  const recipient=await resolveOutboundRecipient({async query(){throw new Error('manual call should not resolve a Sales lead');}},regular,{destination:'+97455551234'});
  assert.deepEqual(recipient,{leadLink:null,destination:'+97455551234'});
});

test('inbound caller numbers link only a unique same-business Sales lead without guessing country codes',async()=>{
  const queries=[];
  const db={async query(sql,args=[]){
    queries.push({sql,args});
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[{uid:ownerUid,legacyUidHash:uidHash}],[]];
    if(sql.includes('FROM pipeline_leads l'))return [[{id:leadId}],[]];
    throw new Error(`Unexpected caller lookup query: ${sql}`);
  }};
  assert.equal(phoneDigitsForMatch('0091 (9876) 543210'),'919876543210');
  assert.equal(phoneDigitsForMatch('55551234'),'55551234');
  assert.deepEqual(phoneDigitsCandidatesForMatch('+974 5555 0000','QA'),['97455550000','55550000']);
  assert.deepEqual(phoneDigitsCandidatesForMatch('55550000','QA'),['55550000','97455550000']);
  assert.deepEqual(phoneDigitsCandidatesForMatch('+97455550000','IN'),['97455550000']);
  assert.deepEqual(await findUniqueLeadLinkByNumber(db,{tenantId,categoryKey:'7network_sales',number:'+91 9876 543210'}),
    {leadUidHash:uidHash,leadId});
  assert.match(queries[1].sql,/LEFT\(REGEXP_REPLACE\(COALESCE\(l\.mobile/);
  assert.match(queries[1].sql,/IN \(\?\)/);
  assert.deepEqual(queries[1].args[1],['919876543210']);
  let queried=false;
  assert.equal(await findUniqueLeadLinkByNumber({async query(){queried=true;return[[],[]];}},
    {tenantId,categoryKey:'training_center',number:'+919876543210'}),null);
  assert.equal(queried,false);
});

test('Qatar inbound ANI matches a unique lead stored in either local or E.164 form',async()=>{
  const lookups=[];
  const db={async query(sql,args=[]){
    lookups.push({sql,args});
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[{uid:ownerUid,legacyUidHash:uidHash}],[]];
    if(sql.includes('FROM pipeline_leads l'))return [[{id:leadId}],[]];
    throw new Error(`Unexpected caller lookup query: ${sql}`);
  }};
  const linked=await findUniqueLeadLinkByNumber(db,{tenantId,categoryKey:'7network_sales',countryCode:'QA',number:'+974 5555 0000'});
  assert.deepEqual(linked,{leadUidHash:uidHash,leadId});
  assert.deepEqual(lookups[1].args[1],['97455550000','55550000']);
  assert.match(lookups[1].sql,/IN \(\?\)/);
});

test('a Qatar local-number do-not-call lead blocks a direct E.164 mobile call',async()=>{
  const oldEligible=gatewayPorts.eligible,statements=[],hangups=[];
  gatewayPorts.eligible=async()=>true;
  const db={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,args=[]){
    statements.push({sql,args});
    if(sql.includes('FROM sx_platform_asterisk_config'))return [[{enabled:1}],[]];
    if(sql.includes('FROM sx_platform_asterisk_runtime'))return [[{status:'connected',heartbeat_fresh:1}],[]];
    if(sql.includes('SELECT x.tenant_id,x.membership_id'))return [[{tenant_id:tenantId,membership_id:'owner-membership',extension:'1201',role:'owner',
      membership_status:'active',identity_status:'active',tenant_status:'active',category_key:'7network_sales',category_version:1,country_code:'QA'}],[]];
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[{uid:ownerUid,legacyUidHash:uidHash}],[]];
    if(sql.includes('SELECT l.id FROM pipeline_leads l')&&sql.includes('EXISTS(SELECT 1 FROM pipeline_activity'))return [[{id:leadId}],[]];
    if(sql.includes('SELECT l.id FROM pipeline_leads l'))return [[{id:leadId}],[]];
    if(sql.includes('SELECT id,owner_agent_id,mobile FROM pipeline_leads'))return [[{id:leadId,owner_agent_id:null,mobile:'55550000'}],[]];
    if(sql.includes('SELECT o.legacy_uid_hash AS uidHash'))return [[{uidHash}],[]];
    throw new Error(`Unexpected direct-dial query: ${sql}`);
  }};
  const control=new AsteriskCallControl({pool:{async getConnection(){return db;}}});
  control.client=async()=>({async hangup(channelId){hangups.push(channelId);}});
  try{
    await assert.rejects(control.startMobileOutbound('mobile-channel-1',{channelName:'PJSIP/salemax-1201-mobile-00000001',destination:'+97455550000'}),
      {code:'CALL_LEAD_DO_NOT_CALL'});
    const suppression=statements.find(row=>row.sql.includes('EXISTS(SELECT 1 FROM pipeline_activity'));
    assert.deepEqual(suppression.args,[uidHash,['97455550000','55550000']]);
    assert.equal(statements.some(row=>row.sql.includes('INSERT INTO sx_telephony_calls')),false);
    assert.deepEqual(hangups,['mobile-channel-1']);
  }finally{gatewayPorts.eligible=oldEligible;}
});

test('Sales mobile app can direct-dial an unlinked number without CRM lead access',async()=>{
  const oldEligible=gatewayPorts.eligible,gatewayId='44444444-4444-4444-8444-444444444444';
  const statements=[];let callInsert=null,started=null;
  gatewayPorts.eligible=async()=>true;
  const db={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,args=[]){
    statements.push({sql,args});
    if(sql.includes('FROM sx_platform_asterisk_config'))return [[{enabled:1}],[]];
    if(sql.includes('FROM sx_platform_asterisk_runtime'))return [[{status:'connected',heartbeat_fresh:1}],[]];
    if(sql.includes('SELECT x.tenant_id,x.membership_id'))return [[{tenant_id:tenantId,membership_id:'owner-membership',extension:'1201',role:'owner',
      membership_status:'active',identity_status:'active',tenant_status:'active',category_key:'salemax_sales',category_version:1,country_code:'QA'}],[]];
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[{uid:ownerUid,legacyUidHash:uidHash}],[]];
    if(sql.includes('FROM pipeline_leads l')&&sql.includes('EXISTS(SELECT 1 FROM pipeline_activity'))return [[],[]];
    if(sql.includes('FROM pipeline_leads l'))return [[],[]];
    if(sql.includes('SELECT o.legacy_uid_hash AS uidHash'))return [[{uidHash}],[]];
    if(sql.includes('SELECT COALESCE(SUM(status IN'))return [[{active_calls:0,recent_attempts:0}],[]];
    if(sql.includes('FROM sx_telephony_gateway_channels'))return [[{channel_no:1}],[]];
    if(sql.includes('FROM sx_telephony_gateways'))return [[{id:gatewayId}],[]];
    if(sql.includes('INSERT INTO sx_telephony_calls')){callInsert=args;return[{affectedRows:1}];}
    if(/^\s*SELECT\b/i.test(sql))throw new Error(`Unexpected Sales mobile dial query: ${sql}`);
    return[{affectedRows:1}];
  }};
  const control=new AsteriskCallControl({pool:{async getConnection(){return db;}}});
  control.startOutboundGateway=async(channelId,reservation,options)=>{started={channelId,reservation,options};return true;};
  try{
    assert.equal(await control.startMobileOutbound('mobile-channel-1',{
      channelName:'PJSIP/salemax-1201-mobile-00000001',destination:'55550000'}),true);
    assert.equal(callInsert[9],'+97455550000');
    assert.equal(callInsert[7],null,'an unmatched direct number has no lead UID link');
    assert.equal(callInsert[8],null,'an unmatched direct number has no lead ID link');
    assert.ok(statements.some(row=>row.sql.includes('EXISTS(SELECT 1 FROM pipeline_activity')),
      'do-not-call records are still checked for the dialed number');
    assert.deepEqual(started,{channelId:'mobile-channel-1',reservation:{tenantId,callId:callInsert[1],membershipId:'owner-membership',
      clientType:'mobile',destination:'+97455550000'},options:{deferAgentAnswer:true}});
  }finally{gatewayPorts.eligible=oldEligible;}
});

test('inbound caller numbers remain unlinked when more than one Sales lead shares the number',async()=>{
  const db={async query(sql){
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[{uid:ownerUid,legacyUidHash:uidHash}],[]];
    if(sql.includes('FROM pipeline_leads l'))return [[{id:leadId},{id:'33333333-3333-4333-8333-333333333333'}],[]];
    throw new Error(`Unexpected caller lookup query: ${sql}`);
  }};
  assert.equal(await findUniqueLeadLinkByNumber(db,{tenantId,categoryKey:'7network_sales',number:'+919876543210'}),null);
});

test('a direct-dial or inbound call links a matching lead only when the answering membership can access it',async()=>{
  const makeDb=leadOwnerAgentId=>({async query(sql){
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[{uid:ownerUid,legacyUidHash:uidHash}],[]];
    if(sql.includes('SELECT l.id FROM pipeline_leads l'))return [[{id:leadId}],[]];
    if(sql.includes('SELECT a.id,a.uid,o.legacy_uid_hash'))return [[{id:41,uid:'agent-uid',
      legacyUidHash:crypto.createHash('sha256').update('agent-uid').digest('hex')}],[]];
    if(sql.includes('SELECT id,owner_agent_id,mobile FROM pipeline_leads'))return [[{id:leadId,owner_agent_id:leadOwnerAgentId,mobile:'+919876543210'}],[]];
    throw new Error(`Unexpected accessible lead query: ${sql}`);
  }});
  assert.deepEqual(await resolveAccessibleLeadLinkByNumber(makeDb(41),{tenantId,categoryKey:'7network_sales',
    membershipId:'agent-membership',role:'agent',number:'+919876543210'}),{leadUidHash:uidHash,leadId});
  assert.equal(await resolveAccessibleLeadLinkByNumber(makeDb(99),{tenantId,categoryKey:'7network_sales',
    membershipId:'agent-membership',role:'agent',number:'+919876543210'}),null);
});

test('inaccessible and malformed lead identifiers fail closed before call creation',async()=>{
  let queried=false;const db={async query(){queried=true;return [[],[]];}};
  await assert.rejects(resolveLeadLink(db,context('owner'),'not-a-uuid'),{code:'INVALID_CALL_LEAD_ID'});
  assert.equal(queried,false);
  await assert.rejects(resolveLeadLink(db,{...context(),tenant:{id:tenantId,categoryKey:'training_center'}},leadId),{code:'CALL_LEAD_CATEGORY_UNAVAILABLE'});
});

test('call history returns only unique lead identifiers the owner can access',async()=>{
  const calls=[];
  const db={async query(sql,args=[]){
    calls.push({sql,args});
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[{uid:ownerUid,legacyUidHash:uidHash}],[]];
    if(sql.includes('SELECT id,owner_agent_id AS ownerAgentId FROM pipeline_leads'))return [[
      {id:leadId,ownerAgentId:null},{id:secondLeadId,ownerAgentId:41}],[]];
    throw new Error(`Unexpected lead visibility query: ${sql}`);
  }};
  const visible=await accessibleLeadIds(db,context('owner'),[leadId,leadId,'bad-id',secondLeadId]);
  assert.deepEqual([...visible].sort(),[leadId,secondLeadId].sort());
  assert.deepEqual(calls[1].args,[uidHash,[leadId,secondLeadId]]);
});

test('call history hides leads outside an agent assignment and filters malformed IDs',async()=>{
  const agentHash=crypto.createHash('sha256').update('agent-uid').digest('hex');
  const calls=[];
  const db={async query(sql,args=[]){
    calls.push({sql,args});
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[{uid:ownerUid,legacyUidHash:uidHash}],[]];
    if(sql.includes('SELECT a.id,a.uid,o.legacy_uid_hash'))return [[{id:41,uid:'agent-uid',legacyUidHash:agentHash}],[]];
    if(sql.includes('SELECT id,owner_agent_id AS ownerAgentId FROM pipeline_leads'))return [[
      {id:leadId,ownerAgentId:41},{id:secondLeadId,ownerAgentId:99}],[]];
    throw new Error(`Unexpected lead visibility query: ${sql}`);
  }};
  const visible=await accessibleLeadIds(db,context('agent'),[leadId,secondLeadId,'forged']);
  assert.deepEqual([...visible],[leadId]);
  assert.deepEqual(calls[2].args,[uidHash,[leadId,secondLeadId]]);
});

test('manager and team leader call history uses only currently mapped team agents',async()=>{
  for(const [role,scopeColumn,scopedAgentId,otherAgentId] of [
    ['manager','manager_membership_id',41,42],
    ['team_leader','team_leader_membership_id',42,41],
  ]){
    const calls=[];
    const agentRows=[41,42].map(id=>({id,uid:`agent-${id}`,
      legacyUidHash:crypto.createHash('sha256').update(`agent-${id}`).digest('hex')}));
    const db={async query(sql,args=[]){
      calls.push({sql,args});
      if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[{uid:ownerUid,legacyUidHash:uidHash}],[]];
      if(sql.includes('SELECT DISTINCT a.id,a.uid,o.legacy_uid_hash'))return [[agentRows.find(row=>row.id===scopedAgentId)],[]];
      if(sql.includes('SELECT id,owner_agent_id AS ownerAgentId FROM pipeline_leads'))return [[
        {id:leadId,ownerAgentId:scopedAgentId},{id:secondLeadId,ownerAgentId:otherAgentId}],[]];
      throw new Error(`Unexpected lead visibility query: ${sql}`);
    }};
    const visible=await accessibleLeadIds(db,context(role),[leadId,secondLeadId]);
    assert.deepEqual([...visible],[leadId]);
    assert.match(calls[1].sql,new RegExp(scopeColumn));
  }
});

test('call history does not query lead IDs for other categories or invalid owner mappings',async()=>{
  let queries=0;
  const db={async query(sql){
    queries++;
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[{uid:ownerUid,legacyUidHash:'wrong-hash'}],[]];
    throw new Error(`Unexpected query after an invalid owner mapping: ${sql}`);
  }};
  const otherCategory={...context('owner'),tenant:{id:tenantId,categoryKey:'training_center'}};
  assert.equal((await accessibleLeadIds(db,otherCategory,[leadId])).size,0);
  assert.equal(queries,0);
  assert.equal((await accessibleLeadIds(db,context('owner'),['forged'])).size,0);
  assert.equal(queries,0);
  assert.equal((await accessibleLeadIds(db,context('owner'),[leadId])).size,0);
  assert.equal(queries,1);
});

test('manager and team leader lead links are checked against current organization scope',async()=>{
  for(const role of ['manager','team_leader']){
    const statements=[];const db=dbFor(role);const original=db.query;
    db.query=async(sql,...args)=>{statements.push(sql);return original(sql,...args);};
    const result=await resolveLeadLink(db,context(role),leadId);
    assert.equal(result.leadId,leadId);
    const scope=statements.find(sql=>sql.includes('FROM sx_sales_org_history'));
    assert.ok(scope);assert.match(scope,role==='manager'?/manager_membership_id/:/team_leader_membership_id/);
  }
});

test('the existing Pipeline opens Call Center with a lead, verifies it, and submits the authorized lead association',()=>{
  const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
  const pipeline=fs.readFileSync(path.join(root,'client/public/pipeline/pipeline.js'),'utf8');
  const entry=fs.readFileSync(path.join(root,'client/public/pipeline-entry.js'),'utf8');
  const calls=fs.readFileSync(path.join(root,'client/public/call-center/call-center.js'),'utf8');
  const callControl=fs.readFileSync(path.join(root,'modules/platform/asterisk-call-control.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'client/public/call-center/index.html'),'utf8');
  assert.match(pipeline,/page=call-center&lead=\$\{encodeURIComponent\(id\)\}/);
  assert.match(entry,/expectedSource='\/call-center\/\?embed=1'\+\(leadId\?/);
  assert.match(calls,/api\/pipeline\/leads\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(calls,/\{destination,clientType,\.\.\.\(linkedLeadId\?\{leadId:linkedLeadId\}/);
  assert.match(callControl,/callLeads\.resolveOutboundRecipient\(db,context,input\)/);
  assert.match(callControl,/destination: recipient\.destination/);
  assert.match(callControl,/started_by_membership_id,lead_uid_hash,lead_id,remote_number/);
  const inboundLeadMatch=callControl.indexOf('callLeads.findUniqueLeadLinkByNumber');
  const inboundCallInsert=callControl.indexOf('lead_uid_hash,lead_id,remote_number,inbound_queue_id,inbound_channel_id,bridge_id');
  assert.ok(inboundLeadMatch>=0&&inboundLeadMatch<inboundCallInsert,'a unique caller-number match is stored before the inbound call is queued');
  assert.match(callControl,/leadLink\?\.leadUidHash\|\|null,leadLink\?\.leadId\|\|null,callerAni/);
  assert.match(callControl,/resolveAccessibleLeadLinkByNumber\(db,[\s\S]*?membershipId:input\.membershipId,role:row\.membership_role,number:row\.remote_number/);
  assert.match(calls,/OUTBOUND_LEAD_REQUIRED:text\('Open an accessible lead/);
  assert.match(html,/id="leadCallContext"/);
  const callCenterHtml=fs.readFileSync(path.join(root,'client/public/call-center/index.html'),'utf8');
  assert.match(callCenterHtml,/call-center\.js\?v=20261112-sip-direct-dial2/);
});
