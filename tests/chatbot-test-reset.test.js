'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isTestReset, resetTestConversation } = require('../modules/platform/chatbot-test-reset');
const { botInput } = require('../modules/platform/chatbot-config');
const config = { testRecipientPhone: '97450000001', allowedRecipientPhones: ['97450000001'] };
test('only the configured and permitted tester can restart a handover', () => {
  for (const text of ['reset bot', ' RESTART BOT ', 'إعادة ضبط الروبوت']) assert.equal(isTestReset(config, '+97450000001', text), true);
  for (const sender of ['97450000002', '97450000001@lid', undefined]) assert.equal(isTestReset(config, sender, 'reset bot'), false);
  assert.equal(isTestReset({ ...config, allowedRecipientPhones: [] }, '97450000001', 'reset bot'), false);
  assert.equal(isTestReset({}, '97450000001', 'reset bot'), false);
  assert.equal(isTestReset(config, '97450000001', 'please reset bot'), false);
});
test('test number validation preserves restrictions and permits disabling', () => {
  const input = { name: 'Test guide', engine: 'guided', config: { ...config, testRecipientPhone: '+97450000001' } };
  assert.equal(botInput(input, 'training_center').config.testRecipientPhone, config.testRecipientPhone);
  for (const phone of ['97450000002', '500', '97450000001@lid']) assert.throws(() => botInput({ ...input, config: { ...config, testRecipientPhone: phone } }, 'training_center'), { code: 'INVALID_TEST_PHONE' });
  assert.equal(botInput({ ...input, config: { ...config, testRecipientPhone: '' } }, 'training_center').config.testRecipientPhone, undefined);
});
test('several configured testers can reset while other allowed customers cannot',()=>{
 const restricted={allowedRecipientPhones:['97450000001','97450000002','97450000003'],testRecipientPhones:['97450000001','97450000002']};
 for(const phone of restricted.testRecipientPhones)assert.equal(isTestReset(restricted,phone,'reset bot'),true);
 assert.equal(isTestReset(restricted,'97450000003','reset bot'),false);
 assert.deepEqual(botInput({name:'Guide',engine:'guided',config:restricted},'training_center').config.testRecipientPhones,restricted.testRecipientPhones);
 assert.throws(()=>botInput({name:'Guide',engine:'guided',config:{...restricted,testRecipientPhones:['97450000004']}},'training_center'),{code:'INVALID_TEST_PHONE'});
});
test('reset clears only scoped bot state, resumes control, and retains message history', async () => {
  const calls = [];
  const profile = { id: 'p', revision: 2, channelKind: 'whatsapp_qr', channelRef: 'channel', engine: 'ai', config };
  const db = { beginTransaction: async () => {}, commit: async () => calls.push(['commit']), rollback: async () => calls.push(['rollback']), query: async (sql, params) => { calls.push([sql, params]); if (sql.startsWith('SELECT revision')) return [[{ revision: 2, status: 'live', config }]]; return [[]]; } };
  await resetTestConversation(db, { ctx: { tenant: { id: 'tenant' } }, profile, uid: 'owner', chatId: 'chat', sender: config.testRecipientPhone, turnId: 'turn' });
  assert.deepEqual(calls.find(c => c[0].startsWith('DELETE'))[1], ['tenant', 'p', 'whatsapp_qr', 'channel', 'chat']);
  assert.ok(calls.some(c => c[0].includes("mode='inherit'")));
  assert.equal(calls.some(c => /DELETE FROM (beta_|sx_tasks|sx_chatbot_turns)/.test(c[0])), false);
  assert.equal(calls.at(-1)[0], 'commit');
});
test('an in-flight answer blocks reset without deleting state or resuming handover', async () => {
  const calls = [];
  const db = { beginTransaction: async () => {}, rollback: async () => calls.push('rollback'), query: async sql => { calls.push(sql); return sql.startsWith('SELECT revision') ? [[{ status: 'live', revision: 2, config }]] : [[{ id: 'pending' }]]; } };
  await assert.rejects(resetTestConversation(db, { ctx: { tenant: { id: 't' } }, profile: { id: 'p', revision: 2 }, sender: config.testRecipientPhone }), { code: 'TEST_RESET_BUSY' });
  assert.equal(calls.some(sql => sql.startsWith('DELETE') || sql.startsWith('INSERT')), false);
  assert.equal(calls.at(-1), 'rollback');
});
