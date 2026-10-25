'use strict';

const ENGINES = new Set(['guided', 'hybrid', 'ai']);
const { getDomainPack } = require('./chatbot-domain-packs');
const { normalizeAudience } = require('./chatbot-audience');

function cleanText(value, max, code) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > max) throw Object.assign(new Error(code), { code });
  return value.trim();
}

function normalizeKnowledgeEntries(entries = []) {
  return entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Object.assign(new Error('INVALID_KNOWLEDGE_ENTRY'), { code: 'INVALID_KNOWLEDGE_ENTRY' });
    return { questionEn: cleanText(entry.questionEn, 400, 'INVALID_KNOWLEDGE_ENTRY'), questionAr: cleanText(entry.questionAr, 400, 'INVALID_KNOWLEDGE_ENTRY'), answerEn: cleanText(entry.answerEn, 1600, 'INVALID_KNOWLEDGE_ENTRY'), answerAr: cleanText(entry.answerAr, 1600, 'INVALID_KNOWLEDGE_ENTRY') };
  });
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
  let compatibleValue=value;
  if(pack?.key==='7network_sales'&&value?.messages&&typeof value.messages==='object'&&value.messages.button7Network==null&&value.messages.buttonSalemax!=null){
    compatibleValue={...value,messages:{...value.messages,button7Network:value.messages.buttonSalemax}};
  }
  const content = visit(compatibleValue, defaults, '');
  content.keywordReplies = normalizeKeywordReplies(value?.keywordReplies);
  return content;
}

function normalizeKeywordReplies(value = []) {
  const invalid = () => { throw Object.assign(new Error('INVALID_KEYWORD_REPLIES'), { code: 'INVALID_KEYWORD_REPLIES' }); };
  if (!Array.isArray(value) || value.length > 30) invalid();
  return value.map(rule => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || !Array.isArray(rule.keywords) || !rule.keywords.length || rule.keywords.length > 20) invalid();
    const keywords = rule.keywords.map(word => {
      if (typeof word !== 'string' || !require('./chatbot-keyword-replies').normalize(word) || word.length > 100) invalid();
      return word.trim();
    });
    if (!['contains', 'exact', 'all'].includes(rule.match || 'contains')) invalid();
    if (rule.enabled != null && typeof rule.enabled !== 'boolean') invalid();
    const reply = {};
    for (const language of ['en', 'ar']) {
      if (rule.reply?.[language] != null && (typeof rule.reply[language] !== 'string' || rule.reply[language].length > 1600)) invalid();
      reply[language] = cleanText(rule.reply?.[language], 1600, 'INVALID_KEYWORD_REPLIES');
    }
    if (!reply.en && !reply.ar) invalid();
    return { enabled: rule.enabled !== false, match: rule.match || 'contains', keywords, reply };
  });
}

