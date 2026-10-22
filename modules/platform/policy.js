const permissions = {
  'tenant.read': { owner: 'tenant', accountant: 'tenant', manager: 'tenant', agent: 'tenant' },
  'tenant.manage': { owner: 'tenant' },
  'team.read': { owner: 'tenant', manager: 'tenant', team_leader: 'team' },
  'team.invite': { owner: 'tenant' },
  'channels.configure': { owner: 'tenant' },
  'automation.manage': { owner: 'tenant' },
  'campaigns.manage': { owner: 'tenant' },
  'conversations.read': { owner: 'tenant', manager: 'tenant', team_leader: 'team', agent: 'assigned' },
  'conversations.reply': { owner: 'tenant', manager: 'tenant', agent: 'assigned' },
  'leads.read': { owner: 'tenant', accountant: 'billing', manager: 'tenant', team_leader: 'team', agent: 'assigned' },
  'leads.manage': { owner: 'tenant', manager: 'tenant', team_leader: 'team', agent: 'assigned' },
  'leads.assign': { owner: 'tenant', manager: 'tenant' },
  'contacts.read': { owner: 'tenant', accountant: 'billing', manager: 'tenant', team_leader: 'team', agent: 'assigned' },
  'contacts.manage': { owner: 'tenant', manager: 'tenant' },
  'products.read': { owner: 'tenant', manager: 'tenant', team_leader: 'tenant', agent: 'tenant' },
  'products.manage': { owner: 'tenant', manager: 'tenant' },
  'courses.read': { owner: 'tenant', accountant: 'tenant', manager: 'tenant', agent: 'tenant' },
  'courses.manage': { owner: 'tenant', manager: 'tenant' },
  'sales.request': { owner: 'tenant', manager: 'tenant', agent: 'assigned' },
  'sales.approve': { owner: 'tenant', manager: 'tenant' },
  'deals.read': { owner: 'tenant', manager: 'sales', team_leader: 'team', agent: 'own' },
  'deals.request': { owner: 'tenant', manager: 'sales', team_leader: 'team', agent: 'assigned' },
  'deals.approve': { owner: 'tenant', manager: 'sales' },
  'commission.policy.manage': { owner: 'tenant' },
  'commissions.read': { owner: 'tenant', accountant: 'finance', manager: 'sales', team_leader: 'team', agent: 'own' },
  'commission.payout.approve': { accountant: 'finance' },
  'commission.payout.pay': { accountant: 'finance' },
  'sales.finance.read': { owner: 'tenant', accountant: 'finance', manager: 'summary' },
  'targets.read': { owner: 'tenant', manager: 'sales', team_leader: 'team', agent: 'own' },
  'targets.manage': { owner: 'tenant', manager: 'sales' },
  'sales.invoice.issue': { owner: 'tenant', accountant: 'finance' },
  'sales.receipt.record': { owner: 'tenant', accountant: 'finance' },
  'sales.receipt.allocate': { owner: 'tenant', accountant: 'finance' },
  'sales.finance.report': { owner: 'tenant', accountant: 'finance', manager: 'summary' },
  'invoices.read': { owner: 'tenant', accountant: 'tenant', manager: 'summary' },
  'invoices.issue': { owner: 'tenant', accountant: 'tenant', manager: 'tenant' },
  'payments.verify': { owner: 'tenant', accountant: 'tenant', manager: 'tenant' },
  'receipts.read': { owner: 'tenant', accountant: 'tenant', manager: 'tenant' },
  'credits.prepare': { owner: 'tenant', accountant: 'tenant' },
  'credits.approve': { owner: 'tenant' },
  'reports.read': { owner: 'tenant', accountant: 'finance', manager: 'sales', team_leader: 'team', agent: 'own' },
  'reports.schedule': { owner: 'tenant' },
  'forms.manage': { owner: 'tenant', manager: 'tenant' },
  'forms.capture': { owner: 'tenant', manager: 'tenant', agent: 'assigned' },
  'tasks.read': { owner: 'tenant', accountant: 'assigned', manager: 'tenant', team_leader: 'team', agent: 'assigned' },
  'tasks.manage': { owner: 'tenant', accountant: 'assigned', manager: 'tenant', team_leader: 'team', agent: 'assigned' },
  'calls.read': { owner: 'tenant', manager: 'tenant', team_leader: 'team', agent: 'assigned' },
  'calls.coaching.read': { owner: 'tenant', manager: 'sales', team_leader: 'team', agent: 'own' },
  'calls.coaching.write': { owner: 'tenant', manager: 'sales', team_leader: 'team' },
  'calls.recording.listen': { owner: 'tenant', manager: 'tenant', team_leader: 'team', agent: 'assigned' },
  'calls.recording.manage': { owner: 'tenant' },
  'calls.control': { owner: 'tenant', manager: 'tenant', team_leader: 'team', agent: 'assigned' },
  'calls.manage': { owner: 'tenant', manager: 'tenant' },
  'templates.manage': { owner: 'tenant' },
  'recruitment.manage': { owner: 'tenant' },
  'properties.read': { owner: 'tenant', manager: 'tenant', team_leader: 'team', agent: 'assigned' },
  'properties.manage': { owner: 'tenant', manager: 'tenant' },
  'properties.assign': { owner: 'tenant', manager: 'tenant' },
  'inventory.read': { owner: 'tenant', accountant: 'tenant', manager: 'tenant', agent: 'tenant' },
  'inventory.adjust': { owner: 'tenant', manager: 'tenant' },
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
  'sales.deals': ['deals.read', 'deals.request', 'deals.approve'],
  'sales.commissions': ['commission.policy.manage', 'commissions.read', 'commission.payout.approve', 'commission.payout.pay'],
  'sales.finance': ['sales.finance.read','sales.invoice.issue','sales.receipt.record','sales.receipt.allocate','sales.finance.report'],
  'sales.targets': ['targets.read','targets.manage'],
  'products.catalog': ['products.read','products.manage'],
  'hr.recruitment': ['recruitment.manage'],
  'realestate.listings': ['properties.read','properties.manage','properties.assign'],
  'retail.inventory': ['inventory.read','inventory.adjust'],
  'campaigns.dashboard': ['campaigns.manage'], 'crm.leads': ['leads.read', 'leads.manage', 'leads.assign'],
  'crm.contacts': ['contacts.read', 'contacts.manage'], 'team.members': ['team.read', 'team.invite'],
  'team.tasks': ['tasks.read', 'tasks.manage'], 'training.courses': ['courses.read', 'courses.manage'],
  'telephony.call-center': ['calls.read', 'calls.coaching.read', 'calls.coaching.write', 'calls.control', 'calls.manage', 'calls.recording.listen', 'calls.recording.manage'],
  'training.batches': ['courses.read', 'courses.manage'], 'training.enrollments': ['sales.request', 'sales.approve'],
  'finance.invoices': ['invoices.read', 'invoices.issue'], 'finance.installments': ['invoices.read'],
  'finance.payments': ['invoices.read', 'payments.verify'], 'finance.receipts': ['receipts.read'],
  'finance.credits': ['credits.prepare', 'credits.approve'], 'reports.read': ['reports.read'],
  'reports.schedule': ['reports.schedule'], 'portal.forms': ['forms.manage', 'forms.capture'],
  'tenant.settings': ['tenant.read', 'tenant.manage'],
});
function scopeFor(membership, permission) {
  if (!Object.hasOwn(permissions, permission)) return null;
  // Listing reads use the persisted assignee and current Sales Organization
  // hierarchy. Custom grants cannot widen these scopes.
  if (permission.startsWith('properties.') && !['owner','manager'].includes(membership.role) && permission!=='properties.read') return null;
  // A custom role is an additional restriction on its fixed seat role. It can
  // never create a permission or scope that the seat role itself lacks.
  if (Array.isArray(membership.customPermissions) && !membership.customPermissions.includes(permission)) return null;
  const base = Object.hasOwn(permissions[permission], membership.role) ? permissions[permission][membership.role] : null;
  if (base) return base;
  // Explicit business-role grants can add modules to a staff seat. Keeping the
  // seat role unchanged preserves assigned-chat scope and approval separation.
  if (['manager','team_leader','agent'].includes(membership.role) &&
      membership.customPermissions?.includes(permission)) return 'tenant';
  // Delegations cannot change finance/owner authority or elevate an agent.
  return membership.role === 'manager' && delegationAllowlist.includes(permission) &&
    (membership.delegatedPermissions?.includes(permission) || membership.customPermissions?.includes(permission)) ? 'tenant' : null;
}
function explicitlyGranted(context,permission){
  return context?.membership?.status==='active' &&
    ['manager','team_leader','agent'].includes(context.membership.role) &&
    context.membership.customPermissions?.includes(permission)===true;
}
function decision(context, { capability, permission, resource, external = false }) {
  if (!context || context.audience !== 'tenant') return { allowed: false, code: 'TENANT_CONTEXT_REQUIRED' };
  const { tenant, membership, subscription, category } = context;
  if (!tenant || !membership || tenant.id !== membership.tenantId) return { allowed: false, code: 'TENANT_CONTEXT_INVALID' };
  if (tenant.status !== 'active' || membership.status !== 'active') return { allowed: false, code: 'ACCOUNT_INACTIVE' };
  if (resource && resource.tenantId !== tenant.id) return { allowed: false, code: 'RESOURCE_NOT_FOUND' };
  if (!Object.hasOwn(capabilities, capability) || !capabilities[capability].includes(permission)) return { allowed: false, code: 'CAPABILITY_PERMISSION_INVALID' };
  if (!category || category.key !== tenant.categoryKey || category.version !== tenant.categoryVersion || !Array.isArray(category.capabilities) || !category.capabilities.includes(capability)) return { allowed: false, code: 'CATEGORY_UNAVAILABLE' };
  // Canonical entitlements carry both fields. Reject explicit/partial mismatches
  // before category-specific exceptions; old in-process contexts may omit both.
  if(subscription&&(Object.hasOwn(subscription,'categoryKey')||Object.hasOwn(subscription,'categoryVersion'))&&
      (subscription.categoryKey!==category.key||subscription.categoryVersion!==category.version))return {allowed:false,code:'FEATURE_UNAVAILABLE'};
  const internalRecruitmentOwner = capability === 'hr.recruitment' && category.key === '7network_sales' && membership.role === 'owner';
  // Recruitment is an owner-only internal 7Network workspace feature, not a customer plan add-on.
  // Keep the tenant's active-plan requirement while avoiding mutation of its published plan version.
  if (!subscription || !['active', 'trial', 'grace'].includes(subscription.status) || !Array.isArray(subscription.capabilities) || (!internalRecruitmentOwner && !subscription.capabilities.includes(capability))) return { allowed: false, code: 'FEATURE_UNAVAILABLE' };
  // Internal 7Network accountants work from Finance and payout records. The
  // legacy Sales Lead Pipeline does not provide the finance-only detail view.
  // Keep Training Center billing-linked lead access unchanged.
  if (category.key === '7network_sales' && membership.role === 'accountant' &&
      ['leads.read', 'contacts.read'].includes(permission)) {
    return { allowed: false, code: 'PERMISSION_DENIED' };
  }
  const canManageTeam = ['7network_sales','training_center'].includes(category.key) &&
    membership.role === 'manager' && permission === 'team.invite' &&
    (!Array.isArray(membership.customPermissions) || membership.customPermissions.includes(permission));
  const scope = canManageTeam ? 'tenant' : scopeFor(membership, permission);
  if (!scope) return { allowed: false, code: 'PERMISSION_DENIED' };
  // Once an owner has configured a member's sidebar, that assignment also
  // constrains the corresponding canonical module APIs. A missing value keeps
  // existing memberships on their established role-based behavior.
  if (Array.isArray(membership.assignedNavigation)) {
    const matchingKeys = require('./navigation').keysForCapability(capability);
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
module.exports = { permissions, capabilities, scopeFor, explicitlyGranted, decision, platformDecision, delegationAllowlist, platformStaffAllowlist, platformAdminAllowlist, platformPermissions };
