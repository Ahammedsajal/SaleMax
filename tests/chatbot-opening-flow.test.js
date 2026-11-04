'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isOpeningGreeting } = require('../modules/platform/chatbot-opening-flow');

test('opening flow runs for standalone English and Arabic greetings', () => {
  for (const text of ['Hi', 'hello there!', 'Good morning', 'مرحبا', 'أهلاً بك 👋', 'السلام عليكم ورحمة الله وبركاته', 'صباح الخير']) {
    assert.equal(isOpeningGreeting(text), true, text);
  }
});

test('opening flow does not intercept a first message that already contains an enquiry', () => {
  for (const text of ['Hi, what is the fee for Excel?', 'I want to register', 'كم رسوم دورة Excel؟', 'موظف']) {
    assert.equal(isOpeningGreeting(text), false, text);
  }
});
