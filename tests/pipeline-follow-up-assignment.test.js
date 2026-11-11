'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const assignment = require('../modules/platform/pipeline-follow-up-assignment');

test('balances unassigned actionable leads over the existing open follow-up load', () => {
  const agents = [5, 19, 20, 21, 22].map(id => ({ id, name: `Agent ${id}` }));
  const items = Array.from({ length: 78 }, (_, index) => ({ leadId: `lead-${index}`, ownerAgentId: null,
    priority: index % 3 ? 'warm' : 'high', daysWaiting: index % 2 ? 4 : 1, hoursWaiting: 100 - index }));
  items.push({ leadId: 'already-owned', ownerAgentId: 22, priority: 'high', daysWaiting: 5 });
  items.push({ leadId: 'review-only', ownerAgentId: null, priority: 'review', daysWaiting: 5 });
  const result = assignment.agentQueue({ items }, agents);
  assert.equal(result.length, 78);
  assert.equal(result.some(item => item.leadId === 'already-owned' || item.leadId === 'review-only'), false);
  const finalLoad = new Map(agents.map(agent => [agent.id, 0]));
  finalLoad.set(22, 1);
  for (const item of result) finalLoad.set(item.agentId, finalLoad.get(item.agentId) + 1);
  assert.deepEqual([...finalLoad.values()], [16, 16, 16, 16, 15]);
});

test('groups manager and agent roles by normalized phone for one combined digest', () => {
  const result = assignment.recipientsByPhone(
    [{ id: 22, name: 'Azhar Mahmood', phone: '+974 5516 0323' }, { id: 19, name: 'Safa', phone: null }],
    [{ role: 'manager', source_table: 'agents', source_id: '22', phone: '97455160323' },
      { role: 'owner', source_table: 'user', source_id: '7', phone: '+974 5000 0000' }],
  );
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups[0].roles.sort(), ['agent', 'manager']);
  assert.equal(result.groups[0].agentId, 22);
  assert.equal(result.noPhoneAgents, 1);
  assert.equal(JSON.stringify(result).includes('97455160323'), false);
});

test('creates concise agent and owner digests with aggregate counts only', () => {
  const agents = [{ id: 5, name: 'Agent 1' }, { id: 22, name: 'Azhar Mahmood' }];
  const items = [
    { agent_id: 5, priority: 'high', days_waiting: 4, status: 'assigned' },
    { agent_id: 5, priority: 'warm', days_waiting: 1, status: 'assigned' },
    { agent_id: 22, priority: 'warm', days_waiting: 5, status: 'assigned' },
    { agent_id: 22, priority: 'high', days_waiting: 2, status: 'skipped' },
  ];
  const result = assignment.makeDigests({ date: '2026-11-11', agents, runItems: items,
    brief: { summary: { needsReview: 28 } }, noPhoneAgents: 0, identifiedCount: 4, existingAssigned: 1 });
  assert.match(result.agentMessages.get(5), /2 new leads assigned to you: 1 high intent, 1 course interest; 1 have waited 72h\+/);
  assert.match(result.ownerText, /4 actionable leads identified · 3 assigned today · 1 already assigned and left unchanged/);
  assert.match(result.ownerText, /28 no-signal chats excluded/);
  assert.equal(result.ownerText.includes('lead-'), false);
  assert.equal(result.agentMessages.get(5).includes('customer'), false);
});

test('schedules delivery using Asia/Qatar wall time and advances to tomorrow after the send time', () => {
  const before = assignment.nextScheduledAt(new Date('2026-11-11T01:00:00.000Z'), '09:00', 'Asia/Qatar');
  assert.equal(before.toISOString(), '2026-11-11T06:00:00.000Z');
  const after = assignment.nextScheduledAt(new Date('2026-11-11T07:00:00.000Z'), '09:00', 'Asia/Qatar');
  assert.equal(after.toISOString(), '2026-11-12T06:00:00.000Z');
});

test('follows the saved daily report time and defaults to 09:00 Qatar when none exists', async () => {
  const saved = await assignment._private.deliverySchedule({ query: async () => [[{ timezone: 'Asia/Qatar', local_time: '08:30' }]] }, 'tenant');
  assert.deepEqual(saved, { timezone: 'Asia/Qatar', sendTime: '08:30', scheduleSource: 'daily_report' });
  const fallback = await assignment._private.deliverySchedule({ query: async () => [[]] }, 'tenant');
  assert.deepEqual(fallback, { timezone: 'Asia/Qatar', sendTime: '09:00', scheduleSource: 'default' });
});

test('normalizes valid WhatsApp numbers without persisting them in digest groups', () => {
  assert.equal(assignment.normalizePhone('(974) 5516-0323'), '97455160323');
  assert.equal(assignment.normalizePhone('not-a-number'), null);
});

test('uses the internal app service as the worker QR endpoint and rejects nonlocal origins', () => {
  const internal = assignment._private.qrInternalUrl({ CRM_INTERNAL_SECRET: 'test-secret', PORT: '3010' });
  assert.equal(internal.url, 'http://app:3010/api/internal/qr/send-text');
  assert.equal(assignment._private.qrInternalUrl({ CRM_INTERNAL_SECRET: 'test-secret', SALEMAX_TASK_QR_INTERNAL_ORIGIN: 'https://external.example' }), null);
});
