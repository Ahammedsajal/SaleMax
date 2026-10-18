/* Shared by maintained screen hooks and the campaign worker. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SaleMaxTemplatePlaceholders=factory();})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const fields=['name','mobile','var1','var2','var3','var4','var5'];
  function numbers(text){return [...new Set([...String(text||'').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b);}
  function targets(components){
    const result=[];
    function scan(list,card=null){for(const c of list||[]){
      const type=String(c.type||'').toUpperCase();
      if(type==='BODY'&&numbers(c.text).length)result.push({key:card===null?'body':`card.${card}.body`,kind:'body',card,text:c.text,numbers:numbers(c.text),component:c});
      if(type==='BUTTONS')for(const [index,b] of (c.buttons||[]).entries())if(String(b.type).toUpperCase()==='URL'&&numbers(b.url).length)result.push({key:card===null?`button.${index}`:`card.${card}.button.${index}`,kind:'button',card,index,text:b.url,numbers:numbers(b.url),component:b});
      if(type==='CAROUSEL')for(const [index,item] of (c.cards||[]).entries())scan(item.components,index);
    }}scan(components);return result;
  }
  function value(payload,target){if(target.card!==null){const card=payload.carousel_cards?.[target.card];return target.kind==='body'?card?.bodyVariables:(card?.buttonVariables||[]).find(b=>Number(b.index)===target.index)?.value;}return target.kind==='body'?payload.body_variables:(payload.button_variables||[]).find(b=>Number(b.index)===target.index)?.value;}
  function validateCampaign(payload,components){for(const target of targets(components)){const values=value(payload,target);if(target.kind==='body'&&(!Array.isArray(values)||values.length!==target.numbers.length))throw Error('PLACEHOLDER_MAPPING_REQUIRED');for(const item of target.kind==='body'?values:[values])if(typeof item!=='string'||!item.trim()||item.length>4096||/\{\{\s*\d+\s*\}\}/.test(item)||[...item.matchAll(/\{\{\{([^}]+)\}\}\}/g)].some(m=>!fields.includes(m[1])))throw Error('PLACEHOLDER_MAPPING_REQUIRED');}}
  function validateSamples(components){for(const t of targets(components)){const sample=t.kind==='body'?t.component.example?.body_text?.[0]:t.component.example;if(!Array.isArray(sample)||sample.length!==t.numbers.length||sample.some(v=>typeof v!=='string'||!v.trim()||numbers(v).length))throw Error('PLACEHOLDER_SAMPLE_REQUIRED');}}
  function replace(variable,contact){if(typeof variable!=='string')return variable;return variable.replace(/\{\{\{(name|mobile|var[1-5])\}\}\}/g,(_,field)=>String(contact[field]??''));}
  function resolveButtons(buttons,contact){return (buttons||[]).map(b=>typeof b==='string'?replace(b,contact):({...b,value:replace(b.value,contact)}));}
  return {fields,numbers,targets,value,validateCampaign,validateSamples,replace,resolveButtons};
});
