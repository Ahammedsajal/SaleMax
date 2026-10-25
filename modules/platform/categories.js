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
// Public professional-services businesses reuse shared CRM leads and storefront
// sections. Public consultation and quote submissions remain unconfirmed requests.
const professionalServices = Object.freeze({ key:'professional_services', version:1, catalogue:null, chatbotLeadCapture:'generic', title:Object.freeze({en:'Professional services',ar:'الخدمات المهنية'}), public:true, planable:true, seatRoles:Object.freeze(['owner','accountant','manager','agent']), capabilities:sharedCapabilities, migration:'20261001_platform_identity.sql' });
// Salon/spa v1 deliberately offers appointment requests only. It has no
// resource-capacity contract, so it cannot confirm or reserve staff/rooms.
const salonSpa = Object.freeze({key:'salon_spa',version:1,catalogue:null,chatbotLeadCapture:'generic',title:Object.freeze({en:'Salon / spa',ar:'صالون / منتجع صحي'}),public:true,planable:true,seatRoles:Object.freeze(['owner','accountant','manager','agent']),capabilities:sharedCapabilities,migration:'20261001_platform_identity.sql'});
// Home-services v1 captures consented visit/quote requests with service-area
// validation and routes the resulting lead through the selected public branch.
const homeServices = Object.freeze({key:'home_services',version:1,catalogue:null,chatbotLeadCapture:'generic',title:Object.freeze({en:'Home services',ar:'خدمات منزلية'}),public:true,planable:true,seatRoles:Object.freeze(['owner','accountant','manager','agent']),capabilities:sharedCapabilities,migration:'20261001_platform_identity.sql'});
// Fitness and events share the existing lead, branch and reusable-section
// foundation. Their customer actions are requests only until real capacity
// and attendance or resource reservation services are implemented.
const fitnessCoaching=Object.freeze({key:'fitness_coaching',version:1,catalogue:null,chatbotLeadCapture:'generic',title:Object.freeze({en:'Fitness / coaching',ar:'لياقة / تدريب شخصي'}),public:true,planable:true,seatRoles:Object.freeze(['owner','accountant','manager','agent']),capabilities:sharedCapabilities,migration:'20261001_platform_identity.sql'});
const eventsVenues=Object.freeze({key:'events_venues',version:1,catalogue:null,chatbotLeadCapture:'generic',title:Object.freeze({en:'Events / venues',ar:'فعاليات / قاعات'}),public:true,planable:true,seatRoles:Object.freeze(['owner','accountant','manager','agent']),capabilities:sharedCapabilities,migration:'20261001_platform_identity.sql'});
// Retail v1 reuses the maintained product editor, then adds branch stock and
// atomic guest checkout; online card settlement is a separate provider gate.
const retailBoutique=Object.freeze({key:'retail_boutique',version:1,catalogue:'products',chatbotLeadCapture:'generic',title:Object.freeze({en:'Retail / boutique',ar:'متجر تجزئة / بوتيك'}),public:true,planable:true,seatRoles:Object.freeze(['owner','accountant','manager','agent']),capabilities:Object.freeze([...sharedCapabilities,'products.catalog','retail.orders']),migration:'20261001_platform_identity.sql'});
// Restaurant/Café is available only through audited platform provisioning
// while its guest-order workflow is under implementation and acceptance.
const restaurantCafe=Object.freeze({key:'restaurant_cafe',version:1,catalogue:'products',chatbotLeadCapture:'generic',title:Object.freeze({en:'Restaurant / café',ar:'مطعم / مقهى'}),public:false,planable:true,seatRoles:Object.freeze(['owner','accountant','manager','agent']),capabilities:Object.freeze([...sharedCapabilities,'products.catalog','restaurant.menu','restaurant.orders']),migration:'20270110_restaurant_menu.sql'});
// First-party 7Network Sales operations. This category is intentionally private:
// it must be provisioned by an audited platform operation, never selected by a
// customer during self-service onboarding. Training-center course catalogue and
// finance capabilities remain excluded; deals and commissions have their own
// contracts in this category.
const sevenNetworkSales = Object.freeze({ key: '7network_sales', version: 1, catalogue:'products', chatbotLeadCapture:'none', taskAdapters:Object.freeze({sales_call:1}), title: Object.freeze({ en: '7Network Sales', ar: 'مبيعات 7Network' }), public: false, planable: true, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'team_leader', 'agent']), capabilities: Object.freeze([...sharedCapabilities, 'sales.deals', 'sales.commissions','sales.finance','sales.targets','sales.icp','products.catalog','hr.recruitment']), migration: '20261001_platform_identity.sql' });
// Internal implementation contract until workflow acceptance is complete.
const realEstate = Object.freeze({ key:'real_estate',version:1,catalogue:null,chatbotLeadCapture:'none',title:Object.freeze({en:'Real Estate',ar:'العقارات'}),public:false,planable:false,seatRoles:Object.freeze(['owner','manager','team_leader','agent']),capabilities:Object.freeze([...sharedCapabilities,'realestate.listings']),migration:'20261222_real_estate_properties.sql' });
// Shared CRM contract for reviewed category-neutral businesses. No vertical module
// or catalogue is implied, and existing legacy accounts are never auto-adopted.
const baseCrm = Object.freeze({ key:'base_crm', version:1, catalogue:null, chatbotLeadCapture:'generic', title:Object.freeze({en:'Base CRM',ar:'إدارة علاقات العملاء الأساسية'}), public:false, planable:true, seatRoles:Object.freeze(['owner','accountant','manager','agent']), capabilities:sharedCapabilities, migration:'20261001_platform_identity.sql' });
// Contract fixture only; never offered for production tenant onboarding.
const restaurantFixture = Object.freeze({ key: 'restaurant_fixture', version: 1, title: Object.freeze({ en: 'Restaurant fixture', ar: 'نموذج مطعم للاختبار' }), public: false, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'agent']), capabilities: Object.freeze(['messaging.inbox', 'crm.contacts', 'team.tasks', 'tenant.settings']), migration: '20261001_platform_identity.sql' });
const registry = require('./category-registry').createCategoryRegistry([trainingCenter, professionalServices, salonSpa, homeServices, fitnessCoaching, eventsVenues, retailBoutique, restaurantCafe, sevenNetworkSales, realEstate, baseCrm, restaurantFixture], capabilities);
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
module.exports = { baseCrm: registry.get(baseCrm.key,baseCrm.version), trainingCenter: registry.get(trainingCenter.key, trainingCenter.version), professionalServices:registry.get(professionalServices.key,professionalServices.version), salonSpa:registry.get(salonSpa.key,salonSpa.version), homeServices:registry.get(homeServices.key,homeServices.version), fitnessCoaching:registry.get(fitnessCoaching.key,fitnessCoaching.version), eventsVenues:registry.get(eventsVenues.key,eventsVenues.version), retailBoutique:registry.get(retailBoutique.key,retailBoutique.version), restaurantCafe:registry.get(restaurantCafe.key,restaurantCafe.version), sevenNetworkSales: registry.get(sevenNetworkSales.key, sevenNetworkSales.version), realEstate:registry.get(realEstate.key,realEstate.version), salemaxSales: registry.get(sevenNetworkSales.key, sevenNetworkSales.version), restaurantFixture: registry.get(restaurantFixture.key,restaurantFixture.version), listCategories, getCategory, canonicalCategoryKey, categoryKeyMatches, categoryKeysFor, supportsBusinessCapability, supportsCategoryCapability };
