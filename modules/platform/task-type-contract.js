'use strict';

const definitions = Object.freeze([
  { key: 'general', label: Object.freeze({ en: 'General', ar: 'عام' }), categoryCapabilities: ['team.tasks'], planCapabilities: ['team.tasks'] },
  { key: 'lead_follow_up', label: Object.freeze({ en: 'Lead follow-up', ar: 'متابعة عميل محتمل' }), categoryCapabilities: ['team.tasks', 'crm.leads'], planCapabilities: ['team.tasks', 'crm.leads'] },
]);

function forContext(ctx) {
  const categoryCapabilities = new Set(ctx?.category?.capabilities || []);
  const planCapabilities = new Set(ctx?.subscription?.capabilities || []);
  const planActive = ['active', 'trial', 'grace'].includes(ctx?.subscription?.status);
  const categoryAdapters=require('./task-type-adapters').configurable(ctx);
  const specialized=categoryAdapters.map(item=>({key:item.key,label:item.label,categoryCapabilities:['team.tasks'],planCapabilities:['team.tasks'],adapter:true}));
  return [...definitions,...specialized].filter(item => item.categoryCapabilities.every(key => categoryCapabilities.has(key)))
    .map(item => ({
      key: item.key,
      label: item.label,
      planAvailable: planActive && (item.adapter ? require('./task-type-adapters').supports(ctx,item.key) : (item.planCapabilities || []).every(key => planCapabilities.has(key))) &&
        (!item.planAnyCapabilities || item.planAnyCapabilities.some(key => planCapabilities.has(key))),
    }));
}

function normalizeEnabled(ctx, value, { enforcePlan = false } = {}) {
  if (value === null) return null;
  const available = new Map(forContext(ctx).map(item => [item.key, item]));
  if (!Array.isArray(value) || value.length > available.size || new Set(value).size !== value.length ||
      value.some(key => typeof key !== 'string' || !available.has(key))) {
    throw Object.assign(new Error('INVALID_CUSTOMIZATION_TASK_TYPES'), { code: 'INVALID_CUSTOMIZATION_TASK_TYPES' });
  }
  if (enforcePlan && value.some(key => !available.get(key).planAvailable)) {
    throw Object.assign(new Error('INVALID_CUSTOMIZATION_TASK_TYPES'), { code: 'INVALID_CUSTOMIZATION_TASK_TYPES' });
  }
  return [...value].sort();
}

function enabledKeys(ctx, document) {
  const available = forContext(ctx).filter(item => item.planAvailable).map(item => item.key);
  return new Set(document?.enabledTaskTypes == null ? available : document.enabledTaskTypes.filter(key => available.includes(key)));
}

function assertAvailable(ctx, key) {
  const option = forContext(ctx).find(item => item.key === key);
  if (!option) throw Object.assign(new Error('INVALID_TASK_TYPE'), { code: 'INVALID_TASK_TYPE', status: 403 });
  if (!option.planAvailable) throw Object.assign(new Error('FEATURE_UNAVAILABLE'), { code: 'FEATURE_UNAVAILABLE', status: 403 });
  return option;
}

function assertSelected(ctx, key) {
  assertAvailable(ctx, key);
  if (!enabledKeys(ctx, { enabledTaskTypes: ctx.enabledTaskTypes }).has(key) && ctx.enabledTaskTypes !== null && ctx.enabledTaskTypes !== undefined) {
    throw Object.assign(new Error('TASK_TYPE_NOT_ENABLED'), { code: 'TASK_TYPE_NOT_ENABLED', status: 409 });
  }
}

module.exports = { definitions, forContext, normalizeEnabled, enabledKeys, assertAvailable, assertSelected };
