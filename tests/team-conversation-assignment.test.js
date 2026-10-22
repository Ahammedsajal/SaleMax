'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { assignConversation, unassignConversation, ownsConversation, chooseAvailableStaff } = require('../modules/platform/team-conversation-assignment');
const hash = uid => crypto.createHash('sha256').update(uid).digest('hex');
const ctx = { tenant: { id: 'tenant-a' }, identity: { id: 'actor' }, membership: { role: 'manager' } };
function fixture(overrides = {}) {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if(sql.includes("WHERE o.source_table='user'")&&sql.includes('JOIN sx_tenants t'))return [[{tenantId:'tenant-a'}]];
    if(sql.includes('FROM sx_legacy_ownership o JOIN sx_memberships'))return [[{uidHash:hash('new-user'),identityId:'new-staff'}]];
    if(sql.startsWith('DELETE FROM sx_conversation_assignments')||sql.startsWith('INSERT INTO sx_conversation_assignments'))return [{affectedRows:1}];
    if (sql.includes("m.role='owner'")) return [[{ uid: 'owner', uidHash: hash('owner') }]];
    if (sql.includes('FOR UPDATE')) return [[{ assigned_agent: JSON.stringify([{ kind: 'identity', identityId: 'old-staff', uid: 'old-user' }]) }]];
    if (sql.includes('i.id=?')) {
      assert.deepEqual(params, ['owner','tenant-a', 'new-staff']);
      return [[{ identityId: 'new-staff', uid: 'new-user', name: 'Staff', role: 'agent', uidHash: hash('new-user'), ...overrides }]];
    }
    return [{ affectedRows: 1 }];
  } };
  return { db, calls };
}
const input = { ctx, uid: 'owner', chatId: 'same-number_same-contact_owner', identityId: 'new-staff' };

test('transfer replaces the old staff assignment and preserves the shared owner and channel', async () => {
  const { db, calls } = fixture();
  const result = await assignConversation(db, input);
  const update = calls.find(call => call.sql.startsWith('UPDATE'));
  assert.equal(JSON.parse(update.params[0]).length, 1);
  assert.equal(ownsConversation(update.params[0], 'new-staff'), true);
  assert.equal(ownsConversation(update.params[0], 'old-staff'), false);
  assert.deepEqual(update.params.slice(1), ['owner', input.chatId]);
  assert.equal(result.previous[0].identityId, 'old-staff');
  assert.equal(calls.filter(call => call.sql.includes('sx_audit_events')).length, 1);
});

test('unassign requires lead-assignment authority, preserves other identities and records an audit event', async () => {
  const calls=[];
  const assigned=JSON.stringify([
    {kind:'identity',identityId:'staff-a',uid:'agent-a'},
    {kind:'identity',identityId:'staff-b',uid:'agent-b'},
  ]);
  const db={query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes("WHERE o.source_table='user'")&&sql.includes('JOIN sx_tenants t'))return [[{tenantId:'tenant-a'}]];
    if(sql.includes('FROM sx_legacy_ownership o JOIN sx_memberships'))return [[{uidHash:hash('agent-b'),identityId:'staff-b'}]];
    if(sql.startsWith('DELETE FROM sx_conversation_assignments')||sql.startsWith('INSERT INTO sx_conversation_assignments'))return [{affectedRows:1}];
    if(sql.includes("m.role='owner'"))return [[{uid:'owner',uidHash:hash('owner')}]];
    if(sql.includes('FOR UPDATE'))return [[{assigned_agent:assigned,origin:'meta',sender_name:'Synthetic',sender_mobile:'+97450000000'}]];
    return [{affectedRows:1}];
  }};
  await unassignConversation(db,{ctx,uid:'owner',chatId:'synthetic-chat',assigneeUid:'agent-a'});
  const update=calls.find(call=>call.sql.startsWith('UPDATE beta_chats'));
  assert.deepEqual(JSON.parse(update.args[0]),[{kind:'identity',identityId:'staff-b',uid:'agent-b'}]);
  assert.deepEqual(update.args.slice(1),['owner','synthetic-chat']);
  const audit=calls.find(call=>call.sql.includes('sx_audit_events'));
  assert.match(audit.sql,/conversation\.unassigned/);
  assert.equal(JSON.parse(audit.args[4]).removedIdentityId,'staff-a');

  const agent={...ctx,identity:{id:'staff-a'},membership:{role:'agent'}};
  await assert.rejects(unassignConversation(db,{ctx:agent,uid:'owner',chatId:'synthetic-chat',assigneeUid:'agent-a'}),{code:'CONVERSATION_TRANSFER_DENIED'});
});

test('incoming routing chooses the online staff with least assigned work, then falls back to the manager', () => {
  const staff = [{identityId:'a',uid:'user-a',role:'agent'},{identityId:'b',uid:'user-b',role:'agent'},{identityId:'m',uid:'manager',role:'manager'},{identityId:'o',uid:'owner',role:'owner'}];
  const chats = [{assigned_agent:JSON.stringify([{kind:'identity',identityId:'a'}])}];
  assert.equal(chooseAvailableStaff(staff,['owner','user-a','user-b'],chats,'m').identityId,'b');
  assert.equal(chooseAvailableStaff(staff,['user-a'],chats,'m').identityId,'a');
  assert.equal(chooseAvailableStaff(staff,[],chats,'m').identityId,'m');
  assert.equal(chooseAvailableStaff(staff,[],chats,'missing'),null);
});

test('incoming routing uses normalized indexed workload counts when available', () => {
  const staff=[
    {identityId:'busy',uid:'busy-uid',role:'agent'},
    {identityId:'free',uid:'free-uid',role:'agent'},
  ];
  const result=chooseAvailableStaff(staff,['busy-uid','free-uid'],[],null,{busy:4,free:1});
  assert.equal(result.identityId,'free');
});

test('agents can transfer only a conversation currently assigned to them', async () => {
  const denied = fixture();
  await assert.rejects(assignConversation(denied.db, { ...input, ctx: { ...ctx, membership: { role: 'agent' } } }), { code: 'CONVERSATION_TRANSFER_DENIED' });
  assert.equal(denied.calls.some(call => call.sql.startsWith('UPDATE')), false);
  const allowed = fixture();
  await assignConversation(allowed.db, { ...input, ctx: { ...ctx, identity: { id: 'old-staff' }, membership: { role: 'agent' } } });
});

test('non-messaging roles, forged ownership and restricted custom assignees cannot receive chats', async () => {
  for (const override of [{ role: 'accountant' }, { uidHash: 'forged' }, { roleProfileId: 'role', seatRole: 'agent', roleStatus: 'active', rolePermissions: ['conversations.read'] }]) {
    const { db, calls } = fixture(override);
    await assert.rejects(assignConversation(db, input), { code: 'CONVERSATION_ASSIGNEE_INVALID' });
    assert.equal(calls.some(call => call.sql.startsWith('UPDATE')), false);
  }
});
