'use strict';

const {capabilities}=require('./policy');

// These are capability-level modules, not editable permissions. Keeping the
// customer labels beside the policy keys makes the setting safe to validate
// against the exact category and plan contract.
const labels=Object.freeze({
  'messaging.inbox':{en:'Inbox',ar:'صندوق الوارد'},
  'messaging.qr':{en:'WhatsApp QR connection',ar:'ربط واتساب عبر QR'},
  'messaging.meta':{en:'Meta WhatsApp connection',ar:'ربط واتساب ميتا'},
  'messaging.templates':{en:'Message templates',ar:'قوالب الرسائل'},
  'campaigns.send':{en:'Campaigns',ar:'الحملات'},
  'campaigns.dashboard':{en:'Campaign dashboard',ar:'لوحة الحملات'},
  'automation.flows':{en:'Automation flows',ar:'مسارات الأتمتة'},
  'automation.chatbot':{en:'Chatbot and FAQs',ar:'روبوت المحادثة والأسئلة الشائعة'},
  'crm.leads':{en:'Lead pipeline',ar:'مسار العملاء المحتملين'},
  'crm.contacts':{en:'Contacts',ar:'جهات الاتصال'},
  'team.members':{en:'Team access',ar:'إدارة وصول الفريق'},
  'team.tasks':{en:'Tasks',ar:'المهام'},
  'telephony.call-center':{en:'Call center',ar:'مركز الاتصال'},
  'sales.deals':{en:'Sales deals',ar:'صفقات المبيعات'},
  'sales.commissions':{en:'Sales commissions',ar:'عمولات المبيعات'},
  'sales.finance':{en:'Sales finance',ar:'مالية المبيعات'},
  'sales.targets':{en:'Sales targets',ar:'أهداف المبيعات'},
  'products.catalog':{en:'Products and services',ar:'المنتجات والخدمات'},
  'realestate.listings':{en:'Properties',ar:'العقارات'},
  'realestate.requirements':{en:'Buyer requirements',ar:'متطلبات المشترين'},
  'realestate.viewings':{en:'Property viewings',ar:'معاينات العقارات'},
  'training.courses':{en:'Courses and learner records',ar:'الدورات وسجلات المتدربين'},
  'training.batches':{en:'Batches',ar:'المجموعات'},
  'training.enrollments':{en:'Enrollments',ar:'التسجيلات'},
  'finance.invoices':{en:'Invoices',ar:'الفواتير'},
  'finance.installments':{en:'Installments',ar:'الأقساط'},
  'finance.payments':{en:'Payments',ar:'المدفوعات'},
  'finance.receipts':{en:'Receipts',ar:'الإيصالات'},
  'finance.credits':{en:'Credits and refunds',ar:'الإشعارات الدائنة والاسترداد'},
  'reports.read':{en:'Reports',ar:'التقارير'},
  'reports.schedule':{en:'Scheduled reports',ar:'التقارير المجدولة'},
  'portal.forms':{en:'Public forms',ar:'النماذج العامة'},
  'hr.recruitment':{en:'Recruitment applications',ar:'طلبات التوظيف'},
});
const apiEnforcedModules=new Set([
  'products.catalog','sales.deals','sales.commissions','sales.finance','sales.targets',
  'realestate.listings','realestate.requirements','realestate.viewings',
  'training.courses','training.batches','training.enrollments',
  'finance.invoices','finance.installments','finance.payments','finance.receipts','finance.credits',
]);
const dependencies=Object.freeze({
  'realestate.requirements':['realestate.listings'],
  'realestate.viewings':['realestate.listings'],
  'training.batches':['training.courses'],
  'training.enrollments':['training.courses'],
  'finance.installments':['finance.invoices'],
  'finance.payments':['finance.invoices'],
  'finance.receipts':['finance.invoices'],
  'finance.credits':['finance.invoices'],
});

function allowedKeys(ctx){
  const categoryKeys=Array.isArray(ctx?.category?.capabilities)?ctx.category.capabilities:[];
  return new Set(categoryKeys.filter(key=>apiEnforcedModules.has(key)&&Object.hasOwn(capabilities,key)&&Object.hasOwn(labels,key)));
}

function options(ctx){
  const allowed=allowedKeys(ctx),plan=new Set(ctx?.subscription?.capabilities||[]);
  const internalRecruitment=ctx?.category?.key==='7network_sales'&&ctx?.membership?.role==='owner';
  return [...allowed].filter(key=>plan.has(key)||(key==='hr.recruitment'&&internalRecruitment))
    .sort().map(key=>({key,label:labels[key],requires:(dependencies[key]||[]).filter(required=>allowed.has(required)&&(plan.has(required)||(required==='hr.recruitment'&&internalRecruitment)))}));
}

function isDisabled(ctx,key){
  const disabled=ctx?.tenant?.disabledModules;
  if(!Array.isArray(disabled))return false;
  return disabled.includes(key)||(dependencies[key]||[]).some(required=>disabled.includes(required));
}

module.exports={allowedKeys,options,labels,apiEnforcedModules,dependencies,isDisabled};
