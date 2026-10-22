'use strict';

// Source-owned module metadata shared by workspace presentation and tenant
// customization. Categories and plans still decide availability at runtime;
// registering metadata here never grants a capability by itself.
const freezeRows=rows=>Object.freeze(rows.map(row=>Object.freeze({...row,label:row.label&&Object.freeze({...row.label}),requires:row.requires&&Object.freeze([...row.requires])})));

const workspaceModules=freezeRows([
  {key:'inbox',capability:'messaging.inbox',permission:'conversations.read'},
  {key:'phonebook',capability:'crm.contacts',permission:'contacts.read'},
  {key:'products',capability:'products.catalog',permission:'products.read'},
  {key:'properties',capability:'realestate.listings',permission:'properties.read'},
  {key:'courses',capability:'training.courses',permission:'courses.read'},
  {key:'finance',capability:'finance.invoices',permission:'invoices.read'},
  {key:'receipts',capability:'finance.receipts',permission:'receipts.read'},
  {key:'payments',capability:'finance.payments',permission:'payments.verify'},
  {key:'reports',capability:'reports.read',permission:'reports.read'},
]);

const configurableModules=freezeRows([
  {capability:'products.catalog',label:{en:'Products and services',ar:'المنتجات والخدمات'}},
  {capability:'sales.deals',label:{en:'Sales deals',ar:'صفقات المبيعات'}},
  {capability:'sales.commissions',label:{en:'Sales commissions',ar:'عمولات المبيعات'}},
  {capability:'sales.finance',label:{en:'Sales finance',ar:'مالية المبيعات'}},
  {capability:'sales.targets',label:{en:'Sales targets',ar:'أهداف المبيعات'}},
  {capability:'realestate.listings',label:{en:'Properties',ar:'العقارات'}},
  {capability:'realestate.requirements',label:{en:'Buyer requirements',ar:'متطلبات المشترين'},requires:['realestate.listings']},
  {capability:'realestate.viewings',label:{en:'Property viewings',ar:'معاينات العقارات'},requires:['realestate.listings']},
  {capability:'training.courses',label:{en:'Courses and learner records',ar:'الدورات وسجلات المتدربين'}},
  {capability:'training.batches',label:{en:'Batches',ar:'المجموعات'},requires:['training.courses']},
  {capability:'training.enrollments',label:{en:'Enrollments',ar:'التسجيلات'},requires:['training.courses']},
  {capability:'finance.invoices',label:{en:'Invoices',ar:'الفواتير'}},
  {capability:'finance.installments',label:{en:'Installments',ar:'الأقساط'},requires:['finance.invoices']},
  {capability:'finance.payments',label:{en:'Payments',ar:'المدفوعات'},requires:['finance.invoices']},
  {capability:'finance.receipts',label:{en:'Receipts',ar:'الإيصالات'},requires:['finance.invoices']},
  {capability:'finance.credits',label:{en:'Credits and refunds',ar:'الإشعارات الدائنة والاسترداد'},requires:['finance.invoices']},
]);

module.exports={workspaceModules,configurableModules};
