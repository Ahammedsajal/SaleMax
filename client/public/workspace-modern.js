(() => {
  'use strict';
  const path=location.pathname.replace(/\/$/,'');
  if(!/^\/(user|agent|admin)(\/|$)/.test(path)&&!/^\/(business-dashboard|sales-workspace|sales-commissions|sales-finance|sales-audit|sales-organization|tasks|pipeline|call-center)(\/|$)/.test(path))return;
  document.documentElement.dataset.sxModern=/^\/(user|agent|admin)(\/|$)/.test(path)?'shell':'module';
  document.documentElement.dataset.sxModule=path.split('/')[1]||'';
  const titles={'wa-qr-connect':['WhatsApp devices','أجهزة واتساب'],'wa-meta-manual':['Meta WhatsApp connection','ربط واتساب ميتا'],'automation-flows':['Automation Flows','مسارات الأتمتة'],'wa-chatbot':['WA Chatbot','روبوت محادثة واتساب'],'create-meta-template':['Create Meta Template','إنشاء قالب ميتا'],'send-campaign':['Send Campaign','إرسال حملة'],'campaign-dashboard':['Campaign Dashboard','لوحة الحملات'],'products-services':['Products & services','المنتجات والخدمات'],phonebook:['Phonebook','دليل الهاتف']};
  const syncPage=()=>{
    const page=new URLSearchParams(location.search).get('page')||'dashboard';if(document.documentElement.dataset.sxPage!==page)document.documentElement.dataset.sxPage=page;
    if(titles[page]&&document.documentElement.dataset.sxModern==='shell'){
      const arabic=/^(ar(?:[-_]|$)|arabic)/i.test(localStorage.getItem('language')||'');
      document.querySelectorAll('.MuiTypography-root').forEach(node=>{if(node.childElementCount===0&&node.textContent===page&&node.getBoundingClientRect().top<90)node.textContent=titles[page][arabic?1:0];});
    }
  };
  syncPage();window.addEventListener('popstate',syncPage);
  if(document.documentElement.dataset.sxModern==='module'){
    try{
      const arabic=/^(ar(?:[-_]|$)|arabic)/i.test(localStorage.getItem('language')||'');
      document.documentElement.lang=arabic?'ar':'en';document.documentElement.dir=arabic?'rtl':'ltr';
      document.addEventListener('DOMContentLoaded',()=>document.querySelectorAll('[data-en][data-ar]').forEach(node=>{node.textContent=node.dataset[arabic?'ar':'en'];}),{once:true});
    }catch{}
  }
  const install=doc=>{
    if(!doc?.head||doc.querySelector('[data-sx-modern-sheet]'))return;
    const link=doc.createElement('link');link.rel='stylesheet';link.href='/workspace-modern.css?v=20261019-uplift2';link.dataset.sxModernSheet='1';doc.head.append(link);
  };
  install(document);
  if(!window.SaleMaxDialogs){
    let decisionOpen=false;
    const show=(message,{input=false,minLength=0}={})=>{
      if(decisionOpen)return Promise.resolve(null);decisionOpen=true;
      return new Promise(resolve=>{
      const arabic=document.documentElement.dir==='rtl',dialog=document.createElement('dialog');dialog.className='sx-action-dialog';
      dialog.setAttribute('aria-labelledby','sx-action-title');
      dialog.innerHTML='<form method="dialog"><div class="sx-dialog-symbol" aria-hidden="true">'+(input?'✎':'✓')+'</div><h2 id="sx-action-title"></h2><p class="sx-dialog-description"></p><label class="sx-dialog-input"><span></span><textarea name="reason" rows="3"></textarea></label><div class="sx-dialog-actions"><button type="button" data-cancel></button><button type="submit" class="primary"></button></div></form>';
      dialog.querySelector('h2').textContent=input?(arabic?'سبب القرار':'Reason for decision'):(arabic?'تأكيد الإجراء':'Confirm action');
      dialog.querySelector('p').textContent=String(message||'');
      const label=dialog.querySelector('label'),field=dialog.querySelector('textarea');label.hidden=!input;field.disabled=!input;field.required=input;field.minLength=minLength;
      label.querySelector('span').textContent=arabic?'السبب':'Reason';
      dialog.querySelector('[data-cancel]').textContent=arabic?'إلغاء':'Cancel';dialog.querySelector('[type=submit]').textContent=arabic?'متابعة':'Continue';
      let result=null;dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
      dialog.querySelector('form').onsubmit=event=>{event.preventDefault();if(!event.currentTarget.reportValidity())return;const value=field.value.trim();if(input&&value.length<minLength){field.setCustomValidity(arabic?'أدخل سببًا أطول.':'Enter a longer reason.');field.reportValidity();return;}result=input?value:true;dialog.close();};
      field.oninput=()=>field.setCustomValidity('');
      dialog.addEventListener('close',()=>{dialog.remove();decisionOpen=false;resolve(result);},{once:true});
      document.body.append(dialog);dialog.showModal();(input?field:dialog.querySelector('[data-cancel]')).focus();
    });};
    window.SaleMaxDialogs=Object.freeze({confirm:async message=>(await show(message))===true,prompt:message=>show(message,{input:true,minLength:3})});
  }
  const frames=new WeakSet();
  const activeTabs=new WeakMap();
  function alignTabs(){
    document.querySelectorAll('.tabs [aria-selected="true"]').forEach(button=>{
      const bar=button.parentElement;if(!bar||activeTabs.get(bar)===button)return;activeTabs.set(bar,button);
      if(bar.scrollWidth>bar.clientWidth)button.scrollIntoView({block:'nearest',inline:'nearest'});
    });
  }
  function updateFrames(){
    document.querySelectorAll('iframe').forEach(frame=>{
      if(frames.has(frame))return;frames.add(frame);
      const apply=()=>{try{const doc=frame.contentDocument;if(!doc||frame.contentWindow.location.origin!==location.origin)return;doc.documentElement.dataset.sxModern='module';install(doc);}catch{}};
      frame.addEventListener('load',apply);apply();
    });
  }
  new MutationObserver(()=>{syncPage();updateFrames();alignTabs();}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-selected']});updateFrames();alignTabs();
})();
