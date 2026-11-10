'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { conversationHistoryFromRows } = require('../modules/platform/chatbot-conversation-history');

test('AI history includes recent customer and staff turns but excludes the current inbound message', () => {
  const rowsNewestFirst = [
    { route: 'INCOMING', msgContext: JSON.stringify({ text: { body: 'Please connect' } }) },
    { route: 'OUTGOING', msgContext: JSON.stringify({ text: { body: 'I can ask admissions to check.' } }) },
    { route: 'INCOMING', msgContext: JSON.stringify({ text: { body: 'I need to start immediately.' } }) },
    { route: 'OUTGOING', msgContext: JSON.stringify({ text: { body: 'Is your name Shamly?' } }) },
  ];
  assert.deepEqual(conversationHistoryFromRows(rowsNewestFirst, 'Please connect'), [
    { role: 'assistant', text: 'Is your name Shamly?' },
    { role: 'user', text: 'I need to start immediately.' },
    { role: 'assistant', text: 'I can ask admissions to check.' },
  ]);
});

test('AI history retains a repeated question when it was the last prior customer turn', () => {
  const rowsNewestFirst = [
    { route: 'OUTGOING', msgContext: JSON.stringify({ text: { body: 'The team is checking.' } }) },
    { route: 'INCOMING', msgContext: JSON.stringify({ text: { body: 'Please connect' } }) },
  ];
  assert.deepEqual(conversationHistoryFromRows(rowsNewestFirst, 'please connect'), [
    { role: 'user', text: 'Please connect' },
    { role: 'assistant', text: 'The team is checking.' },
  ]);
});
