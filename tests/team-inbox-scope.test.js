'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { resolveInboxUid, resolveInboxScope, filterAssignedChats, authorizeInboxPayload } = require('../modules/platform/team-inbox-scope');
const hash = uid => crypto.createHash('sha256').update(uid).digest('hex');
const user = { id: 2, uid: 'synthetic-manager' };
const member = { tenantId: 'synthetic-tenant', tenantStatus: 'active', identityId: 'staff-a', role: 'manager', membershipStatus: 'active', identityStatus: 'active', uidHash: hash(user.uid), delegatedPermissions: [] };
const query = row => async sql => sql.includes('WHERE o.source_table') ? [row] : [{ uid: 'synthetic-owner', uidHash: hash('synthetic-owner') }];
test('real Agent-seat source uses the agents ownership link and rejects foreign owner bindings',async()=>{
  const agent={...user,isAgent:true,role:'agent',is_active:1,owner_uid:'synthetic-owner'};
  const lookup=async sql=>{if(sql.includes('WHERE o.source_table')){assert.match(sql,/source_table='agents'/);return [{...member,role:'agent'}];}return [{uid:'synthetic-owner',uidHash:hash('synthetic-owner')}];};
  assert.equal((await resolveInboxScope(lookup,agent,'send_chat_message')).assignedOnly,true);
  for(const change of [{owner_uid:'other'},{is_active:0}])await assert.rejects(resolveInboxScope(lookup,{...agent,...change},'get_chat_list'),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});

test('unmapped legacy agents retain only their assigned chats and verified owner scope',async()=>{
  const agent={id:9,uid:'legacy-agent',isAgent:true,role:'agent',is_active:1,owner_uid:'synthetic-owner'};
  const lookup=async(sql,args)=>{
    if(sql.includes('WHERE o.source_table'))return [];
    if(sql.includes('FROM agents'))return [{uid:agent.uid,owner_uid:agent.owner_uid,is_active:1,role:'agent'}];
    if(sql.includes('FROM user'))return [{uid:agent.owner_uid}];
    return [];
  };
  const scope=await resolveInboxScope(lookup,agent,'get_chat_list');
  assert.equal(scope.canonical,false);assert.equal(scope.legacyAgent,true);assert.equal(scope.uid,'synthetic-owner');assert.equal(scope.assignedOnly,true);
  const own={uid:'synthetic-owner',chat_id:'own',sender_mobile:'5550001',assigned_agent:JSON.stringify([{id:9,uid:'legacy-agent'}])};
  const other={uid:'synthetic-owner',chat_id:'other',sender_mobile:'5550002',assigned_agent:JSON.stringify([{id:10,uid:'other-agent'}])};
  assert.deepEqual(filterAssignedChats([own,other],scope),[own]);
  const read=async(sql,args)=>{assert.match(sql,/WHERE uid=\? AND chat_id=\? LIMIT 1/);assert.deepEqual(args,['synthetic-owner','own']);return [own];};
  await assert.rejects(authorizeInboxPayload(async(_sql,args)=>{assert.deepEqual(args,['synthetic-owner','other']);return [other];},scope,'load_conversation',{chat:{chat_id:'other'}}),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  const reply=await authorizeInboxPayload(read,scope,'send_chat_message',{chatInfo:{chat_id:'own',sender_mobile:'forged'}});
  assert.equal(reply.chatInfo.sender_mobile,'5550001');
  for(const event of ['send_new_message','delete_chat','assign_agent_to_chat','add_label','on_label_delete'])await assert.rejects(authorizeInboxPayload(read,scope,event,{}),{code:'TEAM_INBOX_PERMISSION_DENIED'});
  await assert.rejects(resolveInboxScope(async(sql)=>sql.includes('WHERE o.source_table')?[]:sql.includes('FROM agents')?[{uid:agent.uid,owner_uid:'other-owner',is_active:1,role:'agent'}]:[{uid:'other-owner'}],agent,'get_chat_list'),{code:'TEAM_INBOX_PERMISSION_DENIED'});
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
test('only owners and managers can remove an agent from a conversation', async () => {
  const chat = { chat_id: 'shared-chat', assigned_agent: JSON.stringify([{ kind: 'identity', identityId: 'staff-a' }]) };
  const lookup = async () => [chat];
  const managerScope = await resolveInboxScope(query(member), user, 'unasign_chat_agent');
  assert.deepEqual(await authorizeInboxPayload(lookup, managerScope, 'unasign_chat_agent', { cId: 'shared-chat', aUid: 'staff-a' }), { cId: 'shared-chat', aUid: 'staff-a' });
  await assert.rejects(resolveInboxScope(query({ ...member, role: 'agent' }), user, 'unasign_chat_agent'), { code: 'TEAM_INBOX_PERMISSION_DENIED' });
});

test('canonical agent accounts use the shared owner scope without access to unassigned chats', async () => {
  const scope = await resolveInboxScope(query({...member,role:'agent'}),user,'get_chat_list');
  assert.equal(scope.uid,'synthetic-owner');
  assert.equal(scope.assignedOnly,true);
  assert.deepEqual(filterAssignedChats([{assigned_agent:'[]'}],scope),[]);
  await assert.rejects(authorizeInboxPayload(async()=>[],scope,'send_new_message',{}),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});
test('an added agent can see a shared chat while the original agent keeps access', async () => {
  const agent = { id: 9, uid: 'agent-uid', isAgent: true, role: 'agent', is_active: 1, owner_uid: 'synthetic-owner' };
  const lookup = async sql => sql.includes('WHERE o.source_table')
    ? [{ ...member, role: 'agent', uidHash: hash(agent.uid) }]
    : [{ uid: 'synthetic-owner', identityId: 'owner-identity', uidHash: hash('synthetic-owner') }];
  const scope = await resolveInboxScope(lookup, agent, 'get_chat_list');
  const shared = { assigned_agent: JSON.stringify([{ kind:'identity', identityId:'first-agent', uid:'first-uid', id:7 }, { kind:'identity', identityId:'added-agent', uid:'agent-uid', id:9 }]) };
  assert.equal(filterAssignedChats([shared], scope).length, 1);
  const other = { ...agent, id:10, uid:'other-agent' };
  const otherScope = await resolveInboxScope(async sql => sql.includes('WHERE o.source_table')
    ? [{ ...member, role: 'agent', uidHash: hash(other.uid) }]
    : [{ uid: 'synthetic-owner', identityId: 'owner-identity', uidHash: hash('synthetic-owner') }], other, 'get_chat_list');
  assert.equal(filterAssignedChats([shared], otherScope).length, 0);
});
test('staff Inbox rejects unknown mutations, inactive identities and restricted roles', async () => {
  for (const event of ['delete_chat','del_contact','unknown']) await assert.rejects(resolveInboxUid(query(member),user,event), { code: 'TEAM_INBOX_PERMISSION_DENIED' });
  for (const override of [{role:'accountant'}, {membershipStatus:'inactive'}, {uidHash:'wrong'}, {tenantStatus:'suspended'}]) await assert.rejects(resolveInboxUid(query({...member,...override}),user,'get_chat_list'), { code: 'TEAM_INBOX_PERMISSION_DENIED' });
});
test('custom role permissions remain authoritative over a manager seat', async () => {
  const custom = {...member, roleProfileId:'synthetic-role', seatRole:'manager', roleStatus:'active', rolePermissions:['conversations.read']};
  assert.equal(await resolveInboxUid(query(custom),user,'load_conversation'),'synthetic-owner');
  await assert.rejects(resolveInboxUid(query(custom),user,'send_chat_message'),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});
