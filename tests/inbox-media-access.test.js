'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const media = require('../modules/platform/inbox-media-access');

test('legacy media links are restricted to the configured same-origin meta-media path', () => {
  const origin = 'https://crm.example.test';
  assert.equal(media.legacyMediaFilename(`${origin}/meta-media/photo.jpg`, origin), 'photo.jpg');
  assert.equal(media.legacyMediaFilename('/meta-media/photo.jpg', origin), 'photo.jpg');
  for (const link of [
    'https://attacker.test/meta-media/photo.jpg',
    `${origin}/media/photo.jpg`,
    `${origin}/meta-media/%2e%2e%2fsecret.jpg`,
    `${origin}/meta-media/photo.jpg?download=1`,
    `${origin}/meta-media/photo.jpg#fragment`,
  ]) assert.equal(media.legacyMediaFilename(link, origin), null);
});

test('existing Inbox response shapes receive short-lived actor and conversation-bound media URLs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '7network-inbox-media-sign-'));
  try {
  const key = Buffer.from('synthetic inbox media signing key');
  const origin = 'https://crm.example.test';
  const actor = { id: 17, uid: 'agent-17', role: 'agent' };
  const sessionExp = Math.floor(Date.now() / 1000) + 600;
  media.savePrivateMedia({ mediaRoot: root, ownerUid: 'owner-7', filename: 'photo.jpg', bytes: Buffer.from('synthetic') });
  const signed = media.signConversation([{
    chat_id: 'chat-7',
    type: 'image',
    msgContext: { image: { link: `${origin}/meta-media/photo.jpg`, caption: 'Synthetic' } },
  }], { key, origin, ownerUid: 'owner-7', actor, sessionExpiresAt: sessionExp, mediaRoot: root });
  const url = new URL(signed[0].msgContext.image.link);
  const grant = url.pathname.split('/').pop();
  const claims = jwt.verify(grant, key, { algorithms: ['HS256'], issuer: '7network', audience: 'inbox-media' });
  assert.equal(url.origin, origin);
  assert.equal(claims.ownerUid, 'owner-7');
  assert.equal(claims.chatId, 'chat-7');
  assert.equal(claims.filename, 'photo.jpg');
  assert.equal(claims.actorType, 'agents');
  assert.equal(claims.actorUid, 'agent-17');
  assert.equal(claims.sessionExp, sessionExp);
  assert.equal(claims.exp - claims.iat, media.GRANT_TTL_SECONDS);
  assert.equal(signed[0].msgContext.image.caption, 'Synthetic');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('signed media delivery rechecks actor, Inbox assignment, live references and byte ranges', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '7network-inbox-media-route-'));
  const mediaRoot = path.join(root, 'media');
  const conversationRoot = path.join(root, 'conversations', 'inbox');
  fs.mkdirSync(mediaRoot, { recursive: true });
  fs.mkdirSync(conversationRoot, { recursive: true });
  const ownerUid = 'owner-7';
  media.savePrivateMedia({ mediaRoot, ownerUid, filename: 'photo.jpg', bytes: Buffer.from('0123456789') });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const key = Buffer.from('synthetic inbox media signing key');
  const chatId = 'chat-7';
  const actor = { id: 17, uid: 'agent-17', role: 'agent', isAgent: true, owner_uid: ownerUid, is_active: 1, email: 'agent@example.test', password: 'synthetic-hash' };
  let assignmentActive = true;
  let databaseReference = true;
  let delegatedSessionActive = true;
  let actorReads = 0;
  const query = async (sql, params = []) => {
    if (sql.includes('FROM sx_sessions')) return delegatedSessionActive ? [{ id: params[0] }] : [];
    if (sql.includes('FROM agents')) {
      actorReads++;
      assert.deepEqual(params, [actor.id, actor.uid, ownerUid, 'agent']);
      return [actor];
    }
    if (sql.includes('FROM beta_conversation')) return databaseReference ? [{}] : [];
    if (sql.includes('FROM beta_chats') || sql.includes('FROM chats')) return [];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const access = {
    resolveInboxScope: async (_query, currentActor, event) => {
      assert.equal(event, 'load_conversation');
      assert.equal(currentActor.uid, actor.uid);
      return { uid: ownerUid, canonical: false, assignedOnly: true };
    },
    authorizeInboxPayload: async (_query, scope, event, payload) => {
      assert.equal(scope.uid, ownerUid);
      assert.equal(event, 'load_conversation');
      assert.equal(payload.chat.chat_id, chatId);
      if (!assignmentActive) throw Object.assign(new Error('denied'), { code: 'TEAM_INBOX_PERMISSION_DENIED' });
    },
  };
  const app = express();
  app.use('/api/inbox-media', media.createRouter({ query, key, mediaRoot, conversationRoot, access }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const grantUrl = media.issueGrant({
    key, origin: base, ownerUid, chatId, filename: 'photo.jpg', actor, agent: true,
  });

  const response = await fetch(grantUrl);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(await response.text(), '0123456789');
  const range = await fetch(grantUrl, { headers: { Range: 'bytes=2-5' } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), '2345');

  const altered = `${grantUrl.slice(0, -1)}${grantUrl.endsWith('A') ? 'B' : 'A'}`;
  assert.equal((await fetch(altered)).status, 404, 'tampered grants are rejected');
  assignmentActive = false;
  assert.equal((await fetch(grantUrl)).status, 404, 'revoked assignment is rechecked on delivery');
  assignmentActive = true;
  databaseReference = false;
  assert.equal((await fetch(grantUrl)).status, 404, 'removed conversation references revoke the media grant');
  assert.ok(actorReads >= 4);

  databaseReference = true;
  assignmentActive = true;
  actor.password = 'new-synthetic-hash';
  assert.equal((await fetch(grantUrl)).status, 404, 'credential changes revoke existing media grants');
  actor.password = 'synthetic-hash';
  const delegatedUrl = media.issueGrant({
    key, origin: base, ownerUid, chatId, filename: 'photo.jpg', actor, agent: true,
    delegatedSessionId: 'synthetic-session-17',
  });
  assert.equal((await fetch(delegatedUrl)).status, 200);
  delegatedSessionActive = false;
  assert.equal((await fetch(delegatedUrl)).status, 404, 'revoked delegated sessions cannot reuse a media URL');

  const expired = jwt.sign({
    purpose: 'inbox-media', ownerUid, chatId, filename: 'photo.jpg', actorType: 'agents',
    actorId: actor.id, actorUid: actor.uid, iat: 1, exp: 2,
  }, key, { algorithm: 'HS256', issuer: '7network', audience: 'inbox-media' });
  assert.equal((await fetch(`${base}/api/inbox-media/${expired}`)).status, 404);
});

test('legacy JSON references keep a file reachable while the media record remains in Inbox history', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '7network-inbox-media-json-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ownerUid = 'owner-7';
  const chatId = 'chat-7';
  const directory = path.join(root, ownerUid);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${chatId}.json`), JSON.stringify([{
    type: 'image',
    msgContext: { image: { link: 'https://crm.example.test/meta-media/photo.jpg' } },
  }]));
  const query = async () => [];
  assert.equal(await media.hasMediaReference(query, {
    conversationRoot: root, ownerUid, chatId, filename: 'photo.jpg', origin: 'https://crm.example.test',
  }), true);
  fs.rmSync(path.join(directory, `${chatId}.json`));
  assert.equal(await media.hasMediaReference(query, {
    conversationRoot: root, ownerUid, chatId, filename: 'photo.jpg', origin: 'https://crm.example.test',
  }), false);
});

test('identical filenames are stored in owner-isolated private directories hidden from static serving', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '7network-inbox-media-collision-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  media.savePrivateMedia({ mediaRoot: root, ownerUid: 'owner-a', filename: 'same.jpg', bytes: Buffer.from('tenant-a') });
  media.savePrivateMedia({ mediaRoot: root, ownerUid: 'owner-b', filename: 'same.jpg', bytes: Buffer.from('tenant-b') });
  const fileA = media.safeMediaFile(root, 'owner-a', 'same.jpg');
  const fileB = media.safeMediaFile(root, 'owner-b', 'same.jpg');
  assert.notEqual(fileA, fileB);
  assert.equal(fs.readFileSync(fileA, 'utf8'), 'tenant-a');
  assert.equal(fs.readFileSync(fileB, 'utf8'), 'tenant-b');
  assert.equal(fs.existsSync(path.join(root, 'same.jpg')), false, 'private files are not exposed through the legacy public root');
  const app = express();
  app.use('/meta-media', express.static(root));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const privatePath = path.relative(root, fileA).split(path.sep).map(encodeURIComponent).join('/');
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/meta-media/${privatePath}`)).status, 404);
});

