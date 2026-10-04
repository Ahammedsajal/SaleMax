const { capabilities } = require('./policy');
const trainingCenter = Object.freeze({ key: 'training_center', version: 1, title: { en: 'Training center', ar: 'مركز تدريب' }, public: true, capabilities: Object.freeze(Object.keys(capabilities)), migration: '20261001_platform_identity.sql' });
// Contract fixture only; never offered for production tenant onboarding.
const restaurantFixture = Object.freeze({ key: 'restaurant_fixture', version: 1, title: { en: 'Restaurant fixture', ar: 'نموذج مطعم للاختبار' }, public: false, capabilities: Object.freeze(['messaging.inbox', 'crm.contacts', 'team.tasks', 'tenant.settings']), migration: '20261001_platform_identity.sql' });
function getCategory(key, version) { return [trainingCenter, restaurantFixture].find(c => c.key === key && c.version === version) || null; }
function supportsBusinessCapability(category, capability) {
  return category?.public === true && Array.isArray(category.capabilities) && category.capabilities.includes(capability);
}
module.exports = { trainingCenter, restaurantFixture, getCategory, supportsBusinessCapability };