function botInput(input, categoryKey, categoryVersion = 1) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('INVALID_BOT'), { code: 'INVALID_BOT' });
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120) throw Object.assign(new Error('INVALID_BOT_NAME'), { code: 'INVALID_BOT_NAME' });
  if (!ENGINES.has(input.engine)) throw Object.assign(new Error('INVALID_BOT_ENGINE'), { code: 'INVALID_BOT_ENGINE' });
  const source = input.config;
  if (!source || typeof source !== 'object' || Array.isArray(source) || Buffer.byteLength(JSON.stringify(source)) > 128000) throw Object.assign(new Error('INVALID_BOT_CONFIG'), { code: 'INVALID_BOT_CONFIG' });
  const config = { domainPack: categoryKey, language: ['en', 'ar', 'en_ar'].includes(source.language) ? source.language : 'en_ar' };
  if (source.salesWorkflow !== undefined) {
    if (source.salesWorkflow !== 'training_center_prospects' || categoryKey !== '7network_sales' || input.engine !== 'guided' || source.guidedMode !== 'domain_default' || source.flowId) {
      throw Object.assign(new Error('INVALID_SALES_WORKFLOW'), { code: 'INVALID_SALES_WORKFLOW' });
    }
    config.salesWorkflow = source.salesWorkflow;
  }
  if (source.captureLeads !== undefined) {
    if (typeof source.captureLeads !== 'boolean') throw Object.assign(new Error('INVALID_BOT_CONFIG'), { code: 'INVALID_BOT_CONFIG' });
    const category = require('./categories').getCategory(categoryKey, categoryVersion);
    if (source.captureLeads && category?.chatbotLeadCapture !== 'generic') throw Object.assign(new Error('BOT_LEAD_CAPTURE_UNAVAILABLE'), { code: 'BOT_LEAD_CAPTURE_UNAVAILABLE' });
    if (category?.chatbotLeadCapture === 'generic') config.captureLeads = source.captureLeads;
  }
  if(source.captureFormId!==undefined){const forms=require('./chatbot-capture-forms');if(!forms.supports({key:categoryKey,version:categoryVersion}))throw Object.assign(new Error('INVALID_CAPTURE_FORM'),{code:'INVALID_CAPTURE_FORM'});config.captureFormId=forms.normalize(source.captureFormId);}
  const audience = normalizeAudience(source.allowedRecipientPhones);
  if (audience !== undefined) config.allowedRecipientPhones = audience;
  if (source.testRecipientPhone != null && source.testRecipientPhone !== '') {
    const phone = require('./chatbot-audience').recipientPhone(source.testRecipientPhone);
    if (!phone || (audience !== undefined && !audience.includes(phone))) throw Object.assign(new Error('INVALID_TEST_PHONE'), { code: 'INVALID_TEST_PHONE' });
    config.testRecipientPhone = phone;
  }
  if (source.testRecipientPhones !== undefined) {
    const phones = normalizeAudience(source.testRecipientPhones);
    if (!phones || phones.length > 10 || (audience !== undefined && phones.some(phone => !audience.includes(phone)))) throw Object.assign(new Error('INVALID_TEST_PHONE'), { code: 'INVALID_TEST_PHONE' });
    config.testRecipientPhones = phones;
    delete config.testRecipientPhone;
  }
  if (source.sharedInboxRouting != null) {
    if (typeof source.sharedInboxRouting !== 'boolean') throw Object.assign(new Error('INVALID_SHARED_INBOX_ROUTING'), { code: 'INVALID_SHARED_INBOX_ROUTING' });
    config.sharedInboxRouting = source.sharedInboxRouting;
  }
  if (source.handoffAssigneeIdentityId != null) {
    if (typeof source.handoffAssigneeIdentityId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source.handoffAssigneeIdentityId)) throw Object.assign(new Error('INVALID_HANDOFF_ASSIGNEE'), { code: 'INVALID_HANDOFF_ASSIGNEE' });
    config.handoffAssigneeIdentityId = source.handoffAssigneeIdentityId;
  }
  if (input.engine === 'guided') {
    if (source.flowId != null && (typeof source.flowId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(source.flowId))) throw Object.assign(new Error('INVALID_FLOW_ID'), { code: 'INVALID_FLOW_ID' });
    config.flowId = source.flowId || null;
    config.guidedMode = config.flowId ? 'automation_flow' : (source.guidedMode === 'domain_default' ? 'domain_default' : null);
    if (source.introFlowId != null && (typeof source.introFlowId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(source.introFlowId))) throw Object.assign(new Error('INVALID_FLOW_ID'), { code: 'INVALID_FLOW_ID' });
    if (config.guidedMode === 'domain_default' && categoryKey === '7network_sales') config.introFlowId = source.introFlowId || null;
    config.welcomeMessage = cleanText(source.welcomeMessage, 1200, 'INVALID_WELCOME_MESSAGE');
    config.fallbackMessage = cleanText(source.fallbackMessage, 1200, 'INVALID_FALLBACK_MESSAGE');
    if (!Array.isArray(source.knowledgeEntries ?? []) || (source.knowledgeEntries ?? []).length > 60) throw Object.assign(new Error('INVALID_KNOWLEDGE_ENTRIES'), { code: 'INVALID_KNOWLEDGE_ENTRIES' });
    config.knowledgeEntries = normalizeKnowledgeEntries(source.knowledgeEntries);
  } else {
    config.instructions = cleanText(source.instructions, 4000, 'INVALID_INSTRUCTIONS');
    config.confidenceThreshold = source.confidenceThreshold == null ? 0.72 : Number(source.confidenceThreshold);
    if (!Number.isFinite(config.confidenceThreshold) || config.confidenceThreshold < 0.5 || config.confidenceThreshold > 0.95) throw Object.assign(new Error('INVALID_CONFIDENCE_THRESHOLD'), { code: 'INVALID_CONFIDENCE_THRESHOLD' });
    config.handoff = source.handoff !== false;
    if (!Array.isArray(source.knowledgeEntries ?? []) || (source.knowledgeEntries ?? []).length > 60) throw Object.assign(new Error('INVALID_KNOWLEDGE_ENTRIES'), { code: 'INVALID_KNOWLEDGE_ENTRIES' });
    config.knowledgeEntries = normalizeKnowledgeEntries(source.knowledgeEntries);
    config.aiDataProcessingConfirmed = source.aiDataProcessingConfirmed === true;
    config.flowId = null;
    if (input.engine === 'hybrid') {
      if (source.flowId != null && (typeof source.flowId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(source.flowId))) throw Object.assign(new Error('INVALID_FLOW_ID'), { code: 'INVALID_FLOW_ID' });
      config.flowId = source.flowId || null;
      config.guidedMode = config.flowId ? 'automation_flow' : (source.guidedMode === 'domain_default' ? 'domain_default' : null);
      if (source.introFlowId != null && (typeof source.introFlowId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(source.introFlowId))) throw Object.assign(new Error('INVALID_FLOW_ID'), { code: 'INVALID_FLOW_ID' });
      if (config.guidedMode === 'domain_default' && categoryKey === '7network_sales') config.introFlowId = source.introFlowId || null;
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

module.exports = { ENGINES, botInput, cleanText, botRequirements, supportsAiPreview, isGuidedChoice, hybridTurnPlan, normalizeGuidedContent, normalizeKeywordReplies };
