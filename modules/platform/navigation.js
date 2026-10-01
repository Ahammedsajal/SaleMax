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
  return items.filter(item => decision(context, item).allowed).map(item => ({ ...item, scope: decision(context, item).scope }));
}
module.exports = { items, navigationFor };
