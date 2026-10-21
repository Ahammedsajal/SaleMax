'use strict';
const { capabilities } = require('./policy');
const moduleDefinitions=require('./module-registry');
const moduleRegistry=moduleDefinitions.createModuleRegistry(moduleDefinitions.definitions,capabilities);

// Explicit contracts: adding a permission to policy must never enroll an
// existing category into that feature. Version changes require reviewed adoption.
const sharedCapabilities = Object.freeze([
  'messaging.inbox', 'messaging.qr', 'messaging.meta', 'messaging.templates',
  'campaigns.send', 'campaigns.dashboard', 'automation.flows', 'automation.chatbot',
  'crm.leads', 'crm.contacts', 'team.members', 'team.tasks',
  'telephony.call-center', 'reports.read', 'tenant.settings',
]);
const sharedModules=Object.freeze([
  {id:'core.business-settings',version:1},{id:'core.inbox',version:1},{id:'core.whatsapp-qr',version:1},
  {id:'core.whatsapp-meta',version:1},{id:'core.templates',version:1},{id:'core.campaigns',version:1},
  {id:'core.automation-flows',version:1},{id:'core.chatbot',version:1},{id:'core.leads',version:1},
  {id:'core.contacts',version:1},{id:'core.team',version:1},{id:'core.tasks',version:1},
  {id:'core.call-center',version:1},{id:'core.reports',version:1},
]);
const trainingCapabilities = Object.freeze([
  ...sharedCapabilities,
  'training.courses', 'training.batches', 'training.enrollments',
  'finance.invoices', 'finance.installments', 'finance.payments',
  'finance.receipts', 'finance.credits', 'reports.schedule', 'portal.forms',
  // Historical v1 contracts already included these through the old denylist.
  // Preserve assigned contracts here; remove only through reviewed v2 adoption.
  'sales.finance', 'hr.recruitment',
]);
const trainingCenter = Object.freeze({ key: 'training_center', version: 1, modules:Object.freeze([...sharedModules,{id:'training.core',version:1},{id:'training.finance',version:1},{id:'training.report-schedules',version:1},{id:'training.forms',version:1},{id:'compat.training-center-v1',version:1}]), catalogue:'courses', chatbotLeadCapture:'training', taskAdapters:Object.freeze({invoice_follow_up:1,enrollment:1}), title: Object.freeze({ en: 'Training center', ar: 'مركز تدريب' }), public: true, planable: true, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'agent']), capabilities: trainingCapabilities, migration: '20261001_platform_identity.sql' });
// First-party 7Network Sales operations. This category is intentionally private:
// it must be provisioned by an audited platform operation, never selected by a
// customer during self-service onboarding. Training-center course catalogue and
// finance capabilities remain excluded; deals and commissions have their own
// contracts in this category.
const sevenNetworkSales = Object.freeze({ key: '7network_sales', version: 1, modules:Object.freeze([...sharedModules,{id:'sales.deals',version:1},{id:'sales.commissions',version:1},{id:'sales.finance',version:1},{id:'sales.targets',version:1},{id:'sales.products-services',version:1},{id:'sales.recruitment',version:1}]), catalogue:'products', chatbotLeadCapture:'none', taskAdapters:Object.freeze({sales_call:1}), title: Object.freeze({ en: '7Network Sales', ar: 'مبيعات 7Network' }), public: false, planable: true, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'team_leader', 'agent']), capabilities: Object.freeze([...sharedCapabilities, 'sales.deals', 'sales.commissions','sales.finance','sales.targets','products.catalog','hr.recruitment']), migration: '20261001_platform_identity.sql' });
// Internal implementation contract until workflow acceptance is complete.
const realEstate = Object.freeze({ key:'real_estate',version:1,modules:Object.freeze([...sharedModules,{id:'real-estate.properties',version:1}]),catalogue:null,chatbotLeadCapture:'none',title:Object.freeze({en:'Real Estate',ar:'العقارات'}),public:false,planable:false,seatRoles:Object.freeze(['owner','manager','team_leader','agent']),capabilities:Object.freeze([...sharedCapabilities,'realestate.listings']),migration:'20261222_real_estate_properties.sql' });
// Shared CRM contract for reviewed category-neutral businesses. No vertical module
// or catalogue is implied, and existing legacy accounts are never auto-adopted.
const baseCrm = Object.freeze({ key:'base_crm', version:1, modules:sharedModules, catalogue:null, chatbotLeadCapture:'generic', title:Object.freeze({en:'Base CRM',ar:'إدارة علاقات العملاء الأساسية'}), public:false, planable:true, seatRoles:Object.freeze(['owner','accountant','manager','agent']), capabilities:sharedCapabilities, migration:'20261001_platform_identity.sql' });
// Contract fixture only; never offered for production tenant onboarding.
const restaurantFixture = Object.freeze({ key: 'restaurant_fixture', version: 1, modules:Object.freeze([{id:'core.inbox',version:1},{id:'core.contacts',version:1},{id:'core.tasks',version:1},{id:'core.business-settings',version:1}]), title: Object.freeze({ en: 'Restaurant fixture', ar: 'نموذج مطعم للاختبار' }), public: false, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'agent']), capabilities: Object.freeze(['messaging.inbox', 'crm.contacts', 'team.tasks', 'tenant.settings']), migration: '20261001_platform_identity.sql' });
const registry = require('./category-registry').createCategoryRegistry([trainingCenter, sevenNetworkSales, realEstate, baseCrm, restaurantFixture], capabilities,moduleRegistry);
const legacyCategoryAliases = Object.freeze({ salemax_sales: sevenNetworkSales.key });
function canonicalCategoryKey(key) { return legacyCategoryAliases[key] || key; }
function categoryKeyMatches(left, right) { return typeof left === 'string' && typeof right === 'string' && canonicalCategoryKey(left) === canonicalCategoryKey(right); }
function categoryKeysFor(key) { const canonical = canonicalCategoryKey(key); return [canonical, ...Object.keys(legacyCategoryAliases).filter(alias => legacyCategoryAliases[alias] === canonical)]; }
function getCategory(key, version) { return registry.get(canonicalCategoryKey(key), version); }
function listCategories() { return registry.list(); }
function supportsBusinessCapability(category, capability) {
  return category?.public === true && Array.isArray(category.capabilities) && category.capabilities.includes(capability);
}
function supportsCategoryCapability(category, capability) {
  return Boolean(category && Array.isArray(category.capabilities) && category.capabilities.includes(capability));
}
module.exports = { baseCrm: registry.get(baseCrm.key,baseCrm.version), trainingCenter: registry.get(trainingCenter.key, trainingCenter.version), sevenNetworkSales: registry.get(sevenNetworkSales.key, sevenNetworkSales.version), realEstate:registry.get(realEstate.key,realEstate.version), salemaxSales: registry.get(sevenNetworkSales.key, sevenNetworkSales.version), restaurantFixture: registry.get(restaurantFixture.key,restaurantFixture.version), listCategories, getCategory, canonicalCategoryKey, categoryKeyMatches, categoryKeysFor, supportsBusinessCapability, supportsCategoryCapability, moduleRegistry };
