'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fallbackContactQuestion, fallbackHandoffReply, safeDraft } = require('../modules/platform/chatbot-contact-assistant');

test('contact fallback asks to confirm an unverified display name and requests a Qatar callback number', () => {
  const reply = fallbackContactQuestion({ language: 'en', hasNameCandidate: true, needsQatarNumber: true });
  assert.match(reply, /\{name\}/);
  assert.match(reply, /Qatar mobile number/);
  assert.match(reply, /\?/);
});

test('contact fallback does not ask for a name that is already confirmed', () => {
  assert.equal(fallbackContactQuestion({ language: 'en', hasNameCandidate: true,
    needsName: false, needsQatarNumber: true }),
  'Please also share a Qatar mobile number (+974, 8 digits) so the course coordinator can call you.');
});

test('handoff fallback only says a request was shared after a claim was queued', () => {
  const queued = fallbackHandoffReply({ language: 'en', courseName: 'Marine Deckhand', needsName: true,
    needsQatarNumber: true, qatarNumberSaved: false, handoffQueued: true, hasNameCandidate: false });
  assert.match(queued, /shared your enquiry about Marine Deckhand/);
  assert.match(queued, /What name/);
  assert.match(queued, /Qatar mobile/);
  const notQueued = fallbackHandoffReply({ language: 'en', needsName: false, needsQatarNumber: false,
    qatarNumberSaved: false, handoffQueued: false, hasNameCandidate: false });
  assert.doesNotMatch(notQueued, /shared|sent|asked|passed/i);
});

test('provider drafts must use the name placeholder and cannot claim an unqueued handoff', () => {
  assert.equal(safeDraft('Is {name} the name you prefer?', { mode: 'contact', language: 'en', hasNameCandidate: true, needsName: true }), 'Is {name} the name you prefer?');
  assert.equal(safeDraft('Is Amina the name you prefer?', { mode: 'contact', language: 'en', hasNameCandidate: true, needsName: true }), null);
  assert.equal(safeDraft('Please share your Qatar number?', { mode: 'contact', language: 'en', hasNameCandidate: true, needsName: false }), 'Please share your Qatar number?');
  assert.equal(safeDraft('I shared it with admissions.', { mode: 'handoff', language: 'en', hasNameCandidate: false, handoffQueued: false }), null);
  assert.equal(safeDraft('I shared it with admissions.', { mode: 'handoff', language: 'en', hasNameCandidate: false, handoffQueued: true }), 'I shared it with admissions.');
});
