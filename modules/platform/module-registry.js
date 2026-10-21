'use strict';

// Reviewed module identity and ownership metadata. These manifests describe
// source-owned modules; they do not themselves grant tenant access. Category,
// plan, tenant activation, member permission and record scope remain separate.
const definitions=[
  {id:'core.business-settings',version:1,activation:'required',capabilities:['tenant.settings'],screens:['dashboard','notifications','settings'],primaryService:'modules/platform/tenant-customization.js',dataBoundary:'tenant_scoped',configSchemaVersion:null},
  {id:'core.inbox',version:1,capabilities:['messaging.inbox'],screens:['inbox'],primaryService:'helper/inbox/inbox.js',dataBoundary:'mixed_legacy_and_tenant',configSchemaVersion:null},
  {id:'core.whatsapp-qr',version:1,capabilities:['messaging.qr'],screens:['whatsapp-qr'],primaryService:'helper/addon/qr/',dataBoundary:'mixed_legacy_and_tenant',configSchemaVersion:null},
  {id:'core.whatsapp-meta',version:1,capabilities:['messaging.meta'],screens:['whatsapp-meta'],primaryService:'modules/platform/chatbot-provider.js',dataBoundary:'mixed_legacy_and_tenant',configSchemaVersion:null},
  {id:'core.templates',version:1,capabilities:['messaging.templates'],screens:['templates'],primaryService:'routes/templet.js',dataBoundary:'legacy_owner_uid',configSchemaVersion:null},
  {id:'core.campaigns',version:1,capabilities:['campaigns.send','campaigns.dashboard'],screens:['campaigns','campaign-dashboard'],primaryService:'loops/campaignBeta.js',dataBoundary:'legacy_owner_uid',configSchemaVersion:null},
  {id:'core.automation-flows',version:1,capabilities:['automation.flows'],screens:['flows'],primaryService:'routes/chatFlow.js',dataBoundary:'legacy_owner_uid',configSchemaVersion:null},
  {id:'core.chatbot',version:1,capabilities:['automation.chatbot'],screens:['chatbot','faqs'],primaryService:'modules/platform/chatbot-router.js',dataBoundary:'mixed_legacy_and_tenant',configSchemaVersion:null},
  {id:'core.leads',version:1,capabilities:['crm.leads'],screens:['leads'],primaryService:'helper/pipeline/leadPipeline.js',dataBoundary:'mixed_legacy_and_tenant',configSchemaVersion:null},
  {id:'core.contacts',version:1,capabilities:['crm.contacts'],screens:['contacts'],primaryService:'modules/platform/tenant-crm-router.js',dataBoundary:'mixed_legacy_and_tenant',configSchemaVersion:null},
  {id:'core.team',version:1,capabilities:['team.members'],screens:['agent-login','sales-organization','team'],primaryService:'modules/platform/team-invitation-router.js',dataBoundary:'mixed_legacy_and_tenant',configSchemaVersion:null},
  {id:'core.tasks',version:1,capabilities:['team.tasks'],screens:['tasks'],primaryService:'modules/platform/task-router.js',dataBoundary:'tenant_scoped',configSchemaVersion:null},
  {id:'core.call-center',version:1,capabilities:['telephony.call-center'],screens:['call-center'],primaryService:'modules/platform/call-center-router.js',dataBoundary:'tenant_scoped',configSchemaVersion:null},
  {id:'core.reports',version:1,capabilities:['reports.read'],screens:['reports'],primaryService:'helper/pipeline/reports.js',dataBoundary:'mixed_legacy_and_tenant',configSchemaVersion:null},
  {id:'training.core',version:1,capabilities:['training.courses','training.batches','training.enrollments'],screens:['courses','batches','enrollments','students','training-profile'],primaryService:'modules/platform/training-course-router.js',dataBoundary:'mixed_legacy_and_tenant',configSchemaVersion:null},
  {id:'training.finance',version:1,capabilities:['finance.invoices','finance.installments','finance.payments','finance.receipts','finance.credits'],screens:['invoices','installments','payments','receipts','credits','finance-reports'],primaryService:'modules/platform/training-finance-router.js',dataBoundary:'tenant_scoped',configSchemaVersion:null},
  {id:'training.report-schedules',version:1,capabilities:['reports.schedule'],screens:['scheduled-reports'],primaryService:'modules/platform/training-report-schedules.js',dataBoundary:'tenant_scoped',configSchemaVersion:null},
  {id:'training.forms',version:1,capabilities:['portal.forms'],screens:['forms'],primaryService:'modules/platform/training-form-router.js',dataBoundary:'tenant_scoped',configSchemaVersion:null},
  {id:'compat.training-center-v1',version:1,activation:'locked_compatibility',capabilities:['sales.finance','hr.recruitment'],screens:[],primaryService:'modules/platform/categories.js',dataBoundary:'compatibility_only',configSchemaVersion:null},
  {id:'sales.deals',version:1,capabilities:['sales.deals'],screens:['sales-deals','sales-audit'],primaryService:'modules/platform/sales-organization-router.js',dataBoundary:'tenant_scoped',configSchemaVersion:null},
  {id:'sales.commissions',version:1,capabilities:['sales.commissions'],screens:['sales-commissions','commission-policy'],primaryService:'modules/platform/sales-commission-router.js',dataBoundary:'tenant_scoped',configSchemaVersion:null},
  {id:'sales.finance',version:1,capabilities:['sales.finance'],screens:['sales-finance'],primaryService:'modules/platform/sales-finance-router.js',dataBoundary:'tenant_scoped',configSchemaVersion:null},
  {id:'sales.targets',version:1,capabilities:['sales.targets'],screens:['sales-targets'],primaryService:'modules/platform/sales-targets-router.js',dataBoundary:'tenant_scoped',configSchemaVersion:null},
  {id:'sales.products-services',version:1,capabilities:['products.catalog'],screens:['products-services'],primaryService:'modules/platform/product-catalog.js',dataBoundary:'mixed_legacy_and_tenant',configSchemaVersion:null},
  {id:'sales.recruitment',version:1,activation:'locked_compatibility',capabilities:['hr.recruitment'],screens:['recruitment'],primaryService:'modules/platform/recruitment-router.js',dataBoundary:'tenant_scoped',configSchemaVersion:null},
  {id:'real-estate.properties',version:1,capabilities:['realestate.listings'],screens:['properties'],primaryService:'modules/platform/real-estate-properties-router.js',dataBoundary:'tenant_scoped',configSchemaVersion:null},
];

