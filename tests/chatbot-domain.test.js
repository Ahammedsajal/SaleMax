'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDomainPack } = require('../modules/platform/chatbot-domain-packs');
const { botInput, hybridTurnPlan } = require('../modules/platform/chatbot-config');
const { trainingCenterGuidedReply, shouldStartGuided } = require('../modules/platform/chatbot-training-guide');

const pack = getDomainPack('training_center', 1);
const courseFacts = [
  {
    code: 'EXCEL-101', nameEn: 'Excel Essentials', nameAr: 'أساسيات إكسل',
    descriptionEn: 'Build practical spreadsheet skills.', descriptionAr: 'اكتسب مهارات الجداول العملية.',
    durationValue: 8, durationUnit: 'weeks', deliveryMode: 'classroom',
    offer: { priceAmount: '350.00', registrationFeeAmount: '25.00', currency: 'QAR' },
    batches: [{ startsOn: '2026-11-15', language: 'en', seatsAvailable: 7 }],
  },
  { code: 'IT-102', nameEn: 'IT Support', nameAr: 'دعم تقنية المعلومات', offer: null, batches: [] },
];

 test('training-center pack exposes versioned, editable bilingual guided content', () => {
  assert.equal(pack.key, 'training_center');
  assert.equal(pack.version, 1);
  assert.equal(pack.guidedContentDefaults.messages.greeting.en, 'Welcome! I can help you explore our training courses.');
  assert.equal(pack.guidedContentDefaults.messages.greeting.ar, 'أهلاً بك! يمكنني مساعدتك في استكشاف الدورات التدريبية.');
  assert.ok(pack.guidedContentSchema.groups.some(group => group.id === 'course-list'));
});

test('guided profile accepts edited messages and bounded display settings', () => {
  const saved = botInput({
    name: 'Admissions guide', engine: 'guided', config: {
      guidedContent: {
        messages: { greeting: { en: 'Hello from the center', ar: 'مرحباً من المركز' } },
        display: { maxCourses: 4, showFees: false },
      },
    },
  }, 'training_center', 1);
  assert.equal(saved.config.guidedMode, 'domain_default');
  assert.equal(saved.config.guidedContent.messages.greeting.en, 'Hello from the center');
  assert.equal(saved.config.guidedContent.messages.greeting.ar, 'مرحباً من المركز');
  assert.equal(saved.config.guidedContent.display.maxCourses, 4);
  assert.equal(saved.config.guidedContent.display.showFees, false);
  assert.equal(saved.config.guidedContent.messages.courseListHeading.en, 'Available courses');
});

test('guided-content validation rejects wrong types and overlong text', () => {
  assert.throws(() => botInput({ name: 'Bad type', engine: 'guided', config: {
    guidedContent: { display: { showFees: 'yes' } },
  } }, 'training_center', 1), error => error.code === 'INVALID_GUIDED_CONTENT');
  assert.throws(() => botInput({ name: 'Too long', engine: 'guided', config: {
    guidedContent: { messages: { greeting: { en: 'x'.repeat(601) } } },
  } }, 'training_center', 1), error => error.code === 'INVALID_GUIDED_CONTENT');
});

test('training guide localizes the welcome/menu and conditionally lists the published enquiry form', () => {
  const facts = [...courseFacts, { kind: 'published_enquiry_form', url: 'https://crm.example/forms/enquiry' }];
  const result = trainingCenterGuidedReply({ message: 'السلام عليكم', state: null, facts, defaults: pack.guidedContentDefaults });
  assert.match(result.reply, /أهلاً بك/);
  assert.match(result.reply, /عرض الدورات/);
  assert.match(result.reply, /نموذج الاستفسار/);
  assert.equal(result.state.language, 'ar');
});

test('guided training conversation greets once, keeps menu navigation concise, and uses editable copy', () => {
  const settings = {
    messages: {
      greeting: { en: 'Welcome to Northstar Academy.' },
      coursesLabel: { en: 'Explore programs' },
      menuPrompt: { en: 'Reply 1 for programs or 0 to return.' },
      courseListHeading: { en: 'Programs open for enrolment' },
    },
  };
  const first = trainingCenterGuidedReply({ message: 'hello', state: null, facts: courseFacts, config: settings, defaults: pack.guidedContentDefaults });
  assert.match(first.reply, /^Welcome to Northstar Academy\./);
  assert.match(first.reply, /Explore programs/);
  const mainMenu = trainingCenterGuidedReply({ message: '0', state: first.state, facts: courseFacts, config: settings, defaults: pack.guidedContentDefaults });
  assert.doesNotMatch(mainMenu.reply, /Welcome to Northstar Academy/);
  const list = trainingCenterGuidedReply({ message: '1', state: mainMenu.state, facts: courseFacts, config: settings, defaults: pack.guidedContentDefaults });
  assert.match(list.reply, /Programs open for enrolment/);
  const details = trainingCenterGuidedReply({ message: '1', state: list.state, facts: courseFacts, config: settings, defaults: pack.guidedContentDefaults });
  const repeatedDetails = trainingCenterGuidedReply({ message: 'more', state: details.state, facts: courseFacts, config: settings, defaults: pack.guidedContentDefaults });
  assert.equal((repeatedDetails.reply.match(/Reply 1 to browse courses/g) || []).length, 1);
});

