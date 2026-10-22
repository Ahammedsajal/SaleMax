const { decision } = require('./policy');
const items = [
  ['dashboard', 'tenant.settings', 'tenant.read', 'Dashboard', 'لوحة التحكم', 'Overview', 'نظرة عامة'],
  ['notifications', 'tenant.settings', 'tenant.read', 'Web Notifications', 'إشعارات الويب', 'Overview', 'نظرة عامة'],
  ['inbox', 'messaging.inbox', 'conversations.read', 'Inbox', 'صندوق الوارد', 'Conversations', 'المحادثات'],
  ['whatsapp-qr', 'messaging.qr', 'channels.configure', 'Add WhatsApp by QR', 'إضافة واتساب عبر QR', 'Conversations', 'المحادثات'],
  ['whatsapp-meta', 'messaging.meta', 'channels.configure', 'Link Meta WhatsApp', 'ربط واتساب ميتا', 'Conversations', 'المحادثات'],
  ['flows', 'automation.flows', 'automation.manage', 'Automation Flows', 'مسارات الأتمتة', 'Automation', 'الأتمتة'],
  ['chatbot', 'automation.chatbot', 'automation.manage', 'WA Chatbot', 'روبوت محادثة واتساب', 'Automation', 'الأتمتة'],
  ['templates', 'messaging.templates', 'templates.manage', 'Create Meta Template', 'إنشاء قالب ميتا', 'Marketing', 'التسويق'],
  ['campaigns', 'campaigns.send', 'campaigns.manage', 'Send Campaign', 'إرسال حملة', 'Marketing', 'التسويق'],
  ['campaign-dashboard', 'campaigns.dashboard', 'campaigns.manage', 'Campaign Dashboard', 'لوحة الحملات', 'Marketing', 'التسويق'],
  ['leads', 'crm.leads', 'leads.read', 'Lead Pipeline', 'مسار العملاء المحتملين', 'Sales', 'المبيعات'],
  ['contacts', 'crm.contacts', 'contacts.read', 'Phonebook', 'دليل الهاتف', 'Sales', 'المبيعات'],
  ['agent-login', 'team.members', 'team.read', 'Agent Login', 'دخول الوكلاء', 'Sales', 'المبيعات'],
  ['tasks', 'team.tasks', 'tasks.read', 'Tasks', 'المهام', 'Sales', 'المبيعات'],
  ['call-center', 'telephony.call-center', 'calls.read', 'Call Center', 'مركز الاتصال', 'Sales', 'المبيعات'],
  ['sales-deals', 'sales.deals', 'deals.read', 'Sales Deals', 'صفقات المبيعات', 'Sales', 'المبيعات'],
  ['sales-commissions', 'sales.commissions', 'commissions.read', 'My Commissions', 'عمولاتي', 'Sales', 'المبيعات'],
  ['sales-finance', 'sales.finance', 'sales.finance.read', 'Sales Finance', 'مالية المبيعات', 'Finance', 'المالية'],
  ['sales-audit', 'tenant.settings', 'tenant.manage', 'Audit Trail', 'سجل التدقيق', 'Administration', 'الإدارة'],
  ['sales-targets', 'sales.targets', 'targets.read', 'Sales Targets', 'أهداف المبيعات', 'Sales', 'المبيعات'],
  ['icp', 'sales.icp', 'icp.read', 'ICP', 'ملف العميل المثالي', 'Sales', 'المبيعات'],
  ['sales-organization', 'team.members', 'team.read', 'Organization', 'الهيكل التنظيمي', 'Sales', 'المبيعات'],
  ['commission-policy', 'sales.commissions', 'commission.policy.manage', 'Commission Policy', 'سياسة العمولات', 'Administration', 'الإدارة'],
  ['products-services', 'products.catalog', 'products.read', 'Products & services', 'المنتجات والخدمات', 'Sales', 'المبيعات'],
  ['properties', 'realestate.listings', 'properties.read', 'Properties', 'العقارات', 'Real Estate', 'العقارات'],
  ['courses', 'training.courses', 'courses.read', 'Courses', 'الدورات', 'Training', 'التدريب'],
  ['batches', 'training.batches', 'courses.read', 'Batches', 'المجموعات', 'Training', 'التدريب'],
  ['enrollments', 'training.enrollments', 'sales.request', 'Enrollments', 'التسجيلات', 'Training', 'التدريب'],
  ['students', 'training.courses', 'courses.manage', 'Students', 'الطلاب', 'Training', 'التدريب'],
  ['training-profile', 'training.courses', 'courses.manage', 'Center profile', 'ملف المركز', 'Training', 'التدريب'],
  ['invoices', 'finance.invoices', 'invoices.read', 'Invoices & Payments', 'الفواتير والمدفوعات', 'Finance', 'المالية'],
  ['installments', 'finance.installments', 'invoices.read', 'Installments', 'الأقساط', 'Finance', 'المالية'],
  ['payments', 'finance.payments', 'payments.verify', 'Payments', 'المدفوعات', 'Finance', 'المالية'],
  ['receipts', 'finance.receipts', 'receipts.read', 'Receipts', 'الإيصالات', 'Finance', 'المالية'],
  ['credits', 'finance.credits', 'credits.prepare', 'Credits and Refunds', 'الإشعارات الدائنة والاسترداد', 'Finance', 'المالية'],
  ['reports', 'reports.read', 'reports.read', 'Lead Reports', 'تقارير العملاء المحتملين', 'Insights', 'الإحصاءات'],
  ['finance-reports', 'reports.read', 'reports.read', 'Finance Reports', 'تقارير المالية', 'Finance', 'المالية'],
  ['faqs', 'automation.chatbot', 'automation.manage', 'FAQs', 'الأسئلة الشائعة', 'Automation', 'الأتمتة'],
  ['scheduled-reports', 'reports.schedule', 'reports.schedule', 'Scheduled Reports', 'التقارير المجدولة', 'Insights', 'الإحصاءات'],
  ['forms', 'portal.forms', 'forms.manage', 'Candidate Applications', 'طلبات المتقدمين', 'Portal leads', 'عملاء البوابة'],
  ['recruitment', 'hr.recruitment', 'recruitment.manage', 'Applications & CVs', 'طلبات التوظيف والسير الذاتية', 'Administration', 'الإدارة'],
  ['team', 'team.members', 'team.read', 'Team access', 'إدارة وصول الفريق', 'Administration', 'الإدارة'],
  ['settings', 'tenant.settings', 'tenant.manage', 'Business Settings', 'إعدادات الأعمال', 'Administration', 'الإدارة'],
].map(([key, capability, permission, en, ar, groupEn, groupAr]) => Object.freeze({ key, capability, permission, path: '/user/' + key, label: { en, ar }, group: { en: groupEn, ar: groupAr },ownerOnly:['recruitment','training-profile'].includes(key),sidebar:!['batches','enrollments','installments','payments','receipts','credits','scheduled-reports'].includes(key) }));
function navigationFor(context) {
  if (context?.audience !== 'tenant' || context.tenant?.status !== 'active' || context.membership?.status !== 'active' || context.membership?.tenantId !== context.tenant?.id) return [];
  // Internal Sales accountants work from finance and payout workspaces only.
  // Finance overview, invoices, reconciliation and finance reports are views
  // inside Sales Finance; commission payouts are a separate workspace.
  const visible = context.category?.key === '7network_sales' && context.membership.role === 'accountant'
    ? items.filter(item => ['sales-finance', 'sales-commissions'].includes(item.key))
    : items;
  return visible.filter(item => (!item.ownerOnly||context.membership.role==='owner') && decision(context, item).allowed &&
    (item.key!=='finance-reports'||decision(context,{capability:'finance.invoices',permission:'invoices.read'}).allowed))
    .map(item => ({ ...item, scope: decision(context, item).scope }));
}

