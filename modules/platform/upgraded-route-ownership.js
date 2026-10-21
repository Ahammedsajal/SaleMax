'use strict';

// Source-owned route ownership metadata for the factory routers mounted by
// mount-existing-upgrade.js. This is an audit contract, not an authorization
// source: policy, tenant identity, plan, member permission and record scope
// still have to be enforced by the route/service itself.
const contracts=Object.freeze([
  {mount:'/api/admin/asterisk',router:'asterisk-router',routeClass:'platform',owner:'platform.telephony',modules:[],contextBoundary:'platform_session'},
  {mount:'/api/admin/platform-auth',router:'auth-router',routeClass:'platform',owner:'platform.identity',modules:[],contextBoundary:'platform_session'},
  {mount:'/api/user/business-auth',router:'auth-router',routeClass:'identity',owner:'tenant.identity',modules:[],contextBoundary:'tenant_identity'},
  {mount:'/api/user/call-center',router:'call-center-router',routeClass:'tenant_module',owner:'core.call-center',modules:['core.call-center'],contextBoundary:'tenant_session'},
  {mount:'/api/user/chatbots',router:'chatbot-router',routeClass:'tenant_module',owner:'core.chatbot',modules:['core.chatbot'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/agent/course-replies',router:'course-quick-reply-router',routeClass:'tenant_module',owner:'category.catalogue.replies',modules:['training.core','sales.products-services'],moduleByCategory:{training_center:['training.core'],'7network_sales':['sales.products-services']},contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/inbox/course-replies',router:'course-quick-reply-router',routeClass:'tenant_module',owner:'category.catalogue.replies',modules:['training.core','sales.products-services'],moduleByCategory:{training_center:['training.core'],'7network_sales':['sales.products-services']},contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/workspace/inbox/course-replies',router:'course-quick-reply-router',routeClass:'tenant_module',owner:'category.catalogue.replies',modules:['training.core','sales.products-services'],moduleByCategory:{training_center:['training.core'],'7network_sales':['sales.products-services']},contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/admin/business-contracts',router:'existing-business-router',routeClass:'platform',owner:'platform.tenant-contracts',modules:[],contextBoundary:'platform_session'},
  {mount:'/api/admin/plan-contracts',router:'existing-catalogue-router',routeClass:'platform',owner:'platform.plan-catalogue',modules:[],contextBoundary:'platform_session'},
  {mount:'/api/admin/platform-access',router:'existing-platform-access-router',routeClass:'platform',owner:'platform.access',modules:[],contextBoundary:'platform_session'},
  {mount:'/api/admin/staff-invitations',router:'existing-platform-access-router',routeClass:'platform',owner:'platform.staff',modules:[],contextBoundary:'platform_invitation'},
  {mount:'/api/agent/phonebook',router:'phonebook-workspace-router',routeClass:'tenant_module',owner:'core.contacts',modules:['core.contacts'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/phonebook/workspace',router:'phonebook-workspace-router',routeClass:'tenant_module',owner:'core.contacts',modules:['core.contacts'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/workspace/phonebook',router:'phonebook-workspace-router',routeClass:'tenant_module',owner:'core.contacts',modules:['core.contacts'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/workspace/properties',router:'real-estate-properties-router',routeClass:'tenant_module',owner:'real-estate.properties',modules:['real-estate.properties'],contextBoundary:'tenant_session'},
  {mount:'/api/public/recruitment',router:'recruitment-router',routeClass:'public_tenant_module',owner:'sales.recruitment',modules:['sales.recruitment'],contextBoundary:'public_tenant_slug'},
  {mount:'/api/user/recruitment',router:'recruitment-router',routeClass:'tenant_module',owner:'sales.recruitment',modules:['sales.recruitment'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/user/sales-audit',router:'sales-audit-router',routeClass:'tenant_module',owner:'sales.deals',modules:['sales.deals'],contextBoundary:'tenant_session'},
  {mount:'/api/user/sales-commissions',router:'sales-commission-router',routeClass:'tenant_module',owner:'sales.commissions',modules:['sales.commissions'],contextBoundary:'tenant_session'},
  {mount:'/api/user/sales-finance',router:'sales-finance-router',routeClass:'tenant_module',owner:'sales.finance',modules:['sales.finance'],contextBoundary:'tenant_session'},
  {mount:'/api/user/sales-organization',router:'sales-organization-router',routeClass:'tenant_module',owner:'sales.deals',modules:['sales.deals'],contextBoundary:'tenant_session'},
  {mount:'/api/user/sales-targets',router:'sales-targets-router',routeClass:'tenant_module',owner:'sales.targets',modules:['sales.targets'],contextBoundary:'tenant_session'},
  {mount:'/api/user/training/tasks',router:'task-router',routeClass:'tenant_module',owner:'core.tasks',modules:['core.tasks'],contextBoundary:'tenant_session'},
  {mount:'/api/workspace/tasks',router:'task-router',routeClass:'tenant_module',owner:'core.tasks',modules:['core.tasks'],contextBoundary:'tenant_session'},
  {mount:'/api/agent/invitations',router:'team-invitation-router',routeClass:'tenant_module',owner:'core.team',modules:['core.team'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/user/team-invitations',router:'team-invitation-router',routeClass:'tenant_module',owner:'core.team',modules:['core.team'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/crm',router:'tenant-crm-router',routeClass:'tenant_module',owner:'core.leads-and-contacts',modules:['core.leads','core.contacts'],contextBoundary:'tenant_session'},
  {mount:'/api/crm/customization',router:'tenant-customization-router',routeClass:'tenant_module',owner:'core.business-settings',modules:['core.business-settings'],contextBoundary:'tenant_session'},
  {mount:'/api/workspace/customization',router:'tenant-customization-router',routeClass:'tenant_module',owner:'core.business-settings',modules:['core.business-settings'],contextBoundary:'tenant_session'},
  {mount:'/api/user/training/profile',router:'training-center-profile-router',routeClass:'tenant_module',owner:'training.core',modules:['training.core'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/workspace/profile',router:'training-center-profile-router',routeClass:'tenant_module',owner:'training.core',modules:['training.core'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/user/training/courses',router:'training-course-router',routeClass:'tenant_module',owner:'training.core',modules:['training.core'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/workspace/courses',router:'training-course-router',routeClass:'tenant_module',owner:'training.core',modules:['training.core'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/workspace/products-services',router:'training-course-router',routeClass:'tenant_module',owner:'sales.products-services',modules:['sales.products-services'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/public/training/documents',router:'training-finance-router',routeClass:'public_tenant_module',owner:'training.finance',modules:['training.finance'],contextBoundary:'public_document_token'},
  {mount:'/api/public/training/reminder-preferences',router:'training-finance-router',routeClass:'public_tenant_module',owner:'training.finance',modules:['training.finance'],contextBoundary:'public_tenant_token'},
  {mount:'/api/user/training/finance-policies',router:'training-finance-router',routeClass:'tenant_module',owner:'training.finance',modules:['training.finance'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/workspace/finance',router:'training-finance-router',routeClass:'tenant_module',owner:'training.finance',modules:['training.finance'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/public/training/forms',router:'training-form-router',routeClass:'public_tenant_module',owner:'training.forms',modules:['training.forms'],contextBoundary:'public_form_slug'},
  {mount:'/api/user/training/forms',router:'training-form-router',routeClass:'tenant_module',owner:'training.forms',modules:['training.forms'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/workspace/forms',router:'training-form-router',routeClass:'tenant_module',owner:'training.forms',modules:['training.forms'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/user/training/students',router:'training-students-router',routeClass:'tenant_module',owner:'training.core',modules:['training.core'],contextBoundary:'canonical_or_legacy_tenant'},
  {mount:'/api/workspace/students',router:'training-students-router',routeClass:'tenant_module',owner:'training.core',modules:['training.core'],contextBoundary:'canonical_or_legacy_tenant'},
].map(contract=>Object.freeze({...contract,modules:Object.freeze([...contract.modules]),...(contract.moduleByCategory?{moduleByCategory:Object.freeze(Object.fromEntries(Object.entries(contract.moduleByCategory).map(([key,value])=>[key,Object.freeze([...value])])))}:{})})));

function ownershipForInventory(inventory,{moduleRegistry,categories}){
  const byKey=new Map(contracts.map(contract=>[`${contract.router}|${contract.mount}`,contract]));
  if(byKey.size!==contracts.length)throw new Error('DUPLICATE_ROUTE_OWNERSHIP_CONTRACT');
  const used=new Set(),unowned=[];
  const routes=inventory.routes.map(route=>{
    const key=`${route.module}|${route.mount}`,contract=byKey.get(key);
    if(!contract){unowned.push(key);return {...route,ownership:null,ownershipStatus:'unmapped'};}
    used.add(key);
    if(!['platform','identity','tenant_module','public_tenant_module'].includes(contract.routeClass)
      ||typeof contract.owner!=='string'||!contract.owner||typeof contract.contextBoundary!=='string')throw new Error(`INVALID_ROUTE_OWNERSHIP_CONTRACT:${key}`);
    for(const id of contract.modules){const entry=moduleRegistry.get(id,1);if(!entry)throw new Error(`UNKNOWN_ROUTE_MODULE:${key}:${id}`);}
    const categoryModules=contract.moduleByCategory||(!contract.modules.length?{}:Object.fromEntries(categories.list().flatMap(category=>{
      const modules=contract.modules.filter(id=>category.modules?.some(ref=>ref.id===id&&ref.version===1));
      return modules.length===contract.modules.length?[[category.key,modules]]:[];
    })));
    for(const [categoryKey,moduleIds] of Object.entries(categoryModules)){
      const category=categories.get(categoryKey,1);
      if(!category||!Array.isArray(moduleIds)||!moduleIds.length||moduleIds.some(moduleId=>!contract.modules.includes(moduleId)||!category.modules?.some(ref=>ref.id===moduleId&&ref.version===1)))throw new Error(`INVALID_CATEGORY_ROUTE_OWNER:${key}:${categoryKey}`);
    }
    if(contract.routeClass==='tenant_module'&&!Object.keys(categoryModules).length)throw new Error(`TENANT_ROUTE_WITHOUT_CATEGORY_OWNER:${key}`);
    return {...route,ownership:{...contract,categoryModules},ownershipStatus:'mapped_policy_unverified'};
  });
  const stale=[...byKey.keys()].filter(key=>!used.has(key));
  return {routes,unowned:[...new Set(unowned)].sort(),stale:stale.sort(),contractCount:contracts.length};
}

module.exports={contracts,ownershipForInventory};
