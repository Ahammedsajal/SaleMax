const router = require("express").Router();
const validateUser = require("../middlewares/user.js");
const dbPool = require('../database/config').promise();
const { getRecentMessages } = require("../functions/function.js");
const businessSessions = require('../modules/platform/business-feature-session');
const tenantAiText = require('../modules/platform/tenant-ai-text');

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

async function tenantIdFor(req) {
  const actor = req.decode?.userData;
  if (!actor) throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED', status: 401 });
  const session = await businessSessions.resolve(dbPool, {
    actor,
    agent: actor.role === 'agent',
    owner: req.owner,
  });
  if (!session.context?.tenant?.id) throw Object.assign(new Error('AI_TENANT_CONTEXT_REQUIRED'), { code: 'AI_TENANT_CONTEXT_REQUIRED', status: 403 });
  return session.context.tenant.id;
}

function sendAiError(res, error) {
  const code = error.code || 'AI_PROVIDER_REQUEST_FAILED';
  const status = Number.isInteger(error.status) ? error.status : 502;
  return res.status(status).json({ success: false, code, msg: code });
}

// Validation middleware
const validate = (validations) => {
  return (req, res, next) => {
    const errors = [];

    validations.forEach((validation) => {
      const value = req.body[validation.field];
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
  ]),
  validateUser,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const translated = await tenantAiText.generate({ pool: dbPool, tenantId: await tenantIdFor(req), mode: 'translation', text: req.body.text, targetLanguage: req.body.targetLanguage });
      return res.json({
        success: true,
        translatedText: translated.text,
      });
    } catch (error) {
      return sendAiError(res, error);
    }
  }
);

router.post(
  "/suggest_reply",
  validate([
    check("chatId", "Chat ID is required").notEmpty(),
  ]),
  validateUser,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { chatId, lastMessage } = req.body;
    const { uid } = req.decode;

    try {
      // Get recent conversation messages for context
      const recentMessages = await getRecentMessages(chatId, uid, 5);
      const latestInbound = [...recentMessages].reverse().find(item => item.route === 'INCOMING' || item.role === 'user');
      const latestText = typeof lastMessage === 'string' && lastMessage.trim() ? lastMessage : latestInbound?.text;
      const suggested = await tenantAiText.generate({ pool: dbPool, tenantId: await tenantIdFor(req), mode: 'suggestion', text: latestText, history: recentMessages });
      return res.json({
        success: true,
        suggestion: suggested.text,
      });
    } catch (error) {
      return sendAiError(res, error);
    }
  }
);

module.exports = router;
