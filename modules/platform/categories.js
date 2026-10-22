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
const trainingCenter = Object.freeze({ key: 'training_center', version: 1, catalogue:'courses', chatbotLeadCapture:'training', taskAdapters:Object.freeze({invoice_follow_up:1,enrollment:1}), title: Object.freeze({ en: 'Training center', ar: 'مركز تدريب' }), public: true, planable: true, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'agent']), capabilities: trainingCapabilities, migration: '20261001_platform_identity.sql' });
// First-party 7Network Sales operations. This category is intentionally private:
// it must be provisioned by an audited platform operation, never selected by a
// customer during self-service onboarding. Training-center course catalogue and
// finance capabilities remain excluded; deals and commissions have their own
// contracts in this category.
const sevenNetworkSales = Object.freeze({ key: '7network_sales', version: 1, catalogue:'products', chatbotLeadCapture:'none', taskAdapters:Object.freeze({sales_call:1}), title: Object.freeze({ en: '7Network Sales', ar: 'مبيعات 7Network' }), public: false, planable: true, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'team_leader', 'agent']), capabilities: Object.freeze([...sharedCapabilities, 'sales.deals', 'sales.commissions','sales.finance','sales.targets','products.catalog','hr.recruitment']), migration: '20261001_platform_identity.sql' });
// Internal implementation contract until workflow acceptance is complete.
const realEstate = Object.freeze({ key:'real_estate',version:1,catalogue:null,chatbotLeadCapture:'none',title:Object.freeze({en:'Real Estate',ar:'العقارات'}),public:false,planable:false,seatRoles:Object.freeze(['owner','manager','team_leader','agent']),capabilities:Object.freeze([...sharedCapabilities,'realestate.listings']),migration:'20261222_real_estate_properties.sql' });
// Private successor contract; v1 remains immutable.
const realEstateV2 = Object.freeze({ key:'real_estate',version:2,catalogue:null,chatbotLeadCapture:'none',title:Object.freeze({en:'Real Estate',ar:'العقارات'}),public:false,planable:false,seatRoles:realEstate.seatRoles,capabilities:Object.freeze([...realEstate.capabilities,'realestate.requirements']),migration:'20261223_real_estate_requirements.sql' });
// Private successor contract; scheduled viewings are enabled only for reviewed v3 tenants.
const realEstateV3 = Object.freeze({ key:'real_estate',version:3,catalogue:null,chatbotLeadCapture:'none',title:Object.freeze({en:'Real Estate',ar:'العقارات'}),public:false,planable:false,seatRoles:realEstate.seatRoles,capabilities:Object.freeze([...realEstateV2.capabilities,'realestate.viewings']),migration:'20261224_real_estate_viewings.sql' });
// Private successor contract adds property-party relationships; earlier versions remain immutable.
const realEstateV4 = Object.freeze({ key:'real_estate',version:4,catalogue:null,chatbotLeadCapture:'none',title:Object.freeze({en:'Real Estate',ar:'العقارات'}),public:false,planable:false,seatRoles:realEstate.seatRoles,capabilities:Object.freeze([...realEstateV3.capabilities,'realestate.parties']),migration:'20261234_real_estate_parties.sql' });
// v5 adds a reviewed bilingual label baseline for the existing Pipeline stages.
// It uses the v4 domain schema unchanged; tenant overrides remain owner-published.
const realEstateV5 = Object.freeze({ key:'real_estate',version:5,catalogue:null,chatbotLeadCapture:'none',title:Object.freeze({en:'Real Estate',ar:'العقارات'}),public:false,planable:false,seatRoles:realEstate.seatRoles,capabilities:realEstateV4.capabilities,migration:'20261234_real_estate_parties.sql',customizationDefaults:Object.freeze({schemaVersion:4,navigationLabels:Object.freeze({leads:Object.freeze({en:'Property enquiries',ar:'استفسارات العقارات'})}),hiddenNavigation:Object.freeze([]),stageLabels:Object.freeze({
  new:Object.freeze({en:'New enquiry',ar:'استفسار جديد'}),
  contacted:Object.freeze({en:'Client contacted',ar:'تم التواصل مع العميل'}),
  interested:Object.freeze({en:'Viewing interest',ar:'اهتمام بالمعاينة'}),
  qualified:Object.freeze({en:'Qualified requirement',ar:'متطلب مؤهل'}),
  proposal:Object.freeze({en:'Offer or negotiation',ar:'عرض أو تفاوض'}),
  won:Object.freeze({en:'Agreement reached',ar:'تم الاتفاق'}),
  lost:Object.freeze({en:'Not proceeding',ar:'لم يتم المتابعة'}),
})}) });
// Shared CRM contract for reviewed category-neutral businesses. No vertical module
// or catalogue is implied, and existing legacy accounts are never auto-adopted.
const baseCrm = Object.freeze({ key:'base_crm', version:1, catalogue:null, chatbotLeadCapture:'generic', title:Object.freeze({en:'Base CRM',ar:'إدارة علاقات العملاء الأساسية'}), public:false, planable:true, seatRoles:Object.freeze(['owner','accountant','manager','agent']), capabilities:sharedCapabilities, migration:'20261001_platform_identity.sql' });
// Contract fixture only; never offered for production tenant onboarding.
const restaurantFixture = Object.freeze({ key: 'restaurant_fixture', version: 1, title: Object.freeze({ en: 'Restaurant fixture', ar: 'نموذج مطعم للاختبار' }), public: false, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'agent']), capabilities: Object.freeze(['messaging.inbox', 'crm.contacts', 'team.tasks', 'tenant.settings']), migration: '20261001_platform_identity.sql' });
const registry = require('./category-registry').createCategoryRegistry([trainingCenter, sevenNetworkSales, realEstate, realEstateV2, realEstateV3, realEstateV4, realEstateV5, baseCrm, restaurantFixture], capabilities);
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
module.exports = { baseCrm: registry.get(baseCrm.key,baseCrm.version), trainingCenter: registry.get(trainingCenter.key, trainingCenter.version), sevenNetworkSales: registry.get(sevenNetworkSales.key, sevenNetworkSales.version), realEstate:registry.get(realEstate.key,realEstate.version), realEstateV2:registry.get(realEstateV2.key,realEstateV2.version), realEstateV3:registry.get(realEstateV3.key,realEstateV3.version), realEstateV4:registry.get(realEstateV4.key,realEstateV4.version), realEstateV5:registry.get(realEstateV5.key,realEstateV5.version), salemaxSales: registry.get(sevenNetworkSales.key, sevenNetworkSales.version), restaurantFixture: registry.get(restaurantFixture.key,restaurantFixture.version), listCategories, getCategory, canonicalCategoryKey, categoryKeyMatches, categoryKeysFor, supportsBusinessCapability, supportsCategoryCapability };
