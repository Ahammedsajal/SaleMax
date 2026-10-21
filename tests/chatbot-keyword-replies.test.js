'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { keywordReply } = require('../modules/platform/chatbot-keyword-replies');
const { botInput, normalizeGuidedContent } = require('../modules/platform/chatbot-config');
const { getDomainPack } = require('../modules/platform/chatbot-domain-packs');
const { previewGuidedTurn } = require('../modules/platform/chatbot-guide-preview');
const pack = getDomainPack('training_center', 1);
const salesPack = getDomainPack('7network_sales', 1);
const rule = (keywords, match = 'contains', enabled = true) => ({ keywords, match, enabled, reply: { en: 'We’re here until 8pm.\nDrop by when it suits you!', ar: 'يسعدنا زيارتك حتى الساعة ٨ مساءً.' } });

test('keyword matching supports ordered any/all/exact rules, phrases and Arabic normalization', () => {
  const rules = [rule(['hours'], 'contains', false), rule(['opening hours']), rule(['hours'])];
  assert.equal(keywordReply('What are your OPENING HOURS?', rules), rules[1].reply.en);
  assert.equal(keywordReply('hoursglass', rules), null);
  assert.equal(keywordReply('opening', [rule(['opening', 'hours'], 'all')]), null);
  assert.equal(keywordReply('hours opening', [rule(['opening', 'hours'], 'all')]), rules[1].reply.en);
  assert.equal(keywordReply('what are opening hours', [rule(['opening hours'], 'exact')]), null);
  assert.equal(keywordReply('Opening hours!', [rule(['opening hours'], 'exact')]), rules[1].reply.en);
  assert.equal(keywordReply('أوقاتُ الدوام؟', [rule(['اوقات الدوام'])], 'ar'), rules[1].reply.ar);
});

test('saved and unsaved keyword replies preserve course state while staff/menu/numeric commands retain priority', async () => {
  const saved = botInput({ name: 'Guide', engine: 'guided', config: { guidedContent: { keywordReplies: [rule(['location']), rule(['agent']), rule(['0']), rule(['1'])] } } }, 'training_center');
  assert.deepEqual(saved.config.guidedContent.keywordReplies[0], rule(['location']));
  const state = { step: 'course_detail', selectedCourseCode: 'EXCEL', courseCodes: ['EXCEL'], greeted: true, language: 'en' };
  const result = pack.guidedReply({ message: 'your location?', state, facts: [], config: saved.config.guidedContent });
  assert.equal(result.reply, rule(['location']).reply.en);
  assert.equal(result.state.selectedCourseCode, 'EXCEL');
  assert.equal(result.media, undefined);
  assert.equal(pack.guidedReply({ message: 'agent', state, facts: [], config: saved.config.guidedContent }).handoff, true);
  assert.equal(pack.guidedReply({ message: '0', state, facts: [], config: saved.config.guidedContent }).state.step, 'menu');
  assert.notEqual(pack.guidedReply({ message: '1', state, facts: [], config: saved.config.guidedContent }).reply, rule(['1']).reply.en);
  const preview = await previewGuidedTurn({ body: { message: 'location', state, guidedContent: saved.config.guidedContent }, pack: { ...pack, requiresDatabase: false } });
  assert.equal(preview.reply, result.reply);
  assert.equal(preview.state.selectedCourseCode, 'EXCEL');
});

test('keyword settings reject incomplete, oversized and malformed rules', () => {
  for (const keywordReplies of [{}, [rule([])], [rule(['x'], 'regex')], [{ ...rule(['x']), reply: {} }], Array(31).fill(rule(['x'])), [rule(['x'.repeat(101)])], [{ ...rule(['x']), enabled: 'yes' }]]) {
    assert.throws(() => normalizeGuidedContent({ keywordReplies }, pack), { code: 'INVALID_KEYWORD_REPLIES' });
  }
});

test('every edited canned message is used without hidden shortening', () => {
  const config = normalizeGuidedContent({ messages: {
    greeting: { en: 'Hello! '.repeat(60).trim() }, menuPrompt: { en: 'MENU CUSTOM' }, admissionsLabel: { en: 'TEAM CUSTOM' },
    courseListPrompt: { en: 'LIST CUSTOM' }, invalidSelection: { en: 'INVALID CUSTOM' }, fallbackMessage: { en: 'FALLBACK CUSTOM' },
    courseDetailsPrompt: { en: 'DETAIL CUSTOM' }, noUpcomingBatches: { en: 'DATES CUSTOM' },
  } }, pack);
  const facts = [{ code: 'C', nameEn: 'Sample course' }];
  const first = pack.guidedReply({ message: 'hello', facts, config });
  assert.ok(first.reply.startsWith(config.messages.greeting.en));
  assert.match(first.reply, /MENU CUSTOM/); assert.match(first.reply, /TEAM CUSTOM/);
  const list = pack.guidedReply({ message: 'courses', facts, state: first.state, config });
  assert.match(list.reply, /LIST CUSTOM/);
  assert.match(pack.guidedReply({ message: '999', state: list.state, facts, config }).reply, /INVALID CUSTOM/);
  const details = pack.guidedReply({ message: '1', state: list.state, facts, config });
  assert.match(details.reply, /DETAIL CUSTOM/); assert.match(details.reply, /DATES CUSTOM/);
  assert.match(pack.guidedReply({ message: 'unrecognized', state: first.state, facts, config }).reply, /FALLBACK CUSTOM/);
});

test('legacy recruitment button settings normalize into the canonical 7Network field',()=>{
  const normalized=normalizeGuidedContent({messages:{buttonSalemax:{en:'About SaleMaX',ar:'عن سليماكس'}}},salesPack);
  assert.deepEqual(normalized.messages.button7Network,{en:'About SaleMaX',ar:'عن سليماكس'});
});
