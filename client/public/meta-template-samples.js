/* Inline, component-specific review samples for the existing template wizard. */
(() => {
  'use strict';
  const contract=window.SaleMaxTemplatePlaceholders,values=new Map();let snapshot=[],queued=false;
  const active=()=>location.pathname==='/user'&&new URLSearchParams(location.search).get('page')==='create-meta-template';
  const ar=()=>{const language=String(localStorage.getItem('language')||'').toLowerCase();return language==='ar'||language.includes('arabic')||document.documentElement.lang?.startsWith('ar')||document.documentElement.dir==='rtl';};
  const tr=(en,arabic)=>ar()?arabic:en;
  const nativeOpen=XMLHttpRequest.prototype.open,nativeSend=XMLHttpRequest.prototype.send,requests=new WeakMap();
  function entries(texts){const counts=new Map();return texts.map(text=>{const count=counts.get(text)||0;counts.set(text,count+1);return {text,key:text+'\u0000'+count,numbers:contract.numbers(text)};});}
  function fieldKey(entry,n){return entry.key+':'+n;}
  function sample(entry,n){return String(values.get(fieldKey(entry,n))||'').trim();}
  function panel(entry){
    const box=document.createElement('section');box.className='sx-placeholder-panel sx-template-samples';box.dataset.sampleKey=entry.key;box.dir=ar()?'rtl':'ltr';
    const heading=document.createElement('h3');heading.textContent=tr('Sample data for review','بيانات تجريبية للمراجعة');const context=document.createElement('p');context.textContent=entry.text;box.append(heading,context);
    for(const n of entry.numbers){const row=document.createElement('div');row.className='sx-placeholder-row';const label=document.createElement('label'),input=document.createElement('input');input.type='text';input.required=true;input.maxLength=1024;input.value=sample(entry,n);input.placeholder=tr('Enter sample content','أدخل مثالاً');input.id='sx-sample-'+Math.random().toString(36).slice(2);label.htmlFor=input.id;label.textContent=tr('Sample ','مثال ')+'{{'+n+'}}';input.addEventListener('input',()=>values.set(fieldKey(entry,n),input.value));row.append(label,input);box.append(row);}
    const note=document.createElement('p');note.textContent=tr('For Meta review only. Select contact columns separately when sending a campaign.','لمراجعة Meta فقط. تُختار أعمدة جهات الاتصال بشكل منفصل عند إرسال الحملة.');box.append(note);return box;
  }
  function render(){
    if(!active()){document.querySelectorAll('.sx-template-samples').forEach(e=>e.remove());snapshot=[];values.clear();return;}
    const main=document.querySelector('main')||document.body;
    // Standard templates retain their native Variables step and payload examples.
    if(main.querySelectorAll('.MuiStepLabel-label').length>3){snapshot=[];main.querySelectorAll('.sx-template-samples').forEach(e=>e.remove());return;}
    const fields=[...main.querySelectorAll('textarea,input')].filter(e=>!e.closest('.sx-template-samples')&&e.type!=='hidden'&&e.getAttribute('aria-hidden')!=='true'&&contract.numbers(e.value).length&&(e.tagName==='TEXTAREA'||/^https?:\/\//.test(e.value)));
    // MUI keeps a hidden sizing textarea beside each visible textarea.
    if(fields.length){snapshot=entries(fields.map(e=>e.value));document.getElementById('sx-samples-review')?.remove();for(const [i,field] of fields.entries()){const host=field.closest('.MuiFormControl-root')||field.parentElement;let box=host.nextElementSibling;if(box?.classList.contains('sx-template-samples')&&box.dataset.sampleKey===snapshot[i].key&&box.dir===(ar()?'rtl':'ltr'))continue;if(box?.classList.contains('sx-template-samples'))box.remove();host.after(panel(snapshot[i]));}for(const box of main.querySelectorAll('.sx-template-samples'))if(!snapshot.some(e=>e.key===box.dataset.sampleKey))box.remove();return;}
    if([...main.querySelectorAll('textarea')].some(e=>e.getAttribute('aria-hidden')!=='true')){snapshot=[];main.querySelectorAll('.sx-template-samples').forEach(e=>e.remove());}
    const steps=[...main.querySelectorAll('.MuiStepLabel-label')];const review=steps.length&&steps[steps.length-1].classList.contains('Mui-active');
    if(!review){document.getElementById('sx-samples-review')?.remove();return;}
    if(document.getElementById('sx-samples-review')||!snapshot.length)return;
    const reviewBox=document.createElement('div');reviewBox.id='sx-samples-review';for(const entry of snapshot)reviewBox.append(panel(entry));const button=[...main.querySelectorAll('button')].find(b=>/^(Submit(?: template)?|Create template|Save changes|إرسال|حفظ التغييرات|حفظ|تقديم)$/i.test(b.textContent.trim()));if(button)button.parentElement.before(reviewBox);
  }
  document.addEventListener('input',event=>{if(active()&&!event.target.closest('.sx-template-samples'))render();});
  document.addEventListener('click',event=>{if(!active())return;const button=event.target.closest('button');if(!button||!/^(Submit(?: template)?|Create template|Save changes|إرسال|حفظ التغييرات|حفظ|تقديم)$/i.test(button.textContent.trim()))return;if(snapshot.some(e=>e.numbers.some(n=>!sample(e,n)))){event.preventDefault();event.stopImmediatePropagation();const input=[...document.querySelectorAll('.sx-template-samples input')].find(e=>!e.value.trim());input?.focus();input?.reportValidity();}},true);
  XMLHttpRequest.prototype.open=function(method,url,...rest){requests.set(this,{method:String(method).toUpperCase(),url:String(url)});return nativeOpen.call(this,method,url,...rest);};
  XMLHttpRequest.prototype.send=function(body){const req=requests.get(this);if(req?.method!=='POST'||!req.url.includes('/add_meta_templet'))return nativeSend.call(this,body);let payload;try{payload=JSON.parse(body);}catch{return nativeSend.call(this,body);}if(!(payload.components||[]).some(c=>c.type==='CAROUSEL'||(c.buttons||[]).some(b=>b.type==='CATALOG')))return nativeSend.call(this,body);try{const targets=contract.targets(payload.components),sources=entries(targets.map(t=>t.text));for(const [i,t] of targets.entries()){const samples=t.numbers.map(n=>sample(sources[i],n));if(samples.every(Boolean)){if(t.kind==='body')t.component.example={...(t.component.example||{}),body_text:[samples]};else t.component.example=samples;}}contract.validateSamples(payload.components);return nativeSend.call(this,JSON.stringify(payload));}catch{this.abort();window.alert(tr('Add sample data for every placeholder before submitting.','أضف بيانات تجريبية لكل متغير قبل الإرسال.'));}};
  new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;render();});}).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['dir','lang']});render();
})();
