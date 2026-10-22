'use strict';
const {decision,permissions,capabilities}=require('./policy');
const coreModules=Object.freeze([
  {key:'inbox',capability:'messaging.inbox',permission:'conversations.read'},
  {key:'phonebook',capability:'crm.contacts',permission:'contacts.read'},
  {key:'products',capability:'products.catalog',permission:'products.read'},
  {key:'properties',capability:'realestate.listings',permission:'properties.read'},
  {key:'courses',capability:'training.courses',permission:'courses.read'},
  {key:'finance',capability:'finance.invoices',permission:'invoices.read'},
  {key:'receipts',capability:'finance.receipts',permission:'receipts.read'},
  {key:'payments',capability:'finance.payments',permission:'payments.verify'},
  {key:'reports',capability:'reports.read',permission:'reports.read'},
  {key:'icp',capability:'sales.icp',permission:'icp.read'},
]);
const moduleExtensions=new Map();
function validateModuleContract(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(Error('INVALID_MODULE_CONTRACT'),{code:'INVALID_MODULE_CONTRACT'});
  const {key,capability,permission,categoryKey,categoryVersion}=input;
  if(typeof key!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(key)||typeof capability!=='string'||!Object.hasOwn(capabilities,capability)||typeof permission!=='string'||!Object.hasOwn(permissions,permission)||!capabilities[capability].includes(permission))throw Object.assign(Error('INVALID_MODULE_CONTRACT'),{code:'INVALID_MODULE_CONTRACT'});
  const scoped=categoryKey!==undefined||categoryVersion!==undefined;
  if(scoped&&(typeof categoryKey!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(categoryKey)||!Number.isSafeInteger(categoryVersion)||categoryVersion<1))throw Object.assign(Error('INVALID_MODULE_CONTRACT'),{code:'INVALID_MODULE_CONTRACT'});
  if(scoped){const category=require('./categories').getCategory(categoryKey,categoryVersion);if(!category||!category.capabilities.includes(capability))throw Object.assign(Error('INVALID_MODULE_CONTRACT'),{code:'INVALID_MODULE_CONTRACT'});}
  return Object.freeze({key,capability,permission,...(scoped?{categoryKey,categoryVersion}:{})});
}
function registerModuleExtension(input){
  const contract=validateModuleContract(input);
  if(coreModules.some(module=>module.key===contract.key)||moduleExtensions.has(contract.key))throw Object.assign(Error('MODULE_CONTRACT_EXISTS'),{code:'MODULE_CONTRACT_EXISTS'});
  moduleExtensions.set(contract.key,contract);
  return contract;
}
function resolveModules(context){
  const result={};
  for(const module of [...coreModules,...moduleExtensions.values()]){
    if(module.categoryKey&&(!require('./categories').categoryKeyMatches(context.tenant?.categoryKey,module.categoryKey)||context.tenant?.categoryVersion!==module.categoryVersion))continue;
    result[module.key]=decision(context,{capability:module.capability,permission:module.permission}).allowed;
  }
  return result;
}
function describe(session){
  const context=session.context;if(!context)throw Object.assign(Error('VERIFIED_BUSINESS_OWNER_REQUIRED'),{code:'VERIFIED_BUSINESS_OWNER_REQUIRED',status:403});
  const assignedNavigation=Array.isArray(context.membership.assignedNavigation)?[...context.membership.assignedNavigation]:null;
  if(assignedNavigation?.some(key=>['invoices','installments','payments','receipts'].includes(key))&&!assignedNavigation.includes('invoices'))assignedNavigation.push('invoices');
  const catalogue=require('./product-catalog').kind(context);
  const catalogCapability=catalogue==='products'?'products.catalog':catalogue==='courses'?'training.courses':null;
  const quickReplyCatalog=catalogCapability&&context.subscription?.capabilities.includes(catalogCapability)&&['active','trial','grace'].includes(context.subscription?.status)?catalogue:null;
  return {quickReplyCatalog,role:context.membership.role,tenantId:context.tenant.id,categoryKey:context.tenant.categoryKey,currency:context.tenant.currency||'QAR',timezone:context.tenant.timezone||'Asia/Qatar',roleProfileId:context.membership.roleProfileId||null,customPermissions:context.membership.customPermissions||null,assignedNavigation,roleNavigation:require('./navigation').navigationFor(context).map(item=>item.key),modules:resolveModules(context),permissions:Object.fromEntries(Object.keys(permissions).map(permission=>{
    const capability=Object.keys(capabilities).find(key=>capabilities[key].includes(permission));
    return [permission,capability?decision(context,{capability,permission}).allowed:false];
  }))};
}
async function describeWithNavigation(pool,session){
  const data=describe(session);
  if(data.role==='manager'){
    const [shares]=await pool.query('SELECT 1 FROM sx_qr_channel_shares WHERE tenant_id=? AND membership_id=? LIMIT 1',[session.context.tenant.id,session.context.membership.id]);
    if(shares.length){if(!data.roleNavigation.includes('whatsapp-qr'))data.roleNavigation.push('whatsapp-qr');if(data.assignedNavigation&&!data.assignedNavigation.includes('whatsapp-qr'))data.assignedNavigation.push('whatsapp-qr');}
  }
  const navigation=require('./navigation');
  const customization=await require('./tenant-customization').effective(pool,session.context);
  const visibleRows=require('./tenant-customization').visibleNavigation(navigation.items.filter(item=>data.roleNavigation.includes(item.key)),customization.document);
  const visible=await navigation.sidebarForMembership(pool,session.context,visibleRows);
  data.roleNavigation=visible.map(item=>item.key);
  data.customizationRevision=customization.revision;
  data.navigationLabels=Object.fromEntries(Object.entries(customization.document.navigationLabels).filter(([key])=>data.roleNavigation.includes(key)));
  data.stageLabels=customization.document.stageLabels||{};
  return data;
}
module.exports={describe,describeWithNavigation,registerModuleExtension};
