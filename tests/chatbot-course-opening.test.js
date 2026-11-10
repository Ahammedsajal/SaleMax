'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planOpening } = require('../modules/platform/chatbot-course-opening');
const { retrieveContext } = require('../modules/platform/chatbot-business-context');

const marine = {
  courseId: 'marine-id', code: 'MARINE', nameEn: 'Marine Deckhand', nameAr: 'العمل البحري',
  descriptionEn: 'Learn deck maintenance and rope handling. Old course fee QAR 999.',
  outcomesEn: 'Use safe practices on deck.', prerequisitesEn: 'Basic English.',
  certificateDetailsEn: 'Qatar Chamber-attested certificate is available.',
  certificateDetailsAr: 'تتوفر شهادة مصدقة من غرفة قطر.',
  deliveryMode: 'hybrid', durationValue: 2, durationUnit: 'months', difficultyLevel: 'beginner',
  offer: { currency: 'QAR', priceAmount: '3000.00', registrationFeeAmount: '0.00' },
  batches: [{ startsOn: '2026-12-15' }],
  media: [{ id: 'poster', kind: 'image' }, { id: 'brochure', kind: 'document', mimeType: 'application/pdf' }],
};
const facts = [marine, { code: 'EXCEL', nameEn: 'Advanced Excel', descriptionEn: 'Learn spreadsheets.' },
  { kind: 'business_profile', addressEn: 'Training Centre, Doha' }, { kind: 'published_enquiry_form', purpose: 'registration' }];
const plan = (message, state = {}, config = {}, extra = {}) => planOpening({
  facts, message, state, config, context: retrieveContext({ facts, message, state, ...extra }),
});

test('the first named enquiry gets a brochure and two full fact sections from the current catalogue', () => {
  const answer = plan('Hello! Can I get more info on Certified Marine Deckhand Course?');
  assert.equal(answer.route, 'course-opening');
  assert.deepEqual(answer.media.map(item => [item.id, item.courseId]), [['brochure', 'marine-id']]);
  assert.match(answer.reply, /Marine Deckhand[\s\S]*deck maintenance[\s\S]*safe practices[\s\S]*Basic English[\s\S]*Beginner/);
  assert.doesNotMatch(answer.reply, /999/);
  assert.equal(answer.openingTexts.length, 1);
  assert.match(answer.openingTexts[0], /2 months[\s\S]*Hybrid[\s\S]*QAR 3,000[\s\S]*No registration fee/);
  assert.match(answer.openingTexts[0], /2026-12-15[\s\S]*Qatar Chamber[\s\S]*registration form/);
  assert.deepEqual(answer.state.courseOpeningCodes, ['MARINE']);
  assert.equal(plan('Tell me about Marine Deckhand', answer.state), null);
  assert.match(plan('Tell me about Advanced Excel', answer.state).reply, /Advanced Excel/);
});

test('focused and ambiguous questions use the existing answer paths', () => {
  for (const message of ['How much is Marine Deckhand?', 'When does Marine Deckhand start?', 'Which certificate do I get for Marine Deckhand?',
    'Can I get more info on this?', 'Compare Advanced Excel and Marine Deckhand', 'Tell me the fees for Marine Deckhand']) {
    assert.equal(plan(message), null, message);
  }
});

test('Arabic labels and saved certificate text are used, with a poster fallback', () => {
  const answer = plan('أريد معلومات عن العمل البحري', { sentCoursePdfIds: ['brochure'] });
  assert.equal(answer.media[0].id, 'poster');
  assert.match(answer.reply, /العمل البحري/);
  assert.match(answer.openingTexts[0], /المدة[\s\S]*غرفة قطر/);
  const hidden = plan('Tell me about Marine Deckhand', {}, { guidedContent: { display: { showFees: false, showUpcomingBatches: false } } });
  assert.doesNotMatch(hidden.openingTexts[0], /QAR|2026-12-15/);
});
