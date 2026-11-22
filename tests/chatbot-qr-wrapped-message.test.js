'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const saved = [];
const stubs = {
  '../database/dbpromise': { query: async () => [] },
  '../helper/addon/qr/control': {},
  '../modules/platform/qr-inbox-groups': { isGroupJid: () => false },
  '../modules/platform/chatbot-mockup': {
    ownsInbox: () => false,
    senderMobileFromQrJid: jid => jid.split('@')[0],
  },
  '../modules/platform/chatbot-conversation-control': { automatedQrSender: () => null },
  '../modules/platform/chatbot-conversation-store': {
    persistConversationMessage: async args => { saved.push(args); return { inserted: true }; },
  },
};
for (const [target, exports] of Object.entries(stubs)) {
  const filename = require.resolve(target);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const { unwrapMessageContent, processBaileysMsg } = require('../helper/addon/qr/processThings');

test('recognises text, audio and documents inside phone and disappearing message wrappers', () => {
  for (const content of [{ conversation: 'hello' }, { audioMessage: { ptt: true } },
    { documentMessage: { fileName: 'course.pdf' } }]) {
    assert.deepEqual(unwrapMessageContent({
      deviceSentMessage: { message: { ephemeralMessage: { message: content } } },
    }), content);
  }
});

test('QR handler records a phone-sent wrapped text as human and requests staff pause', async () => {
  saved.length = 0;
  const result = await processBaileysMsg({
    sessionId: 'test-session', live: true, uid: 'test-owner', chatId: 'test-chat',
    userFromMysql: { timezone: 'UTC' },
    body: { key: { fromMe: true, remoteJid: '97455555555@s.whatsapp.net', id: 'phone-message' },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { deviceSentMessage: { message: { conversation: 'Message from phone' } } } },
  });
  assert.equal(result.newMessage.msgContext.text.body, 'Message from phone');
  assert.equal(result.newMessage.sentBy, 'human');
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].staffReply, { channelKind: 'whatsapp_qr', channelRef: 'test-session' });
});

test('QR handler still records incoming customer text', async () => {
  saved.length = 0;
  const result = await processBaileysMsg({
    sessionId: 'test-session', live: true, uid: 'test-owner', chatId: 'test-chat',
    userFromMysql: { timezone: 'UTC' },
    body: { key: { fromMe: false, remoteJid: '97455555555@s.whatsapp.net', id: 'customer-message' },
      message: { conversation: 'How much?' } },
  });
  assert.equal(result.newMessage.route, 'INCOMING');
  assert.equal(result.newMessage.msgContext.text.body, 'How much?');
  assert.equal(saved.length, 1);
});
