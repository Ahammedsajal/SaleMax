(() => {
  'use strict';
  const root=document.querySelector('#document'),status=root.querySelector('[data-status]'),content=root.querySelector('[data-content]'),title=root.querySelector('[data-title]');
  const ar=(navigator.language||'').toLowerCase().startsWith('ar');document.documentElement.lang=ar?'ar':'en';document.documentElement.dir=ar?'rtl':'ltr';
  const t=(en,arabic)=>ar?arabic:en,token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
  const add=(parent,tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text??'');if(className)el.className=className;parent.append(el);return el;};
  async function request(path,body){const response=await fetch(`/api/public/training/reminder-preferences/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',body:JSON.stringify(body)});const result=await response.json();if(!response.ok||!result.success)throw Error('unavailable');return result.data;}
  function render(data){content.replaceChildren();content.hidden=false;title.textContent=t('Installment reminder preferences','تفضيلات تذكير الأقساط');add(content,'h2',`${t('Invoice','الفاتورة')} ${data.invoiceNumber}`);add(content,'p',`${t('Preference for','التفضيل الخاص بـ')} ${data.recipient||t('this invoice contact','جهة الاتصال لهذه الفاتورة')}`);add(content,'p',data.status==='opted_in'?t('Email installment reminders are enabled. You can turn them off at any time.','تم تفعيل تذكيرات الأقساط عبر البريد الإلكتروني. يمكنك إيقافها في أي وقت.'):data.status==='opted_out'?t('Email installment reminders are off. You can turn them on again here.','تذكيرات الأقساط عبر البريد الإلكتروني متوقفة. يمكنك تفعيلها مجددًا هنا.'):t('No installment reminders will be sent unless you choose to receive them.','لن يتم إرسال تذكيرات بالأقساط ما لم تختر استلامها.'));
    const actions=add(content,'div',undefined,undefined);actions.dataset.reminderActions='';
    const optIn=add(actions,'button',t('Receive email reminders','استلام التذكيرات عبر البريد الإلكتروني'));optIn.type='button';optIn.disabled=data.status==='opted_in';
    const optOut=add(actions,'button',t('Do not send reminders','عدم إرسال التذكيرات'),'secondary');optOut.type='button';optOut.disabled=data.status==='opted_out';
    const message=add(content,'p','', 'notice');message.setAttribute('role','status');
    const change=async(value,button)=>{optIn.disabled=true;optOut.disabled=true;message.textContent=t('Saving your choice…','جارٍ حفظ اختيارك…');try{render(await request('update',{token,optIn:value}));}catch{message.textContent=t('Your choice could not be saved. Please refresh the page and try again.','تعذر حفظ اختيارك. حدّث الصفحة وحاول مرة أخرى.');optIn.disabled=false;optOut.disabled=false;}finally{button.blur();}};
    optIn.onclick=()=>change(true,optIn);optOut.onclick=()=>change(false,optOut);status.remove();
  }
  if(!token){status.textContent=t('This preference link is unavailable. Ask the business for a new link.','رابط التفضيلات غير متاح. اطلب من المؤسسة رابطًا جديدًا.');return;}
  request('resolve',{token}).then(render).catch(()=>{status.textContent=t('This preference link is unavailable. Ask the business for a new link.','رابط التفضيلات غير متاح. اطلب من المؤسسة رابطًا جديدًا.');});
})();
