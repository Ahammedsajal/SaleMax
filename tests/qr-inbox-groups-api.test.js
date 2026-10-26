'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createRouter = require('../modules/platform/qr-inbox-groups-router');
const { groupChatId } = require('../modules/platform/qr-inbox-groups');
test('group API enforces authentication, owner scope, CSRF origin and validates before sends', async t => {
  const uid = 'synthetic-owner', chatId = groupChatId(uid, 'qr-one', '100@g.us');
  let sent = 0, synced = 0;
  const pool = { query: async (sql, args) => {
    if (sql.includes('sx_legacy_ownership')) return [[]];
    if (sql.includes('FROM instance')) return [[{ uniqueId: 'qr-one', uid, number: '100' }]];
    if (sql.includes('FROM beta_chats')) { assert.equal(args[0], uid); return [[{ chat_id: chatId, sender_name: 'Synthetic group', origin_instance_unique_id: 'qr-one', profile: JSON.stringify({ whatsappGroup: { subject: 'Synthetic group', participants: [] } }) }]]; }
    if (sql.includes('FROM beta_conversation')) return [[]];
    throw Error('Unexpected SQL');
  } };
  const service = { stored: async (owner, id) => {
    assert.equal(owner, uid);
    if (id !== chatId) throw Object.assign(Error('QR_GROUP_NOT_FOUND'), { code: 'QR_GROUP_NOT_FOUND', status: 404 });
    return { chat: { chat_id: chatId }, group: { jid: '100@g.us', participants: [] } };
  }, details: async () => ({ group: { subject: 'Synthetic group' }, stale: false }), sync: async () => { synced++; return { count: 1 }; }, sendTarget: async () => { sent++; throw Error('Transport should not run'); } };
  const authenticate = (req, res, next) => {
    if (req.get('Authorization') !== 'Bearer synthetic') return res.status(401).json({ success: false });
    req.featureSession = { actor: { id: 1, uid }, ownerUid: uid, agent: false, refresh: async () => {} }; next();
  };
  const app = express(); app.use('/groups', createRouter({ pool, authenticate, origin: 'https://7network.live', groupService: service }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/groups`;
  const request = (path, body, origin = 'https://7network.live') => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer synthetic', Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await fetch(base)).status, 401);
  assert.equal((await request('')).status, 200);
  assert.equal((await request('/sync', { instanceId: 'qr-one' }, 'https://untrusted.invalid')).status, 403);
  assert.equal(synced, 0);
  assert.equal((await request('/sync', { instanceId: 'qr-one' })).status, 200);
  assert.equal((await request('/sync', { instanceId: 'qr-one' })).status, 429);
  assert.equal(synced, 1);
  assert.equal((await request('/send', { chatId, text: '' })).status, 400);
  assert.equal((await request('/details?chatId=' + groupChatId('other-owner', 'qr-one', '100@g.us'))).status, 404);
  assert.equal(sent, 0);
});
