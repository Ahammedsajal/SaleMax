'use strict';
const {decision,permissions,capabilities}=require('./policy');
const {workspaceModules}=require('./workspace-module-registry');
function describe(session){
  const context=session.context;if(!context)throw Object.assign(Error('VERIFIED_BUSINESS_OWNER_REQUIRED'),{code:'VERIFIED_BUSINESS_OWNER_REQUIRED',status:403});
  const assignedNavigation=Array.isArray(context.membership.assignedNavigation)?[...context.membership.assignedNavigation]:null;
  if(assignedNavigation?.some(key=>['invoices','installments','payments','receipts'].includes(key))&&!assignedNavigation.includes('invoices'))assignedNavigation.push('invoices');
  const catalogue=require('./product-catalog').kind(context);
  const catalogCapability=catalogue==='products'?'products.catalog':catalogue==='courses'?'training.courses':null;
  const quickReplyCatalog=catalogCapability&&context.subscription?.capabilities.includes(catalogCapability)&&['active','trial','grace'].includes(context.subscription?.status)?catalogue:null;
  return {quickReplyCatalog,role:context.membership.role,tenantId:context.tenant.id,categoryKey:context.tenant.categoryKey,categoryVersion:context.tenant.categoryVersion,currency:context.tenant.currency||'QAR',timezone:context.tenant.timezone||'Asia/Qatar',roleProfileId:context.membership.roleProfileId||null,customPermissions:context.membership.customPermissions||null,assignedNavigation,roleNavigation:require('./navigation').navigationFor(context).map(item=>item.key),modules:Object.fromEntries(workspaceModules.map(({key,capability,permission})=>[key,decision(context,{capability,permission}).allowed])),permissions:Object.fromEntries(Object.keys(permissions).map(permission=>{
    const capability=Object.keys(capabilities).find(key=>capabilities[key].includes(permission));
    return [permission,capability?decision(context,{capability,permission}).allowed:false];
  }))};
}
async function describeWithNavigation(pool,session){
  const data=describe(session);
  if(data.role==='manager'){
    const [shares]=await pool.query('SELECT 1 FROM sx_qr_channel_shares WHERE tenant_id=? AND membership_id=? LIMIT 1',[session.context.tenant.id,session.context.membership.id]);
    if(shares.length){if(!data.roleNavigation.includes('whatsapp-qr'))data.roleNavigation.push('whatsapp-qr');if(data.assignedNavigation&&!data.assignedNavigation.includes('whatsapp-qr'))data.assignedNavigation.push('whatsapp-qr');}
  }
  const navigation=require('./navigation');
  const customization=await require('./tenant-customization').effective(pool,session.context);
  const visibleRows=require('./tenant-customization').visibleNavigation(navigation.items.filter(item=>data.roleNavigation.includes(item.key)),customization.document);
  const visible=await navigation.sidebarForMembership(pool,session.context,visibleRows);
  data.roleNavigation=visible.map(item=>item.key);
  data.customizationRevision=customization.revision;
  data.navigationLabels=Object.fromEntries(Object.entries(customization.document.navigationLabels).filter(([key])=>data.roleNavigation.includes(key)));
  return data;
}
module.exports={describe,describeWithNavigation};