function parseSidebar(value){
  if(value==null)return null;
  try{const result=typeof value==='string'?JSON.parse(value):value;
    if(Array.isArray(result)&&result.length<=items.length&&new Set(result).size===result.length&&result.every(key=>items.some(item=>item.key===key)))return result;
  }catch{}
  throw Object.assign(Error('INVALID_ROLE_NAVIGATION'),{code:'INVALID_ROLE_NAVIGATION',status:400});
}
function filterSidebar(rows,selection){const selected=parseSidebar(selection);return rows.filter(item=>item.sidebar!==false&&(selected===null?!item.optIn:selected.includes(item.key)));}
async function sidebarForMembership(pool,context,rows){
  if(!context.membership.roleProfileId)return filterSidebar(rows,null);
  const [roles]=await pool.query('SELECT navigation AS sidebarNavigation FROM sx_team_roles WHERE tenant_id=? AND id=?',[context.tenant.id,context.membership.roleProfileId]);
  if(roles.length!==1)throw Object.assign(Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED',status:403});
  return filterSidebar(rows,roles[0].sidebarNavigation);
}
// The existing Finance screen contains invoices, installments, payments and
// receipts in one workspace. A screen assignment admits those views; the
// member's action permissions still decide which operations are available.
function keysForCapability(capability){
  if(['finance.invoices','finance.installments','finance.payments','finance.receipts'].includes(capability))return ['invoices','installments','payments','receipts'];
  return items.filter(item=>item.capability===capability).map(item=>item.key);
}
module.exports = { items, navigationFor, keysForCapability,parseSidebar,filterSidebar,sidebarForMembership };
