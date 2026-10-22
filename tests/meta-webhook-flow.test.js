'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('both 7Network process entrypoints parse Meta callbacks without a global app-secret gate', () => {
  for (const file of ['app.js', 'server.js']) {
    const source = read(file);
    assert.match(source, /express\.json\(\{\s*limit:\s*["']10mb["'],\s*verify:\s*require\(["']\.\/modules\/platform\/meta-webhook-signature["']\)\.captureRawBody\s*\}\)/);
  }

  const inbox = read('routes/inbox.js');
  assert.doesNotMatch(inbox, /verifyMetaWebhookRequest|requireMetaSignature|META_WEBHOOK_SIGNATURE_NOT_CONFIGURED/);
});

test('WhatsApp webhook entrypoints acknowledge Meta without waiting for optional pipeline work', () => {
  const inbox = read('routes/inbox.js');
  const embedStart = inbox.indexOf('router.post("/embed/webhook/:uid"');
  const embedEnd = inbox.indexOf('// adding webhook', embedStart);
  assert.ok(embedStart >= 0 && embedEnd > embedStart);
  const embedRoute = inbox.slice(embedStart, embedEnd);
  assert.ok(embedRoute.indexOf('res.sendStatus(200)') > 0);
  assert.doesNotMatch(embedRoute, /verifyMetaWebhookRequest/);

  const start = inbox.indexOf('router.post("/webhook/:uid"');
  const end = inbox.indexOf('// Helper function to update broadcast contact permission', start);
  assert.ok(start >= 0 && end > start);
  const route = inbox.slice(start, end);
  const acknowledge = route.indexOf('res.sendStatus(200)');
  const pipelineDispatch = route.indexOf('setImmediate(() => {');
  const pipelineCapture = route.indexOf('captureMetaWebhook({ uid: userUID, body })');
  const inboxHandling = route.indexOf('await handleMessages(change, userUID, body)');
  assert.ok(acknowledge >= 0 && pipelineDispatch > acknowledge);
  assert.ok(pipelineCapture > pipelineDispatch && inboxHandling > acknowledge);
  assert.match(route, /Pipeline webhook capture failed; inbox handling continues/);
  assert.doesNotMatch(route, /console\.log\(JSON\.stringify\(\{\s*body\s*\}\)\)/);
});

test('inbox processing still checks the callback phone number against the selected tenant connection', () => {
  const inbox = read('routes/inbox.js');
  assert.match(inbox, /async function handleMessages\(change, uid, body\)/);
  assert.match(inbox, /SELECT \* FROM meta_api WHERE uid = \?/);
  assert.match(inbox, /if \(checkNumber !== myNumberId\)\s*\{\s*console\.log\("⚠️ Phone number mismatch"\);\s*return;/);
});

test('inbox refresh endpoint authenticates and scopes its socket notification to the caller', () => {
  const inbox = read('routes/inbox.js');
  const start = inbox.indexOf('router.get("/", validateUser, async (req, res) => {');
  const end = inbox.indexOf('// sending templets', start);
  assert.ok(start >= 0 && end > start);
  const route = inbox.slice(start, end);
  assert.match(route, /resolveInboxScope\(query, req\.decode\.userData, 'get_chat_list'\)/);
  assert.match(route, /const uid = req\.decode\.actorUid \|\| req\.decode\.uid/);
  assert.match(route, /getConnectionsByUid\(uid\)/);
  assert.match(route, /sendToSocket\(connection\.socketId, "msg", "update_conversations"\)/);
  assert.doesNotMatch(route, /lWvj6K0xI0FlSKJoyV7ak9DN0mzvKJK8|SELECT \* FROM rooms/);
});

test('legacy Meta template reply updates are constrained to the owner UID', () => {
  const functions = read('functions/function.js');
  const start = functions.indexOf('function updateMetaTempletInMsg(');
  const end = functions.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  const helper = functions.slice(start, end);
  assert.match(helper, /UPDATE chats SET last_message_came = \?, last_message = \?, is_opened = \? WHERE chat_id = \? AND uid = \?/);
  assert.match(helper, /\[userTimezone, JSON\.stringify\(savObj\), 0, chatId, uid\]/);
  assert.match(helper, /UPDATE chats SET is_opened = \? WHERE chat_id = \? AND uid = \?/);
  assert.match(helper, /\[\s*1,\s*chatId,\s*uid,?\s*\]/);

  const sendStart = functions.indexOf('function sendMetaMsg(');
  const sendEnd = functions.indexOf('\nfunction ', sendStart + 1);
  assert.ok(sendStart >= 0 && sendEnd > sendStart);
  const sender = functions.slice(sendStart, sendEnd);
  assert.match(sender, /UPDATE chats SET last_message_came = \?, last_message = \?, is_opened = \? WHERE chat_id = \? AND uid = \?/);
  assert.match(sender, /\[userTimezone, JSON\.stringify\(finalSaveMsg\), 1, chatId, uid\]/);
  assert.match(sender, /UPDATE chats SET is_opened = \? WHERE chat_id = \? AND uid = \?/);
  assert.match(sender, /\[\s*1,\s*chatId,\s*uid,?\s*\]/);
});

test('legacy inbox contact and label deletes include the tenant owner UID', () => {
  const socket = read('helper/socket/index.js');
  const labelStart = socket.indexOf('case "on_label_delete":');
  const labelEnd = socket.indexOf('case "set_chat_label":', labelStart);
  assert.ok(labelStart >= 0 && labelEnd > labelStart);
  assert.match(socket.slice(labelStart, labelEnd), /DELETE FROM chat_tags WHERE id = \? AND uid = \?/);

  const contactStart = socket.indexOf('case "del_contact":');
  const contactEnd = socket.indexOf('case "update_spend_time":', contactStart);
  assert.ok(contactStart >= 0 && contactEnd > contactStart);
  const route = socket.slice(contactStart, contactEnd);
  assert.match(route, /const deletionOwnerUid = isAgent \? socket\?\.userData\?\.owner_uid : uid/);
  assert.match(route, /DELETE FROM contact WHERE id = \? AND uid = \?/);
});

test('socket delete handlers pass the authenticated owner UID to both DELETE queries', async () => {
  const modulePaths = [
    '../database/dbpromise',
    '../modules/platform/team-inbox-scope',
    '../modules/platform/delegated-account-session',
    '../helper/socket/function',
    '../functions/function.js',
    '../helper/pipeline/conversationAttendance',
    '../helper/addon/telegram/processTelegramInbox',
    '../helper/socket/index',
  ].map(specifier => require.resolve(specifier));
  const priorModules = new Map(modulePaths.map(filename => [filename, require.cache[filename]]));
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    return [];
  };
  const ownerUid = 'synthetic-tenant-owner';
  const stubs = new Map([
    [modulePaths[0], { query }],
    [modulePaths[1], {
      resolveInboxScope: async () => ({ canonical: true, uid: ownerUid, assignedOnly: false, ctx: { membership: { role: 'owner' } } }),
      authorizeInboxPayload: async (_query, _scope, _event, payload) => payload,
    }],
    [modulePaths[2], { assertDelegatedSession: async () => {} }],
    [modulePaths[3], {}],
    [modulePaths[4], {}],
    [modulePaths[5], {}],
    [modulePaths[6], {}],
  ]);

  try {
    for (const [filename, exports] of stubs) {
      require.cache[filename] = { id: filename, filename, loaded: true, exports };
    }
    delete require.cache[modulePaths[7]];
    const { processSocketEvent } = require('../helper/socket/index');
    const listeners = new Map();
    const socket = {
      userData: { id: 7, uid: ownerUid, role: 'user', isAgent: false },
      decodedToken: { uid: ownerUid },
      on: (event, listener) => listeners.set(event, listener),
      emit: () => {},
    };
    processSocketEvent({ socket });
    await listeners.get('message')({ type: 'on_label_delete', payload: { labelId: 701 } });
    await listeners.get('message')({ type: 'del_contact', payload: { contactId: 902 } });

    assert.deepEqual(calls.filter(call => call.sql.startsWith('DELETE FROM chat_tags')).map(call => call.params), [[701, ownerUid]]);
    assert.deepEqual(calls.filter(call => call.sql.startsWith('DELETE FROM contact')).map(call => call.params), [[902, ownerUid]]);
  } finally {
    for (const filename of modulePaths) {
      if (priorModules.get(filename)) require.cache[filename] = priorModules.get(filename);
      else delete require.cache[filename];
    }
  }
});

test('agent time tracking accepts only short updates for the authenticated agent in its business', () => {
  const socket = read('helper/socket/index.js');
  const start = socket.indexOf('case "update_spend_time":');
  const end = socket.indexOf('case "translate_message":', start);
  assert.ok(start >= 0 && end > start);
  const route = socket.slice(start, end);
  assert.match(route, /!agentAccount/);
  assert.match(route, /agentUidd !== actorUid/);
  assert.match(route, /!Number\.isInteger\(timeSpent\)/);
  assert.match(route, /timeSpent > 5/);
  assert.match(route, /SELECT logs FROM agents WHERE uid = \? AND owner_uid = \? LIMIT 1/);
  assert.match(route, /UPDATE agents SET logs = \? WHERE uid = \? AND owner_uid = \?/);
});

test('legacy V3 Inbox import is owner-only and tenant-scoped through migration deduplication', () => {
  const inbox = read('routes/inbox.js');
  const start = inbox.indexOf('router.get("/import_chats_from_v3", validateUser, async (req, res) => {');
  const end = inbox.indexOf('\nmodule.exports = router;', start);
  assert.ok(start >= 0 && end > start);
  const route = inbox.slice(start, end);
  assert.match(route, /resolveInboxScope\(query, req\.decode\.userData, 'get_chat_list'\)/);
  assert.match(route, /INBOX_IMPORT_OWNER_REQUIRED/);
  assert.match(route, /SELECT \* FROM chats WHERE uid = \?/);
  assert.match(route, /importChatsFromv3\(\{ chatData \}\)/);
  assert.doesNotMatch(route, /SELECT \* FROM chats`/);

  const functions = read('functions/function.js');
  const importStart = functions.indexOf('async function importChatsFromv3(');
  const importEnd = functions.indexOf('\nasync function saveMessageToConversation(', importStart);
  assert.ok(importStart >= 0 && importEnd > importStart);
  assert.match(functions.slice(importStart, importEnd), /`meta_\$\{chat\.sender_mobile\}_\$\{chat\.uid\}`/);
});

test('manual Meta connection subscribes its WABA to the 7Network app', () => {
  const user = read('routes/user.js');
  const start = user.indexOf('router.post("/update_meta"');
  const end = user.indexOf('// update embed meta', start);
  assert.ok(start >= 0 && end > start);
  const route = user.slice(start, end);
  assert.match(route, /await subscribeWabaWebhook\(\{/);
  assert.match(route, /wabaId:\s*waba_id/);
  assert.match(route, /accessToken:\s*access_token/);
  assert.match(route, /webhook_subscribed:\s*true/);
  assert.match(route, /META_WEBHOOK_SUBSCRIPTION_FAILED/);
});

test('Meta WABA subscription sends a POST with the tenant token only as a Bearer header', async () => {
  const { subscribeWabaWebhook } = require('../modules/platform/meta-webhook-subscription');
  let request;
  const result = await subscribeWabaWebhook({
    wabaId: '1490367149599261',
    accessToken: 'test-token-do-not-log',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, text: async () => JSON.stringify({ success: true }) };
    },
  });
  assert.equal(result.subscribed, true);
  assert.equal(result.wabaId, '1490367149599261');
  assert.equal(request.url, 'https://graph.facebook.com/v26.0/1490367149599261/subscribed_apps');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.authorization, 'Bearer test-token-do-not-log');
  assert.doesNotMatch(request.url, /test-token-do-not-log/);
});

test('Meta WABA subscription fails closed on provider rejection without exposing provider data', async () => {
  const { subscribeWabaWebhook } = require('../modules/platform/meta-webhook-subscription');
  await assert.rejects(
    () => subscribeWabaWebhook({
      wabaId: '1490367149599261',
      accessToken: 'test-token-do-not-log',
      fetchImpl: async () => ({ ok: false, text: async () => JSON.stringify({ error: { message: 'sensitive provider detail' } }) }),
    }),
    (error) => {
      assert.equal(error.message, 'Meta rejected the WhatsApp webhook subscription');
      assert.doesNotMatch(error.message, /sensitive provider detail|test-token-do-not-log/);
      return true;
    },
  );
});
