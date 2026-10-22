'use strict';
const { capabilities } = require('./policy');

// Explicit contracts: adding a permission to policy must never enroll an
// existing category into that feature. Version changes require reviewed adoption.
const sharedCapabilities = Object.freeze([
  'messaging.inbox', 'messaging.qr', 'messaging.meta', 'messaging.templates',
  'campaigns.send', 'campaigns.dashboard', 'automation.flows', 'automation.chatbot',
  'crm.leads', 'crm.contacts', 'team.members', 'team.tasks',
  'telephony.call-center', 'reports.read', 'tenant.settings',
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
const trainingCenter = Object.freeze({ key: 'training_center', version: 1, catalogue:'courses', chatbotLeadCapture:'training', taskAdapters:Object.freeze({invoice_follow_up:1,enrollment:1}), taskAssignmentScope:'workspace', qrSharing:Object.freeze({managerAgentScope:'tenant',accountantAccess:true}), conversationTransferLeadAdapter:'whatsapp_inquiry_v1', title: Object.freeze({ en: 'Training center', ar: 'مركز تدريب' }), public: true, planable: true, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'agent']), capabilities: trainingCapabilities, migration: '20261001_platform_identity.sql' });
// First-party 7Network Sales operations. This category is intentionally private:
// it must be provisioned by an audited platform operation, never selected by a
// customer during self-service onboarding. Training-center course catalogue and
// finance capabilities remain excluded; deals and commissions have their own
// contracts in this category.
const sevenNetworkSales = Object.freeze({ key: '7network_sales', version: 1, catalogue:'products', chatbotLeadCapture:'none', taskAdapters:Object.freeze({invoice_follow_up:1,sales_call:1}), title: Object.freeze({ en: '7Network Sales', ar: 'مبيعات 7Network' }), public: false, planable: true, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'team_leader', 'agent']), capabilities: Object.freeze([...sharedCapabilities, 'sales.deals', 'sales.commissions','sales.finance','sales.targets','products.catalog','hr.recruitment']), migration: '20261001_platform_identity.sql' });
// Internal implementation contract until workflow acceptance is complete.
const realEstate = Object.freeze({ key:'real_estate',version:1,catalogue:null,chatbotLeadCapture:'none',title:Object.freeze({en:'Real Estate',ar:'العقارات'}),public:false,planable:false,seatRoles:Object.freeze(['owner','manager','team_leader','agent']),capabilities:Object.freeze([...sharedCapabilities,'realestate.listings']),migration:'20261222_real_estate_properties.sql' });
// Shared CRM contract for reviewed category-neutral businesses. No vertical module
// or catalogue is implied, and existing legacy accounts are never auto-adopted.
const retailShop=Object.freeze({key:'retail_shop',version:1,catalogue:'products',inventoryAdapter:'retail_stock_ledger_v1',chatbotLeadCapture:'generic',taskAssignmentScope:'workspace',conversationTransferLeadAdapter:'whatsapp_inquiry_v1',title:Object.freeze({en:'Retail shop',ar:'متجر تجزئة'}),public:false,planable:false,seatRoles:Object.freeze(['owner','accountant','manager','agent']),capabilities:Object.freeze([...sharedCapabilities,'products.catalog','retail.inventory']),migration:'20261227_retail_inventory.sql'});
const baseCrm = Object.freeze({ key:'base_crm', version:1, catalogue:null, chatbotLeadCapture:'generic', title:Object.freeze({en:'Base CRM',ar:'إدارة علاقات العملاء الأساسية'}), public:false, planable:true, seatRoles:Object.freeze(['owner','accountant','manager','agent']), capabilities:sharedCapabilities, migration:'20261001_platform_identity.sql' });
// Contract fixture only; never offered for production tenant onboarding.
const restaurantFixture = Object.freeze({ key: 'restaurant_fixture', version: 1, title: Object.freeze({ en: 'Restaurant fixture', ar: 'نموذج مطعم للاختبار' }), public: false, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'agent']), capabilities: Object.freeze(['messaging.inbox', 'crm.contacts', 'team.tasks', 'tenant.settings']), migration: '20261001_platform_identity.sql' });
const registry = require('./category-registry').createCategoryRegistry([trainingCenter, sevenNetworkSales, realEstate, retailShop, baseCrm, restaurantFixture], capabilities);
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
module.exports = { baseCrm: registry.get(baseCrm.key,baseCrm.version), trainingCenter: registry.get(trainingCenter.key, trainingCenter.version), sevenNetworkSales: registry.get(sevenNetworkSales.key, sevenNetworkSales.version), realEstate:registry.get(realEstate.key,realEstate.version), retailShop:registry.get(retailShop.key,retailShop.version), salemaxSales: registry.get(sevenNetworkSales.key, sevenNetworkSales.version), restaurantFixture: registry.get(restaurantFixture.key,restaurantFixture.version), listCategories, getCategory, canonicalCategoryKey, categoryKeyMatches, categoryKeysFor, supportsBusinessCapability, supportsCategoryCapability };
