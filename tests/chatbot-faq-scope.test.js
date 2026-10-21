'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const scope = require('../modules/platform/chatbot-faq-scope');
const { mergeKnowledgeEntries, findApprovedFaq } = require('../modules/platform/chatbot-faq');

const profile = '3ad17b18-b7fd-4ebc-9af5-87e737e79583';
const other = '99c19f4d-7c15-4ec1-9c80-e2a70f9c3981';
const context = { tenant: { id: 'tenant-a' }, category: { key: 'sales', version: 1 } };

test('FAQ profile scope accepts only canonical UUIDs and treats an omitted profile as shared', () => {
  assert.equal(scope.profileId(undefined), null);
  assert.equal(scope.profileId(''), null);
  assert.equal(scope.profileId(profile), profile);
  assert.throws(() => scope.profileId('../other-tenant'), { code: 'INVALID_FAQ_SCOPE' });
});

test('profile selection is checked against tenant and pinned category version', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return [[{ id: profile }]]; } };
  assert.equal(await scope.assertProfileScope(db, context, profile), profile);
  assert.deepEqual(calls[0].params, ['tenant-a', profile, 'sales', 1]);
  assert.match(calls[0].sql, /tenant_id=\? AND id=\? AND category_key=\? AND category_version=\?/);

  const missing = { query: async () => [[]] };
  await assert.rejects(scope.assertProfileScope(missing, context, other), { code: 'BOT_NOT_FOUND' });
});

test('FAQ editor and bot runtime queries preserve tenant scope and bot-first fallback ordering', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return [[], []]; } };
  await scope.listForEditor(db, 'tenant-a', profile);
  assert.deepEqual(calls[0].params, ['tenant-a', profile]);
  assert.match(calls[0].sql, /tenant_id=\? AND profile_id <=> \?/);
  await scope.loadForBot(db, 'tenant-a', profile);
  assert.deepEqual(calls[1].params, ['tenant-a', profile, profile]);
  assert.match(calls[1].sql, /profile_id IS NULL OR profile_id=\?/);
  assert.match(calls[1].sql, /ORDER BY CASE WHEN profile_id=\? THEN 0 ELSE 1 END/);
  await scope.loadForBot(db, 'tenant-a', null);
  assert.deepEqual(calls[2].params, ['tenant-a', null, null]);
});

test('bot-specific FAQ answers override shared matches while retaining missing-language fallbacks', () => {
  const merged = mergeKnowledgeEntries(
    [{ questionEn:'What are your evening classes?',answerEn:'Bot-specific schedule.' }],
    [{ questionEn:'What are your evening classes?',answerEn:'Shared schedule.',questionAr:'ما هي حصص المساء المتاحة؟',answerAr:'المواعيد المشتركة.' }],
  );
  assert.equal(merged.length, 2, 'duplicate English question is removed while the shared Arabic answer remains available');
  const english = findApprovedFaq('tell me about evening classes', merged, 'en');
  const arabic = findApprovedFaq('ما هي حصص المساء المتاحة', merged, 'ar');
  assert.equal(english.answer, 'Bot-specific schedule.'); assert.equal(english.index, 0);
  assert.equal(arabic.answer, 'المواعيد المشتركة.'); assert.equal(arabic.index, 1);
});
