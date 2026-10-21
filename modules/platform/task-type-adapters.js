'use strict';

const fail=(code,status=403)=>{throw Object.assign(new Error(code),{code,status});};

// Domain task behavior is reviewed source code, never a tenant-provided callback.
// Category versions pin the adapter version they have been tested against.
const adapters=Object.freeze({
  'invoice_follow_up@1':Object.freeze({
    key:'invoice_follow_up',version:1,requiredCapabilities:Object.freeze(['finance.invoices']),
    label:Object.freeze({en:'Invoice follow-up',ar:'متابعة فاتورة'}),
    validate(){}
  }),
  'enrollment@1':Object.freeze({
    key:'enrollment',version:1,requiredCapabilities:Object.freeze(['training.enrollments']),
    label:Object.freeze({en:'Enrollment',ar:'تسجيل'}),validate(){}
  }),
  'sales_call@1':Object.freeze({
    key:'sales_call',version:1,requiredCapabilities:Object.freeze(['telephony.call-center']),requiresExplicitDueAt:true,
    label:Object.freeze({en:'Scheduled sales call',ar:'مكالمة مبيعات مجدولة'}),
    validate({sourceType,linked,participants}){
      if(sourceType!=='lead'||!linked?.leadId)fail('INVALID_SALES_CALL_LEAD',400);
      if(!participants.some(person=>person.actorType==='agent'&&person.role==='assignee'))fail('TASK_ASSIGNEE_REQUIRED',400);
    }
  })
});
const adapterId=(key,version)=>`${key}@${version}`;
function getAdapter(key,version){return adapters[adapterId(key,version)]||null;}
function knownAdapters(){return Object.freeze(Object.values(adapters).map(({key,version,requiredCapabilities=[]})=>Object.freeze({key,version,requiredCapabilities})));}

function categoryFor(ctx){
  const tenant=ctx?.tenant;
  if(!tenant||!Number.isSafeInteger(Number(tenant.categoryVersion))||Number(tenant.categoryVersion)<1)return null;
  const categories=require('./categories');
  const category=categories.getCategory(tenant.categoryKey,Number(tenant.categoryVersion));
  if(!category||!categories.categoryKeyMatches(category.key,tenant.categoryKey))return null;
  if(ctx.category&&(ctx.category.key!==category.key||ctx.category.version!==category.version))return null;
  return category;
}
function categoryTaskAdapter(ctx,key){
  const category=categoryFor(ctx),version=category?.taskAdapters?.[key];
  return Number.isSafeInteger(version)?getAdapter(key,version):null;
}
function supports(ctx,key){
  if(key==='general')return true;
  if(key==='lead_follow_up'){
    const category=categoryFor(ctx);
    return !category||category.capabilities.includes('crm.leads')
      &&(!Array.isArray(ctx?.subscription?.capabilities)||ctx.subscription.capabilities.includes('crm.leads'));
  }
  const adapter=categoryTaskAdapter(ctx,key);
  if(!adapter)return false;
  const category=categoryFor(ctx);
  if(!category?.capabilities.includes('team.tasks'))return false;
  const entitlements=ctx?.subscription?.capabilities;
  return Array.isArray(entitlements)&&adapter.requiredCapabilities.every(capability=>entitlements.includes(capability));
}
function available(ctx){
  const result=[{key:'general',label:{en:'General',ar:'عام'}}];
  if(supports(ctx,'lead_follow_up'))result.unshift({key:'lead_follow_up',label:{en:'Lead follow-up',ar:'متابعة عميل محتمل'}});
  const category=categoryFor(ctx);
  for(const [key,version] of Object.entries(category?.taskAdapters||{})){
    const adapter=getAdapter(key,version);
    if(adapter)result.push({key,label:adapter.label});
  }
  return result;
}
function presentation(ctx){
  const category=categoryFor(ctx);
  return category?{key:category.key,title:category.title}:{key:null,title:{en:'Business',ar:'الأعمال'}};
}
function validate(ctx,key,details){if(key==='general'||key==='lead_follow_up')return;const adapter=categoryTaskAdapter(ctx,key);if(!adapter)fail('INVALID_TASK_TYPE');adapter.validate(details);}

module.exports={knownAdapters,getAdapter,categoryTaskAdapter,supports,available,presentation,validate};
