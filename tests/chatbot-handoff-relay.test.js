'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const relay = require('../modules/platform/chatbot-handoff-relay');

test('relay accepts only explicit code-prefixed replies and close commands', () => {
  assert.deepEqual(relay.parseCommand('P3DBQ9: Thanks, I’ll check that for you'), {
    action: 'reply', code: 'P3DBQ9', body: 'Thanks, I’ll check that for you',
  });
  assert.deepEqual(relay.parseCommand('CLOSE P3DBQ9'), { action: 'close', code: 'P3DBQ9' });
  for (const text of ['hello', 'P3DBQ: missing one character', 'P3DBQ9 Thanks', 'CLOSE P3DBQ9 later']) {
    assert.equal(relay.parseCommand(text), null, text);
  }
});

test('queued relay content is encrypted and bound to the delivery, claim, and tenant ids', () => {
  const key = 'SALEMAX_PLATFORM_KEY_BASE64';
  const previous = process.env[key];
  process.env[key] = Buffer.alloc(32, 7).toString('base64');
  try {
    const ids = { tenantId: 'tenant-1', claimId: 'claim-1', deliveryId: 'delivery-1' };
    const sealed = relay.encryptPayload({ text: 'private customer question' }, ids);
    assert.equal(sealed.ciphertext.includes(Buffer.from('private customer question')), false);
    assert.equal(relay.decryptPayload({ tenant_id: ids.tenantId, claim_id: ids.claimId, id: ids.deliveryId, payload_ciphertext: sealed.ciphertext,
      payload_iv: sealed.iv, payload_auth_tag: sealed.authTag }).text, 'private customer question');
    assert.throws(() => relay.decryptPayload({ tenant_id: ids.tenantId, claim_id: ids.claimId,
      id: 'different-delivery', payload_ciphertext: sealed.ciphertext, payload_iv: sealed.iv,
      payload_auth_tag: sealed.authTag }));
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});
