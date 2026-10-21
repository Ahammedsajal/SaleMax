const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const validateUser = require("../middlewares/user.js");
const inboxScope = require('../modules/platform/team-inbox-scope');
const aiContract = require('../modules/platform/ai-assistant-contract');
const aiAccess = require('../modules/platform/legacy-module-access').createLegacyModuleAccess({
  pool: require('../database/config.js').promise(),
  capability: 'messaging.inbox',
  permission: 'conversations.reply',
});
const validateAssistantUser = (req, res, next) => validateUser(req, res, error => {
  if (error) return next(error);
  return aiAccess(req, res, next);
});
const {
  getRecentMessages,
  suggestReplyWithOpenAI,
  suggestReplyWithGemini,
  suggestReplyWithDeepseek,
  translateWithOpenAI,
  translateWithGemini,
  translateWithDeepseek,
} = require("../functions/function.js");

// Custom check function
const check = (field, message) => {
  return {
    field,
    message,
    notEmpty: function () {
      return this;
    },
  };
};

// Custom validationResult function
const validationResult = (req) => {
  return {
    isEmpty: () => !req.validationErrors || req.validationErrors.length === 0,
    array: () => req.validationErrors || [],
  };
};

// Validation middleware
const validate = (validations) => {
  return (req, res, next) => {
    const errors = [];

    validations.forEach((validation) => {
      const value = req.body?.[validation.field];
      if (!value || (typeof value === "string" && value.trim() === "")) {
        errors.push({
          field: validation.field,
          msg: validation.message,
        });
      }
    });

    req.validationErrors = errors;
    next();
  };
};

router.post(
  "/translate",
  validate([
    check("text", "Text is required").notEmpty(),
    check("targetLanguage", "Target language is required").notEmpty(),
    check("provider", "AI provider is required").notEmpty(),
    check("apiKey", "API key is required").notEmpty(),
  ]),
  validateAssistantUser,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    let input;
    try { input = aiContract.translationInput(req.body); }
    catch { return res.status(400).json({ success: false, code: 'INVALID_AI_REQUEST', msg: 'Please check the text, language, and AI provider settings.' }); }
    const { text, targetLanguage, provider, apiKey } = input;

    try {
      let translatedText = "";

      switch (provider) {
        case "openai":
          translatedText = await translateWithOpenAI(
            text,
            targetLanguage,
            apiKey
          );
          break;
        case "gemini":
          translatedText = await translateWithGemini(
            text,
            targetLanguage,
            apiKey
          );
          break;
        case "deepseek":
          translatedText = await translateWithDeepseek(
            text,
            targetLanguage,
            apiKey
          );
          break;
        default:
          return res.json({
            success: false,
            msg: "Unsupported AI provider",
          });
      }

      return res.json({
        success: true,
        translatedText,
      });
    } catch (error) {
      console.error("Translation provider request failed");
      return res.status(502).json({
        success: false,
        code: 'AI_PROVIDER_REQUEST_FAILED',
        msg: 'Translation is unavailable right now. Please try again. [AI_PROVIDER_REQUEST_FAILED]',
      });
    }
  }
);

router.post(
  "/suggest_reply",
  validate([
    check("chatId", "Chat ID is required").notEmpty(),
    check("provider", "AI provider is required").notEmpty(),
    check("apiKey", "API key is required").notEmpty(),
  ]),
  validateAssistantUser,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    let input;
    try { input = aiContract.replyInput(req.body); }
    catch { return res.status(400).json({ success: false, code: 'INVALID_AI_REQUEST', msg: 'Please check the conversation and AI provider settings.' }); }
    const { chatId, lastMessage, provider, apiKey } = input;
    const { uid } = req.decode;

    try {
      const inboxUser = { ...req.decode.userData, uid, isAgent: req.decode.role === 'agent' || req.decode.userData?.role === 'agent' };
      const scope = await inboxScope.resolveInboxScope(query, inboxUser, 'suggest_reply');
      await inboxScope.authorizeInboxPayload(query, scope, 'suggest_reply', { chatId });
    } catch (error) {
      if (error.code === 'TEAM_INBOX_PERMISSION_DENIED') {
        return res.status(403).json({ success: false, code: 'CONVERSATION_ACCESS_DENIED', msg: 'You can’t create a reply for this conversation. [CONVERSATION_ACCESS_DENIED]' });
      }
      console.error('AI conversation access check failed');
      return res.status(503).json({ success: false, code: 'AI_CONTEXT_UNAVAILABLE', msg: 'We can’t check this conversation right now. Please try again. [AI_CONTEXT_UNAVAILABLE]' });
    }

    try {
      // Get recent conversation messages for context
      const recentMessages = await getRecentMessages(chatId, uid, 5);

      let suggestion = "";

      switch (provider) {
        case "openai":
          suggestion = await suggestReplyWithOpenAI(
            recentMessages,
            lastMessage,
            apiKey
          );
          break;
        case "gemini":
          suggestion = await suggestReplyWithGemini(
            recentMessages,
            lastMessage,
            apiKey
          );
          break;
        case "deepseek":
          suggestion = await suggestReplyWithDeepseek(
            recentMessages,
            lastMessage,
            apiKey
          );
          break;
        default:
          return res.json({
            success: false,
            msg: "Unsupported AI provider",
          });
      }

      return res.json({
        success: true,
        suggestion,
      });
    } catch (error) {
      console.error("AI reply suggestion request failed");
      return res.status(502).json({
        success: false,
        code: 'AI_PROVIDER_REQUEST_FAILED',
        msg: 'A reply suggestion is unavailable right now. Please try again. [AI_PROVIDER_REQUEST_FAILED]',
      });
    }
  }
);

module.exports = router;
