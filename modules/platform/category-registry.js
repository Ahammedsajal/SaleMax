'use strict';
const crypto=require('node:crypto');

function contractFingerprint(source) {
  const contract={
    key:source.key,
    version:source.version,
    title:{en:source.title.en,ar:source.title.ar},
    public:source.public,
    planable:source.planable===undefined?null:source.planable,
    catalogue:source.catalogue===undefined?null:source.catalogue,
    chatbotLeadCapture:source.chatbotLeadCapture||'none',
    taskAdapters:Object.fromEntries(Object.entries(source.taskAdapters||{}).sort(([a],[b])=>a.localeCompare(b))),
    capabilities:[...source.capabilities].sort(),
    seatRoles:[...source.seatRoles].sort(),
    migration:source.migration,
  };
  return crypto.createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

// Registries are assembled at boot from reviewed source, never tenant input.
function createCategoryRegistry(definitions, knownCapabilities, contractLock=null) {
  const invalid = () => { throw Object.assign(new Error('INVALID_CATEGORY_MANIFEST'), { code: 'INVALID_CATEGORY_MANIFEST' }); };
  const knownTaskAdapters = new Map(require('./task-type-adapters').knownAdapters().map(adapter => [adapter.key, adapter]));
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
      || (source.taskAdapters!==undefined&&(!source.taskAdapters||typeof source.taskAdapters!=='object'||Array.isArray(source.taskAdapters)||Object.prototype.toString.call(source.taskAdapters)!=='[object Object]'
        ||Object.entries(source.taskAdapters).some(([key,version])=>!knownTaskAdapters.has(key)||knownTaskAdapters.get(key).version!==version||!source.capabilities.includes('team.tasks')||knownTaskAdapters.get(key).requiredCapabilities.some(capability=>!source.capabilities.includes(capability)))))
      || typeof source.migration !== 'string' || !/^\d{8}_[a-z0-9_]+\.sql$/.test(source.migration)) invalid();
    const id = `${source.key}@${source.version}`;
    if (entries.has(id)) invalid();
    if(contractLock){
      const locked=contractLock[id];
      if(typeof locked!=='string'||!/^[a-f0-9]{64}$/.test(locked)||contractFingerprint(source)!==locked)invalid();
    }
    // Copy owned data before freezing: callers cannot mutate a retained input.
    const manifest = Object.freeze({ key: source.key, version: source.version,
      title: Object.freeze({ en: source.title.en, ar: source.title.ar }),
      public: source.public, ...(source.planable === undefined ? {} : { planable: source.planable }),
      ...(source.catalogue===undefined?{}:{catalogue:source.catalogue}),
      chatbotLeadCapture: source.chatbotLeadCapture || 'none',
      taskAdapters:Object.freeze({...source.taskAdapters}),
      capabilities: Object.freeze([...source.capabilities]), seatRoles: Object.freeze([...source.seatRoles]), migration: source.migration });
    entries.set(id, manifest);
  }
  if(contractLock&&Object.keys(contractLock).length!==entries.size)invalid();
  return Object.freeze({
    get(key, version) {
      if (typeof key !== 'string' || !Number.isSafeInteger(version) || version < 1) return null;
      return entries.get(`${key}@${version}`) || null;
    },
    list() { return Object.freeze([...entries.values()]); },
  });
}
module.exports = { createCategoryRegistry, contractFingerprint };
