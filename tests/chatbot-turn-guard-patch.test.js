'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { apply } = require('../deploy/patch-chatbot-turn-guard');

test('production overlay routes through one bot owner and hands off burst overflow', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-turn-guard-'));
  const inboxPath = path.join(root, 'helper/inbox/inbox.js');
  const runtimePath = path.join(root, 'modules/platform/chatbot-runtime.js');
  fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
  fs.writeFileSync(inboxPath, `before\n      // Process the message through the flow builder\n      await processWebhook(latestConversation?.newMessage, user);\n\n      let configuredBot = { handled: false };\n      if (!configuredBot?.handled) {\n        await processAutomation({\n          uid,\n        });\n      }\nafter`);
  fs.writeFileSync(runtimePath, `before\n        return aiTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo });\n      });\n      if (!turnLock.acquired)\nafter`);
  apply(root);
  const inbox = fs.readFileSync(inboxPath, 'utf8');
  const runtime = fs.readFileSync(runtimePath, 'utf8');
  assert.ok(inbox.indexOf('let configuredBot') < inbox.indexOf('await processWebhook'));
  assert.match(inbox, /if \(!configuredBot\?\.handled\) \{\n        \/\/ Run both legacy fallbacks only when no configured bot owns this chat\.\n        await processWebhook/);
  assert.match(runtime, /'concurrent-message-burst'/);
  assert.equal((inbox.match(/await processWebhook\(/g) || []).length, 1);
});
