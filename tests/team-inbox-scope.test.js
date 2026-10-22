'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { resolveInboxUid, resolveInboxScope, filterAssignedChats, assignedChatSql, authorizeInboxPayload, authorizeInboxFeature } = require('../modules/platform/team-inbox-scope');
const hash = uid => crypto.createHash('sha256').update(uid).digest('hex');
const user = { id: 2, uid: 'synthetic-manager' };
const member = { tenantId: 'synthetic-tenant', tenantStatus: 'active', categoryKey: 'training_center', membershipId:'synthetic-membership', identityId: 'staff-a', role: 'manager', membershipStatus: 'active', identityStatus: 'active', uidHash: hash(user.uid), delegatedPermissions: [] };
const query = row => async sql => sql.includes('WHERE o.source_table') ? [row] : [{ uid: 'synthetic-owner', uidHash: hash('synthetic-owner') }];
test('real Agent-seat source uses the agents ownership link and rejects foreign owner bindings',async()=>{
  const agent={...user,isAgent:true,role:'agent',is_active:1,owner_uid:'synthetic-owner'};
  const lookup=async sql=>{if(sql.includes('WHERE o.source_table')){assert.match(sql,/source_table='agents'/);return [{...member,role:'agent'}];}return [{uid:'synthetic-owner',uidHash:hash('synthetic-owner')}];};
  assert.equal((await resolveInboxScope(lookup,agent,'send_chat_message')).assignedOnly,true);
  for(const change of [{owner_uid:'other'},{is_active:0}])await assert.rejects(resolveInboxScope(lookup,{...agent,...change},'get_chat_list'),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});

test('manager reads and replies through the verified owner Inbox scope', async () => {
  for (const event of ['get_chat_list','load_conversation','send_chat_message']) assert.equal(await resolveInboxUid(query(member), user, event), 'synthetic-owner');
  assert.equal(await resolveInboxUid(async () => [], user, 'get_chat_list'), user.uid);
});

test('Manager scope includes only assigned QR chats and QR connections', async () => {
  const assignedChannel = { instanceId: 41, uniqueId: 'owner-qr-session', number: '97450000000', title: 'Support', status: 'ACTIVE' };
  const lookup = async sql => {
    if (sql.includes('WHERE o.source_table')) return [{ ...member, role: 'manager' }];
    if (sql.includes('WHERE m.tenant_id=? AND m.role=\'owner\'')) return [{ uid: 'synthetic-owner', uidHash: hash('synthetic-owner') }];
    if (sql.includes('FROM sx_qr_channel_shares')) return [assignedChannel];
    return [];
  };
  const scope = await resolveInboxScope(lookup, user, 'get_chat_list');
  const sqlFilter=assignedChatSql(scope,'bc');
  assert.match(sqlFilter.sql,/bc\.assigned_agent LIKE \?/);
  assert.match(sqlFilter.sql,/bc\.origin='qr' AND bc\.origin_instance_unique_id IN \(\?\)/);
  assert.deepEqual(sqlFilter.params,['%staff-a%','owner-qr-session']);
  assert.equal(scope.uid, 'synthetic-owner');
  assert.deepEqual(scope.sharedQrInstanceIds, [41]);
  assert.deepEqual(filterAssignedChats([
    { origin: 'qr', origin_instance_unique_id: 'owner-qr-session', assigned_agent: '[]' },
    { origin: 'qr', origin_instance_unique_id: 'another-session', assigned_agent: '[]' },
    { origin: 'meta', origin_instance_unique_id: 'owner-qr-session', assigned_agent: '[]' },
  ], scope).map(chat => chat.origin_instance_unique_id), ['owner-qr-session']);
  assert.deepEqual(require('../modules/platform/team-inbox-scope').filterQrInstances([
    { id: 41, uniqueId: 'owner-qr-session' }, { id: 42, uniqueId: 'private-session' },
  ], scope).map(instance => instance.id), [41]);
});

test('SQL assigned-chat candidate filter is safe for owners and returns no rows for empty staff scope',()=>{
  assert.deepEqual(assignedChatSql({canonical:true,assignedOnly:false}),{sql:'',params:[]});
  assert.deepEqual(assignedChatSql({canonical:true,assignedOnly:true,qrOnly:true,sharedQrInstances:[]}),{sql:' AND 1=0',params:[]});
  assert.throws(()=>assignedChatSql({canonical:true,assignedOnly:true},'bc; DROP TABLE beta_chats'));
});

test('Agent QR access follows an active manager grant and the agent’s current manager assignment',async()=>{
  const agent={...user,isAgent:true,role:'agent',is_active:1,owner_uid:'synthetic-owner'};
  const assignedChannel={instanceId:51,uniqueId:'delegated-qr-session',number:'97450000000',title:'Team QR',status:'ACTIVE'};
  const calls=[];
  const lookup=async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('WHERE o.source_table'))return [{...member,role:'agent'}];
    if(sql.includes("m.role='owner'"))return [{uid:'synthetic-owner',membershipId:'owner-member',identityId:'owner-identity',uidHash:hash('synthetic-owner')}];
    if(sql.includes('FROM sx_qr_channel_shares share'))return [assignedChannel];
    return [];
  };
  const scope=await resolveInboxScope(lookup,agent,'get_chat_list');
  assert.deepEqual(scope.sharedQrInstanceIds,[51]);
  assert.match(calls.find(call=>call.sql.includes('FROM sx_qr_channel_shares share')).sql,/sx_sales_org_history/);
  assert.deepEqual(filterAssignedChats([{origin:'qr',origin_instance_unique_id:'delegated-qr-session',assigned_agent:'[]'},{origin:'qr',origin_instance_unique_id:'private-session',assigned_agent:'[]'}],scope).map(chat=>chat.origin_instance_unique_id),['delegated-qr-session']);
});

