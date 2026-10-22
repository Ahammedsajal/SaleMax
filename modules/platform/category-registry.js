'use strict';

// Registries are assembled at boot from reviewed source, never tenant input.
function createCategoryRegistry(definitions, knownCapabilities) {
  const invalid = () => { throw Object.assign(new Error('INVALID_CATEGORY_MANIFEST'), { code: 'INVALID_CATEGORY_MANIFEST' }); };
  const knownTaskAdapters=new Map(require('./task-type-adapters').knownAdapters().map(adapter=>[adapter.key,adapter]));
  if (!Array.isArray(definitions) || !knownCapabilities || typeof knownCapabilities !== 'object') invalid();
  const entries = new Map();
  for (const source of definitions) {
    if (!source || typeof source.key !== 'string' || !/^[a-z0-9][a-z0-9_]{1,79}$/.test(source.key)
      || !Number.isSafeInteger(source.version) || source.version < 1
      || typeof source.public !== 'boolean' || (source.planable !== undefined && typeof source.planable !== 'boolean')
      || !source.title || !['en', 'ar'].every(lang => typeof source.title[lang] === 'string' && source.title[lang].trim())
      || !Array.isArray(source.capabilities) || source.capabilities.some(key => typeof key !== 'string' || !Object.hasOwn(knownCapabilities, key))
      || new Set(source.capabilities).size !== source.capabilities.length
      || !Array.isArray(source.seatRoles) || !source.seatRoles.includes('owner')
      || source.seatRoles.some(role => !['owner', 'accountant', 'manager', 'team_leader', 'agent'].includes(role))
      || new Set(source.seatRoles).size !== source.seatRoles.length
      || (source.catalogue!==undefined&&source.catalogue!==null&&!['courses','products'].includes(source.catalogue))
      || (source.catalogue==='courses'&&!source.capabilities.includes('training.courses'))
      || (source.catalogue==='products'&&!source.capabilities.includes('products.catalog'))
      || (source.chatbotLeadCapture!==undefined&&!['none','generic','training'].includes(source.chatbotLeadCapture))
      || (source.chatbotLeadCapture==='generic'&&!source.capabilities.includes('crm.leads'))
      || (source.chatbotLeadCapture==='training'&&(!source.capabilities.includes('crm.leads')||!source.capabilities.includes('training.courses')))
      || (source.taskAssignmentScope!==undefined&&!['self','workspace'].includes(source.taskAssignmentScope))
      || (source.taskAdapters!==undefined&&(!source.taskAdapters||typeof source.taskAdapters!=='object'||Array.isArray(source.taskAdapters)||!(Object.getPrototypeOf(source.taskAdapters)===null||Object.getPrototypeOf(Object.getPrototypeOf(source.taskAdapters))===null)
        ||Object.entries(source.taskAdapters).some(([key,version])=>{const adapter=knownTaskAdapters.get(key);return !Number.isSafeInteger(version)||!adapter||adapter.version!==version||!source.capabilities.includes('team.tasks')||adapter.requiredCapabilities.some(capability=>!source.capabilities.includes(capability))||(adapter.requiredAnyCapabilities.length&&!adapter.requiredAnyCapabilities.some(capability=>source.capabilities.includes(capability)));})))
      || typeof source.migration !== 'string' || !/^\d{8}_[a-z0-9_]+\.sql$/.test(source.migration)) invalid();
    const id = `${source.key}@${source.version}`;
    if (entries.has(id)) invalid();
    // Copy owned data before freezing: callers cannot mutate a retained input.
    const manifest = Object.freeze({ key: source.key, version: source.version,
      title: Object.freeze({ en: source.title.en, ar: source.title.ar }),
      public: source.public, ...(source.planable === undefined ? {} : { planable: source.planable }),
      ...(source.catalogue===undefined?{}:{catalogue:source.catalogue}),
      chatbotLeadCapture: source.chatbotLeadCapture || 'none',
      taskAdapters:Object.freeze({...source.taskAdapters}),
      taskAssignmentScope:source.taskAssignmentScope||'self',
      capabilities: Object.freeze([...source.capabilities]), seatRoles: Object.freeze([...source.seatRoles]), migration: source.migration });
    entries.set(id, manifest);
  }
  return Object.freeze({
    get(key, version) {
      if (typeof key !== 'string' || !Number.isSafeInteger(version) || version < 1) return null;
      return entries.get(`${key}@${version}`) || null;
    },
    list() { return Object.freeze([...entries.values()]); },
  });
}
module.exports = { createCategoryRegistry };
