'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startPreference, courseInterest, savedStartLabel, advance, planReply, acknowledgement } = require('../modules/platform/chatbot-admissions-intake');

test('stores a stated start preference but does not treat course schedule questions as preferences', () => {
  assert.deepEqual(startPreference('I would like to start next week.'), { window: 'within_month', detail: 'next week', only: true });
  assert.deepEqual(startPreference('أريد أن أبدأ في ديسمبر'), { window: null, detail: 'في ديسمبر', only: true });
  assert.deepEqual(startPreference('2027-01-05', true), { window: null, detail: '2027-01-05', only: true });
  assert.equal(startPreference('When does the course start?', true), null);
  assert.equal(startPreference('next week'), null);
  assert.equal(startPreference('I can start next week with my phone 97455555555'), null);
  assert.equal(startPreference('I am interested in Excel. I can start next week').only, false);
  assert.equal(savedStartLabel({ preferredStartWindow: 'within_month' }, 'ar'), 'خلال شهر');
  assert.equal(courseInterest('I want to know about marine course'), 'marine course');
  assert.equal(courseInterest('Tell me about your business'), null);
});

test('confirms saved details one at a time and requests replacements when declined', () => {
  const input = { savedName: 'Nora', savedStart: 'next week', language: 'en' };
  const initial = advance({ ...input, prior: {}, text: 'Tell me about marine course' });
  assert.equal(initial.prompt, 'I have your name as Nora—could you please confirm I’ve got it right?');
  const accepted = advance({ ...input, prior: { ...initial.state, waiting: initial.key }, text: 'Yes' });
  assert.equal(accepted.state.nameConfirmed, true);
  assert.equal(accepted.answerOnly, true);
  assert.equal(accepted.prompt, 'You mentioned next week as your preferred start—would you like me to keep that noted?');
  const declined = advance({ ...input, prior: { ...accepted.state, waiting: accepted.key }, text: 'No' });
  assert.equal(declined.key, 'start');
  const corrected = advance({ ...input, prior: { ...declined.state, waiting: declined.key }, text: 'Flexible' });
  assert.equal(corrected.start.window, 'flexible');
  assert.equal(corrected.key, undefined);
  assert.equal(corrected.state.startConfirmed, true);
});

test('mockup recognizes an immediate start before it has asked for a start date', () => {
  for (const [text, language] of [['Immediately', 'en'], ['فورًا', 'ar']]) {
    const result = advance({ prior: { waiting: 'confirmName' }, text, name: text, nameOnly: true,
      savedName: 'Nora', language, recognizeImmediate: true });
    assert.equal(result.start.window, 'asap');
    assert.equal(result.answerOnly, true);
    assert.equal(result.state.startConfirmed, true);
    assert.equal(result.state.nameConfirmed, undefined);
    assert.equal(result.key, 'confirmName');
  }
});

test('provider timeout continues short intake, then hands over after saved answers', () => {
  const original = { handedOff: true, code: 'AI_PROVIDER_TIMEOUT' };
  const info = { courseInterest: 'marine course', language: 'en', intake: { session: {}, key: 'name' } };
  const planned = planReply(original, info);
  assert.equal(planned.handedOff, undefined);
  assert.equal(planned.route, 'admissions-intake');
  assert.equal(planned.state.admissionsEscalation.reason, 'AI_PROVIDER_TIMEOUT');
  assert.deepEqual(planReply({ canAnswer: true, reply: 'Thanks' }, { ...info, intake: { session: planned.state } }), original);
  const explicit = { handedOff: true, code: 'HUMAN_REVIEW_REQUIRED' };
  assert.equal(planReply(explicit, info), explicit);
  assert.equal(planReply({ canAnswer: true, reply: 'Fee is 950 QAR.' }, info).reply, 'Fee is 950 QAR.');
});

test('does not repeatedly block staff handover on unanswered questions', () => {
  const plan = advance({ prior: { nameAsked: 2, startAsked: 2 }, text: 'What is the fee?', language: 'en' });
  assert.equal(plan.key, undefined);
  assert.equal(plan.answerOnly, false);
});


test('acknowledgements stay local and distinct from application consent or questions', () => {
  assert.equal(acknowledgement('ok.', 'en'), 'Got it.');
  assert.equal(acknowledgement('👍🏽', 'en'), 'Got it.');
  assert.equal(acknowledgement('تمام', 'ar'), 'تمام.');
  assert.equal(acknowledgement('Thank you!', 'en'), 'You’re welcome.');
  for (const message of ['yes', 'ok?', 'ok, how much?', 'send the form', 'agent']) {
    assert.equal(acknowledgement(message, 'en'), null);
  }
});
