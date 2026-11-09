'use strict';

// Use a disposable MariaDB server and a private socket. This creates its own schema.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const express = require('express');
const { discover, applyMigrations } = require('../database/migration-runner');
const { trainingCenter } = require('../modules/platform/categories');
const mockup = require('../modules/platform/chatbot-mockup');

async function main() {
  const socketPath = process.env.SALEMAX_TEST_DB_SOCKET;
  if (!socketPath || !fs.statSync(socketPath).isSocket()) throw Error('DISPOSABLE_TEST_SOCKET_REQUIRED');
  const settings = { socketPath, user: process.env.DBUSER || 'root', password: process.env.DBPASS || '' };
  const schema = 'salemax_mockup_test_' + randomUUID().replace(/-/g, '').slice(0, 12);
  const admin = await mysql.createConnection(settings);
  await admin.query('CREATE DATABASE ' + schema);
  const pool = mysql.createPool({ ...settings, database: schema, connectionLimit: 4 });
  let server;
  try {
    const db = await pool.getConnection();
    try {
      const names = ['20261001_platform_identity.sql', '20270130_chatbot_mockup_turns.sql'];
      const migrations = discover(path.join(__dirname, '../database/migrations')).filter(item => names.includes(item.file));
      assert.deepEqual((await applyMigrations(db, migrations)).applied, names);
      assert.deepEqual((await applyMigrations(db, migrations)).skipped, names);
    } finally { db.release(); }
    const tenant = randomUUID(), foreign = randomUUID(), identity = randomUUID(), member = randomUUID(), uid = 'synthetic-owner';
    const hash = createHash('sha256').update(uid).digest('hex');
    process.env.SALEMAX_CHATBOT_MOCKUP_TENANT_ID = tenant;
    process.env.SALEMAX_CHATBOT_MOCKUP_OWNER_HASH = hash;
    await pool.query("INSERT INTO sx_tenants(id,slug,name,category_key,category_version,status) VALUES (?,'demo','Demo','training_center',1,'active'),(?,'foreign','Foreign','training_center',1,'active')", [tenant, foreign]);
    await pool.query("INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES (?,'synthetic@example.test','Synthetic','active')", [identity]);
    await pool.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role) VALUES (?,?,?,'owner')", [member, tenant, identity]);
    await pool.query('CREATE TABLE user (id INT PRIMARY KEY, uid VARCHAR(191), role VARCHAR(20))');
    await pool.query("INSERT INTO user VALUES (1,?,'user')", [uid]);
    await pool.query("INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES ('user','1',?,?,?,UTC_TIMESTAMP())", [tenant, member, hash]);

    const event = (id, chatId, body, route = 'INCOMING') => ({ uid, origin: 'qr', sessionId: 'qr-1', chatId,
      message: { type: 'text', route, metaChatId: id, senderName: chatId === 'chat-b' ? 'متعلم تجريبي' : 'Synthetic learner', msgContext: { text: { body } } } });
    assert.equal(mockup.ownsInbox(uid, 'qr'), true);
    assert.equal(mockup.ownsInbox('other', 'qr'), false);
    assert.equal(mockup.ownsInbox(uid, 'telegram'), false);
    await mockup.enqueue(pool, event('a', 'chat-a', 'What is the fee?'));
    await mockup.enqueue(pool, event('a', 'chat-a', 'What is the fee?'));
    await mockup.enqueue(pool, event('b', 'chat-a', 'Email: learner@example.test'));
    await mockup.enqueue(pool, event('c', 'chat-b', 'Hi'));
    await mockup.enqueue(pool, event('out', 'chat-a', 'Staff reply', 'OUTGOING'));
    await mockup.enqueue(pool, event('group', 'qrgroup_example', 'Group message'));
    await mockup.enqueue(pool, { ...event('cross', 'chat-c', 'Foreign tenant'), uid: 'other' });
    const queued = await mockup.list(pool, tenant, null);
    assert.equal(queued.items.length, 2);
    assert.equal(queued.items.reduce((sum, row) => sum + Number(row.turnCount), 0), 3);

    let started, finishFirst;
    const firstStarted = new Promise(resolve => { started = resolve; });
    const firstWait = new Promise(resolve => { finishFirst = resolve; });
    const first = mockup.tick(pool, { generate: async input => {
      assert.equal(input.message, 'What is the fee?');
      started();
      await firstWait;
      return { reply: 'First draft', state: { selectedCourseCode: 'fixture-course' }, revision: 2 };
    } });
    try {
      await Promise.race([firstStarted, first.then(() => { throw Error('FIRST_DRAFT_NOT_CLAIMED'); })]);
      await mockup.tick(pool, { generate: async input => {
        assert.equal(input.chatId, 'chat-b');
        assert.equal(input.state, undefined);
        return { reply: 'Other conversation' };
      } });
    } finally { finishFirst(); await first; }
    await mockup.tick(pool, { generate: async input => {
      assert.equal(input.state.selectedCourseCode, 'fixture-course');
      assert.equal(input.message, 'Email: [email omitted]');
      return { reply: 'Second draft', wouldHandoff: true, reason: 'HUMAN_REVIEW_REQUIRED' };
    } });
    assert.equal(await mockup.tick(pool), false);

    const conversation = queued.items.find(row => Number(row.turnCount) === 2).conversationKey;
    const items = (await mockup.thread(pool, tenant, conversation, null)).items;
    assert.deepEqual(items.map(item => item.status), ['ready', 'review']);
    assert.deepEqual(items.map(item => item.replyText), ['First draft', 'Second draft']);
    assert.equal((await mockup.thread(pool, foreign, conversation, null)).items.length, 0);

    const app = express();
    app.use('/mockup', mockup.createRouter({ pool, authenticate: (req, res, next) => {
      if (!req.get('x-role')) return res.status(401).json({ success: false });
      const tenantId = req.get('x-other') ? foreign : tenant;
      req.featureSession = { context: {
        audience: 'tenant', tenant: { id: tenantId, status: 'active', categoryKey: 'training_center', categoryVersion: 1 },
        membership: { tenantId, status: 'active', role: req.get('x-role') },
        category: trainingCenter, subscription: { status: 'active', capabilities: ['automation.chatbot'] },
      } };
      next();
    } }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/mockup`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { 'x-role': 'agent' } })).status, 403);
    assert.equal((await fetch(url, { headers: { 'x-role': 'owner', 'x-other': 'yes' } })).status, 404);
    const response = await fetch(url + '/conversations/' + conversation, { headers: { 'x-role': 'owner' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal((await response.json()).data.items[0].replyText, 'First draft');
    const search = async query => {
      const result = await fetch(url + '?search=' + encodeURIComponent(query), { headers: { 'x-role': 'owner' } });
      assert.equal(result.status, 200);
      return (await result.json()).data.items;
    };
    const matched = await search('SYNTHETIC');
    assert.equal(matched.length, 1);
    assert.equal(matched[0].conversationKey, conversation);
    assert.equal(matched[0].preview, 'Email: [email omitted]');
    assert.equal((await search('متعلم')).length, 1);
    assert.deepEqual(await search('%'), []);
    assert.equal((await fetch(url + '?search=a&search=b', { headers: { 'x-role': 'owner' } })).status, 400);
    console.log('Mockup migration, deduplication, ordered draft state, tenant boundary and owner read API verified.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    await admin.query('DROP DATABASE ' + schema);
    await admin.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
