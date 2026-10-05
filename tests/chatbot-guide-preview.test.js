'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDomainPack } = require('../modules/platform/chatbot-domain-packs');
const { previewGuidedTurn } = require('../modules/platform/chatbot-guide-preview');

const sourcePack = getDomainPack('training_center', 1);
const courseFacts = [{ code: 'excel', nameEn: 'Excel Essentials', descriptionEn: 'Practical spreadsheet skills', offer: { priceAmount: '350.00', currency: 'QAR' }, batches: [] }];

test('guided preview uses unsaved bilingual copy and tenant-scoped published facts across turns', async () => {
  const scopes = [];
  const pack = { ...sourcePack, loadFacts: async ({ tenantId }) => { scopes.push(tenantId); return courseFacts; } };
  const body = { message: 'hello', state: null, guidedContent: { messages: { greeting: { en: 'Welcome to the draft preview.' } } } };
  const first = await previewGuidedTurn({ body, pack, db: {}, tenantId: 'tenant-a', platformOrigin: 'https://crm.example' });
  assert.match(first.reply, /Welcome to the draft preview/);
  const list = await previewGuidedTurn({ body: { ...body, message: 'courses', state: first.state }, pack, db: {}, tenantId: 'tenant-a' });
  assert.match(list.reply, /Excel Essentials — 350\.00 QAR/);
  const details = await previewGuidedTurn({ body: { ...body, message: '1', state: list.state }, pack, db: {}, tenantId: 'tenant-a' });
  assert.match(details.reply, /Practical spreadsheet skills/);
  assert.deepEqual(scopes, ['tenant-a', 'tenant-a', 'tenant-a']);
  assert.equal(details.handoff, false);
});

test('guided preview rejects oversized or forged conversation state', async () => {
  await assert.rejects(() => previewGuidedTurn({
    body: { message: '1', state: { courseCodes: Array(31).fill('course') } },
    pack: sourcePack, db: {}, tenantId: 'tenant-a',
  }), error => error.code === 'INVALID_PREVIEW_STATE');
  await assert.rejects(() => previewGuidedTurn({
    body: { message: '   ' }, pack: sourcePack, db: {}, tenantId: 'tenant-a',
  }), error => error.code === 'INVALID_PREVIEW_REQUEST');
});

test('preview state validation is category-neutral for future guided flows', async () => {
  const pack = {
    guidedContentDefaults: { messages: { welcome: { en: 'Welcome', ar: 'مرحباً' } } },
    guidedReply: ({ state }) => ({ reply: `Step: ${state?.step || 'start'}`, state: { step: 'appointment_slot', draftId: 'sample' } }),
  };
  const result = await previewGuidedTurn({ body: { message: 'start', state: { step: 'appointment_slot', draftId: 'sample' } }, pack, db: {}, tenantId: 'tenant-b' });
  assert.equal(result.reply, 'Step: appointment_slot');
  assert.equal(result.state.step, 'appointment_slot');
});
