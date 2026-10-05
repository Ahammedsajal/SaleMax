'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SUPPORTED_CHANNEL_KINDS, channelFor } = require('../modules/platform/chatbot-channels');

test('the editor/runtime share only inbound WhatsApp adapters that have send and state support', () => {
  assert.deepEqual(SUPPORTED_CHANNEL_KINDS, ['whatsapp_meta', 'whatsapp_qr']);
  assert.equal(channelFor('meta'), 'whatsapp_meta');
  assert.equal(channelFor('QR'), 'whatsapp_qr');
  for (const unsupported of ['telegram', 'web', 'email', '', null]) assert.equal(channelFor(unsupported), null);
});
