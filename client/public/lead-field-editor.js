(() => {
 'use strict';
 const ar=()=>document.documentElement.lang?.startsWith('ar'),tr=(en,arabic)=>ar()?arabic:en;
 const models=new WeakMap();
 function scopeMap(panel){let value=models.get(panel);if(!value){value=new Map();models.set(panel,value);}return value;}
 function mount(panel,initial,options={}){
  const scope=options.scope==='property'?'property':'lead',property=scope==='property';
  panel.querySelector(`[data-${scope}-field-editor]`)?.remove();
  const form=panel.querySelector('form');if(!form)return;
  const section=document.createElement('details');section.dataset[`${scope}FieldEditor`]='1';
  const summary=document.createElement('summary');summary.textContent=property?tr('Custom property fields','حقول العقارات المخصصة'):tr('Custom lead fields','حقول العملاء المخصصة');section.append(summary);
  const help=document.createElement('p');help.textContent=property
   ?tr('Add business-specific listing details such as parking, furnishing or view. Required fields apply when creating or editing a listing. Archived fields stop collection; saved values and their labels remain readable. Field types are fixed after creation.','أضف تفاصيل خاصة بالنشاط مثل المواقف أو التأثيث أو الإطلالة. تنطبق الحقول المطلوبة عند إنشاء الإعلان أو تعديله. توقف الحقول المؤرشفة عن الجمع مع بقاء القيم وأسمائها السابقة للقراءة. نوع الحقل ثابت بعد إنشائه.')
   :tr('Add optional or required fields for manual lead entry. Archive a field to stop manual collection; saved values remain readable. Published forms keep their fields until republished. Field types are fixed after creation.','أضف حقولًا اختيارية أو مطلوبة عند إدخال العميل يدويًا. أرشف الحقل لإيقاف جمعه يدويًا مع حفظ القيم السابقة للقراءة. تحتفظ النماذج المنشورة بحقولها حتى إعادة نشرها. نوع الحقل ثابت بعد إنشائه.');section.append(help);
  const list=document.createElement('div');section.append(list);
  const fields=structuredClone(initial||[]),controls=[];
  function draw(field){
   const row=document.createElement('fieldset');row.style.cssText='margin:12px 0;padding:12px;border:1px solid #e4e8ef;border-radius:9px';
   const legend=document.createElement('legend');legend.textContent=({text:tr('Text','نص'),integer:tr('Whole number','عدد صحيح'),boolean:tr('Yes / No','نعم / لا'),date:tr('Date','تاريخ')})[field.type];row.append(legend);
   const entry={field};
   for(const language of ['en','ar']){const label=document.createElement('label'),input=document.createElement('input');label.textContent=language==='en'?tr('English label','اسم الحقل بالإنجليزية'):tr('Arabic label','اسم الحقل بالعربية');input.value=field.label[language];input.maxLength=80;input.lang=language;input.dir=language==='ar'?'rtl':'ltr';input.required=true;input.dataset.fieldLanguage=language;label.append(input);row.append(label);entry[language]=input;}
   const requiredText=property?tr('Required for listings','مطلوب للإعلانات'):tr('Required for manual entry','مطلوب عند الإدخال اليدوي');
   for(const [key,text] of [['required',requiredText],['active',tr('Collect this field','جمع بيانات هذا الحقل')]]){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=field[key];input.style.width='auto';label.append(input,document.createTextNode(text));row.append(label);entry[key]=input;}
   controls.push(entry);list.append(row);
  }
  fields.forEach(draw);
  const addControls=document.createElement('div');addControls.className='actions';const types=document.createElement('select');
  for(const [value,text] of [['text',tr('Text','نص')],['integer',tr('Whole number','عدد صحيح')],['boolean',tr('Yes / No','نعم / لا')],['date',tr('Date','تاريخ')]]){const option=document.createElement('option');option.value=value;option.textContent=text;types.append(option);}
  types.setAttribute('aria-label',tr('New field type','نوع الحقل الجديد'));
  const button=document.createElement('button');button.type='button';button.textContent=property?tr('Add property field','إضافة حقل عقار'):tr('Add lead field','إضافة حقل عميل');
  button.dataset[property?'addPropertyField':'addLeadField']='1';
  button.onclick=()=>{if(controls.length>=24)return;const type=types.value,key=(property?'pf_':'cf_')+type+'_'+crypto.randomUUID().replaceAll('-','').slice(0,16);draw({key,type,label:{en:'',ar:''},required:false,active:true,version:1});button.disabled=controls.length>=24;form.dispatchEvent(new Event('input',{bubbles:true}));};
  button.disabled=controls.length>=24;addControls.append(types,button);section.append(addControls);
  const primaryActions=[...form.querySelectorAll('.actions')].find(node=>!node.closest('[data-lead-field-editor],[data-property-field-editor]'));
  primaryActions?.before(section);scopeMap(panel).set(scope,controls);
 }
 function collect(panel,scope='lead'){return (scopeMap(panel).get(scope)||[]).map(entry=>({...entry.field,label:{en:entry.en.value.trim(),ar:entry.ar.value.trim()},required:entry.required.checked,active:entry.active.checked}));}
 // Reset archives definitions instead of losing their stable identity/history.
 function reset(panel,scope='lead'){for(const entry of scopeMap(panel).get(scope)||[])entry.active.checked=false;}
 function preview(host,fields){const list=document.createElement('ul');for(const field of fields||[]){const line=document.createElement('li');line.textContent=field.label.en+' · '+field.label.ar+' · '+field.type+' · '+(field.active?tr('Active','نشط'):tr('Archived','مؤرشف'))+(field.required?' · '+tr('Required','مطلوب'):'');list.append(line);}host.append(list);}
 window.SaleMaxLeadFieldEditor=Object.freeze({mount,collect,reset,preview});
})();
