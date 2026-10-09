'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { assignConversation, ownsConversation } = require('../modules/platform/team-conversation-assignment');
const hash = uid => crypto.createHash('sha256').update(uid).digest('hex');
const ctx = { tenant: { id: 'tenant-a' }, identity: { id: 'actor' }, membership: { role: 'manager' } };
function fixture(overrides = {}) {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("m.role='owner'")) return [[{ uid: 'owner', uidHash: hash('owner') }]];
    if (sql.includes('FOR UPDATE')) return [[{ assigned_agent: JSON.stringify([{ kind: 'identity', identityId: 'old-staff', uid: 'old-user' }]) }]];
    if (sql.includes('i.id=?')) {
      assert.deepEqual(params, ['tenant-a', 'new-staff']);
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
