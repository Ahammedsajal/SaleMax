'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveQrSessionOwner } = require('../modules/platform/qr-session-owner');

test('QR runtime owner comes from one exact database session record, not the session-id prefix', async () => {
  const calls = [];
  const owner = await resolveQrSessionOwner(async (sql, args) => {
    calls.push({ sql, args });
    return [{ id: 31, uid: 'actual-owner', uniqueId: 'another-tenant_custom-session', number: '97450000000' }];
  }, 'another-tenant_custom-session');
  assert.deepEqual(owner, { instanceId: 31, uid: 'actual-owner', uniqueId: 'another-tenant_custom-session', number: '97450000000' });
  assert.deepEqual(calls[0].args, ['another-tenant_custom-session']);
});

test('missing, ambiguous and foreign-owner QR sessions fail closed', async () => {
  const noRows = async () => [];
  const duplicateRows = async () => [
    { id: 1, uid: 'owner-a', uniqueId: 'shared-session' },
    { id: 2, uid: 'owner-b', uniqueId: 'shared-session' },
  ];
  const oneRow = async () => [{ id: 3, uid: 'owner-a', uniqueId: 'owner-a_session' }];
  assert.equal(await resolveQrSessionOwner(noRows, 'missing'), null);
  assert.equal(await resolveQrSessionOwner(duplicateRows, 'shared-session'), null);
  assert.equal(await resolveQrSessionOwner(oneRow, 'owner-a_session', 'owner-b'), null);
  assert.equal(await resolveQrSessionOwner(noRows, ''), null);
});
