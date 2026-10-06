const permissions = {
  'tenant.read': { owner: 'tenant', accountant: 'tenant', manager: 'tenant', agent: 'tenant' },
  'tenant.manage': { owner: 'tenant' },
  'team.read': { owner: 'tenant', manager: 'tenant' },
  'team.invite': { owner: 'tenant' },
  'channels.configure': { owner: 'tenant' },
  'automation.manage': { owner: 'tenant' },
  'campaigns.manage': { owner: 'tenant' },
  'conversations.read': { owner: 'tenant', manager: 'tenant', agent: 'assigned' },
  'conversations.reply': { owner: 'tenant', manager: 'tenant', agent: 'assigned' },
  'leads.read': { owner: 'tenant', accountant: 'billing', manager: 'tenant', agent: 'assigned' },
  'leads.manage': { owner: 'tenant', manager: 'tenant', agent: 'assigned' },
  'leads.assign': { owner: 'tenant', manager: 'tenant' },
  'contacts.read': { owner: 'tenant', accountant: 'billing', manager: 'tenant', agent: 'assigned' },
  'contacts.manage': { owner: 'tenant', manager: 'tenant' },
  'courses.read': { owner: 'tenant', accountant: 'tenant', manager: 'tenant', agent: 'tenant' },
  'courses.manage': { owner: 'tenant', manager: 'tenant' },
  'sales.request': { owner: 'tenant', manager: 'tenant', agent: 'assigned' },
  'sales.approve': { owner: 'tenant', manager: 'tenant' },
  'invoices.read': { owner: 'tenant', accountant: 'tenant', manager: 'summary' },
  'invoices.issue': { owner: 'tenant', accountant: 'tenant' },
  'payments.verify': { owner: 'tenant', accountant: 'tenant' },
  'receipts.read': { owner: 'tenant', accountant: 'tenant' },
  'credits.prepare': { owner: 'tenant', accountant: 'tenant' },
  'credits.approve': { owner: 'tenant' },
  'reports.read': { owner: 'tenant', accountant: 'finance', manager: 'sales', agent: 'own' },
  'reports.schedule': { owner: 'tenant' },
  'forms.manage': { owner: 'tenant', manager: 'tenant' },
  'forms.capture': { owner: 'tenant', manager: 'tenant', agent: 'assigned' },
  'tasks.read': { owner: 'tenant', accountant: 'assigned', manager: 'tenant', agent: 'assigned' },
  'tasks.manage': { owner: 'tenant', accountant: 'assigned', manager: 'tenant', agent: 'assigned' },
  'calls.read': { owner: 'tenant', manager: 'tenant', agent: 'assigned' },
  'calls.control': { owner: 'tenant', manager: 'tenant', agent: 'assigned' },
  'calls.manage': { owner: 'tenant', manager: 'tenant' },
  'templates.manage': { owner: 'tenant' },
};
const delegationAllowlist = Object.freeze(['team.invite', 'channels.configure', 'automation.manage', 'campaigns.manage', 'templates.manage']);
const platformStaffAllowlist = Object.freeze(['tenants.read', 'tenants.create', 'tenants.manage', 'plans.read', 'plans.draft', 'plans.assign', 'plans.publish', 'support.request', 'incidents.read', 'telephony.configure']);
const platformAdminAllowlist = Object.freeze([...platformStaffAllowlist, 'tenants.category-change', 'bots.assign']);
const platformPermissions = Object.freeze([...platformAdminAllowlist, 'owner.recover', 'owner.transfer', 'staff.manage', 'categories.manage', 'tenants.owner-transfer', 'providers.configure', 'features.release', 'audit.read', 'exports.create']);
const capabilities = Object.freeze({
  'messaging.inbox': ['conversations.read', 'conversations.reply'],
  'messaging.qr': ['channels.configure'], 'messaging.meta': ['channels.configure'],
  'automation.flows': ['automation.manage'], 'automation.chatbot': ['automation.manage'],
  'messaging.templates': ['templates.manage'], 'campaigns.send': ['campaigns.manage'],
  'campaigns.dashboard': ['campaigns.manage'], 'crm.leads': ['leads.read', 'leads.manage', 'leads.assign'],
  'crm.contacts': ['contacts.read', 'contacts.manage'], 'team.members': ['team.read', 'team.invite'],
  'team.tasks': ['tasks.read', 'tasks.manage'], 'training.courses': ['courses.read', 'courses.manage'],
  'telephony.call-center': ['calls.read', 'calls.control', 'calls.manage'],
  'training.batches': ['courses.read', 'courses.manage'], 'training.enrollments': ['sales.request', 'sales.approve'],
  'finance.invoices': ['invoices.read', 'invoices.issue'], 'finance.installments': ['invoices.read'],
  'finance.payments': ['invoices.read', 'payments.verify'], 'finance.receipts': ['receipts.read'],
  'finance.credits': ['credits.prepare', 'credits.approve'], 'reports.read': ['reports.read'],
  'reports.schedule': ['reports.schedule'], 'portal.forms': ['forms.manage', 'forms.capture'],
  'tenant.settings': ['tenant.read', 'tenant.manage'],
});
function scopeFor(membership, permission) {
  if (!Object.hasOwn(permissions, permission)) return null;
  // A custom role is an additional restriction on its fixed seat role. It can
  // never create a permission or scope that the seat role itself lacks.
  if (Array.isArray(membership.customPermissions) && !membership.customPermissions.includes(permission)) return null;
  const base = Object.hasOwn(permissions[permission], membership.role) ? permissions[permission][membership.role] : null;
  if (base) return base;
  // Delegations cannot change finance/owner authority or elevate an agent.
  return membership.role === 'manager' && delegationAllowlist.includes(permission) &&
    (membership.delegatedPermissions?.includes(permission) || membership.customPermissions?.includes(permission)) ? 'tenant' : null;
}
function decision(context, { capability, permission, resource, external = false }) {
  if (!context || context.audience !== 'tenant') return { allowed: false, code: 'TENANT_CONTEXT_REQUIRED' };
  const { tenant, membership, subscription, category } = context;
  if (!tenant || !membership || tenant.id !== membership.tenantId) return { allowed: false, code: 'TENANT_CONTEXT_INVALID' };
  if (tenant.status !== 'active' || membership.status !== 'active') return { allowed: false, code: 'ACCOUNT_INACTIVE' };
  if (resource && resource.tenantId !== tenant.id) return { allowed: false, code: 'RESOURCE_NOT_FOUND' };
  if (!Object.hasOwn(capabilities, capability) || !capabilities[capability].includes(permission)) return { allowed: false, code: 'CAPABILITY_PERMISSION_INVALID' };
  if (!category || category.key !== tenant.categoryKey || category.version !== tenant.categoryVersion || !Array.isArray(category.capabilities) || !category.capabilities.includes(capability)) return { allowed: false, code: 'CATEGORY_UNAVAILABLE' };
  if (!subscription || !['active', 'trial', 'grace'].includes(subscription.status) || !Array.isArray(subscription.capabilities) || !subscription.capabilities.includes(capability)) return { allowed: false, code: 'FEATURE_UNAVAILABLE' };
  const scope = scopeFor(membership, permission);
  if (!scope) return { allowed: false, code: 'PERMISSION_DENIED' };
  // Once an owner has configured a member's sidebar, that assignment also
  // constrains the corresponding canonical module APIs. A missing value keeps
  // existing memberships on their established role-based behavior.
  if (Array.isArray(membership.assignedNavigation)) {
    const menuItems = require('./navigation').items;
    const matchingKeys = menuItems.filter(item => item.capability === capability).map(item => item.key);
    if (matchingKeys.length && !matchingKeys.some(key => membership.assignedNavigation.includes(key))) {
      return { allowed: false, code: 'PERMISSION_DENIED' };
    }
  }
  if (resource) {
    if (scope === 'assigned' && resource.assignedMembershipId !== membership.id) return { allowed: false, code: 'RESOURCE_NOT_FOUND' };
    if (scope === 'own' && resource.subjectMembershipId !== membership.id) return { allowed: false, code: 'RESOURCE_NOT_FOUND' };
    if (scope === 'billing' && resource.billingLinked !== true) return { allowed: false, code: 'RESOURCE_NOT_FOUND' };
  }
  if (external && context.runtimeReady?.[capability] !== true) return { allowed: false, code: 'PROVIDER_NOT_READY' };
  return { allowed: true, scope };
}
function platformDecision(context, permission) {
  if (!context || context.audience !== 'platform' || context.membership?.status !== 'active' || !platformPermissions.includes(permission) || context.mfaVerified !== true) return false;
  // Platform MFA is verified once when the existing administrator signs in.
  // Sensitive actions remain permission-checked and audited, but do not trigger
  // another password/MFA prompt during that authenticated platform session.
  if (context.membership.role === 'super_admin') return true;
  if (context.membership.role === 'platform_admin') return platformAdminAllowlist.includes(permission);
  return context.membership.role === 'staff' && platformStaffAllowlist.includes(permission) && context.membership.delegatedPermissions?.includes(permission) === true;
}
module.exports = { permissions, capabilities, scopeFor, decision, platformDecision, delegationAllowlist, platformStaffAllowlist, platformAdminAllowlist, platformPermissions };
