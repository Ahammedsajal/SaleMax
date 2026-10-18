/* Progressive enhancement of the existing campaign form; no compiled shell edits. */
(() => {
  'use strict';
  const contract=window.SaleMaxTemplatePlaceholders,templates=new Map(),choices=new Map();
  const id='sx-campaign-mapping';let selected=null,queued=false,labels={},labelsLoaded=false;
  const nativeOpen=XMLHttpRequest.prototype.open,nativeSend=XMLHttpRequest.prototype.send,requests=new WeakMap();
  const active=()=>location.pathname==='/user'&&new URLSearchParams(location.search).get('page')==='send-campaign';
  const ar=()=>{const language=String(localStorage.getItem('language')||'').toLowerCase();return language==='ar'||language.includes('arabic')||document.documentElement.lang?.startsWith('ar')||document.documentElement.dir==='rtl';};
  const tr=(en,arabic)=>ar()?arabic:en;
  XMLHttpRequest.prototype.open=function(method,url,...rest){requests.set(this,{method:String(method).toUpperCase(),url:String(url)});if(String(url).includes('/get_my_meta_templets_beta'))this.addEventListener('load',()=>{try{const data=JSON.parse(this.responseText);for(const t of data.data||[])templates.set(t.name+':'+t.language,t);render();}catch{}});return nativeOpen.call(this,method,url,...rest);};
  XMLHttpRequest.prototype.send=function(body){const req=requests.get(this);if(active()&&req?.method==='POST'&&req.url.includes('/create_template_campaign')&&selected){try{const p=JSON.parse(body);if(p.template_name!==selected.name||p.template_language!==selected.language)throw Error('TEMPLATE_CHANGED');apply(p);contract.validateCampaign(p,selected.components);return nativeSend.call(this,JSON.stringify(p));}catch{showError();this.abort();return;}}return nativeSend.call(this,body);};
  function sendButton(){return [...document.querySelectorAll('button.MuiButton-contained')].find(b=>/^(Send Campaign|Send Message|إرسال الحملة|إرسال حملة|إرسال رسالة)$/i.test(b.textContent.trim()));}
  function render(){
    if(active()&&!labelsLoaded&&window.SaleMaxWorkspace){labelsLoaded=true;window.SaleMaxWorkspace.request('phonebook','/bootstrap').then(data=>{labels=Object.fromEntries((data.config?.labels||[]).map((label,index)=>['var'+(index+1),label]));document.getElementById(id)?.remove();render();}).catch(()=>{});}
    let panel=document.getElementById(id);const button=active()&&sendButton();
    if(!button){panel?.remove();selected=null;choices.clear();return;}
    const main=document.querySelector('main')||document.body;
    const leaves=[...main.querySelectorAll('*')].filter(e=>!e.children.length).map(e=>e.textContent.trim());
    const matches=[...templates.values()].filter(t=>leaves.includes(t.name)&&leaves.includes(t.language));
    const template=matches.length===1?matches[0]:null;
    if(!template||!isSpecial(template)){panel?.remove();selected=null;return;}
    if(selected?.name!==template.name||selected?.language!==template.language){choices.clear();panel?.remove();panel=null;}
    selected=template;const targets=contract.targets(template.components);if(!targets.length){panel?.remove();return;}
    if(panel&&panel.dir===(ar()?'rtl':'ltr'))return;
    panel?.remove();panel=document.createElement('section');panel.id=id;panel.dir=ar()?'rtl':'ltr';panel.className='sx-placeholder-panel';
    const title=document.createElement('h3');title.textContent=tr('Placeholder columns','أعمدة المتغيرات');
    const intro=document.createElement('p');intro.textContent=tr('Choose a phonebook column for every placeholder, or enter a fixed value. Template samples are for review only. These selections are used for sending.','اختر عموداً من دفتر الهاتف لكل متغير، أو أدخل قيمة ثابتة. أمثلة القالب للمراجعة فقط؛ تُستخدم هذه الاختيارات للإرسال.');panel.append(title,intro);
    for(const target of targets)for(const number of target.numbers){
      const key=target.key+':'+number,row=document.createElement('div');row.className='sx-placeholder-row';
      const label=document.createElement('label');label.htmlFor=id+'-'+key;label.textContent=(target.card===null?tr('Message','الرسالة'):tr('Card ','البطاقة ')+(target.card+1))+' · '+(target.kind==='button'?tr('Button ','الزر ')+(target.index+1)+' · ':'')+'{{'+number+'}}';
      const select=document.createElement('select');select.id=label.htmlFor;select.setAttribute('aria-label',label.textContent);
      const options=[['',tr('Select column…','اختر العمود…')],...contract.fields.map(field=>[field,labels[field]||(field==='name'?tr('Name','الاسم'):field==='mobile'?tr('Mobile','الجوال'):tr('Variable ','المتغير ')+field.slice(3))]),['custom',tr('Fixed value','قيمة ثابتة')]];
      for(const [value,text] of options){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
      const input=document.createElement('input');input.type='text';input.maxLength=4096;input.placeholder=tr('Enter fixed value','أدخل قيمة ثابتة');input.setAttribute('aria-label',label.textContent+' '+tr('fixed value','قيمة ثابتة'));
      const choice=choices.get(key)||{field:'',text:''};select.value=choice.field;input.value=choice.text;input.hidden=choice.field!=='custom';
      select.addEventListener('change',()=>{choices.set(key,{field:select.value,text:input.value});input.hidden=select.value!=='custom';clearError();});input.addEventListener('input',()=>{choices.set(key,{field:select.value,text:input.value});clearError();});row.append(label,select,input);panel.append(row);
    }
    const error=document.createElement('p');error.dataset.error='true';error.hidden=true;error.setAttribute('role','alert');panel.append(error);const nameHeading=[...main.querySelectorAll('h6')].find(e=>e.textContent.trim()===template.name);const settings=nameHeading?.closest('.MuiPaper-root')?.nextElementSibling;if(settings)settings.after(panel);else button.parentElement.before(panel);
  }
  function isSpecial(t){return (t.components||[]).some(c=>c.type==='CAROUSEL'||(c.buttons||[]).some(b=>b.type==='CATALOG'));}
  function mapped(t,n){const c=choices.get(t.key+':'+n);return !c?'':c.field==='custom'?c.text.trim():contract.fields.includes(c.field)?'{{{'+c.field+'}}}':'';}
  function apply(p){for(const t of contract.targets(selected.components)){const values=t.numbers.map(n=>mapped(t,n));if(t.card===null){if(t.kind==='body')p.body_variables=values;else{p.button_variables=p.button_variables||[];const rest=p.button_variables.filter(b=>Number(b.index)!==t.index);p.button_variables=[...rest,{index:t.index,value:values[0]}];}}else{const card=p.carousel_cards?.[t.card];if(!card)throw Error('CARD_MISSING');if(t.kind==='body')card.bodyVariables=values;else card.buttonVariables=[...(card.buttonVariables||[]).filter(b=>Number(b.index)!==t.index),{index:t.index,value:values[0]}];}}}
  function clearError(){const e=document.querySelector('#'+id+' [data-error]');if(e)e.hidden=true;}
  function showError(){const e=document.querySelector('#'+id+' [data-error]');if(e){e.hidden=false;e.textContent=tr('Select a column or enter a fixed value for every placeholder.','اختر عموداً أو أدخل قيمة ثابتة لكل متغير.');e.scrollIntoView({block:'center'});}}
  document.addEventListener('click',event=>{if(!active()||!selected||event.target.closest('button')!==sendButton())return;const p={carousel_cards:(selected.components.find(c=>c.type==='CAROUSEL')?.cards||[]).map(()=>({}))};try{apply(p);contract.validateCampaign(p,selected.components);}catch{event.preventDefault();event.stopImmediatePropagation();showError();}},true);
  new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;render();});}).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['dir','lang']});
  render();
})();
