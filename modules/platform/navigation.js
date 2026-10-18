const { decision } = require('./policy');
const items = [
  ['dashboard', 'tenant.settings', 'tenant.read', 'Dashboard', 'لوحة التحكم', 'Overview', 'نظرة عامة'],
  ['inbox', 'messaging.inbox', 'conversations.read', 'Inbox', 'صندوق الوارد', 'Conversations', 'المحادثات'],
  ['whatsapp-qr', 'messaging.qr', 'channels.configure', 'Add WhatsApp by QR', 'إضافة واتساب عبر QR', 'Conversations', 'المحادثات'],
  ['whatsapp-meta', 'messaging.meta', 'channels.configure', 'Link Meta WhatsApp', 'ربط واتساب ميتا', 'Conversations', 'المحادثات'],
  ['flows', 'automation.flows', 'automation.manage', 'Automation Flows', 'مسارات الأتمتة', 'Automation', 'الأتمتة'],
  ['chatbot', 'automation.chatbot', 'automation.manage', 'Chatbot', 'روبوت المحادثة', 'Automation', 'الأتمتة'],
  ['templates', 'messaging.templates', 'templates.manage', 'Create Meta Template', 'إنشاء قالب ميتا', 'Marketing', 'التسويق'],
  ['campaigns', 'campaigns.send', 'campaigns.manage', 'Send Campaign', 'إرسال حملة', 'Marketing', 'التسويق'],
  ['campaign-dashboard', 'campaigns.dashboard', 'campaigns.manage', 'Campaign Dashboard', 'لوحة الحملات', 'Marketing', 'التسويق'],
  ['leads', 'crm.leads', 'leads.read', 'Lead Pipeline', 'مسار العملاء المحتملين', 'Sales', 'المبيعات'],
  ['contacts', 'crm.contacts', 'contacts.read', 'Phonebook', 'دليل الهاتف', 'Sales', 'المبيعات'],
  ['agent-login', 'team.members', 'team.read', 'Agent Login', 'دخول الوكلاء', 'Sales', 'المبيعات'],
  ['tasks', 'team.tasks', 'tasks.read', 'Agent Task', 'مهام الوكلاء', 'Sales', 'المبيعات'],
  ['call-center', 'telephony.call-center', 'calls.read', 'Call Center', 'مركز الاتصال', 'Sales', 'المبيعات'],
  ['sales-deals', 'sales.deals', 'deals.read', 'Sales Deals', 'صفقات المبيعات', 'Sales', 'المبيعات'],
  ['sales-commissions', 'sales.commissions', 'commissions.read', 'My Commissions', 'عمولاتي', 'Sales', 'المبيعات'],
  ['sales-finance', 'sales.finance', 'sales.finance.read', 'Sales Finance', 'مالية المبيعات', 'Finance', 'المالية'],
  ['sales-audit', 'tenant.settings', 'tenant.manage', 'Audit Trail', 'سجل التدقيق', 'Administration', 'الإدارة'],
  ['sales-targets', 'sales.targets', 'targets.read', 'Sales Targets', 'أهداف المبيعات', 'Sales', 'المبيعات'],
  ['sales-organization', 'team.members', 'team.read', 'Organization', 'الهيكل التنظيمي', 'Sales', 'المبيعات'],
  ['commission-policy', 'sales.commissions', 'commission.policy.manage', 'Commission Policy', 'سياسة العمولات', 'Administration', 'الإدارة'],
  ['courses', 'training.courses', 'courses.read', 'Courses', 'الدورات', 'Training', 'التدريب'],
  ['batches', 'training.batches', 'courses.read', 'Batches', 'المجموعات', 'Training', 'التدريب'],
  ['enrollments', 'training.enrollments', 'sales.request', 'Enrollments', 'التسجيلات', 'Training', 'التدريب'],
  ['invoices', 'finance.invoices', 'invoices.read', 'Invoices', 'الفواتير', 'Finance', 'المالية'],
  ['installments', 'finance.installments', 'invoices.read', 'Installments', 'الأقساط', 'Finance', 'المالية'],
  ['payments', 'finance.payments', 'payments.verify', 'Payments', 'المدفوعات', 'Finance', 'المالية'],
  ['receipts', 'finance.receipts', 'receipts.read', 'Receipts', 'الإيصالات', 'Finance', 'المالية'],
  ['credits', 'finance.credits', 'credits.prepare', 'Credits and Refunds', 'الإشعارات الدائنة والاسترداد', 'Finance', 'المالية'],
  ['reports', 'reports.read', 'reports.read', 'Reports', 'التقارير', 'Insights', 'الإحصاءات'],
  ['scheduled-reports', 'reports.schedule', 'reports.schedule', 'Scheduled Reports', 'التقارير المجدولة', 'Insights', 'الإحصاءات'],
  ['forms', 'portal.forms', 'forms.manage', 'Lead Forms', 'نماذج العملاء المحتملين', 'Portal leads', 'عملاء البوابة'],
  ['team', 'team.members', 'team.read', 'Team and Roles', 'الفريق والأدوار', 'Administration', 'الإدارة'],
  ['settings', 'tenant.settings', 'tenant.manage', 'Business Settings', 'إعدادات الأعمال', 'Administration', 'الإدارة'],
].map(([key, capability, permission, en, ar, groupEn, groupAr]) => Object.freeze({ key, capability, permission, path: '/user/' + key, label: { en, ar }, group: { en: groupEn, ar: groupAr } }));
function navigationFor(context) {
  if (context?.audience !== 'tenant' || context.tenant?.status !== 'active' || context.membership?.status !== 'active' || context.membership?.tenantId !== context.tenant?.id) return [];
  // Internal Sales accountants work from finance and payout workspaces only.
  // Finance overview, invoices, reconciliation and finance reports are views
  // inside Sales Finance; commission payouts are a separate workspace.
  const visible = context.category?.key === 'salemax_sales' && context.membership.role === 'accountant'
    ? items.filter(item => ['sales-finance', 'sales-commissions'].includes(item.key))
    : items;
  return visible.filter(item => decision(context, item).allowed).map(item => ({ ...item, scope: decision(context, item).scope }));
}
// The existing Finance screen contains invoices, installments, payments and
// receipts in one workspace. A screen assignment admits those views; the
// member's action permissions still decide which operations are available.
function keysForCapability(capability){
  if(['finance.invoices','finance.installments','finance.payments','finance.receipts'].includes(capability))return ['invoices','installments','payments','receipts'];
  return items.filter(item=>item.capability===capability).map(item=>item.key);
}
module.exports = { items, navigationFor, keysForCapability };