test('accountant QR share grants access only to shared QR conversations and replies',async()=>{
  const accountant={...user,uid:'synthetic-accountant'};
  const channel={instanceId:61,uniqueId:'accountant-qr',number:'97450000000',title:'Team QR',status:'ACTIVE'};
  const lookup=async sql=>{
    if(sql.includes('WHERE o.source_table'))return [{...member,uidHash:hash(accountant.uid),role:'accountant',categoryKey:'training_center'}];
    if(sql.includes("m.role='owner'"))return [{uid:'synthetic-owner',membershipId:'owner-member',identityId:'owner-identity',uidHash:hash('synthetic-owner')}];
    if(sql.includes('FROM sx_qr_channel_shares share'))return [channel];
    return [];
  };
  const scope=await resolveInboxScope(lookup,accountant,'get_chat_list');
  assert.equal(scope.qrOnly,true);
  assert.deepEqual(filterAssignedChats([
    {origin:'qr',origin_instance_unique_id:'accountant-qr',assigned_agent:'[]'},
    {origin:'qr',origin_instance_unique_id:'private-qr',assigned_agent:'[]'},
    {origin:'meta',origin_instance_unique_id:'accountant-qr',assigned_agent:'[]'}
  ],scope).length,1);
  const allowed=await authorizeInboxPayload(async()=>[{chat_id:'shared',origin:'qr',origin_instance_unique_id:'accountant-qr'}],scope,'send_chat_message',{chatInfo:{chat_id:'shared'}});
  assert.equal(allowed.chatInfo.origin,'qr');
  await assert.rejects(authorizeInboxPayload(async()=>[],scope,'assign_agent_to_chat',{chatId:'shared'}),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  await assert.rejects(resolveInboxScope(async sql=>sql.includes('WHERE o.source_table')?[{...member,uidHash:hash(accountant.uid),role:'accountant',categoryKey:'training_center'}]:sql.includes("m.role='owner'")?[{uid:'synthetic-owner',identityId:'owner-identity',uidHash:hash('synthetic-owner')}]:[],accountant,'get_chat_list'),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});

test('staff Inbox drops transferred chats and rejects stale direct reads/replies and forged targets', async () => {
  const scope = await resolveInboxScope(query(member), user, 'get_chat_list');
  const current = { chat_id: 'shared-chat', origin: 'qr', sender_mobile: 'synthetic-customer', assigned_agent: JSON.stringify([{kind:'identity',identityId:'staff-a'}]) };
  const transferred = {...current, assigned_agent: JSON.stringify([{kind:'identity',identityId:'staff-b'}])};
  assert.equal(filterAssignedChats([current, transferred], scope).length, 1);
  let stored = current;
  const lookup = async (sql, params) => { assert.deepEqual(params, ['synthetic-owner','shared-chat']); return [stored]; };
  const reply = await authorizeInboxPayload(lookup, scope, 'send_chat_message', {chatInfo:{chat_id:'shared-chat', sender_mobile:'forged-recipient', origin:'meta'}});
  assert.equal(reply.chatInfo.sender_mobile, current.sender_mobile);
  assert.equal(reply.chatInfo.origin, 'qr');
  stored = transferred;
  for (const [event, payload] of [['load_conversation',{chat:{chat_id:'shared-chat'}}],['send_chat_message',{chatInfo:{chat_id:'shared-chat'}}],['export_conversation',{chatId:'shared-chat'}],['assign_agent_to_chat',{chatId:'shared-chat'}]]) {
    await assert.rejects(authorizeInboxPayload(lookup,scope,event,payload),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  }
});

test('canonical agent accounts use the shared owner scope without access to unassigned chats', async () => {
  const scope = await resolveInboxScope(query({...member,role:'agent'}),user,'get_chat_list');
  assert.equal(scope.uid,'synthetic-owner');
  assert.equal(scope.assignedOnly,true);
  assert.deepEqual(filterAssignedChats([{assigned_agent:'[]'}],scope),[]);
  await assert.rejects(authorizeInboxPayload(async()=>[],scope,'send_new_message',{}),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});
test('staff Inbox rejects unknown mutations, inactive identities and restricted roles', async () => {
  for (const event of ['delete_chat','unknown']) await assert.rejects(resolveInboxUid(query(member),user,event), { code: 'TEAM_INBOX_PERMISSION_DENIED' });
  for (const override of [{role:'accountant'}, {membershipStatus:'inactive'}, {uidHash:'wrong'}, {tenantStatus:'suspended'}]) {
    const row={...member,...override};
    const lookup=async sql=>sql.includes('WHERE o.source_table')?[row]:sql.includes('FROM sx_qr_channel_shares share')?[]:[{uid:'synthetic-owner',membershipId:'owner-member',identityId:'owner-identity',uidHash:hash('synthetic-owner')}];
    await assert.rejects(resolveInboxUid(lookup,user,'get_chat_list'), { code: 'TEAM_INBOX_PERMISSION_DENIED' });
  }
});
test('custom role permissions remain authoritative over a manager seat', async () => {
  const custom = {...member, roleProfileId:'synthetic-role', seatRole:'manager', roleStatus:'active', rolePermissions:['conversations.read']};
  assert.equal(await resolveInboxUid(query(custom),user,'load_conversation'),'synthetic-owner');
  await assert.rejects(resolveInboxUid(query(custom),user,'send_chat_message'),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});

test('agent time tracking is bound to the authenticated active agent and verified owner', async () => {
  const agent={id:7,uid:'synthetic-agent',owner_uid:'synthetic-owner',role:'agent',isAgent:true,is_active:1};
  const calls=[];
  const lookup=async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('WHERE o.source_table'))return [{...member,role:'agent',uidHash:hash(agent.uid)}];
    if(sql.includes("m.role='owner'"))return [{uid:'synthetic-owner',identityId:'owner-identity',uidHash:hash('synthetic-owner')}];
    if(sql.includes('FROM sx_qr_channel_shares share'))return [];
    if(sql.includes('FROM agents WHERE uid=? AND owner_uid=? AND is_active=1'))return [{uid:agent.uid}];
    return [];
  };
  const scope=await resolveInboxScope(lookup,agent,'update_spend_time');
  assert.deepEqual(await authorizeInboxPayload(lookup,scope,'update_spend_time',{uid:agent.uid,timeSpent:5,date:'forged'},agent),{
    uid:agent.uid,ownerUid:'synthetic-owner',timeSpent:5,
  });
  assert.ok(calls.some(call=>call.sql.includes('uid=? AND owner_uid=? AND is_active=1')&&call.args[0]===agent.uid&&call.args[1]==='synthetic-owner'));
  await assert.rejects(authorizeInboxPayload(lookup,scope,'update_spend_time',{uid:'foreign-agent',timeSpent:5},agent),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  await assert.rejects(authorizeInboxPayload(lookup,scope,'update_spend_time',{uid:agent.uid,timeSpent:301},agent),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  await assert.rejects(authorizeInboxPayload(lookup,scope,'update_spend_time',{uid:agent.uid,timeSpent:1.5},agent),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  await assert.rejects(authorizeInboxPayload(lookup,scope,'update_spend_time',{uid:agent.uid,timeSpent:5},{...agent,role:'manager',isAgent:false}),{code:'TEAM_INBOX_PERMISSION_DENIED'});

  const unmapped={uid:agent.uid,canonical:false};
  assert.deepEqual(await authorizeInboxPayload(lookup,unmapped,'update_spend_time',{uid:agent.uid,timeSpent:3},agent),{
    uid:agent.uid,ownerUid:'synthetic-owner',timeSpent:3,
  });
  const foreignOwner=async(sql,args)=>sql.includes('FROM agents WHERE uid=? AND owner_uid=? AND is_active=1')?[]:lookup(sql,args);
  await assert.rejects(authorizeInboxPayload(foreignOwner,scope,'update_spend_time',{uid:agent.uid,timeSpent:5},agent),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});

test('contact deletion requires tenant contact-management authority and returns a scoped target', async () => {
  const managerScope={canonical:true,uid:'synthetic-owner',ctx:{membership:{role:'manager'}}};
  assert.deepEqual(await authorizeInboxPayload(async()=>[],managerScope,'del_contact',{contactId:'42'},{role:'manager'}),{
    contactId:42,ownerUid:'synthetic-owner',
  });
  await assert.rejects(authorizeInboxPayload(async()=>[],managerScope,'del_contact',{contactId:42},{role:'agent',isAgent:true}),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  await assert.rejects(authorizeInboxPayload(async()=>[],{canonical:false,uid:'legacy-agent'},'del_contact',{contactId:42},{role:'agent',isAgent:true}),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  await assert.rejects(authorizeInboxPayload(async()=>[],{canonical:false,uid:'legacy-user'},'del_contact',{contactId:'4 OR 1=1'},{role:'user'}),{code:'INVALID_CONTACT_ID'});
  assert.deepEqual(await authorizeInboxPayload(async()=>[],{canonical:false,uid:'legacy-user'},'del_contact',{id:42},{role:'user'}),{
    contactId:42,ownerUid:'legacy-user',
  });
  const custom={...member,roleProfileId:'synthetic-role',seatRole:'manager',roleStatus:'active',rolePermissions:['conversations.read']};
  await assert.rejects(resolveInboxUid(query(custom),user,'del_contact'),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});

test('label deletion and legacy chat-row mutations stay inside the authenticated owner', async () => {
  const staffScope={canonical:true,uid:'synthetic-owner',assignedOnly:true,ctx:{membership:{role:'manager'}}};
  const labelQuery=async(sql,args)=>{
    assert.match(sql,/FROM chat_tags WHERE id=\? AND uid=\?/);
    assert.deepEqual(args,[17,'synthetic-owner']);
    return [{id:17}];
  };
  assert.deepEqual(await authorizeInboxPayload(labelQuery,staffScope,'on_label_delete',{labelId:'17'}),{
    labelId:17,ownerUid:'synthetic-owner',
  });
  await assert.rejects(authorizeInboxPayload(async()=>[],staffScope,'on_label_delete',{labelId:17}),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  await assert.rejects(authorizeInboxPayload(labelQuery,staffScope,'on_label_delete',{labelId:'17 OR 1=1'}),{code:'TEAM_INBOX_PERMISSION_DENIED'});

  const legacyScope={canonical:false,uid:'legacy-owner'};
  const chatQuery=async(sql,args)=>{
    assert.match(sql,/FROM beta_chats WHERE uid=\? AND id=\? LIMIT 1/);
    assert.deepEqual(args,['legacy-owner',91]);
    return [{id:91,uid:'legacy-owner'}];
  };
  await authorizeInboxPayload(chatQuery,legacyScope,'set_chat_label',{chatIdRow:91,labelData:{id:1}});
  await assert.rejects(authorizeInboxPayload(async()=>[],legacyScope,'set_chat_label',{chatIdRow:91,labelData:{id:1}}),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});

test('legacy agents resolve the verified owner and may target only their assigned conversations', async () => {
  const actor={id:44,uid:'legacy-agent',owner_uid:'legacy-owner',role:'agent',isAgent:true,is_active:1};
  const scope={canonical:false,uid:actor.uid};
  const assigned={chat_id:'legacy-chat',assigned_agent:JSON.stringify([{id:44,uid:actor.uid}])};
  const lookup=async(sql,args)=>{
    if(sql.includes('FROM agents WHERE uid=? AND owner_uid=?')){
      assert.deepEqual(args,[actor.uid,actor.owner_uid]);
      return [{uid:actor.uid}];
    }
    if(sql.includes('FROM beta_chats WHERE uid=? AND chat_id=?')){
      assert.deepEqual(args,[actor.owner_uid,'legacy-chat']);
      return [assigned];
    }
    return [];
  };
  const result=await authorizeInboxPayload(lookup,scope,'load_conversation',{chat:{chat_id:'legacy-chat'}},actor);
  assert.equal(result.ownerUid,actor.owner_uid);
  assert.equal(result.chat,assigned);
  const deletion=await authorizeInboxPayload(lookup,scope,'delete_chat',{chatId:'legacy-chat',type:'delete'},actor);
  assert.equal(deletion.ownerUid,actor.owner_uid);
  const selfUnassign=await authorizeInboxPayload(lookup,scope,'assign_agent_to_chat',{chatId:'legacy-chat',agentUid:actor.uid,unAssign:true},actor);
  assert.equal(selfUnassign.ownerUid,actor.owner_uid);
  await assert.rejects(authorizeInboxPayload(lookup,scope,'assign_agent_to_chat',{chatId:'legacy-chat',agentUid:'another-agent',unAssign:true},actor),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  await assert.rejects(authorizeInboxPayload(lookup,scope,'unasign_chat_agent',{cId:'legacy-chat',aUid:'another-agent'},actor),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  await assert.rejects(authorizeInboxPayload(async(sql,args)=>sql.includes('FROM agents WHERE uid=? AND owner_uid=?')?[{uid:actor.uid}]:sql.includes('FROM beta_chats WHERE uid=? AND chat_id=?')?[{chat_id:'legacy-chat',assigned_agent:'[]'}]:[],scope,'load_conversation',{chat:{chat_id:'legacy-chat'}},actor),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  await assert.rejects(authorizeInboxPayload(async()=>[],scope,'load_conversation',{chat:{chat_id:'legacy-chat'}},{...actor,owner_uid:'foreign-owner'}),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});

test('new QR messages require an owner-owned connection and the legacy agent opt-in', async () => {
  const ownerScope={canonical:true,uid:'synthetic-owner',assignedOnly:false};
  const ownInstance={id:8,uid:'synthetic-owner',uniqueId:'owner-session',number:'97450000000',status:'ACTIVE'};
  const ownerQuery=async(sql,args)=>{
    assert.match(sql,/FROM instance WHERE uid=\? AND uniqueId=\?/);
    assert.deepEqual(args,['synthetic-owner','owner-session']);
    return [ownInstance];
  };
  const allowed=await authorizeInboxPayload(ownerQuery,ownerScope,'send_new_message',{instance:{uniqueId:'owner-session',number:'forged-number'}});
  assert.deepEqual(allowed.instance,ownInstance);
  assert.equal(allowed.ownerUid,'synthetic-owner');
  await assert.rejects(authorizeInboxPayload(async()=>[],ownerScope,'send_new_message',{instance:{uniqueId:'foreign-session'}}),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  await assert.rejects(authorizeInboxPayload(ownerQuery,{...ownerScope,assignedOnly:true},'send_new_message',{instance:{uniqueId:'owner-session'}}),{code:'TEAM_INBOX_PERMISSION_DENIED'});

  const actor={id:44,uid:'legacy-agent',owner_uid:'legacy-owner',role:'agent',isAgent:true,is_active:1};
  const agentScope={canonical:false,uid:actor.uid};
  const agentQuery=async(sql,args)=>{
    if(sql.includes('SELECT uid FROM agents WHERE uid=?'))return [{uid:actor.uid}];
    if(sql.includes('SELECT uid,allow_send_new_qr FROM agents WHERE uid=?'))return [{uid:actor.uid,allow_send_new_qr:1}];
    if(sql.includes('FROM instance WHERE uid=? AND uniqueId=?'))return [{...ownInstance,uid:actor.owner_uid}];
    return [];
  };
  const legacy=await authorizeInboxPayload(agentQuery,agentScope,'send_new_message',{instance:{uniqueId:'owner-session'}},actor);
  assert.equal(legacy.ownerUid,actor.owner_uid);
  await assert.rejects(authorizeInboxPayload(async(sql,args)=>sql.includes('SELECT uid FROM agents WHERE uid=?')?[{uid:actor.uid}]:sql.includes('SELECT uid,allow_send_new_qr FROM agents WHERE uid=?')?[{uid:actor.uid,allow_send_new_qr:0}]:[],agentScope,'send_new_message',{instance:{uniqueId:'owner-session'}},actor),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});

test('canonical Inbox events refresh and enforce the active tenant category, plan and module policy', async () => {
  const categories=require('../modules/platform/categories');
  const scope={canonical:true,uid:'synthetic-owner',ctx:{tenant:{id:'tenant-a'},identity:{id:'identity-a'},membership:{id:'member-a',role:'manager'}}};
  const context={audience:'tenant',identity:{id:'identity-a'},tenant:{id:'tenant-a',status:'active',categoryKey:'training_center',categoryVersion:1,disabledModules:[]},membership:{id:'member-a',tenantId:'tenant-a',role:'manager',status:'active'},category:categories.trainingCenter,subscription:{status:'active',capabilities:[...categories.trainingCenter.capabilities]}};
  let refreshes=0;
  const session={ownerUid:'synthetic-owner',refresh:async()=>{refreshes++;return {...session,context};}};
  assert.equal(await authorizeInboxFeature(scope,'del_contact',session).then(value=>value.context),context);
  assert.equal(refreshes,1);
  const disabled={...context,tenant:{...context.tenant,disabledModules:['crm.contacts']}};
  await assert.rejects(authorizeInboxFeature(scope,'del_contact',{...session,refresh:async()=>({...session,context:disabled})}),{code:'MODULE_DISABLED'});
  const removedPlan={...context,subscription:{status:'active',capabilities:['messaging.inbox']}};
  await assert.rejects(authorizeInboxFeature(scope,'del_contact',{...session,refresh:async()=>({...session,context:removedPlan})}),{code:'FEATURE_UNAVAILABLE'});
  await assert.rejects(authorizeInboxFeature({...scope,uid:'other-owner'},'del_contact',session),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  assert.equal(await authorizeInboxFeature({...scope,canonical:false},'del_contact',null),null);
});
