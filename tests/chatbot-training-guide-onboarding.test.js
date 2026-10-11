'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { trainingCenterGuidedReply } = require('../modules/platform/chatbot-training-guide');
const { getDomainPack } = require('../modules/platform/chatbot-domain-packs');
const { polishGuidedReply } = require('../modules/platform/chatbot-business-context');

const defaults = getDomainPack('training_center', 1).guidedContentDefaults;
const facts = [
  { kind: 'course', code: 'EXCEL', courseId: 'course-1', nameEn: 'Advanced Excel', nameAr: 'إكسل متقدم', descriptionEn: 'Build practical reporting skills.', durationValue: 6, durationUnit: 'weeks', offer: { priceAmount: 950, registrationFeeAmount: 0, currency: 'QAR' } },
  { kind: 'published_enquiry_form', purpose: 'registration', url: 'https://example.invalid/student-registration' },
];

test('first greeting feels welcoming, offers numbered choices and does not ask for a name yet', () => {
  const result = trainingCenterGuidedReply({ message: 'Hi', state: null, facts, config: {}, defaults });
  assert.match(result.reply, /Welcome to Pro Catalyst Training Center/);
  for (const choice of ['[1]', '[2]', '[3]', '[0]']) assert.ok(result.reply.includes(choice));
  assert.doesNotMatch(result.reply, /May I have your name\?/);
  assert.equal(result.state.greeted, true);
});

test('Hybrid greeting polishing preserves the numbered welcome menu', () => {
  const result = trainingCenterGuidedReply({ message: 'Hi', state: null, facts, config: {}, defaults });
  polishGuidedReply({ result, profile: { engine: 'hybrid', config: {} }, message: 'Hi', state: null, defaults });
  assert.ok(result.reply.includes('[1]'));
  assert.ok(result.reply.includes('[3]'));
});

test('a first course question receives the greeting and menu after its answer', () => {
  const result = trainingCenterGuidedReply({ message: 'Advanced Excel', state: null, facts, config: {}, defaults });
  assert.match(result.reply, /Welcome to Pro Catalyst Training Center/);
  assert.match(result.reply, /QAR|950/);
  assert.match(result.reply, /send the application form/i);
  assert.ok(result.reply.includes('[1]'));
});

test('an interested learner receives the published application link only after agreeing', () => {
  const result = trainingCenterGuidedReply({ message: 'yes, send it', state: { greeted: true, step: 'course_detail', selectedCourseCode: 'EXCEL' }, facts, config: {}, defaults });
  assert.match(result.reply, /application form/i);
  assert.match(result.reply, /help with any part/i);
  assert.match(result.reply, /https:\/\/example\.invalid\/student-registration/);
  assert.equal(result.state.step, 'application_shared');
});

test('natural yes please send it wording is treated as registration-form consent', () => {
  const result = trainingCenterGuidedReply({ message: 'Yes, please send it', state: { greeted: true, step: 'course_detail', selectedCourseCode: 'EXCEL' }, facts, config: {}, defaults });
  assert.match(result.reply, /https:\/\/example\.invalid\/student-registration/);
  assert.equal(result.state.step, 'application_shared');
});

test('an enquiry form is not misrepresented as a registration application', () => {
  const enquiryFacts = facts.map(item => item.kind === 'published_enquiry_form' ? { ...item, purpose: 'enquiry' } : item);
  const detail = trainingCenterGuidedReply({ message: 'Advanced Excel', state: null, facts: enquiryFacts, config: {}, defaults });
  assert.doesNotMatch(detail.reply, /send the application form/i);
  const followup = trainingCenterGuidedReply({ message: 'yes please', state: { greeted: true, step: 'course_detail', selectedCourseCode: 'EXCEL' }, facts: enquiryFacts, config: {}, defaults });
  assert.doesNotMatch(followup.reply, /student-registration/);
});
