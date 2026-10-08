(() => {
  'use strict';
  const root=document.querySelector('#document'),status=root.querySelector('[data-status]'),content=root.querySelector('[data-content]'),title=root.querySelector('[data-title]');
  const ar=(navigator.language||'').toLowerCase().startsWith('ar');
  document.documentElement.lang=ar?'ar':'en';document.documentElement.dir=ar?'rtl':'ltr';
  const t=(en,arabic)=>ar?arabic:en;
  const token=location.hash.slice(1);
  history.replaceState(null,'',location.pathname);
  const add=(parent,tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text??'');if(className)el.className=className;parent.append(el);return el;};
  const money=(amount,currency)=>new Intl.NumberFormat(ar?'ar-QA':'en-QA',{style:'currency',currency:currency||'QAR'}).format(Number(amount||0)/100);
  const date=value=>value?new Intl.DateTimeFormat(ar?'ar-QA':'en-QA',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Qatar'}).format(new Date(value)):'—';
  const field=(parent,label,value)=>{const box=add(parent,'div',undefined,'field');add(box,'strong',label);add(box,'span',value||'—');};
  function render(doc){
    content.replaceChildren();content.hidden=false;
    const invoice=doc.type==='invoice';title.textContent=invoice?t('Invoice','فاتورة'):t('Payment receipt','إيصال دفع');
    const heading=add(content,'h2',`${invoice?t('Invoice','فاتورة'):t('Receipt','إيصال')} ${doc.number}`);
    const grid=add(content,'div',undefined,'grid');field(grid,t('Business','المؤسسة'),doc.legalName);if(doc.registrationNumber)field(grid,t('Registration number','رقم التسجيل'),doc.registrationNumber);if(doc.address)field(grid,t('Address','العنوان'),doc.address);
    if(invoice){field(grid,t('Payer','الدافع'),doc.payerName);field(grid,t('Learner','المتعلم'),doc.learnerName);field(grid,t('Issued','تاريخ الإصدار'),date(doc.issuedAt));}
    else{field(grid,t('Payer','الدافع'),doc.payerName);field(grid,t('Invoice','الفاتورة'),doc.invoiceNumber);field(grid,t('Received','تاريخ الاستلام'),date(doc.receivedAt));field(grid,t('Verified','تاريخ التحقق'),date(doc.verifiedAt));field(grid,t('Issued','تاريخ الإصدار'),date(doc.issuedAt));field(grid,t('Method','طريقة الدفع'),({cash:t('Cash','نقدًا'),bank_transfer:t('Bank transfer','تحويل بنكي'),cheque:t('Cheque','شيك'),other:t('Other','أخرى')})[doc.method]||doc.method);}
    if(invoice){const rows=doc.lines||[];add(content,'h2',t('Issued items','البنود الصادرة'));const table=add(content,'table'),head=add(table,'thead'),hr=add(head,'tr');[t('Description','الوصف'),t('Qty','الكمية'),t('Unit price','سعر الوحدة'),t('Total','الإجمالي')].forEach(x=>add(hr,'th',x));const body=add(table,'tbody');rows.forEach(line=>{const tr=add(body,'tr');add(tr,'td',ar?(line.descriptionAr||line.descriptionEn):line.descriptionEn);add(tr,'td',line.quantity);add(tr,'td',money(line.unitAmountMinor,doc.currency));add(tr,'td',money(line.totalMinor,doc.currency));});
      add(content,'p',`${t('Subtotal','المجموع الفرعي')}: ${money(doc.subtotalMinor,doc.currency)} · ${t('Tax','الضريبة')}: ${money(doc.taxMinor,doc.currency)} · ${t('Issued total','الإجمالي الصادر')}: ${money(doc.totalMinor,doc.currency)}`,'amount');if(doc.balance)add(content,'p',`${t('Current balance','الرصيد الحالي')}: ${money(doc.balance.amountDueMinor,doc.currency)} (${t('as of','حتى')} ${date(doc.balance.asOf)})`,'notice');if(doc.terms)add(content,'p',`${t('Agreed terms','الشروط المتفق عليها')}: ${doc.terms}`,'notice');
    }else{add(content,'p',`${t('Received amount','المبلغ المستلم')}: ${money(doc.amountMinor,doc.currency)}`,'amount');add(content,'h2',t('Receipt allocations','تخصيص الإيصال'));const table=add(content,'table'),head=add(table,'thead'),hr=add(head,'tr');[t('Invoice','الفاتورة'),t('Installment','القسط'),t('Amount','المبلغ')].forEach(x=>add(hr,'th',x));const body=add(table,'tbody');(doc.allocations||[]).forEach(item=>{const tr=add(body,'tr');add(tr,'td',item.invoiceNumber);add(tr,'td',item.installment);add(tr,'td',money(item.amountMinor,doc.currency));});}
    add(content,'p',t('This link provides access only to this document. Anyone who receives the link can open it until it expires or is revoked.','يتيح هذا الرابط الوصول إلى هذا المستند فقط. يمكن لأي شخص يتلقى الرابط فتحه حتى انتهاء صلاحيته أو إلغائه.'),'notice');status.remove();
  }
  if(!token){status.textContent=t('This link is invalid, expired or revoked. Contact the business for a new link.','هذا الرابط غير صالح أو منتهي الصلاحية أو ملغى. يرجى التواصل مع المؤسسة للحصول على رابط جديد.');return;}
  fetch('/api/public/training/documents/resolve',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',body:JSON.stringify({token})}).then(async response=>{const body=await response.json();if(!response.ok||!body.success)throw Error('unavailable');render(body.data);}).catch(()=>{status.textContent=t('This link is invalid, expired or revoked. Contact the business for a new link.','هذا الرابط غير صالح أو منتهي الصلاحية أو ملغى. يرجى التواصل مع المؤسسة للحصول على رابط جديد.');});
})();
