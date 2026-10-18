'use strict';
const contract=require('../../client/public/template-placeholder-contract');
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
async function validate({payload,uid,query,fetchImpl=global.fetch}){
  if(!['CAROUSEL','CATALOG'].includes(payload.template_type))return null;
  const [api]=await query('SELECT waba_id, access_token FROM meta_api WHERE uid = ?',[uid]);
  if(!api)fail('META_CREDENTIALS_REQUIRED');
  const url=new URL(`https://graph.facebook.com/v21.0/${encodeURIComponent(api.waba_id)}/message_templates`);
  url.searchParams.set('name',payload.template_name);url.searchParams.set('fields','name,language,status,components');url.searchParams.set('limit','100');
  let response,data;try{response=await fetchImpl(url,{headers:{Authorization:'Bearer '+api.access_token},signal:AbortSignal.timeout(15000)});data=await response.json();}catch{fail('TEMPLATE_VALIDATION_UNAVAILABLE',503);}
  if(!response.ok||data.error)fail('TEMPLATE_VALIDATION_UNAVAILABLE',503);
  const template=data.data?.find(t=>t.name===payload.template_name&&t.language===payload.template_language&&t.status==='APPROVED');
  if(!template)fail('APPROVED_TEMPLATE_REQUIRED');
  const carousel=template.components.find(c=>c.type==='CAROUSEL'),catalog=template.components.some(c=>(c.buttons||[]).some(b=>b.type==='CATALOG'));
  if((payload.template_type==='CAROUSEL'&&!carousel)||(payload.template_type==='CATALOG'&&!catalog))fail('TEMPLATE_TYPE_MISMATCH');
  if(carousel&&payload.carousel_cards?.length!==carousel.cards.length)fail('CAROUSEL_CARD_COUNT_MISMATCH');
  try{contract.validateCampaign(payload,template.components);}catch{fail('PLACEHOLDER_MAPPING_REQUIRED');}
  return template.components;
}
function validateContacts(payload,components,contacts){
  if(!components)return;
  for(const target of contract.targets(components)){
    const values=contract.value(payload,target),list=target.kind==='body'?values:[values];
    if(contacts.some(contact=>list.some(value=>!contract.replace(value,contact).trim())))fail('CONTACT_PLACEHOLDER_VALUE_MISSING');
  }
}
module.exports={validate,validateContacts};
