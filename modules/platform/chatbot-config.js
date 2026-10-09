'use strict';

const ENGINES = new Set(['guided', 'hybrid', 'ai']);
const { getDomainPack } = require('./chatbot-domain-packs');
const { normalizeAudience } = require('./chatbot-audience');

function cleanText(value, max, code) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > max) throw Object.assign(new Error(code), { code });
  return value.trim();
}

function botRequirements(engine, config = {}) {
  return {
    requiresGuidedFlow: (engine === 'guided' || engine === 'hybrid') && config.guidedMode !== 'domain_default',
    requiresAi: engine === 'ai' || (engine === 'hybrid' && config.aiFallback !== false),
  };
}

function supportsAiPreview(engine, config = {}) {
  return engine === 'ai' || (engine === 'hybrid' && config.aiFallback !== false);
}

function isGuidedChoice(value) {
  return /^(?:[1-9]|[1-9]\d|yes|no|menu|back|نعم|لا|القائمة|رجوع)$/i.test(String(value || '').trim());
}

function hybridTurnPlan({ hasSession, isChoice, aiFallback, domainDefault = false, shouldStartGuided = false }) {
  if (domainDefault) return { runGuided: aiFallback === false || isChoice || shouldStartGuided, allowAiFallback: aiFallback !== false };
  return { runGuided: !hasSession || isChoice || aiFallback === false, allowAiFallback: aiFallback !== false };
}

function normalizeGuidedContent(value, pack) {
  const defaults = pack?.guidedContentDefaults;
  if (!defaults || typeof defaults !== 'object') throw Object.assign(new Error('CATEGORY_GUIDED_CONTENT_UNAVAILABLE'), { code: 'CATEGORY_GUIDED_CONTENT_UNAVAILABLE' });
  if (value != null && (typeof value !== 'object' || Array.isArray(value))) throw Object.assign(new Error('INVALID_GUIDED_CONTENT'), { code: 'INVALID_GUIDED_CONTENT' });
  const fields = new Map((pack.guidedContentSchema?.groups || []).flatMap(group => group.fields || []).map(field => [field.path, field]));
  function visit(source, fallback, path) {
    if (typeof fallback === 'string') {
      if (source == null) return fallback;
      const field = fields.get(path) || fields.get(path.replace(/\.(?:en|ar)$/, ''));
      const maxLength = Number.isSafeInteger(field?.maxLength) ? field.maxLength : 600;
      if (typeof source !== 'string' || source.length > maxLength) throw Object.assign(new Error('INVALID_GUIDED_CONTENT'), { code: 'INVALID_GUIDED_CONTENT' });
      return source.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
    }
    if (typeof fallback === 'boolean') {
      if (source == null) return fallback;
      if (typeof source !== 'boolean') throw Object.assign(new Error('INVALID_GUIDED_CONTENT'), { code: 'INVALID_GUIDED_CONTENT' });
      return source;
    }
    if (typeof fallback === 'number') {
      const field = fields.get(path);
      if (!field || source == null) return fallback;
      if (!Number.isSafeInteger(source) || source < field.min || source > field.max) throw Object.assign(new Error('INVALID_GUIDED_CONTENT'), { code: 'INVALID_GUIDED_CONTENT' });
      return source;
    }
    if (!fallback || typeof fallback !== 'object' || Array.isArray(fallback)) return fallback;
    if (source != null && (typeof source !== 'object' || Array.isArray(source))) throw Object.assign(new Error('INVALID_GUIDED_CONTENT'), { code: 'INVALID_GUIDED_CONTENT' });
    return Object.fromEntries(Object.entries(fallback).map(([key, child]) => [key, visit(source?.[key], child, path ? `${path}.${key}` : key)]));
  }
  return visit(value, defaults, '');
}

