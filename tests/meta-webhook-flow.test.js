'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('both SaleMaX process entrypoints parse Meta callbacks without a global app-secret gate', () => {
  for (const file of ['app.js', 'server.js']) {
    const source = read(file);
    assert.match(source, /express\.json\(\{\s*limit:\s*["']10mb["']\s*\}\)/);
    assert.doesNotMatch(source, /meta-webhook-signature|captureRawBody/);
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
