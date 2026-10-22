'use strict';

const {decision}=require('./policy');
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};

// A field scope is metadata on one reviewed entity adapter. New domains must
// add their storage and screen adapters before they are exposed here.
const registry=Object.freeze({
  lead:Object.freeze({
    key:'lead',documentKey:'leadFields',legacyDocumentKey:'leadFields',prefix:'cf',token:'LEAD',
    capability:'crm.leads',categoryKeys:null,planCapability:'crm.leads',permission:'leads.manage',
    label:{en:'Custom lead fields',ar:'حقول العملاء المخصصة'},
    help:{en:'Add fields for your business. Saved values and their labels remain readable when a field is archived.',ar:'أضف حقولًا خاصة بنشاطك. تبقى القيم وأسماؤها السابقة للقراءة عند أرشفة الحقل.'},
    addLabel:{en:'Add lead field',ar:'إضافة حقل عميل'},
    requiredLabel:{en:'Required for manual entry',ar:'مطلوب عند الإدخال اليدوي'},
  }),
  property:Object.freeze({
    key:'property',documentKey:'propertyFields',legacyDocumentKey:'propertyFields',prefix:'pf',token:'PROPERTY',
    capability:'realestate.listings',categoryKeys:Object.freeze(['real_estate']),planCapability:'realestate.listings',permission:'properties.manage',
    label:{en:'Custom property fields',ar:'حقول العقارات المخصصة'},
    help:{en:'Add business-specific listing details. Required fields apply when creating or editing a listing. Archived values and their labels remain readable.',ar:'أضف تفاصيل خاصة بإعلانات العقارات. تنطبق الحقول المطلوبة عند إنشاء الإعلان أو تعديله. تبقى القيم وأسماؤها السابقة للقراءة عند الأرشفة.'},
    addLabel:{en:'Add property field',ar:'إضافة حقل عقار'},
    requiredLabel:{en:'Required for listings',ar:'مطلوب للإعلانات'},
  }),
});

function get(key){const scope=registry[key];if(!scope)fail('INVALID_CUSTOM_FIELD_SCOPE');return scope;}
function assertCategory(ctx,key){
  const scope=get(key),category=ctx?.category;
  if(!category||!Array.isArray(category.capabilities)||!category.capabilities.includes(scope.capability)||scope.categoryKeys&&!scope.categoryKeys.includes(category.key))fail('CATEGORY_UNAVAILABLE',409);
  return scope;
}
function planAvailable(ctx,key){
  const scope=get(key);
  return !scope.planCapability||Boolean(ctx?.subscription?.capabilities?.includes(scope.planCapability));
}
function assertAvailable(ctx,key){
  const scope=assertCategory(ctx,key);
  if(scope.planCapability&&!ctx.subscription?.capabilities?.includes(scope.planCapability))fail('FEATURE_UNAVAILABLE',409);
  return scope;
}
function fieldsForDocument(document,key){
  const scope=get(key);
  if(document?.schemaVersion>=8)return document.customFieldScopes?.[key]||[];
  return document?.[scope.legacyDocumentKey]||[];
}
function available(ctx){
  const result=[];
  for(const scope of Object.values(registry)){
    try{
      assertCategory(ctx,scope.key);
      const includedInPlan=planAvailable(ctx,scope.key);
      result.push({key:scope.key,documentKey:scope.documentKey,prefix:scope.prefix,label:scope.label,help:scope.help,addLabel:scope.addLabel,requiredLabel:scope.requiredLabel,planAvailable:includedInPlan,editable:includedInPlan&&decision(ctx,{capability:scope.capability,permission:scope.permission}).allowed});
    }catch(error){if(error.code!=='CATEGORY_UNAVAILABLE')throw error;}
  }
  return result;
}
module.exports={registry,get,assertCategory,assertAvailable,planAvailable,fieldsForDocument,available};
