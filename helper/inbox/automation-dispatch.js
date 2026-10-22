'use strict';

async function dispatch({
  uid, message, user, sessionId, configuredSessionId, origin, chatId, db,
  reconcileConversation, processWebhook, runConfiguredBot, processAutomation,
  notifyBotSent, logger = console,
}) {
  let openingRoute = null;
  if (['qr', 'meta'].includes(origin) && message?.route === 'INCOMING') {
    try {
      openingRoute = await reconcileConversation(db, { uid, chatId });
    } catch (error) {
      logger.warn('Opening routing sync unavailable:', error.code || error.name);
    }
  }

  // A keyword-routed enquiry belongs to its assigned human agent. Do not send
  // a second response from legacy flows or automated bots for the same turn.
  if (openingRoute?.routed) return { routed: true, configuredBot: { handled: false } };

  await processWebhook(message, user);

  let configuredBot = { handled: false };
  try {
    configuredBot = await runConfiguredBot({ uid, message, user, sessionId: configuredSessionId || sessionId, origin, chatId });
  } catch (error) {
    // A missing/unavailable additive chatbot schema must not interrupt the
    // legacy automation flow for existing accounts.
    logger.warn('Configured chatbot runtime unavailable; preserving legacy flow dispatch.', error.code || 'CHATBOT_RUNTIME_ERROR');
  }

  if (!configuredBot?.handled) {
    await processAutomation({ uid, message, user, sessionId, origin, chatId });
  }
  if (configuredBot?.sent && chatId) await notifyBotSent(chatId);
  return { routed: false, configuredBot };
}

module.exports = { dispatch };
