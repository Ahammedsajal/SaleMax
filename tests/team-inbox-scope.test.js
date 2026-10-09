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

test('manager reads and replies through the verified owner Inbox scope', async () => {
  for (const event of ['get_chat_list','load_conversation','send_chat_message']) assert.equal(await resolveInboxUid(query(member), user, event), 'synthetic-owner');
  assert.equal(await resolveInboxUid(async () => [], user, 'get_chat_list'), user.uid);
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
  for (const event of ['delete_chat','del_contact','unknown']) await assert.rejects(resolveInboxUid(query(member),user,event), { code: 'TEAM_INBOX_PERMISSION_DENIED' });
  for (const override of [{role:'accountant'}, {membershipStatus:'inactive'}, {uidHash:'wrong'}, {tenantStatus:'suspended'}]) await assert.rejects(resolveInboxUid(query({...member,...override}),user,'get_chat_list'), { code: 'TEAM_INBOX_PERMISSION_DENIED' });
});
test('custom role permissions remain authoritative over a manager seat', async () => {
  const custom = {...member, roleProfileId:'synthetic-role', seatRole:'manager', roleStatus:'active', rolePermissions:['conversations.read']};
  assert.equal(await resolveInboxUid(query(custom),user,'load_conversation'),'synthetic-owner');
  await assert.rejects(resolveInboxUid(query(custom),user,'send_chat_message'),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});