test('signed delivery isolates two tenants that use the same media filename', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '7network-inbox-media-tenant-collision-'));
  const mediaRoot = path.join(root, 'media');
  const conversationRoot = path.join(root, 'conversations', 'inbox');
  fs.mkdirSync(mediaRoot, { recursive: true });
  fs.mkdirSync(conversationRoot, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const actors = [
    { id: 1, uid: 'owner-a', role: 'user', password: 'a-hash' },
    { id: 2, uid: 'owner-b', role: 'user', password: 'b-hash' },
  ];
  for (const [index, actor] of actors.entries()) {
    media.savePrivateMedia({ mediaRoot, ownerUid: actor.uid, filename: 'collision.jpg', bytes: Buffer.from(`tenant-${index ? 'b' : 'a'}`) });
  }
  const key = Buffer.from('synthetic inbox media signing key');
  const references = new Set(['owner-a:chat-a', 'owner-b:chat-b']);
  const query = async (sql, params = []) => {
    if (sql.includes('FROM user')) return actors.filter(actor => actor.id === params[0] && actor.uid === params[1]);
    if (sql.includes('FROM beta_conversation')) return references.has(`${params[0]}:${params[1]}`) ? [{}] : [];
    if (sql.includes('FROM beta_chats') || sql.includes('FROM chats')) return [];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const access = {
    resolveInboxScope: async (_query, actor) => ({ uid: actor.uid, canonical: false }),
    authorizeInboxPayload: async (_query, scope, _event, payload) => {
      if (!references.has(`${scope.uid}:${payload.chat.chat_id}`)) throw Object.assign(new Error('denied'), { code: 'TEAM_INBOX_PERMISSION_DENIED' });
    },
  };
  const app = express();
  app.use('/api/inbox-media', media.createRouter({ query, key, mediaRoot, conversationRoot, access }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const responseTexts = [];
  for (const [index, actor] of actors.entries()) {
    const chatId = `chat-${index ? 'b' : 'a'}`;
    const url = media.issueGrant({ key, origin, ownerUid: actor.uid, chatId, filename: 'collision.jpg', actor });
    const response = await fetch(url);
    assert.equal(response.status, 200);
    responseTexts.push(await response.text());
  }
  assert.deepEqual(responseTexts, ['tenant-a', 'tenant-b']);
});
