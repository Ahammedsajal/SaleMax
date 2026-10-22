'use strict';

// Registries are assembled at boot from reviewed source, never tenant input.
function createCategoryRegistry(definitions, knownCapabilities) {
  const invalid = () => { throw Object.assign(new Error('INVALID_CATEGORY_MANIFEST'), { code: 'INVALID_CATEGORY_MANIFEST' }); };
  const isPlain=value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const prototype=Object.getPrototypeOf(value);
    return prototype===null||Object.getPrototypeOf(prototype)===null;
  };
  const validAccessPolicy=(policy,roles,categoryCapabilities)=>{
    if(policy===undefined)return true;
    if(!isPlain(policy)||Object.keys(policy).some(key=>!['planExemptOwnerCapabilities','deniedRolePermissions','tenantRolePermissions'].includes(key)))return false;
    const exemptions=policy.planExemptOwnerCapabilities??[];
    if(!Array.isArray(exemptions)||new Set(exemptions).size!==exemptions.length||exemptions.some(key=>typeof key!=='string'||!categoryCapabilities.includes(key)))return false;
    const validRoleRules=rules=>{
      if(rules===undefined)return true;
      if(!isPlain(rules))return false;
      return Object.entries(rules).every(([role,items])=>roles.includes(role)&&Array.isArray(items)&&items.length>0&&new Set(items).size===items.length&&items.every(permission=>typeof permission==='string'&&Object.values(knownCapabilities).some(list=>Array.isArray(list)&&list.includes(permission))&&categoryCapabilities.some(key=>knownCapabilities[key]?.includes(permission))));
    };
    return validRoleRules(policy.deniedRolePermissions)&&validRoleRules(policy.tenantRolePermissions);
  };
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
      || (source.inventoryAdapter!==undefined&&(!['retail_stock_ledger_v1'].includes(source.inventoryAdapter)||source.catalogue!=='products'||!source.capabilities.includes('retail.inventory')))
      || !validAccessPolicy(source.accessPolicy,source.seatRoles,source.capabilities)
      || (source.chatbotLeadCapture!==undefined&&!['none','generic','training'].includes(source.chatbotLeadCapture))
      || (source.chatbotLeadCapture==='generic'&&!source.capabilities.includes('crm.leads'))
      || (source.chatbotLeadCapture==='training'&&(!source.capabilities.includes('crm.leads')||!source.capabilities.includes('training.courses')))
      || (source.taskAssignmentScope!==undefined&&!['self','workspace'].includes(source.taskAssignmentScope))
      || (source.qrSharing!==undefined&&(!source.qrSharing||typeof source.qrSharing!=='object'||Array.isArray(source.qrSharing)||!(Object.getPrototypeOf(source.qrSharing)===null||Object.getPrototypeOf(Object.getPrototypeOf(source.qrSharing))===null)
        ||Object.keys(source.qrSharing).some(key=>!['managerAgentScope','accountantAccess'].includes(key))
        ||(source.qrSharing.managerAgentScope!==undefined&&!['manager_team','tenant'].includes(source.qrSharing.managerAgentScope))
        ||(source.qrSharing.accountantAccess!==undefined&&typeof source.qrSharing.accountantAccess!=='boolean')
        ||(source.qrSharing.managerAgentScope==='tenant'&&(!source.capabilities.includes('messaging.qr')||!source.capabilities.includes('team.members')))
        ||(source.qrSharing.accountantAccess===true&&(!source.capabilities.includes('messaging.qr')||!source.capabilities.includes('messaging.inbox')||!source.capabilities.includes('team.members')))))
      || (source.conversationTransferLeadAdapter!==undefined&&(!['none','whatsapp_inquiry_v1'].includes(source.conversationTransferLeadAdapter)||(source.conversationTransferLeadAdapter==='whatsapp_inquiry_v1'&&(!source.capabilities.includes('crm.leads')||!source.capabilities.includes('messaging.inbox')))))
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
      ...(source.inventoryAdapter===undefined?{}:{inventoryAdapter:source.inventoryAdapter}),
      accessPolicy:Object.freeze({
        planExemptOwnerCapabilities:Object.freeze([...(source.accessPolicy?.planExemptOwnerCapabilities||[])]),
        deniedRolePermissions:Object.freeze(Object.fromEntries(Object.entries(source.accessPolicy?.deniedRolePermissions||{}).map(([role,items])=>[role,Object.freeze([...items])]))),
        tenantRolePermissions:Object.freeze(Object.fromEntries(Object.entries(source.accessPolicy?.tenantRolePermissions||{}).map(([role,items])=>[role,Object.freeze([...items])]))),
      }),
      chatbotLeadCapture: source.chatbotLeadCapture || 'none',
      taskAdapters:Object.freeze({...source.taskAdapters}),
      taskAssignmentScope:source.taskAssignmentScope||'self',
      qrSharing:Object.freeze({managerAgentScope:source.qrSharing?.managerAgentScope||'manager_team',accountantAccess:source.qrSharing?.accountantAccess===true}),
      conversationTransferLeadAdapter:source.conversationTransferLeadAdapter||'none',
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
