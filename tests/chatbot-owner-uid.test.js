'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { legacyOwnerUidForTenant } = require('../modules/platform/chatbot-owner-uid');

test('canonical inbox lookup filters account owner from linked staff accounts', async () => {
  const ownerUid = 'synthetic-owner-uid';
  const db = {
    async query(sql, params) {
      assert.match(sql, /JOIN sx_memberships m ON m\.id=o\.membership_id AND m\.tenant_id=o\.tenant_id/);
      assert.match(sql, /m\.role='owner'/);
      assert.match(sql, /m\.status='active'/);
      assert.match(sql, /m\.active_owner_tenant=o\.tenant_id/);
      assert.deepEqual(params, ['tenant-1']);
      // Non-owner accountant and manager links are filtered by the query.
      return [[{
        uid: ownerUid,
        uidHash: crypto.createHash('sha256').update(ownerUid).digest('hex'),
      }], []];
    },
  };

  assert.equal(await legacyOwnerUidForTenant(db, 'tenant-1'), ownerUid);
});

test('canonical inbox lookup fails closed for ambiguous or invalid owner links', async () => {
  const ownerUid = 'synthetic-owner-uid';
  const valid = { uid: ownerUid, uidHash: crypto.createHash('sha256').update(ownerUid).digest('hex') };
  for (const rows of [[valid, valid], [{ uid: ownerUid, uidHash: 'invalid' }], []]) {
    await assert.rejects(
      legacyOwnerUidForTenant({ query: async () => [rows, []] }, 'tenant-1'),
      error => error.code === 'LEGACY_INBOX_LINK_REQUIRED',
    );
  }
});
