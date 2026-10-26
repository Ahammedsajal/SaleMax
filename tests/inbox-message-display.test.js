'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeConversationLists } = require('../helper/inbox/chatData');

function display(type, payload) {
  return mergeConversationLists({
    dbMessages: [{ metaChatId: 'sample', type, msgContext: JSON.stringify(payload), timestamp: 1 }],
  })[0];
}

test('native text keeps Unicode emoji and Arabic unchanged', () => {
  const payload = { type: 'text', text: { body: 'مرحباً 👋🏽 ❤️' } };
  const result = display('text', payload);
  assert.equal(result.type, 'text');
  assert.deepEqual(result.msgContext, payload);
});

test('stored Meta button payload uses the existing Inbox button card contract', () => {
  const payload = {
    type: 'interactive',
    interactive: { type: 'button', body: { text: 'Choose a demo' }, action: { buttons: [{ type: 'reply', reply: { id: 'demo', title: 'Show me a demo' } }] } },
  };
  const result = display('interactive', payload);
  assert.equal(result.type, 'button');
  assert.deepEqual(result.msgContext, payload);
  assert.equal(result.msgContext.interactive.action.buttons[0].reply.id, 'demo');
});

test('stored Meta list payload keeps sections and row descriptions for the existing list renderer', () => {
  const payload = { type: 'interactive', interactive: { type: 'list', body: { text: 'Select' }, action: { sections: [{ title: 'Courses', rows: [{ id: 'one', title: 'Course one', description: 'Details' }] }] } } };
  const result = display('interactive', payload);
  assert.equal(result.type, 'list');
  assert.deepEqual(result.msgContext, payload);
});

test('reaction and sticker histories become visible using supported renderer formats', () => {
  const reaction = display('reaction', { type: 'reaction', reaction: { emoji: '👍🏽', message_id: 'target' } });
  assert.equal(reaction.type, 'text');
  assert.equal(reaction.msgContext.text.body, '👍🏽');
  const sticker = display('sticker', { type: 'sticker', sticker: { link: 'https://example.invalid/sticker.webp' } });
  assert.equal(sticker.type, 'image');
  assert.equal(sticker.msgContext.image.link, 'https://example.invalid/sticker.webp');
});

test('new provider types retain their payload and get a visible fallback', () => {
  const payload = { type: 'future_kind', future_kind: { id: 'payload-1' } };
  const result = display('future_kind', payload);
  assert.equal(result.type, 'text');
  assert.match(result.msgContext.text.body, /future_kind/);
  assert.deepEqual(result.msgContext.meta.originalPayload, payload.future_kind);
});

test('DB and legacy copies still deduplicate by provider message ID after display conversion', () => {
  const message = { metaChatId: 'same-id', type: 'interactive', msgContext: { type: 'interactive', interactive: { type: 'button', body: { text: 'Body' }, action: { buttons: [] } } }, timestamp: 1 };
  const result = mergeConversationLists({ dbMessages: [message], fileMessages: [message] });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'button');
  assert.equal(message.type, 'interactive');
});
