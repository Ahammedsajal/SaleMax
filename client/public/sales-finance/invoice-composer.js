(() => {
  'use strict';
  const api=window.SalesFinanceInvoiceApi;
  if(!api)return;
  const $=id=>document.getElementById(id),dialog=$('invoiceComposerDialog'),form=$('invoiceComposerForm'),rows=$('invoiceLineItems'),error=$('invoiceComposerError');
  const arabic=document.documentElement.dir==='rtl'||(localStorage.getItem('language')||'').toLowerCase().includes('ar');
  const copy=arabic?{product:'المنتج / الخدمة',description:'وصف البند',name:'الاسم الظاهر في الفاتورة',quantity:'الكمية',unit:'سعر الوحدة',discount:'الخصم',remove:'إزالة البند',choose:'اختر منتجًا أو خدمة',custom:'بند / خدمة مخصصة',customer:'ستظهر بيانات العميل هنا',failed:'تعذر إنشاء الفاتورة. راجع بيانات العميل والبنود.',priceError:'يرجى مراجعة سعر كل بند والخصم.',catalogError:'تعذر تحميل المنتجات. يمكنك إدخال بنود مخصصة.'}:{product:'Product / service',description:'Item description',name:'Name shown on invoice',quantity:'Quantity',unit:'Unit price',discount:'Discount',remove:'Remove item',choose:'Choose a product or service',custom:'Custom item / service',customer:'Customer details will appear here',failed:'Could not create the invoice. Review the customer and item details.',priceError:'Review each item price and discount.',catalogError:'Products could not load. You can still enter custom items.'};
  let catalog=[],requestKey='',payloadFingerprint='';
  const money=minor=>{const code=(form.elements.currency.value||'QAR').trim().toUpperCase();try{return new Intl.NumberFormat(arabic?'ar-QA':'en-QA',{style:'currency',currency:/^[A-Z]{3}$/.test(code)?code:'QAR'}).format(Number(minor||0)/100)}catch{return `${code} ${(Number(minor||0)/100).toFixed(2)}`}};
  const toMinor=value=>{const amount=Number(value);if(!Number.isFinite(amount)||amount<0||amount*100>Number.MAX_SAFE_INTEGER)throw Error('INVALID_FINANCE_AMOUNT');return Math.round(amount*100)};
  function update(){
    $('invoiceSummaryCustomer').textContent=form.elements.customerName.value.trim()||copy.customer;
    let total=0;const summary=[];
    for(const row of rows.querySelectorAll('.invoice-line')){
      const name=row.querySelector('[data-line-name]').value.trim(),qty=Number(row.querySelector('[data-line-quantity]').value||0),price=Number(row.querySelector('[data-line-price]').value||0),discount=Number(row.querySelector('[data-line-discount]').value||0);
      const line=Math.max(0,qty*price-discount),lineMinor=Math.round(line*100);if(Number.isFinite(lineMinor))total+=lineMinor;
      row.querySelector('[data-line-total]').textContent=name&&qty>0?`${name} · ${money(lineMinor)}`:'';
      if(name)summary.push(`<div class="invoice-summary-row"><span>${api.escape(`${qty||0} × ${name}`)}</span><span>${money(lineMinor)}</span></div>`);
    }
    $('invoiceSummaryLines').innerHTML=summary.join('');$('invoiceSummaryTotal').textContent=money(total);
  }
  function addLine(){
    if(rows.children.length>=10)return;
    const row=document.createElement('div');row.className='invoice-line';
    const select=document.createElement('select');select.setAttribute('aria-label',copy.product);select.innerHTML=`<option value="">${api.escape(copy.choose)}</option>`+catalog.map(item=>`<option value="${api.escape(item.id)}">${api.escape(arabic&&item.nameAr?item.nameAr:item.name)}${item.code?` · ${api.escape(item.code)}`:''}${item.priceMinor?` · ${money(item.priceMinor)}`:''}</option>`).join('')+`<option value="custom">${copy.custom}</option>`;
    const product=document.createElement('label');product.textContent=copy.product;product.append(select);
    const desc=document.createElement('label');desc.className='line-description';desc.textContent=copy.description;const name=document.createElement('input');name.type='text';name.maxLength=191;name.required=true;name.dataset.lineName='';name.placeholder=copy.name;desc.append(name);
    const quantity=field(copy.quantity,'number','1','1',9999);quantity.dataset.lineQuantity='';
    const price=field(copy.unit,'number','','0.01',999999999999);price.min='0.01';price.dataset.linePrice='';
    const discount=field(copy.discount,'number','0','0.01',999999999999);discount.min='0';discount.dataset.lineDiscount='';
    const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='×';remove.dataset.removeLine='';remove.setAttribute('aria-label',copy.remove);
    const output=document.createElement('output');output.dataset.lineTotal='';row.append(product,quantity.parentElement,price.parentElement,discount.parentElement,remove,desc,output);rows.append(row);
    select.onchange=()=>{const item=catalog.find(entry=>entry.id===select.value);if(item){name.value=arabic&&item.nameAr?item.nameAr:item.name;name.readOnly=true;name.dataset.productId=item.id;if(item.priceMinor)price.value=(Number(item.priceMinor)/100).toFixed(2)}else{name.readOnly=false;name.dataset.productId='';if(select.value==='custom')name.focus()}update()};
    row.addEventListener('input',update);remove.onclick=()=>{row.remove();if(!rows.children.length)addLine();update()};update();
  }
  function field(label,type,value,step,max){const wrap=document.createElement('label'),caption=document.createElement('span'),input=document.createElement('input');caption.textContent=label;input.type=type;input.value=value;input.step=step;input.max=max;input.required=true;wrap.append(caption,input);return input}
  async function open(){form.reset();form.elements.currency.value='QAR';rows.replaceChildren();error.hidden=true;error.textContent='';requestKey=crypto.randomUUID();payloadFingerprint='';$('submitInvoice').disabled=true;dialog.showModal();try{catalog=(await api.request('/products')).items||[]}catch{catalog=[];error.textContent=copy.catalogError;error.hidden=false}addLine();$('submitInvoice').disabled=false;form.elements.customerName.focus()}
  $('createInvoice').onclick=open;$('addInvoiceLine').onclick=addLine;dialog.querySelectorAll('[data-invoice-close]').forEach(button=>button.onclick=()=>dialog.close());form.addEventListener('input',update);form.elements.currency.addEventListener('input',update);
  form.addEventListener('submit',async event=>{
    event.preventDefault();const submit=$('submitInvoice');submit.disabled=true;error.hidden=true;
    try{
      const lineItems=[...rows.querySelectorAll('.invoice-line')].map(row=>{
        const name=row.querySelector('[data-line-name]').value.trim(),quantity=Number(row.querySelector('[data-line-quantity]').value),unitPriceMinor=toMinor(row.querySelector('[data-line-price]').value),discountMinor=toMinor(row.querySelector('[data-line-discount]').value||'0'),productId=row.querySelector('[data-line-name]').dataset.productId||null;
        if(!name||!Number.isInteger(quantity)||quantity<1||quantity>9999||unitPriceMinor<1||discountMinor>quantity*unitPriceMinor)throw Error('INVALID_FINANCE_INPUT');
        return {productId,name,quantity,unitPriceMinor:String(unitPriceMinor),discountMinor:String(discountMinor)};
      });
      const currency=form.elements.currency.value.trim().toUpperCase();if(!/^[A-Z]{3}$/.test(currency))throw Error('INVALID_FINANCE_CURRENCY');
      const payload={customerName:form.elements.customerName.value.trim(),customerMobile:form.elements.customerMobile.value.trim()||null,currency,dueAt:form.elements.dueAt.value||null,lineItems};const fingerprint=JSON.stringify(payload);if(payloadFingerprint&&payloadFingerprint!==fingerprint)requestKey=crypto.randomUUID();payloadFingerprint=fingerprint;payload.idempotencyKey=requestKey;
      const result=await api.request('/invoices',{method:'POST',body:JSON.stringify(payload)});dialog.close();api.setView('invoices');await api.showDocument('invoice',result.id);await api.loadInvoices();
    }catch(err){error.textContent=err.message==='INVALID_FINANCE_AMOUNT'?copy.priceError:copy.failed;error.hidden=false}finally{submit.disabled=false}
  });
})();
