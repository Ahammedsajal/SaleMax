'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, schedule, summary } = require('../modules/platform/chatbot-followup-preview');
const { variants, render } = require('../modules/platform/chatbot-followup-library');

const first = Date.parse('2026-11-02T08:00:00Z');
const last = Date.parse('2026-11-03T16:00:00Z');
const row = { first_at: '2026-11-02 08:00:00', status: 'open', stage_key: 'interested' };
const course = { nameEn: 'Marine Deckhand' };
const message = (body, timestamp = last, route = 'INCOMING', sentBy = '') =>
  ({ msgContext: { text: { body } }, type: 'text', timestamp, route, sentBy });

test('customer inactivity restarts both previews and keeps them in Qatar review hours', () => {
  assert.deepEqual(schedule(first, last), {
    two: Date.parse('2026-11-06T06:00:00Z'),
    seven: Date.parse('2026-11-11T06:00:00Z'),
  });
  const messages = [message('What is the fee?')];
  assert.equal(classify({ row, messages, course, now: last }).status, 'scheduled');
  assert.equal(classify({ row, messages, course, now: last + 8 * 86400000 }).status, 'ready');
});

test('staff and lead progression stop previews while a same-session answer can qualify', () => {
  const inbound = message('Marine Deckhand please');
  const answer = message('The fee is QAR 3000', last + 60000, 'OUTGOING');
  const now = last + 8 * 86400000;
  assert.equal(classify({ row, messages: [inbound, answer], course, now }).status, 'ready');
  const followup = message('Just checking up', last + 86400000, 'OUTGOING');
  assert.equal(classify({ row, messages: [inbound, followup], course, now }).reason, 'STAFF_FOLLOWED_UP');
  assert.equal(classify({ row: { ...row, progressed: 1 }, messages: [inbound], course, now }).reason, 'LEAD_PROGRESSED');
  assert.equal(classify({ row: { ...row, staff_task: 1 }, messages: [inbound], course, now }).reason, 'STAFF_OWNS_LEAD');
  assert.equal(classify({ row, messages: [inbound], course: null, now }).reason, 'COURSE_UNCLEAR');
});

test('an opt-out or a substantive reply after an existing draft suppresses the sequence', () => {
  const active = { ...row, prior_draft: 'existing', prior_last: '2026-11-02 08:00:00' };
  assert.equal(classify({ row: active, messages: [message('Stop course updates')], course }).reason, 'OPT_OUT');
  assert.equal(classify({ row: active, messages: [message('I can start this month')], course }).reason, 'CUSTOMER_REPLIED');
  assert.equal(classify({ row: active, messages: [message('Thanks')], course, now: last }).reason, 'WAITING_FOR_SILENCE');
});

test('variant selection sees topic codes only and renders the confirmed course in either language', () => {
  const phrase = 'هل يمكن معرفة رسوم الدورة؟';
  const info = summary([message(phrase)], [phrase]);
  assert.equal(info.first[0], 'F02');
  assert.equal(info.language, 'ar');
  assert.doesNotMatch(JSON.stringify(info), /رسوم/);
  assert.equal(Object.keys(variants).length, 15);
  assert.match(render('F02', 'مساعد بحري', 'ar'), /مساعد بحري/);
  assert.match(render('F07', 'Marine Deckhand', 'en'), /Marine Deckhand/);
});
