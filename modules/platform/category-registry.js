'use strict';

// Registries are assembled at boot from reviewed source, never tenant input.
function createCategoryRegistry(definitions, knownCapabilities) {
  const invalid = () => { throw Object.assign(new Error('INVALID_CATEGORY_MANIFEST'), { code: 'INVALID_CATEGORY_MANIFEST' }); };
  function copyTaskAdapters(value, categoryCapabilities) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
    const entries = Object.entries(value);
    if (entries.length > 16) invalid();
    const known = new Map(require('./task-type-adapters').knownAdapters().map(adapter => [`${adapter.key}@${adapter.version}`, adapter]));
    const result = {};
    for (const [key, version] of entries.sort(([left],[right]) => left.localeCompare(right))) {
      if (!/^[a-z][a-z0-9_]{1,63}$/.test(key) || !Number.isSafeInteger(version) || version < 1) invalid();
      const adapter = known.get(`${key}@${version}`);
      if (!adapter || adapter.requiredCapabilities.some(capability => !categoryCapabilities.includes(capability))) invalid();
      result[key] = version;
    }
    return Object.freeze(result);
  }
  function copyCustomizationDefaults(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
    let bytes;
    try { bytes = Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch { invalid(); }
    if (bytes > 32 * 1024) invalid();
    function copy(node, depth = 0) {
      if (depth > 8) invalid();
      if (node === null || typeof node === 'string' || typeof node === 'boolean') return node;
      if (typeof node === 'number' && Number.isFinite(node)) return node;
      if (Array.isArray(node)) return Object.freeze(node.map(item => copy(item, depth + 1)));
      if (!node || typeof node !== 'object' || Object.getPrototypeOf(node) !== Object.prototype) invalid();
      const result = {};
      for (const [key, child] of Object.entries(node)) result[key] = copy(child, depth + 1);
      return Object.freeze(result);
    }
    return copy(value);
  }
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
      || (source.formsAdapter!==undefined&&!require('./form-category-adapters').validateDeclaration(source.formsAdapter,source.capabilities))
      || (source.customizationDefaults !== undefined && !source.capabilities.includes('tenant.settings'))
      || (source.customizationSchema !== undefined && !source.capabilities.includes('tenant.settings'))
      || typeof source.migration !== 'string' || !/^\d{8}_[a-z0-9_]+\.sql$/.test(source.migration)) invalid();
    const taskAdapters = source.taskAdapters === undefined ? undefined : copyTaskAdapters(source.taskAdapters, source.capabilities);
    let customizationSchema;
    if(source.customizationSchema!==undefined){
      try{customizationSchema=require('./tenant-module-settings').copySchema(source.customizationSchema,source.capabilities);}
      catch{invalid();}
    }
    if(source.customizationDefaults&&Object.hasOwn(source.customizationDefaults,'moduleSettings')){
      if(!customizationSchema||source.customizationDefaults.schemaVersion<6)invalid();
      try{require('./tenant-module-settings').normalize(source.customizationDefaults.moduleSettings,customizationSchema);}
      catch{invalid();}
    }
    const id = `${source.key}@${source.version}`;
    if (entries.has(id)) invalid();
    // Copy owned data before freezing: callers cannot mutate a retained input.
    const manifest = Object.freeze({ key: source.key, version: source.version,
      title: Object.freeze({ en: source.title.en, ar: source.title.ar }),
      public: source.public, ...(source.planable === undefined ? {} : { planable: source.planable }),
      ...(source.catalogue===undefined?{}:{catalogue:source.catalogue}),
      ...(source.customizationDefaults===undefined?{}:{customizationDefaults:copyCustomizationDefaults(source.customizationDefaults)}),
      ...(customizationSchema===undefined?{}:{customizationSchema}),
      ...(source.formsAdapter===undefined?{}:{formsAdapter:source.formsAdapter}),
      ...(taskAdapters===undefined?{}:{taskAdapters}),
      chatbotLeadCapture: source.chatbotLeadCapture || 'none',
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
