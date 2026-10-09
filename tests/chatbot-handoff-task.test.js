'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assignHandoffTask } = require('../modules/platform/chatbot-handoff-task');
const input = { ctx: { tenant: { id: 'synthetic-tenant' }, identity: { id: 'owner' } }, uid: 'synthetic-owner', chatId: 'synthetic-chat', channelKind: 'whatsapp_qr', channelRef: 'synthetic-channel', reason: 'customer-requested-human', profile: { config: { handoffAssigneeIdentityId: 'manager' } } };

test('handover creates an internal task for active staff, preserves owner visibility, and queues no external messages', async () => {
  const writes = [];
  const db = { query: async (sql, args) => { if (sql.includes('FROM sx_memberships')) return [[{ identity_id: 'manager' }]]; if (sql.includes('SELECT id FROM sx_tasks')) return [[]]; writes.push({ sql, args }); return [{ affectedRows: 1 }]; } };
  assert.ok(await assignHandoffTask(db, input));
  const participants = writes.filter(x => x.sql.includes('sx_task_participants'));
  assert.deepEqual(participants.map(x => x.args.slice(2,4)), [['manager', 'assignee'], ['owner', 'observer']]);
  assert.ok(writes.some(x => x.sql.includes("'system'")));
  assert.equal(writes.some(x => /notification|beta_chats/.test(x.sql)), false);
});

test('inactive staff cannot receive a task and repeated handover reuses an open task', async () => {
  assert.equal(await assignHandoffTask({ query: async () => [[]] }, input), null);
  const db = { query: async sql => { if (sql.includes('FROM sx_memberships')) return [[{ identity_id: 'manager' }]]; if (sql.includes('SELECT id FROM sx_tasks')) return [[{ id: 'existing-task' }]]; throw Error('duplicate write'); } };
  assert.equal(await assignHandoffTask(db, input), 'existing-task');
});
