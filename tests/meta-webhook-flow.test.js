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

test('delivery status callbacks update logs only after resolving and passing the tenant UID',()=>{
  const inbox=read('routes/inbox.js');
  const embedStart=inbox.indexOf('router.post("/embed/webhook/:uid"');
  const embedEnd=inbox.indexOf('// adding webhook',embedStart);
  const embed=inbox.slice(embedStart,embedEnd);
  assert.ok(embed.indexOf('if (!userUID) return;')<embed.indexOf('uid: userUID'));
  assert.match(embed,/updateWebhookStatuses\(\{[\s\S]*?uid: userUID,[\s\S]*?updateCampaignMessageStatus: updateMessageStatus/);

  const handlerStart=inbox.indexOf('async function handleMessages(change, uid, body)');
  const handlerEnd=inbox.indexOf('// Save message',handlerStart);
  const handler=inbox.slice(handlerStart,handlerEnd);
  assert.match(handler,/updateWebhookStatuses\(\{[\s\S]*?\n\s*uid,[\s\S]*?updateCampaignMessageStatus: updateMessageStatus/);
  assert.ok(handler.indexOf('if (checkNumber !== myNumberId)')<handler.indexOf('updateWebhookStatuses('));

  const functions=read('functions/function.js');
  assert.match(functions,/UPDATE beta_campaign_logs SET delivery_status = \?, error_message = \? WHERE uid = \? AND meta_msg_id = \?/);
  assert.match(functions,/UPDATE beta_campaign_logs SET delivery_status = \? WHERE uid = \? AND meta_msg_id = \?/);
  const campaignWorker=read('loops/campaignBeta.js');
  assert.match(campaignWorker,/findCampaignLog\(\{ query, uid, messageId: metaMsgId \}\)/);
  assert.match(campaignWorker,/WHERE campaign_id = \? AND uid = \?`/);
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
