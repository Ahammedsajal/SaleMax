'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const adapter = require('../modules/platform/legacy-agent-task-adapter');

test('agent task adapter returns assigned shared tasks alongside legacy tasks', async () => {
  const calls = [];
  const shared = {
    id: '517ab2bf-d667-42b2-9ffc-6e2a8ec454aa',
    title: 'Follow up', description: 'Call the customer', status: 'open', priority: 'urgent',
    due_at: '2026-10-15 09:00:00', completed_at: null, assigned_by_name: 'Owner',
  };
  const legacy = { id: 12, title: 'Legacy task', status: 'PENDING' };
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return sql.includes('FROM sx_tasks') ? [shared] : [legacy];
  };

  const tasks = await adapter.listAgentTasks(query, { ownerUid: 'owner-uid', agentUid: 'agent-uid', agentId: 5 });

  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks[0], {
    id: `sx:${shared.id}`, title: 'Follow up', description: 'Call the customer', status: 'PENDING',
    priority: 'high', due_date: shared.due_at, completion_percentage: 0, agent_comments: '',
    completed_at: null, assigned_by: { name: 'Owner' },
  });
  assert.equal(tasks[1], legacy);
  assert.deepEqual(calls.map(call => call.params), [
    ['agent-uid'],
    ['5', crypto.createHash('sha256').update('owner-uid', 'utf8').digest('hex')],
  ]);
  assert.match(calls[1].sql, /p\.actor_type='agent'/);
  assert.match(calls[1].sql, /p\.removed_at IS NULL/);
  assert.match(calls[1].sql, /t\.deleted_at IS NULL/);
});

test('agent task adapter maps shared status, priority, completion time, and due state', () => {
  const task = adapter.asLegacyAgentTask({
    id: '11111111-1111-4111-8111-111111111111', title: 'Review', status: 'completed',
    priority: 'normal', due_at: null, completed_at: '2026-10-14 06:00:00', assigned_by_name: null,
  });
  assert.equal(task.status, 'COMPLETED');
  assert.equal(task.priority, 'medium');
  assert.equal(task.completion_percentage, 100);
  assert.equal(task.completed_at, Math.floor(new Date('2026-10-14 06:00:00').getTime() / 1000));
  assert.equal(task.due_date, null);
  assert.equal(task.assigned_by, null);
});