function createModuleRegistry(sources,knownCapabilities){
  const invalid=()=>{throw Object.assign(new Error('INVALID_MODULE_MANIFEST'),{code:'INVALID_MODULE_MANIFEST'});};
  if(!Array.isArray(sources)||!knownCapabilities||typeof knownCapabilities!=='object')invalid();
  const entries=new Map();
  for(const source of sources){
    if(!source||typeof source.id!=='string'||!/^[a-z][a-z0-9.-]{1,79}$/.test(source.id)||!Number.isSafeInteger(source.version)||source.version<1
      ||!Array.isArray(source.capabilities)||!source.capabilities.length||new Set(source.capabilities).size!==source.capabilities.length||source.capabilities.some(key=>!Object.hasOwn(knownCapabilities,key))
      ||!Array.isArray(source.screens)||new Set(source.screens).size!==source.screens.length||source.screens.some(key=>typeof key!=='string'||!/^[a-z][a-z0-9-]{0,79}$/.test(key))
      ||typeof source.primaryService!=='string'||!/^[-A-Za-z0-9_./]{1,180}$/.test(source.primaryService)||source.primaryService.split('/').includes('..')||!['tenant_scoped','legacy_owner_uid','mixed_legacy_and_tenant','compatibility_only'].includes(source.dataBoundary)
      ||(source.activation!==undefined&&!['required','optional','locked_compatibility'].includes(source.activation))
      ||(source.configSchemaVersion!==null&&(!Number.isSafeInteger(source.configSchemaVersion)||source.configSchemaVersion<1)))invalid();
    const identity=`${source.id}@${source.version}`;if(entries.has(identity))invalid();
    entries.set(identity,Object.freeze({...source,activation:source.activation||'optional',capabilities:Object.freeze([...source.capabilities]),screens:Object.freeze([...source.screens])}));
  }
  return Object.freeze({
    get(id,version){return typeof id==='string'&&Number.isSafeInteger(version)?entries.get(`${id}@${version}`)||null:null;},
    list(){return Object.freeze([...entries.values()]);},
  });
}

module.exports={definitions:Object.freeze(definitions.map(value=>Object.freeze({...value,capabilities:Object.freeze([...value.capabilities]),screens:Object.freeze([...value.screens])}))),createModuleRegistry};
