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
const trainingCenter = Object.freeze({ key: 'training_center', version: 1, title: Object.freeze({ en: 'Training center', ar: 'مركز تدريب' }), public: true, planable: true, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'agent']), capabilities: trainingCapabilities, migration: '20261001_platform_identity.sql' });
// First-party SaleMaX sales operations. This category is intentionally private:
// it must be provisioned by an audited platform operation, never selected by a
// customer during self-service onboarding. Training-center course catalogue and
// finance capabilities remain excluded; deals and commissions have their own
// contracts in this category.
const salemaxSales = Object.freeze({ key: 'salemax_sales', version: 1, title: Object.freeze({ en: 'SaleMaX Sales', ar: 'مبيعات SaleMaX' }), public: false, planable: true, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'team_leader', 'agent']), capabilities: Object.freeze([...sharedCapabilities, 'sales.deals', 'sales.commissions','sales.finance','sales.targets','products.catalog','hr.recruitment']), migration: '20261001_platform_identity.sql' });
// Contract fixture only; never offered for production tenant onboarding.
const restaurantFixture = Object.freeze({ key: 'restaurant_fixture', version: 1, title: Object.freeze({ en: 'Restaurant fixture', ar: 'نموذج مطعم للاختبار' }), public: false, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'agent']), capabilities: Object.freeze(['messaging.inbox', 'crm.contacts', 'team.tasks', 'tenant.settings']), migration: '20261001_platform_identity.sql' });
const registry = require('./category-registry').createCategoryRegistry([trainingCenter, salemaxSales, restaurantFixture], capabilities);
function getCategory(key, version) { return registry.get(key, version); }
function listCategories() { return registry.list(); }
function supportsBusinessCapability(category, capability) {
  return category?.public === true && Array.isArray(category.capabilities) && category.capabilities.includes(capability);
}
function supportsCategoryCapability(category, capability) {
  return Boolean(category && Array.isArray(category.capabilities) && category.capabilities.includes(capability));
}
module.exports = { trainingCenter: registry.get(trainingCenter.key, trainingCenter.version), salemaxSales: registry.get(salemaxSales.key, salemaxSales.version), restaurantFixture: registry.get(restaurantFixture.key, restaurantFixture.version), listCategories, getCategory, supportsBusinessCapability, supportsCategoryCapability };
