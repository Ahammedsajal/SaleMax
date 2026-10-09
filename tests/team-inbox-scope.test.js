'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { resolveInboxUid } = require('../modules/platform/team-inbox-scope');
const hash = uid => crypto.createHash('sha256').update(uid).digest('hex');
const user = { id: 2, uid: 'synthetic-manager' };
const member = { tenantId: 'synthetic-tenant', tenantStatus: 'active', role: 'manager', membershipStatus: 'active', identityStatus: 'active', uidHash: hash(user.uid), delegatedPermissions: [] };
const query = row => async sql => sql.includes('WHERE o.source_table') ? [row] : [{ uid: 'synthetic-owner', uidHash: hash('synthetic-owner') }];

test('manager reads and replies through the verified owner Inbox scope', async () => {
  for (const event of ['get_chat_list','load_conversation','send_chat_message']) assert.equal(await resolveInboxUid(query(member), user, event), 'synthetic-owner');
  assert.equal(await resolveInboxUid(async () => [], user, 'get_chat_list'), user.uid);
});
test('staff Inbox rejects unknown mutations, inactive identities and restricted roles', async () => {
  for (const event of ['delete_chat','del_contact','unknown']) await assert.rejects(resolveInboxUid(query(member),user,event), { code: 'TEAM_INBOX_PERMISSION_DENIED' });
  for (const override of [{role:'accountant'}, {membershipStatus:'inactive'}, {uidHash:'wrong'}, {tenantStatus:'suspended'}]) await assert.rejects(resolveInboxUid(query({...member,...override}),user,'get_chat_list'), { code: 'TEAM_INBOX_PERMISSION_DENIED' });
});
test('custom role permissions remain authoritative over a manager seat', async () => {
  const custom = {...member, roleProfileId:'synthetic-role', seatRole:'manager', roleStatus:'active', rolePermissions:['conversations.read']};
  assert.equal(await resolveInboxUid(query(custom),user,'load_conversation'),'synthetic-owner');
  await assert.rejects(resolveInboxUid(query(custom),user,'send_chat_message'),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});