function botInput(input, categoryKey, categoryVersion = 1) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('INVALID_BOT'), { code: 'INVALID_BOT' });
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120) throw Object.assign(new Error('INVALID_BOT_NAME'), { code: 'INVALID_BOT_NAME' });
  if (!ENGINES.has(input.engine)) throw Object.assign(new Error('INVALID_BOT_ENGINE'), { code: 'INVALID_BOT_ENGINE' });
  const source = input.config;
  if (!source || typeof source !== 'object' || Array.isArray(source) || Buffer.byteLength(JSON.stringify(source)) > 32000) throw Object.assign(new Error('INVALID_BOT_CONFIG'), { code: 'INVALID_BOT_CONFIG' });
  const config = { domainPack: categoryKey, language: ['en', 'ar', 'en_ar'].includes(source.language) ? source.language : 'en_ar' };
  const audience = normalizeAudience(source.allowedRecipientPhones);
  if (audience !== undefined) config.allowedRecipientPhones = audience;
  if (input.engine === 'guided') {
    if (source.flowId != null && (typeof source.flowId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(source.flowId))) throw Object.assign(new Error('INVALID_FLOW_ID'), { code: 'INVALID_FLOW_ID' });
    config.flowId = source.flowId || null;
    config.guidedMode = config.flowId ? 'automation_flow' : (source.guidedMode === 'domain_default' ? 'domain_default' : null);
    config.welcomeMessage = cleanText(source.welcomeMessage, 1200, 'INVALID_WELCOME_MESSAGE');
    config.fallbackMessage = cleanText(source.fallbackMessage, 1200, 'INVALID_FALLBACK_MESSAGE');
  } else {
    config.instructions = cleanText(source.instructions, 4000, 'INVALID_INSTRUCTIONS');
    config.confidenceThreshold = source.confidenceThreshold == null ? 0.72 : Number(source.confidenceThreshold);
    if (!Number.isFinite(config.confidenceThreshold) || config.confidenceThreshold < 0.5 || config.confidenceThreshold > 0.95) throw Object.assign(new Error('INVALID_CONFIDENCE_THRESHOLD'), { code: 'INVALID_CONFIDENCE_THRESHOLD' });
    config.handoff = source.handoff !== false;
    if (!Array.isArray(source.knowledgeEntries ?? []) || (source.knowledgeEntries ?? []).length > 60) throw Object.assign(new Error('INVALID_KNOWLEDGE_ENTRIES'), { code: 'INVALID_KNOWLEDGE_ENTRIES' });
    config.knowledgeEntries = (source.knowledgeEntries ?? []).map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Object.assign(new Error('INVALID_KNOWLEDGE_ENTRY'), { code: 'INVALID_KNOWLEDGE_ENTRY' });
      return { questionEn: cleanText(entry.questionEn, 400, 'INVALID_KNOWLEDGE_ENTRY'), questionAr: cleanText(entry.questionAr, 400, 'INVALID_KNOWLEDGE_ENTRY'), answerEn: cleanText(entry.answerEn, 1600, 'INVALID_KNOWLEDGE_ENTRY'), answerAr: cleanText(entry.answerAr, 1600, 'INVALID_KNOWLEDGE_ENTRY') };
    });
    config.aiDataProcessingConfirmed = source.aiDataProcessingConfirmed === true;
    config.flowId = null;
    if (input.engine === 'hybrid') {
      if (source.flowId != null && (typeof source.flowId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(source.flowId))) throw Object.assign(new Error('INVALID_FLOW_ID'), { code: 'INVALID_FLOW_ID' });
      config.flowId = source.flowId || null;
      config.guidedMode = config.flowId ? 'automation_flow' : (source.guidedMode === 'domain_default' ? 'domain_default' : null);
      config.aiFallback = source.aiFallback !== false;
    }
  }
  if (categoryKey === 'training_center') {
    if ((input.engine === 'guided' || input.engine === 'hybrid') && !config.flowId && config.guidedMode !== 'domain_default') config.guidedMode = 'domain_default';
    config.workflow = source.workflow === 'course_enquiry' ? 'course_enquiry' : 'course_admissions';
    config.collect = ['name', 'course_interest', 'preferred_schedule', 'phone', 'consent'];
  }
  const domainPack = getDomainPack(categoryKey, categoryVersion);
  if (config.guidedMode === 'domain_default' && (!domainPack.guidedReply || !domainPack.guidedContentDefaults)) throw Object.assign(new Error('CATEGORY_GUIDED_FLOW_UNAVAILABLE'), { code: 'CATEGORY_GUIDED_FLOW_UNAVAILABLE' });
  if (domainPack.guidedContentDefaults && (config.guidedMode === 'domain_default' || source.guidedContent != null)) config.guidedContent = normalizeGuidedContent(source.guidedContent, domainPack);
  return { name: input.name.trim(), engine: input.engine, config };
}

module.exports = { ENGINES, botInput, cleanText, botRequirements, supportsAiPreview, isGuidedChoice, hybridTurnPlan, normalizeGuidedContent };
