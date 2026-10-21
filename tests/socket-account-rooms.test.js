'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  accountRoom,
  accountRoomsForUser,
  presenceForUserData,
  connectedUidsFromSockets,
  joinAccountRooms,
  emitToAccount,
} = require('../modules/platform/socket-account-rooms');

test('account rooms isolate identities and cannot collide through separators', () => {
  assert.notEqual(accountRoom('tenant:member'), accountRoom('tenant/member'));
  assert.notEqual(accountRoom('tenant-a'), accountRoom('tenant-b'));
  assert.equal(accountRoom('  '), null);
  assert.equal(accountRoom('x'.repeat(1000)), null);
});

test('only server-resolved user and owner identities become account rooms', () => {
  assert.deepEqual(accountRoomsForUser({ uid: 'agent-7', isAgent: true, owner_uid: 'owner-3', teamOwnerUid: 'owner-3' }), [
    accountRoom('agent-7'), accountRoom('owner-3'),
  ]);
  assert.deepEqual(accountRoomsForUser({ uid: 'owner-3', owner_uid: 'forged', isAgent: false }), [accountRoom('owner-3')]);
});

test('socket joins derive from verified user data and presence excludes account details', async () => {
  const joined = [];
  const socket = { join: async (room) => joined.push(room) };
  const userData = { uid: 'agent-7', name: 'Private Name', email: 'private@example.test', isAgent: true, owner_uid: 'owner-3' };
  assert.deepEqual(await joinAccountRooms(socket, userData), [accountRoom('agent-7'), accountRoom('owner-3')]);
  assert.deepEqual(joined, [accountRoom('agent-7'), accountRoom('owner-3')]);
  assert.deepEqual(presenceForUserData(userData), { uid: 'agent-7', isAgent: true, owner_uid: 'owner-3', teamOwnerUid: null });
  assert.deepEqual(connectedUidsFromSockets([{ data: { crmPresence: presenceForUserData(userData) } }, { data: {} }]), [
    { uid: 'agent-7', isAgent: true, owner: 'owner-3' },
  ]);
});

test('account broadcasts target a server-derived room and invalid targets fail closed', () => {
  const calls = [];
  const io = { to(room) { return { emit(event, data) { calls.push({ room, event, data }); } }; } };
  assert.equal(emitToAccount(io, 'owner-3', 'request_update_chat_list', { chatId: 'c1' }), true);
  assert.equal(emitToAccount(io, '', 'ring', {}), false);
  assert.deepEqual(calls, [{ room: accountRoom('owner-3'), event: 'request_update_chat_list', data: { chatId: 'c1' } }]);
});
