'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { recipientAllowed, normalizeAudience } = require('../modules/platform/chatbot-audience');
const { botInput } = require('../modules/platform/chatbot-config');
const { getDomainPack } = require('../modules/platform/chatbot-domain-packs');

test('restricted bot admits only an exact international phone and fails closed for unknown identities', () => {
  const config = { allowedRecipientPhones: ['97450000001'] };
  for (const phone of ['97450000001', '+97450000001', '97450000001@s.whatsapp.net']) assert.equal(recipientAllowed(config, phone), true);
  for (const phone of ['97450000002', '50000001', '97450000001@lid', '97450000001@g.us', undefined, 'prefix97450000001', '97450000001:2@s.whatsapp.net']) assert.equal(recipientAllowed(config, phone), false);
  for (const list of [null, 'all', [], {}]) assert.equal(recipientAllowed({ allowedRecipientPhones: list }, '97450000001'), false);
  assert.equal(recipientAllowed({}, '97450000002'), true);
});

test('editing a guided profile preserves its explicit audience and rejects invalid lists', () => {
  const input = { name: 'Synthetic restricted guide', engine: 'guided', config: { allowedRecipientPhones: ['+97450000001', '97450000001'] } };
  assert.deepEqual(botInput(input, 'training_center').config.allowedRecipientPhones, ['97450000001']);
  assert.deepEqual(normalizeAudience([]), []);
  for (const list of ['all', ['500'], [1], ['97450000001@lid']]) assert.throws(() => normalizeAudience(list), { code: 'INVALID_BOT_AUDIENCE' });
});

test('admissions handover option does not steal third course selection and language can switch', () => {
  const pack = getDomainPack('training_center', 1);
  const run = (message, state, facts = []) => pack.guidedReply({ message, state, facts });
  assert.equal(run('3', { step: 'menu', greeted: true }).handoff, true);
  assert.equal(run('Can I talk to someone?', { step: 'menu' }).handoff, true);
  const facts = [1,2,3].map(n => ({ code: 'SYN-' + n, nameEn: 'Synthetic ' + n, offer: { currency: 'QAR', priceAmount: '10' }, batches: [] }));
  const listing = run('courses', null, facts);
  assert.equal(run('3', listing.state, facts).state.selectedCourseCode, 'SYN-3');
  assert.equal(run('English', { step: 'menu', language: 'ar', greeted: true }).state.language, 'en');
  assert.equal(run('العربية', { step: 'menu', language: 'en', greeted: true }).state.language, 'ar');
  assert.doesNotMatch(run('hello', { step: 'menu', greeted: true }).reply, /Welcome!/);
});
