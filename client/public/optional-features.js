(() => {
  'use strict';
  const labels=window.salemaxOptionalLabels||{};
  const pages={'chat-widget':'chat_widget','wa-qr-rest-api':'customer_api','conversational-api':'customer_api','template-api':'customer_api','api-dashboard':'customer_api','manage-webhook':'webhooks','webhook-automation':'webhooks','webhook-logs':'webhooks','wa-warmer':'whatsapp_warmer'};
  const names={chat_widget:['Chat Widget','ودجت المحادثة'],customer_api:['Customer API access','وصول العملاء إلى API'],webhooks:['Webhooks','الويب هوك'],whatsapp_warmer:['WhatsApp Warmer','تهيئة واتساب']};
  const isAr=()=>document.documentElement.dir==='rtl'||(localStorage.getItem('language')||'').toLowerCase().includes('arab');
  const tr=(en,ar)=>isAr()?ar:en;
  let features={},userToken=null,loading=false,checked=false;
  const style=document.createElement('style');style.textContent='[data-sx-optional-hidden]{display:none!important}html[data-sx-optional-pending] main{visibility:hidden}.sx-optional-panel{margin:16px;padding:20px;border:1px solid #dcc9d2;border-radius:10px;background:var(--mui-palette-background-paper,#fff);color:var(--mui-palette-text-primary,#263243)}.sx-optional-panel label{display:flex;gap:10px;align-items:center;margin:14px 0}.sx-optional-panel button,.sx-optional-action{min-height:40px;margin:4px;padding:6px 12px;border:1px solid #c4a4b3;border-radius:6px;cursor:pointer}.sx-optional-panel button:focus-visible,.sx-optional-action:focus-visible{outline:3px solid #a8003b}';document.head.appendChild(style);
  if(location.pathname==='/user'&&pages[new URLSearchParams(location.search).get('page')])document.documentElement.dataset.sxOptionalPending='1';
  function hideUserItems(){
    if(location.pathname.replace(/\/$/,'')!=='/user')return;
    document.querySelectorAll('.MuiDrawer-root li,.MuiDrawer-root [role=button],.MuiDrawer-root .MuiListSubheader-root').forEach(node=>{
      const texts=[node.textContent.trim(),...Array.from(node.querySelectorAll('span')).map(span=>span.textContent.trim())];
      const feature=texts.map(text=>labels[text]).find(Boolean);
      if(!feature)return;const row=node.closest('li')||node;
      if(features[feature]!==true)row.dataset.sxOptionalHidden='1';else delete row.dataset.sxOptionalHidden;
    });
  }
  async function loadUser(){
    if(location.pathname.replace(/\/$/,'')!=='/user')return;
    const token=localStorage.getItem('wacrm_user');
    if(token!==userToken){userToken=token;features={};checked=false;}
    if(loading||checked||!token){hideUserItems();return;}
    loading=true;
    try{const r=await fetch('/api/user/optional-features',{headers:{Authorization:'Bearer '+token},credentials:'same-origin',cache:'no-store'});const d=await r.json();if(r.ok&&d.success&&token===localStorage.getItem('wacrm_user'))features=d.data.features||{};}catch{features={};}
    finally{loading=false;checked=true;hideUserItems();const feature=pages[new URLSearchParams(location.search).get('page')];if(feature&&features[feature]!==true){location.replace('/user?page=dashboard');}else delete document.documentElement.dataset.sxOptionalPending;}
  }
  async function openSettings(id){
    if(document.querySelector('[data-sx-optional-panel]'))return;
    const grid=document.querySelector('.MuiDataGrid-root');if(!grid)return;
    const host=document.createElement('section');host.dataset.sxOptionalPanel='1';host.className='sx-optional-panel';host.dir=isAr()?'rtl':'ltr';grid.parentElement.insertBefore(host,grid);
    const heading=document.createElement('h3');heading.textContent=tr('Optional user features','ميزات المستخدم الاختيارية');host.append(heading);
    const note=document.createElement('p');note.textContent=tr('Disabled by default. Enable only the features this customer needs. Plan limits and provider availability still apply.','معطّلة افتراضيًا. فعّل فقط الميزات التي يحتاجها هذا العميل. تظل حدود الخطة وتوفر مزودي الخدمة سارية.');host.append(note);
    const message=document.createElement('p');message.setAttribute('role','status');host.append(message);
    const close=document.createElement('button');close.type='button';close.textContent=tr('Close','إغلاق');close.onclick=()=>host.remove();host.append(close);
    try{
      const access=window.salemaxPlanContracts?.protectedRequest;if(!access)throw Error('AUTH_REQUIRED');
      const result=await access(id+'/optional-features');let revision=result.data.revision;
      const form=document.createElement('form');const inputs={};
      for(const [key,name] of Object.entries(names)){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=result.data.features[key]===true;inputs[key]=input;label.append(input,document.createTextNode(tr(...name)));form.append(label);}
      const save=document.createElement('button');save.type='submit';save.textContent=tr('Save optional features','حفظ الميزات الاختيارية');form.append(save);host.insertBefore(form,message);
      form.onsubmit=async event=>{event.preventDefault();save.disabled=true;message.textContent='';try{const result=await access(id+'/optional-features',{revision,features:Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.checked]))});revision=result.data.revision;message.textContent=tr('Saved. The user menu updates on refresh.','تم الحفظ. تتحدث قائمة المستخدم عند إعادة التحميل.');}catch(error){message.textContent=errorText(error);}finally{save.disabled=false;}};
    }catch(error){message.textContent=errorText(error);}
    heading.tabIndex=-1;heading.focus();
  }
  function errorText(error){return error.code==='MFA_REQUIRED'?tr('Verify platform MFA in Manage Plans, then retry.','تحقق من المصادقة الثنائية في إدارة الخطط ثم حاول مجددًا.'):error.code==='STALE_FEATURE_SETTINGS'?tr('Settings changed. Close and reopen to review the latest settings.','تغيرت الإعدادات. أغلق وأعد الفتح لمراجعة أحدث الإعدادات.'):tr('Could not load or save these settings. Check your administrator access and retry.','تعذر تحميل أو حفظ الإعدادات. تحقق من صلاحيات المسؤول وحاول مجددًا.');}
  function mountAdmin(){
    if(location.pathname!=='/admin'||new URLSearchParams(location.search).get('page')!=='manage-users')return;
    document.querySelectorAll('.MuiDataGrid-row[data-id]').forEach(row=>{const cell=row.querySelector('[data-field=plan]');if(!cell||cell.querySelector('[data-sx-optional-action]'))return;const button=document.createElement('button');button.type='button';button.dataset.sxOptionalAction='1';button.className='sx-optional-action';button.textContent=tr('Optional features','ميزات اختيارية');button.onclick=event=>{event.stopPropagation();openSettings(row.dataset.id);};cell.append(button);});
  }
  let queued=false;function update(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;hideUserItems();mountAdmin();loadUser();});}
  new MutationObserver(update).observe(document.documentElement,{subtree:true,childList:true});
  window.addEventListener('popstate',update);window.addEventListener('storage',()=>{checked=false;update();});window.addEventListener('focus',()=>{checked=false;update();});update();
})();
