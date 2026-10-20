(() => {
 'use strict';
 const ar=()=>document.documentElement.lang?.startsWith('ar')||/^ar/i.test(localStorage.getItem('language')||'');
 const tr=(en,arabic)=>ar()?arabic:en;
 const states=new WeakMap();
 function mount(form,contract={revision:0,fields:[]},saved={}){
  if(!form)return;
  form.querySelector('[data-tenant-lead-fields]')?.remove();
  const active=(contract?.fields||[]).filter(field=>field.active),section=document.createElement('section');section.className='lead-form-section';section.dataset.tenantLeadFields='1';
  const heading=document.createElement('h3');heading.textContent=tr('Business-specific details','بيانات خاصة بالنشاط');section.append(heading);
  const controls=new Map();
  for(const field of active){
   const wrap=document.createElement('div');wrap.className='field';const label=document.createElement('label'),id='lead-field-'+field.key,input=document.createElement(field.type==='boolean'?'select':'input');input.id=id;label.htmlFor=id;label.textContent=field.label[ar()?'ar':'en']+(field.required?' *':'');
   const value=saved?.[field.key]?.value;
   if(field.type==='boolean'){
    for(const [v,text] of [['','—'],['true',tr('Yes','نعم')],['false',tr('No','لا')]]){const option=document.createElement('option');option.value=v;option.textContent=text;input.append(option);}
    input.value=value===true?'true':value===false?'false':'';
   }else{input.type=field.type==='integer'?'number':field.type==='date'?'date':'text';input.value=value??'';if(field.type==='text')input.maxLength=1000;if(field.type==='integer'){input.step='1';input.min='-1000000000000';input.max='1000000000000';}}
   input.required=field.required;wrap.append(label,input);section.append(wrap);controls.set(field.key,{field,input});
  }
  const inactive=Object.entries(saved||{}).filter(([key])=>!active.some(field=>field.key===key));
  if(inactive.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=tr('Historical fields (read only)','حقول سابقة (للقراءة فقط)');details.append(summary);for(const [,entry] of inactive){const line=document.createElement('p');line.textContent=(entry.definition?.label?.[ar()?'ar':'en']||tr('Archived field','حقل مؤرشف'))+': '+String(entry.value??'—');details.append(line);}section.append(details);}
  if(active.length||inactive.length){const last=form.lastElementChild;if(last)form.insertBefore(section,last);else form.append(section);}
  states.set(form,{revision:contract?.revision||0,controls});
 }
 function collect(form){
  const state=states.get(form);if(!state)return undefined;
  const values={};for(const [key,{field,input}] of state.controls){const raw=input.value;values[key]=raw===''?null:field.type==='integer'?Number(raw):field.type==='boolean'?raw==='true':raw;}
  return {configurationRevision:state.revision,values};
 }
 window.SaleMaxLeadFields=Object.freeze({mount,collect});
})();
