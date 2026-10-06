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

test('WA Chatbot preserves its native list and Add Chatbot assignment dialog', () => {
  assert.match(admin, /if \(isAssignmentPage\(\)\) \{ state\.mounted = false; closeViews\(\); addStyle\(\); mountNativeAssignmentButton\(\); mountNativeProfileList\(\); return false; \}/);
  assert.match(admin, /Keep the existing WA Chatbot page and Add Chatbot layout/);
  assert.match(admin, /function mountNativeAssignmentButton\(\)[\s\S]*?openNativeAssignmentDialog\(\)/);
  const picker = admin.slice(admin.indexOf('async function openNativeAssignmentDialog('), admin.indexOf('function isInboxPage('));
  assert.match(picker, /Select Automation Flow/);
  assert.match(picker, /Search flows\.\.\./);
  assert.match(picker, /Enter webhook title\.\.\./);
  assert.match(picker, /bots\.filter\(bot =>/);
  assert.match(picker, /data-bot-option/);
  assert.match(picker, /renderBotOptions\(true\)/);
  assert.match(picker, /alreadyAssigned \? tr\('This bot is already assigned to this number\.'/);
  assert.doesNotMatch(picker, /Legacy flow setup/);
  assert.match(admin, /async function openNativeAssignmentDialog\(\)[\s\S]*?api\(`\/\$\{bot\.id\}\/channels`, 'PUT'/);
  assert.match(admin, /function isFlowPage\(\)[\s\S]*?return \['automation-flows', 'automation_flows', 'automation', 'chat-flow'\]/);
  assert.match(sidebar, /'WA Chatbot':'chatbot'/);
  assert.match(sidebar, /'WA Chatbot':'wa-chatbot'/);
  assert.match(sidebar, /event\.stopImmediatePropagation\(\); location\.href = '\/user\?page=wa-chatbot'/);
  const editor = admin.slice(admin.indexOf('function openEditor('), admin.indexOf('function conversationId('));
  assert.doesNotMatch(editor, /name="channel"|api\(`\/\$\{id\}\/channels`,'PUT'/);
  assert.doesNotMatch(admin, /<th>\$\{esc\(tr\('WhatsApp Number'/);
});

test('chatbot overlays follow the active SaleMaX dark theme without restyling the legacy canvas', () => {
  assert.match(admin, /function syncChatbotTheme\(\)/);
  assert.match(admin, /localStorage\.getItem\('theme_mode'\)/);
  assert.match(admin, /data-sx-chatbot-theme/);
  assert.match(admin, /html\[data-sx-chatbot-theme="dark"\] #sx-chatbot-tabs/);
  assert.match(admin, /html\[data-sx-chatbot-theme="dark"\] #sx-chatbot-panel/);
  assert.match(admin, /html\[data-sx-chatbot-theme="dark"\] #sx-chatbot-dialog/);
  assert.doesNotMatch(admin, /html\[data-sx-chatbot-theme="dark"\].*\.react-flow/);
});

test('bot editor renders editable bilingual training-center guide fields', () => {
  assert.match(admin, /guidedContentMarkup\(config, selectedDomainGuide\)/);
  assert.match(admin, /English<textarea/);
  assert.match(admin, /العربية<textarea/);
  assert.match(admin, /guidedContent:\$\{esc\(field\.path\)\}:en/);
  assert.match(admin, /guidedContent:\$\{esc\(field\.path\)\}:ar/);
});

test('AI provider, model, usage limit, and confidence use curated dropdown choices', () => {
  assert.match(admin, /<select name="provider"/);
  assert.match(admin, /value="openai"/);
  assert.match(admin, /name="model"[^>]*>\$\{modelChoices\(/);
  assert.doesNotMatch(admin, /<input name="model"/);
  assert.match(admin, /id: 'gpt-6-luna'.*Recommended/);
  assert.match(admin, /id: 'gemini-3\.1-flash-lite'.*Recommended/);
  assert.match(admin, /id: 'deepseek-flash'.*Recommended/);
  assert.match(admin, /name="dailyTokenLimit"[^>]*>\$\{presetChoices\(/);
  assert.match(admin, /<select name="confidenceThreshold"/);
  assert.match(admin, /Saved model:/);
  assert.match(admin, /Prices are estimates in USD per 1 million text tokens/);
});

test('active bot profiles stay editable while provider credentials and sensitive AI settings stay locked', () => {
  assert.match(admin, /data-edit="\$\{esc\(bot\.id\)\}"/);
  assert.doesNotMatch(admin, /data-edit="\$\{esc\(bot\.id\)\}"\s+\$\{bot\.status==='live'\?'disabled/);
  assert.match(admin, /Saved changes take effect on the next incoming message/);
  assert.match(admin, /Provider credentials and usage limits are locked while this bot is active/);
  assert.match(admin, /Pause this bot before changing its AI privacy confirmation/);
  assert.match(admin, /aiDataProcessingConfirmed:liveEdit\?config\.aiDataProcessingConfirmed===true/);
  assert.match(admin, /assign its number from the Chatbot page/);
  assert.match(chatbotRouter, /if \(row\.status === 'live'\) await assertLiveProfileReady/);
  assert.match(chatbotRouter, /appliedImmediately: row\.status === 'live'/);
  assert.match(chatbotRouter, /status='live' AND \(engine='ai' OR \(engine='hybrid'/);
  assert.match(chatbotRouter, /if \(liveAiBot\) fail\('LIVE_BOT_MUST_BE_PAUSED'\)/);
  assert.match(chatbotRouter, /async function assertLiveProfileReady/);
});

test('bot assignments display connected channel labels instead of internal IDs', () => {
  assert.match(chatbotRouter, /JSON_EXTRACT\(embed_data,'\$\.phoneDetails\.display_phone_number'\)/);
  assert.doesNotMatch(chatbotRouter, /phoneDetails\.verified_name/);
  assert.match(chatbotRouter, /SELECT uniqueId AS reference,number AS label FROM instance/);
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
  assert.match(admin, /header\.insertBefore\(control, actions\)/);
  assert.match(admin, /matchMedia\('\(max-width: 767px\)'\)/);
  assert.match(admin, /data-sx-chatbot-mobile-toggle/);
  assert.match(admin, /let lastActiveConversation = null/);
  assert.match(admin, /if \(lastActiveConversation && infoButton\)/);
  assert.match(admin, /header\.parentElement\.insertBefore\(control, header\.nextElementSibling\)/);
  assert.match(admin, /sx-active-chatbot-control\.sx-mobile-open \[data-sx-chatbot-control-body\]\{position:static/);
  assert.doesNotMatch(admin, /position:fixed;z-index:1100;top:82px/);
});

test('HTML and sidebar cache keys invalidate older chatbot scripts together', { skip: !index }, () => {
  assert.match(index, /training-sidebar\.js\?v=20261006-inbox-bot-header3/);
  assert.match(sidebar, /chatbot-admin\.js\?v=20261006-inbox-bot-header3/);
});
