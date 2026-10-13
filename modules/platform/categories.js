const { capabilities } = require('./policy');
const trainingCenter = Object.freeze({ key: 'training_center', version: 1, title: { en: 'Training center', ar: 'مركز تدريب' }, public: true, planable: true, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'agent']), capabilities: Object.freeze(Object.keys(capabilities).filter(key=>!['sales.deals','sales.commissions','sales.targets'].includes(key))), migration: '20261001_platform_identity.sql' });
// First-party SaleMaX sales operations. This category is intentionally private:
// it must be provisioned by an audited platform operation, never selected by a
// customer during self-service onboarding. Training-center catalogue and
// finance capabilities remain excluded; deals and commissions have their own
// contracts in this category.
const salemaxSales = Object.freeze({ key: 'salemax_sales', version: 1, title: { en: 'SaleMaX Sales', ar: 'مبيعات SaleMaX' }, public: false, planable: true, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'team_leader', 'agent']), capabilities: Object.freeze(['messaging.inbox', 'crm.leads', 'crm.contacts', 'team.members', 'team.tasks', 'telephony.call-center', 'reports.read', 'tenant.settings', 'sales.deals', 'sales.commissions','sales.finance','sales.targets']), migration: '20261001_platform_identity.sql' });
// Contract fixture only; never offered for production tenant onboarding.
const restaurantFixture = Object.freeze({ key: 'restaurant_fixture', version: 1, title: { en: 'Restaurant fixture', ar: 'نموذج مطعم للاختبار' }, public: false, seatRoles: Object.freeze(['owner', 'accountant', 'manager', 'agent']), capabilities: Object.freeze(['messaging.inbox', 'crm.contacts', 'team.tasks', 'tenant.settings']), migration: '20261001_platform_identity.sql' });
function getCategory(key, version) { return [trainingCenter, salemaxSales, restaurantFixture].find(c => c.key === key && c.version === version) || null; }
function supportsBusinessCapability(category, capability) {
  return category?.public === true && Array.isArray(category.capabilities) && category.capabilities.includes(capability);
}
function supportsCategoryCapability(category, capability) {
  return Boolean(category && Array.isArray(category.capabilities) && category.capabilities.includes(capability));
}
module.exports = { trainingCenter, salemaxSales, restaurantFixture, getCategory, supportsBusinessCapability, supportsCategoryCapability };
