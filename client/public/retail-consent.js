'use strict';
(() => {
  const root=document.getElementById('consent-status');
  if(!root)return;
  const arabic=new URLSearchParams(location.search).get('lang')==='ar';
  const t=(en,ar)=>arabic?ar:en;
  document.documentElement.lang=arabic?'ar':'en';
  document.documentElement.dir=arabic?'rtl':'ltr';
  const text=(en,ar)=>{root.replaceChildren();const heading=document.createElement('h1');heading.textContent=en;root.append(heading);if(ar){const message=document.createElement('p');message.textContent=ar;root.append(message);}};
  const match=location.hash.match(/^#stop=([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i);
  if(!match){text(t('No valid preference link was found.','لم يتم العثور على رابط تفضيل صالح.'));return;}
  const orderId=match[1],token=match[2];
  history.replaceState(null,'',location.pathname+location.search);
  fetch(location.pathname,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({orderId,token})}).then(async response=>{
      const result=await response.json().catch(()=>({}));
      if(!response.ok||result.success===false)throw Error(result.code||'PREFERENCE_UPDATE_FAILED');
      text(t('WhatsApp updates for this order are stopped.','تم إيقاف تحديثات واتساب لهذا الطلب.'),t('تم إيقاف تحديثات واتساب لهذا الطلب.','WhatsApp updates for this order are stopped.'));
    }).catch(()=>text(t('We could not update the preference. Open the link again or contact the store.','تعذر تحديث التفضيل. افتح الرابط مرة أخرى أو تواصل مع المتجر.'),t('تعذر تحديث التفضيل. افتح الرابط مرة أخرى أو تواصل مع المتجر.','We could not update the preference. Open the link again or contact the store.')));
})();
