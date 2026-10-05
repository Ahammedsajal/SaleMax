'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const admin = read('client/public/chatbot-admin.js');
const sidebar = read('client/public/training-sidebar.js');
const indexPath = path.join(__dirname, '..', 'client/public/index.html');
const index = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
const chatbotRouter = read('modules/platform/chatbot-router.js');

test('existing Automation Flows canvas remains the first pill tab', () => {
  const definitions = admin.match(/const definitions = \[([\s\S]*?)\];/)?.[1] || '';
  assert.match(definitions, /\['legacy',\s*tr\('Automation Flows'/);
  assert.ok(definitions.indexOf("['legacy'") < definitions.indexOf("['guided'") );
});

test('Chatbot page is the only assignment surface and keeps the legacy WA chatbot accessible', () => {
  assert.match(admin, /function isAssignmentPage\(\)/);
  assert.match(admin, /id="sx-open-legacy-chatbot"/);
  assert.match(admin, /data-manage-assignment/);
  assert.match(admin, /id="sx-open-assignments"/);
  assert.match(admin, /api\(`\/\$\{bot\.id\}\/channels`, 'PUT'/);
  const flowsList = admin.slice(admin.indexOf('function panelMarkup('), admin.indexOf('async function refresh('));
  assert.doesNotMatch(flowsList, /WhatsApp Number|bot\.channels/);
  const editor = admin.slice(admin.indexOf('function openEditor('), admin.indexOf('function conversationId('));
  assert.doesNotMatch(editor, /name="channel"|input\[name=channel\]|\/channels`,'PUT'/);
  assert.match(editor, /assign its number from the Chatbot page/);
});

test('runtime writes bounded stage and code diagnostics for failed bot turns', () => {
  const runtime = read('modules/platform/chatbot-runtime.js');
  const migration = read('database/migrations/20261101_chatbot_turn_diagnostics.sql');
  assert.match(runtime, /error_stage=\?,error_code=\?/);
  assert.match(runtime, /console\.warn\('\[chatbot\] turn failed'/);
  assert.match(runtime, /guided_session_read/);
  assert.match(runtime, /channel_send/);
  assert.match(migration, /ADD COLUMN error_stage VARCHAR\(64\)/);
  assert.match(migration, /ADD COLUMN error_code VARCHAR\(64\)/);
});

test('bot editor renders editable bilingual training-center guide fields', () => {
  assert.match(admin, /guidedContentMarkup\(config, selectedDomainGuide\)/);
  assert.match(admin, /English<textarea/);
  assert.match(admin, /العربية<textarea/);
  assert.match(admin, /guidedContent:\$\{esc\(field\.path\)\}:en/);
  assert.match(admin, /guidedContent:\$\{esc\(field\.path\)\}:ar/);
  assert.match(admin, /function faqEditorMarkup\(config\)/);
  assert.match(admin, /function collectFaqEntries\(editor\)/);
  assert.match(admin, /Each FAQ language needs both a question and an answer/);
  assert.match(admin, /settings exceed the 32 KB limit/i);
  assert.doesNotMatch(admin, /input\[name=channel\]:checked/);
  assert.doesNotMatch(admin, /api\(`\/\$\{id\}\/channels`/);
});

test('bot assignments display connected channel labels instead of internal IDs', () => {
  assert.match(chatbotRouter, /JSON_EXTRACT\(embed_data,'\$\.phoneDetails\.display_phone_number'\)/);
  assert.doesNotMatch(chatbotRouter, /phoneDetails\.verified_name/);
  assert.match(chatbotRouter, /SELECT uniqueId AS reference,number AS label FROM instance/);
  assert.match(chatbotRouter, /SELECT uniqueId AS reference,number AS label FROM instance WHERE uid=\? AND status='ACTIVE'/);
  assert.match(chatbotRouter, /uniqueId AS id FROM instance WHERE uid=\? AND uniqueId=\? AND status='ACTIVE'/);
  assert.match(admin, /function channelLabel\(channel\)/);
  assert.match(admin, /Number label unavailable/);
  assert.doesNotMatch(admin, /Meta WhatsApp'\s*:\s*'QR WhatsApp'\)\}\s*·\s*\$\{esc\(c\.reference\)\}/);
});

test('guided editor previews unsaved copy with the authenticated read-only category guide', () => {
  assert.match(admin, /data-guided-preview/);
  assert.match(admin, /collectGuidedContent\(new FormData\(formElement\)\)/);
  assert.match(admin, /does not save the bot, call an AI provider, or send a WhatsApp message/);
  assert.match(admin, /api\('\/guided-preview', 'POST'/);
  assert.match(chatbotRouter, /router\.post\('\/guided-preview'/);
  assert.match(chatbotRouter, /previewGuidedTurn\(\{ body: req\.body, pack, db, tenantId: ctx\.tenant\.id/);
});

test('Inbox bot control requires explicit number selection when channel scope is missing', () => {
  assert.match(admin, /data-sx-chatbot-channel/);
  assert.match(admin, /inboxBotChannelOptions\(\)/);
  assert.match(admin, /filter\(channel => assigned\.has/);
  assert.match(admin, /Choose the number this conversation uses\./);
  assert.match(admin, /\/conversations\/\$\{encodeURIComponent\(id\)\}\/bot-control/);
  assert.match(admin, /manuallySelectedChatChannels\.set\(id, selectedScope\)/);
  assert.match(admin, /manuallySelectedChatChannels\.get\(id\)/);
  assert.match(admin, /manuallySelectedChatChannels\.delete\(id\)/);
});

test('HTML and sidebar cache keys invalidate older chatbot scripts together', { skip: !index }, () => {
  assert.match(index, /training-sidebar\.js\?v=20261102-team-access1/);
  assert.match(sidebar, /chatbot-admin\.js\?v=20261101b/);
});
