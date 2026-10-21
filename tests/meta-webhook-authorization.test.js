'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { resolveMetaWebhookOwner } = require('../modules/platform/meta-webhook-authorization');
const { createMetaWebhookSignatureGuard } = require('../modules/platform/meta-webhook-signature');

function body(bindings) {
  return { object: 'whatsapp_business_account', entry: bindings.map(({ wabaId, phoneId }) => ({
    id: wabaId,
    changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneId } } }],
  })) };
}

test('direct webhook binds each signed phone ID to the configured tenant UID', async () => {
  const calls = [];
  const uid = await resolveMetaWebhookOwner({
    body: body([{ wabaId: '123456789012345', phoneId: '987654321098765' }]),
    expectedUid: 'tenant-owner-a',
    query: async (sql, params) => { calls.push({ sql, params }); return [{ uid: 'tenant-owner-a' }]; },
  });
  assert.equal(uid, 'tenant-owner-a');
  assert.deepEqual(calls[0].params, ['tenant-owner-a', '987654321098765']);
  assert.match(calls[0].sql, /uid = \? AND business_phone_number_id = \?/);
});

test('embedded webhook resolves one owner from the signed WABA and phone pair', async () => {
  let call;
  const uid = await resolveMetaWebhookOwner({
    body: body([{ wabaId: '123456789012345', phoneId: '987654321098765' }]),
    embedded: true,
    query: async (sql, params) => { call = { sql, params }; return [{ uid: 'tenant-owner-a' }]; },
  });
  assert.equal(uid, 'tenant-owner-a');
  assert.deepEqual(call.params, ['123456789012345', '987654321098765']);
  assert.match(call.sql, /embed_data/);
  assert.match(call.sql, /business_phone_number_id = \?/);
});

test('webhook rejects unknown, ambiguous, or cross-owner phone bindings', async () => {
  const input = { body: body([{ wabaId: '123456789012345', phoneId: '987654321098765' }]), expectedUid: 'tenant-owner-a' };
  await assert.rejects(resolveMetaWebhookOwner({ ...input, query: async () => [] }), { code: 'META_WEBHOOK_OWNER_MISMATCH' });
  await assert.rejects(resolveMetaWebhookOwner({ ...input, query: async () => [{ uid: 'tenant-owner-a' }, { uid: 'tenant-owner-a' }] }), { code: 'META_WEBHOOK_OWNER_MISMATCH' });
  await assert.rejects(resolveMetaWebhookOwner({ ...input, query: async () => [{ uid: 'tenant-owner-b' }] }), { code: 'META_WEBHOOK_OWNER_MISMATCH' });
  await assert.rejects(resolveMetaWebhookOwner({ body: body([
    { wabaId: '123456789012345', phoneId: '987654321098765' },
    { wabaId: '987654321098765', phoneId: '123456789012345' },
  ]), embedded: true, query: async (_sql, params) => [{ uid: params[1] === '987654321098765' ? 'tenant-owner-a' : 'tenant-owner-b' }] }), { code: 'META_WEBHOOK_MULTIPLE_OWNERS' });
  await assert.rejects(resolveMetaWebhookOwner({ body: { entry: [] }, expectedUid: 'tenant-owner-a', query: async () => [] }), { code: 'META_WEBHOOK_PHONE_BINDING_MISSING' });
});

function fakeResponse() {
  return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } };
}

test('Meta webhook signature guard fails closed and accepts only a valid raw-body HMAC', async () => {
  const payload = Buffer.from('{"entry":[]}');
  const secret = 'synthetic-app-secret';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  const guard = createMetaWebhookSignatureGuard({ getSecret: async () => secret });
  const req = { rawBody: payload, headers: { 'x-hub-signature-256': signature } };
  let nextCalled = false;
  await guard(req, fakeResponse(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const missing = fakeResponse();
  await createMetaWebhookSignatureGuard({ getSecret: async () => null })(req, missing, () => assert.fail('must not call next'));
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.payload.code, 'META_WEBHOOK_SIGNATURE_NOT_CONFIGURED');

  const invalid = fakeResponse();
  await guard({ ...req, headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } }, invalid, () => assert.fail('must not call next'));
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.payload.code, 'META_WEBHOOK_SIGNATURE_INVALID');
});