test('the first specific course question includes the editable greeting only once', () => {
  const config = { messages: { greeting: { en: 'Welcome to Northstar Academy.' } } };
  const first = trainingCenterGuidedReply({ message: 'What is the fee for Excel Essentials?', state: null, facts: courseFacts, config, defaults: pack.guidedContentDefaults });
  assert.match(first.reply, /^Welcome to Northstar Academy\.\n\nExcel Essentials/);
  assert.equal(first.state.greeted, true);
  const followUp = trainingCenterGuidedReply({ message: 'tell me more', state: first.state, facts: courseFacts, config, defaults: pack.guidedContentDefaults });
  assert.doesNotMatch(followUp.reply, /^Welcome to Northstar Academy\./);
});

test('course list honors course limits and never invents unpublished fees', () => {
  const settings = { display: { maxCourses: 1, showFees: true, showRegistrationFee: true } };
  const list = trainingCenterGuidedReply({ message: 'courses', state: { step: 'menu' }, facts: courseFacts, config: settings, defaults: pack.guidedContentDefaults });
  assert.match(list.reply, /1\. Excel Essentials — 350\.00 QAR/);
  assert.doesNotMatch(list.reply, /IT Support/);
  const detail = trainingCenterGuidedReply({ message: '1', state: list.state, facts: courseFacts, config: settings, defaults: pack.guidedContentDefaults });
  assert.match(detail.reply, /Registration fee: 25\.00 QAR/);
  assert.match(detail.reply, /2026-11-15/);
  assert.doesNotMatch(detail.reply, /IT Support/);
  assert.doesNotMatch(detail.reply, /not published/i);
});

test('fee and batch visibility settings affect replies without changing catalogue facts', () => {
  const result = trainingCenterGuidedReply({
    message: 'Excel Essentials', state: { step: 'menu' }, facts: courseFacts,
    config: { display: { showFees: false, showRegistrationFee: false, showUpcomingBatches: false } },
    defaults: pack.guidedContentDefaults,
  });
  assert.match(result.reply, /Build practical spreadsheet skills/);
  assert.doesNotMatch(result.reply, /350\.00|Registration fee|Upcoming batches|seats available/i);
});

test('course list navigation, handoff and Arabic digit normalization work', () => {
  assert.equal(shouldStartGuided('أرسل ١'), true);
  const list = trainingCenterGuidedReply({ message: 'courses', state: null, facts: courseFacts, defaults: pack.guidedContentDefaults });
  const detail = trainingCenterGuidedReply({ message: '١', state: list.state, facts: courseFacts, defaults: pack.guidedContentDefaults });
  assert.match(detail.reply, /أساسيات إكسل/);
  const handoff = trainingCenterGuidedReply({ message: 'agent', state: detail.state, facts: courseFacts, defaults: pack.guidedContentDefaults });
  assert.equal(handoff.handoff, true);
  assert.match(handoff.reply, /إيقاف الردود الآلية/);
});

test('hybrid routes menu and course choices deterministically and leaves ordinary questions to AI', () => {
  assert.deepEqual(hybridTurnPlan({ hasSession: false, isChoice: false, aiFallback: true, domainDefault: true, shouldStartGuided: true }), { runGuided: true, allowAiFallback: true });
  assert.deepEqual(hybridTurnPlan({ hasSession: true, isChoice: true, aiFallback: true, domainDefault: true }), { runGuided: true, allowAiFallback: true });
  assert.deepEqual(hybridTurnPlan({ hasSession: true, isChoice: false, aiFallback: true, domainDefault: true }), { runGuided: false, allowAiFallback: true });
  assert.deepEqual(hybridTurnPlan({ hasSession: true, isChoice: false, aiFallback: false, domainDefault: true }), { runGuided: true, allowAiFallback: false });
});
