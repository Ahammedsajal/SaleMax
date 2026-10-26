'use strict';

const fs = require('node:fs');
const path = require('node:path');

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) {
    if (source.includes(after)) return source;
    throw new Error(`CHATBOT_TURN_GUARD_PATCH_TARGET_MISSING:${label}`);
  }
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`CHATBOT_TURN_GUARD_PATCH_TARGET_AMBIGUOUS:${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function apply(root = '/app') {
  const inboxPath = path.join(root, 'helper/inbox/inbox.js');
  let inbox = fs.readFileSync(inboxPath, 'utf8');
  inbox = replaceOnce(inbox,
    `      // Process the message through the flow builder\n      await processWebhook(latestConversation?.newMessage, user);\n\n      let configuredBot = { handled: false };`,
    `      let configuredBot = { handled: false };`, 'inbox-configured-first');
  inbox = replaceOnce(inbox,
    `      if (!configuredBot?.handled) {\n        await processAutomation({`,
    `      if (!configuredBot?.handled) {\n        // Run both legacy fallbacks only when no configured bot owns this chat.\n        await processWebhook(latestConversation?.newMessage, user);\n        await processAutomation({`, 'inbox-legacy-fallback');
  fs.writeFileSync(inboxPath, inbox);

  const runtimePath = path.join(root, 'modules/platform/chatbot-runtime.js');
  let runtime = fs.readFileSync(runtimePath, 'utf8');
  runtime = replaceOnce(runtime,
    `        return aiTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo });\n      });\n      if (!turnLock.acquired)`,
    `        return aiTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo });\n      }, { onOverflow: async () => {\n        if (!await shouldPause(uid, chatId, channelKind, sessionId)) {\n          await handoffConversation(ctx, chatId, channelKind, sessionId, 'concurrent-message-burst', profile, uid);\n        }\n      } });\n      if (!turnLock.acquired)`, 'configured-bot-overflow-handoff');
  fs.writeFileSync(runtimePath, runtime);
  return { inbox: inboxPath, runtime: runtimePath };
}

if (require.main === module) {
  try { apply(process.argv[2] || '/app'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { apply };
