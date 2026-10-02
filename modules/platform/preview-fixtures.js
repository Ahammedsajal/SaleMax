const { capabilities, decision, platformDecision } = require('./policy');
const { trainingCenter, restaurantFixture } = require('./categories');
const { navigationFor } = require('./navigation');
const roles = ['super_admin','platform_admin','staff','owner','accountant','manager','agent'];
function fixture(role, categoryKey='training_center') {
  if(!roles.includes(role)) throw Object.assign(new Error('Unknown preview role'),{status:400});
  const category=categoryKey==='restaurant_fixture'?restaurantFixture:trainingCenter;
  if(!['training_center','restaurant_fixture'].includes(categoryKey)) throw Object.assign(new Error('Unknown preview category'),{status:400});
  const platform=['super_admin','platform_admin','staff'].includes(role);
  const context=platform?{audience:'platform',mfaVerified:true,recentlyAuthenticated:true,membership:{role,status:'active',delegatedPermissions:['tenants.read','plans.read','plans.draft','plans.assign','support.request']}}:{audience:'tenant',tenant:{id:'demo-tenant-a',status:'active',categoryKey:category.key,categoryVersion:1},membership:{id:role==='agent'?'demo-agent-a':'demo-'+role,tenantId:'demo-tenant-a',role,status:'active',delegatedPermissions:[]},subscription:{status:'active',capabilities:Object.keys(capabilities)},category,runtimeReady:{}};
  const nav=platform?[['businesses','tenants.read','Businesses','الأعمال'],['plans','plans.read','Plans','الخطط'],['staff','staff.manage','Staff access','صلاحيات الموظفين'],['categories','categories.manage','Categories','الفئات'],['incidents','incidents.read','System health','سلامة النظام'],['audit','audit.read','Audit trail','سجل التدقيق']].filter(([,permission])=>platformDecision(context,permission)).map(([key,permission,en,ar])=>({key,permission,label:{en,ar},group:{en:'Platform',ar:'المنصة'},scope:'platform'})):navigationFor(context);
  const source=[
    {id:'LEAD-001',tenantId:'demo-tenant-a',assignedMembershipId:'demo-agent-a',name:{en:'Learner A',ar:'متعلم أ'},course:{en:'IELTS preparation',ar:'التحضير لاختبار آيلتس'},stage:{en:'Follow-up due',ar:'حان موعد المتابعة'},outcome:{en:'Requested evening batch',ar:'طلب مجموعة مسائية'},billingLinked:false,attention:true},
    {id:'LEAD-002',tenantId:'demo-tenant-a',assignedMembershipId:'demo-agent-b',name:{en:'Learner B',ar:'متعلم ب'},course:{en:'Business English',ar:'اللغة الإنجليزية للأعمال'},stage:{en:'Sale review',ar:'مراجعة البيع'},outcome:{en:'Offer awaiting approval',ar:'العرض ينتظر الموافقة'},billingLinked:true,attention:true},
    {id:'LEAD-003',tenantId:'demo-tenant-a',assignedMembershipId:'demo-agent-a',name:{en:'Learner C',ar:'متعلم ج'},course:{en:'Microsoft Excel',ar:'مايكروسوفت إكسل'},stage:{en:'Qualified',ar:'مؤهل'},outcome:{en:'Course details shared',ar:'تمت مشاركة تفاصيل الدورة'},billingLinked:false,attention:false},
    {id:'LEAD-004',tenantId:'demo-tenant-b',assignedMembershipId:'demo-agent-a',name:{en:'Other tenant learner',ar:'متعلم من مؤسسة أخرى'},course:{en:'Hidden course',ar:'دورة مخفية'},stage:{en:'Hidden',ar:'مخفي'},outcome:{en:'Never visible',ar:'غير مرئي'},billingLinked:true,attention:true},
  ];
  const leads=platform?[]:source.filter(resource=>decision(context,{capability:'crm.leads',permission:'leads.read',resource}).allowed).map(lead=>role==='accountant'?{...lead,outcome:{en:'Billing record available',ar:'سجل الفوترة متاح'}}:lead);
  const finance=!platform&&decision(context,{capability:'finance.payments',permission:'payments.verify'}).allowed;
  return {designPreview:true,syntheticData:true,role,category:{key:category.key,title:category.title},audience:context.audience,nav,leads,finance,context,checks:[
    {key:'foreignLead',label:{en:'Another business’s lead',ar:'عميل محتمل لمؤسسة أخرى'},allowed:!platform&&decision(context,{capability:'crm.leads',permission:'leads.read',resource:source[3]}).allowed},
    {key:'verifyPayment',label:{en:'Verify a payment',ar:'التحقق من دفعة'},allowed:finance},
    {key:'platformOwner',label:{en:'Owner recovery controls',ar:'ضوابط استعادة حساب المالك'},allowed:platformDecision(context,'owner.recover')},
  ]};
}
function inspect(role, category, key) {
  const result=fixture(role,category);
  const item=result.nav.find(item=>item.key===key);
  if(!item) return {allowed:false,code:'PERMISSION_DENIED'};
  return {allowed:true,scope:item.scope,permission:item.permission,capability:item.capability||null,implementedWorkflow:false,syntheticData:true};
}
module.exports={roles,fixture,inspect};
