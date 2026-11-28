(() => {
  if (!/^\/(user|agent)\/?$/.test(location.pathname)) return;
  if (window.__sxRetailWorkspaceLoaded) return;
  window.__sxRetailWorkspaceLoaded = true;
  const t=(en,ar)=>(localStorage.getItem('language')||'').toLowerCase().startsWith('ar')?ar:en;
  const pages=[
    ['retail-orders','retail.orders',t('Retail orders','طلبات التجزئة')],
    ['retail-customers','retail.customers.read',t('Customers','العملاء')],
    ['retail-connected-stores','retail.connect',t('Store Connections','اتصالات المتاجر')],
    ['retail-deliveries','retail.deliver',t('My deliveries','عمليات التوصيل الخاصة بي')],
    ['retail-finance','retail.finance',t('Cash reconciliation','تسوية النقد')]
  ];
  const active=new URLSearchParams(location.search).get('page');
  function syncTheme(){
    const root=document.documentElement,saved=(localStorage.getItem('theme_mode')||'').toLowerCase();
    const dark=saved==='dark'||(saved!=='light'&&(root.dataset.sxTheme==='dark'||window.matchMedia('(prefers-color-scheme: dark)').matches));
    const next=dark?'dark':'light';if(root.dataset.sxTheme!==next)root.dataset.sxTheme=next;
  }
  const add=(parent,tag,text)=>{
    const node=document.createElement(tag);
    if(text!==undefined)node.textContent=text;
    parent.append(node);return node;
  };
  const input=(parent,label,value='',type='text')=>{
    const node=add(add(parent,'label',label+' '),'input');
    node.type=type;node.value=value;return node;
  };
  const api=async(path,method='GET',body)=>(await window.SaleMaxWorkspace.request('retail',path,{method,body})).data;
  const money=minor=>new Intl.NumberFormat(t('en-QA','ar-QA'),{style:'currency',currency:'QAR'}).format(Number(minor)/100);
  function sourceMoney(amount,currency){
    const match=String(amount??'0').match(/^(-?)(\d{1,20})(?:\.(\d{1,6}))?$/);
    if(!match)return String(amount??'—')+' '+String(currency||'');
    try{
      const locale=t('en-QA','ar-QA'),formatter=new Intl.NumberFormat(locale,{style:'currency',currency});
      const digits=formatter.resolvedOptions().maximumFractionDigits,scale=10n**BigInt(digits),fraction=match[3]||'';
      let minor=BigInt(match[2])*scale+BigInt((fraction+'0'.repeat(digits)).slice(0,digits)||'0');
      if(fraction.slice(digits, digits+1)>='5')minor++;
      const negative=match[1]==='-'&&minor>0n,pattern=formatter.formatToParts(negative?-1:1);
      const first=pattern.findIndex(part=>part.type==='integer');
      let last=first;for(let index=first+1;index<pattern.length&&['group','integer'].includes(pattern[index].type);index++)last=index;
      const prefix=pattern.slice(0,first).map(part=>part.value).join(''),suffix=pattern.slice(last+1).filter(part=>!['decimal','fraction'].includes(part.type)).map(part=>part.value).join('');
      const whole=new Intl.NumberFormat(locale,{useGrouping:true,maximumFractionDigits:0}).format(minor/scale);
      if(!digits)return prefix+whole+suffix;
      const decimal=pattern.find(part=>part.type==='decimal')?.value||'.';
      const decimalValue=new Intl.NumberFormat(locale,{useGrouping:false,minimumIntegerDigits:digits,maximumFractionDigits:0}).format(minor%scale);
      return prefix+whole+decimal+decimalValue+suffix;
    }catch{return String(amount)+' '+String(currency||'');}
  }
  const labels={placed:t('Placed','جديد'),ready:t('Ready','جاهز'),dispatched:t('Dispatched','قيد التوصيل'),completed:t('Completed','مكتمل'),cancelled:t('Cancelled','ملغى'),returned:t('Returned','مرتجع'),partially_returned:t('Partially returned','مرتجع جزئياً')};
  const deliveryLabels={unassigned:t('Not assigned','غير معيّن'),assigned:t('Assigned','تم التعيين'),in_transit:t('On the way','في الطريق'),failed:t('Delivery failed','تعذر التسليم'),delivered:t('Delivered','تم التسليم'),returned:t('Returned to store','أُعيد إلى المتجر')};
  const failureLabels={customer_unavailable:t('Customer unavailable','العميل غير متاح'),address_not_found:t('Address not found','العنوان غير موجود'),customer_rescheduled:t('Customer asked to reschedule','طلب العميل إعادة الجدولة'),access_blocked:t('Access blocked','تعذر الوصول'),other:t('Other','سبب آخر')};
  function action(parent,title,operation,status,refresh){
    const button=add(parent,'button',title);
    button.type='button';
    button.onclick=async()=>{
      button.disabled=true;
      try {const result=await operation();status.textContent=typeof result==='string'?result:(result?.message||t('Saved','تم الحفظ'));if(refresh&&result?.refresh!==false)await refresh();}
      catch {status.textContent=t('Could not save. Refresh and try again.','تعذر الحفظ. حدّث الصفحة وحاول مرة أخرى.');}
      finally {button.disabled=false;}
    };
  }
  function orderDate(value){
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return '—';
    return new Intl.DateTimeFormat(t('en-QA','ar-QA'),{dateStyle:'medium',timeStyle:'short'}).format(date);
  }
  function renderOrder(root,order,{driver,drivers,canLinkLead,status,refresh}){
    const base=driver?'/deliveries':'/orders';
    const imported=Boolean(order.importedFromStore);
    const providerName=order.sourceProvider==='shopify'?'Shopify':'WooCommerce';
    const amount=imported?sourceMoney(order.sourceTotal,order.currency):money(order.totalMinor);
    const card=add(root,'article');card.className='sx-retail-order';
    const row=add(card,'div');row.className='sx-retail-order-summary';
    const reference=add(row,'div');reference.className='sx-retail-order-reference';
    add(reference,'span',t('Order','طلب')).className='sx-retail-order-label';
    const orderId=add(reference,'bdi',String(order.id).slice(0,8).toUpperCase());orderId.dir='ltr';orderId.className='sx-retail-order-id';
    const date=add(reference,'time',orderDate(order.createdAt));date.dateTime=order.createdAt||'';date.className='sx-retail-order-date';
    const buyer=add(row,'div');buyer.className='sx-retail-order-buyer';
    add(buyer,'strong',order.buyerName||t('Customer','العميل'));
    const phone=add(buyer,'bdi',order.buyerPhone||'');phone.dir='ltr';phone.className='sx-retail-order-phone';
    const total=add(row,'strong',amount);total.className='sx-retail-order-total';total.dir='auto';
    const badges=add(row,'div');badges.className='sx-retail-order-badges';
    if(imported){
      const source=add(badges,'span',t('Imported · '+providerName,'مستورد · '+providerName));source.className='sx-retail-order-fulfillment';
      const sourceState=add(badges,'span',t('Store: ','المتجر: ')+(order.sourceOrderStatus||'—'));sourceState.className='sx-retail-order-status';sourceState.dir='auto';
    }else{
      const state=add(badges,'span',labels[order.status]||order.status);state.className='sx-retail-order-status sx-retail-status-'+String(order.status||'').replace(/[^a-z_]/g,'');
      const fulfillment=add(badges,'span',order.fulfillment==='delivery'?t('Delivery','توصيل'):t('Pickup','استلام'));fulfillment.className='sx-retail-order-fulfillment';
    }
    const details=add(card,'details');details.className='sx-retail-order-details';
    add(details,'summary',imported?t('Imported order details','تفاصيل الطلب المستورد'):t('Order details and actions','تفاصيل الطلب والإجراءات'));
    const body=add(details,'div');body.className='sx-retail-order-body';
    const fullReference=add(body,'p');add(fullReference,'strong',t('Reference: ','المرجع: '));const fullId=add(fullReference,'bdi',order.id);fullId.dir='ltr';
    const contact=add(body,'div');contact.className='sx-retail-order-contact';
    const contactName=add(contact,'p');add(contactName,'strong',t('Customer: ','العميل: '));add(contactName,'span',order.buyerName||'—');
    const contactPhone=add(contact,'p');add(contactPhone,'strong',t('Mobile: ','الهاتف: '));const phoneValue=add(contactPhone,'bdi',order.buyerPhone||'—');phoneValue.dir='ltr';
    if(order.buyerEmail){const contactEmail=add(contact,'p');add(contactEmail,'strong',t('Email: ','البريد الإلكتروني: '));const emailValue=add(contactEmail,'bdi',order.buyerEmail);emailValue.dir='auto';}
    if(imported){
      add(body,'p',t('Source store: ','المتجر المصدر: ')+String(order.sourceStoreName||providerName));
      const sourceOrder=add(body,'p');add(sourceOrder,'strong',t('Store order: ','طلب المتجر: '));const sourceId=add(sourceOrder,'bdi',String(order.sourceOrderId||order.id));sourceId.dir='ltr';
      add(body,'p',t('Store order status: ','حالة طلب المتجر: ')+String(order.sourceOrderStatus||'—')+' · '+t('Payment status: ','حالة الدفع: ')+String(order.sourceFinancialStatus||'—')).dir='auto';
      add(body,'p',t('Store-reported total (not verified by 7Network): ','الإجمالي المبلغ عنه من المتجر (غير متحقق من 7Network): ')+amount).dir='auto';
      for(const item of order.lines){
        const line=add(body,'p',(t(item.nameEn,item.nameAr)||item.nameEn)+' × '+item.quantity+(item.sku?' · SKU '+item.sku:''));
        if(item.sourceTotal!=null)add(line,'span',' · '+sourceMoney(item.sourceTotal,item.sourceCurrency||order.currency));
      }
      return;
    }
    add(body,'p',amount+' · '+(order.fulfillment==='delivery'?t('Delivery','توصيل'):t('Pickup','استلام')));
    if(order.locationNameEn)add(body,'p',t('Location: ','الموقع: ')+(t(order.locationNameEn,order.locationNameAr)||order.locationNameEn));
    if(order.fulfillment==='delivery'){
      add(body,'p',t('Delivery status: ','حالة التوصيل: ')+(deliveryLabels[order.deliveryState]||deliveryLabels.unassigned));
      if(order.deliveryState==='failed')add(body,'p',t('Last issue: ','آخر مشكلة: ')+(failureLabels[order.lastDeliveryFailureReason]||t('Not specified','غير محدد'))+' · '+t('Attempts: ','المحاولات: ')+order.deliveryAttemptCount);
    }
    for(const item of order.lines)add(body,'p',(t(item.nameEn,item.nameAr)||item.nameEn)+(item.variantValueEn?' · '+t(item.variantValueEn,item.variantValueAr):'')+' × '+item.quantity);
    if(order.cashReceived)add(body,'p',t('Cash collected','تم تحصيل النقد'));
    if(driver&&order.fulfillment==='delivery'&&order.status==='dispatched'&&order.deliveryState==='in_transit'&&order.deliveryProofRequired&&!order.proofVerified){
      const code=input(body,t('Buyer handoff code','رمز استلام العميل'));
      code.inputMode='numeric';code.autocomplete='one-time-code';code.maxLength=6;code.pattern='[0-9]{6}';
      action(body,t('Verify handoff','تحقق من رمز الاستلام'),async()=>{
        if(!/^\d{6}$/.test(code.value))throw Error('INVALID_DELIVERY_PROOF');
        const result=await api('/deliveries/'+order.id+'/proof','POST',{requestId:crypto.randomUUID(),code:code.value});
        return {verified:result.verified,message:result.verified?t('Handoff verified. Cash collection is now available.','تم التحقق من الاستلام. أصبح تسجيل تحصيل النقد متاحاً.'):
          t('Code did not match. Check with the customer and try again.','الرمز غير صحيح. تحقق مع العميل وحاول مرة أخرى.'),refresh:result.verified};
      },status,refresh);
    }
    if(driver&&order.fulfillment==='delivery'&&order.status==='dispatched'&&order.deliveryState==='in_transit'){
      const reason=add(add(body,'label',t('Delivery issue','مشكلة في التوصيل')+' '),'select');
      for(const [value,label] of Object.entries(failureLabels))add(reason,label).value=value;
      action(body,t('Report delivery failure','الإبلاغ عن تعذر التسليم'),()=>api('/deliveries/'+order.id+'/failed','POST',{requestId:crypto.randomUUID(),reason:reason.value}),status,refresh);
    }
    if(driver&&order.fulfillment==='delivery'&&order.status==='dispatched'&&order.deliveryState==='failed'){
      action(body,t('Retry delivery','إعادة محاولة التوصيل'),()=>api('/deliveries/'+order.id+'/retry','POST',{requestId:crypto.randomUUID()}),status,refresh);
    }
    const canCollect=!order.cashReceived&&((order.fulfillment==='delivery'&&order.status==='dispatched'&&(!order.deliveryProofRequired||order.proofVerified))||(order.fulfillment==='pickup'&&order.status==='ready'));
    if(canCollect){
      action(body,t('Record full cash collected','تسجيل تحصيل المبلغ نقداً'),async()=>{
        if(!window.confirm(t('Confirm that the full amount was collected: ','تأكيد تحصيل كامل المبلغ: ')+money(order.totalMinor)))return;
        await api(base+'/'+order.id+'/cash-received','POST',{requestId:crypto.randomUUID(),amountMinor:Number(order.totalMinor)});
      },status,refresh);
    }
    if(canLinkLead){
      if(order.leadId)add(body,'p',t('Linked to Lead Pipeline','مرتبط بمسار العملاء المحتملين'));
      else action(body,t('Add to Lead Pipeline','إضافة إلى مسار العملاء المحتملين'),()=>api('/orders/'+order.id+'/lead','POST',{}),status,refresh);
    }
    if(!driver&&['completed','partially_returned'].includes(order.status)){
      const returns=add(body,'details');add(returns,'summary',t('Record returned items','تسجيل المنتجات المرتجعة'));
      const reason=input(returns,t('Return reason','سبب الإرجاع'));
      const restock=input(returns,t('Restock after inspection','إعادة للمخزون بعد الفحص'),'','checkbox');
      const qtyFields=[];
      for(const line of order.lines.filter(item=>item.returnableQuantity>0)){
        const quantity=input(returns,(t(line.nameEn,line.nameAr)||line.nameEn)+' · '+t('Return quantity (up to ','الكمية المرتجعة (بحد أقصى ')+line.returnableQuantity+')','','number');
        quantity.min=0;quantity.max=line.returnableQuantity;quantity.step=line.quantityIncrement||'1';quantity.value=0;
        qtyFields.push({id:line.id,quantity});
      }
      action(returns,t('Save return','حفظ الإرجاع'),()=>{
        const lines=qtyFields.filter(item=>Number(item.quantity.value)>0).map(item=>({id:item.id,quantity:item.quantity.value}));
        if(!lines.length||!reason.value.trim())throw Error('INVALID_RETURN');
        return api('/orders/'+order.id+'/returns','POST',{requestId:crypto.randomUUID(),reason:reason.value,restock:restock.checked,lines});
      },status,refresh);
    }
    if(order.deliveryAddress){
      add(body,'p',[order.deliveryZone,order.deliveryAddress].filter(Boolean).join(' · '));
      const mapLinks=add(body,'div');mapLinks.className='sx-retail-map-links';
      const map=add(mapLinks,'a','Google Maps');map.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(order.deliveryPin||order.deliveryAddress);
      map.target='_blank';map.rel='noopener noreferrer';
      const waze=add(mapLinks,'a','Waze');waze.href='https://www.waze.com/ul?'+(order.deliveryPin?'ll='+encodeURIComponent(order.deliveryPin):'q='+encodeURIComponent(order.deliveryAddress))+'&navigate=yes';
      waze.target='_blank';waze.rel='noopener noreferrer';
    }
    if(!driver&&order.fulfillment==='delivery'&&(['placed','ready'].includes(order.status)||(order.status==='dispatched'&&order.deliveryState==='failed'))){
      const select=add(add(body,'label',t('Assigned driver','السائق المعيّن')+' '),'select');
      add(select,'option',t('Select a driver','اختر سائقاً')).value='';
      for(const member of drivers)add(select,'option',member.name).value=member.id;
      select.value=order.driverId||'';
      action(body,t('Assign','تعيين'),()=>api('/orders/'+order.id+'/driver','PUT',{driverId:select.value}),status,refresh);
    }
    const options=order.status==='placed'&&!driver?['ready','cancelled']:
      order.status==='ready'?order.fulfillment==='delivery'?[...(order.driverId?['dispatched']:[]),...(!driver?['cancelled']:[])]:!driver?[...(order.cashReceived?['completed']:[]),...(!order.cashReceived?['cancelled']:[])]:[]:
      order.status==='dispatched'?(order.cashReceived?['completed']:[]):order.status==='completed'&&!driver?['returned']:order.status==='partially_returned'&&!driver?['returned']:[];
    for(const next of options)action(body,labels[next],()=>{
      if(next==='returned'&&!window.confirm(t('Return all remaining items to stock? Inspect items before restocking. Refunds are recorded separately.','إرجاع كل المنتجات المتبقية للمخزون؟ افحص المنتجات قبل إعادتها. يتم تسجيل المبالغ المستردة بشكل منفصل.')))return;
      return api(base+'/'+order.id+'/status','POST',{status:next});
    },status,refresh);
  }
  function sourceStatus(value){
    const key=String(value||'unknown').toLowerCase().replace(/^wc-/,'');
    const en={pending:'Pending',new:'New',processing:'Processing', 'on-hold':'On hold',completed:'Completed',cancelled:'Cancelled',canceled:'Canceled',delivered:'Delivered',refunded:'Refunded',failed:'Failed','checkout-draft':'Checkout draft',open:'Open',closed:'Closed',unknown:'Unknown',paid:'Paid','paid_reported_by_store':'Paid (reported by store)','refunded_reported_by_store':'Refunded (reported by store)'};
    const ar={pending:'قيد الانتظار',new:'جديد',processing:'قيد المعالجة','on-hold':'معلّق',completed:'مكتمل',cancelled:'ملغى',canceled:'ملغى',delivered:'تم التسليم',refunded:'مسترد',failed:'فشل','checkout-draft':'مسودة الدفع',open:'مفتوح',closed:'مغلق',unknown:'غير معروف',paid:'مدفوع','paid_reported_by_store':'مدفوع (حسب المتجر)','refunded_reported_by_store':'مسترد (حسب المتجر)'};
    const fallback=key.replace(/[-_]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());
    return t(en[key]||fallback,ar[key]||fallback);
  }
  function renderOnlineOrder(root,order){
    const card=add(root,'article');card.className='sx-retail-order sx-retail-online-order';
    const row=add(card,'div');row.className='sx-retail-order-summary';
    const reference=add(row,'div');reference.className='sx-retail-order-reference';
    add(reference,'span',t('Online order','طلب إلكتروني')).className='sx-retail-order-label';
    const number=add(reference,'bdi','#'+String(order.orderNumber||order.externalOrderId));number.dir='auto';number.className='sx-retail-order-id';
    const date=add(reference,'time',orderDate(order.orderDate));date.dateTime=order.orderDate||'';date.className='sx-retail-order-date';
    const source=add(row,'div');source.className='sx-retail-order-buyer';
    add(source,'strong',order.storeName||t('Connected store','متجر متصل'));
    add(source,'span',order.provider==='woocommerce'?'WooCommerce':String(order.provider||'').toUpperCase());
    const total=add(row,'strong',sourceMoney(order.totalAmount,order.currency));total.className='sx-retail-order-total';total.dir='auto';
    const badges=add(row,'div');badges.className='sx-retail-order-badges';
    add(badges, 'span', sourceStatus(order.status)).className='sx-retail-order-status';
    const details=add(card,'details');details.className='sx-retail-order-details';
    add(details,'summary',t('Source order details','تفاصيل الطلب من المتجر'));
    const body=add(details,'div');body.className='sx-retail-order-body';
    const id=add(body,'p');add(id,'strong',t('Store order ID: ','معرّف طلب المتجر: '));const idValue=add(id,'bdi',order.externalOrderId);idValue.dir='ltr';
    add(body,'p',t('Store: ','المتجر: ')+(order.storeName||'—')+' · '+(order.provider==='woocommerce'?'WooCommerce':String(order.provider||'').toUpperCase()));
    add(body,'p',t('Order status: ','حالة الطلب: ')+sourceStatus(order.status));
    add(body,'p',t('Payment status reported by store: ','حالة الدفع حسب المتجر: ')+sourceStatus(order.financialStatus));
    const dateLabel=order.dateBasis==='source_created'?t('Placed: ','تاريخ الطلب: '):t('Imported: ','تاريخ الاستيراد: ');
    add(body,'p',dateLabel+orderDate(order.orderDate));
    if(order.lastSyncAt)add(body,'p',t('Last store sync: ','آخر مزامنة للمتجر: ')+orderDate(order.lastSyncAt));
    const rows=[['Subtotal', 'المجموع الفرعي',order.breakdown?.subtotal],['Discount','الخصم',order.breakdown?.discount],
      ['Shipping','الشحن',order.breakdown?.shipping],['Tax','الضريبة',order.breakdown?.tax],['Refunds reported by store','المبالغ المستردة حسب المتجر',order.breakdown?.refunds]];
    for(const [en,ar,amount] of rows)if(amount!==null&&amount!==undefined&&Number(amount)!==0)add(body,'p',t(en+': ',ar+': ')+sourceMoney(amount,order.currency));
    const items=add(body,'section');items.className='sx-retail-online-items';
    add(items,'h3',t('Purchased items','المنتجات المشتراة'));
    const itemStatus=add(items,'p');itemStatus.setAttribute('role','status');itemStatus.setAttribute('aria-live','polite');
    const itemList=add(items,'ul');itemList.className='sx-retail-online-item-list';
    const loadItems=add(items,'button',t('Load item and SKU details','تحميل تفاصيل المنتجات ورموز SKU'));loadItems.type='button';
    loadItems.onclick=async()=>{
      loadItems.disabled=true;itemStatus.textContent=t('Loading item details…','جارٍ تحميل تفاصيل المنتجات…');
      try{
        const result=await api('/orders/online/detail','POST',{connectionId:order.connectionId,externalOrderId:order.externalOrderId});
        itemList.replaceChildren();
        if(!result.lines?.length)itemStatus.textContent=t('No line items were included in this store snapshot.','لا تتضمن لقطة المتجر تفاصيل المنتجات.');
        else{
          itemStatus.textContent='';
          for(const lineData of result.lines){
            const line=add(itemList,'li');line.className='sx-retail-online-item';
            add(line,'h4',lineData.name||t('Store item','منتج من المتجر'));
            const sourceName=order.provider==='woocommerce'?'Woo':'store',sourceNameAr=order.provider==='woocommerce'?'Woo':'المتجر';
            const sourceIds=add(line,'p');add(sourceIds,'strong',order.provider==='woocommerce'?t('Woo product / variation: ','المنتج / المتغير في Woo: '):t('Store product / variation: ','منتج / متغير المتجر: '));
            const productId=add(sourceIds,'bdi',lineData.productId||'—');productId.dir='ltr';
            if(lineData.variationId){add(sourceIds,'span',' / ');const variationId=add(sourceIds,'bdi',lineData.variationId);variationId.dir='ltr';}
            const sourceSku=add(line,'p');add(sourceSku,'strong',t(sourceName+' SKU: ','رمز SKU في '+sourceNameAr+': '));const skuValue=add(sourceSku,'bdi',lineData.sku||'—');skuValue.dir='ltr';
            add(line,'p',t('Quantity: ','الكمية: ')+lineData.quantity);
            if(lineData.unitPrice!==null)add(line,'p',t('Unit price: ','سعر الوحدة: ')+sourceMoney(lineData.unitPrice,order.currency));
            if(lineData.total!==null)add(line,'p',t('Line total: ','إجمالي السطر: ')+sourceMoney(lineData.total,order.currency));
            const mappingLabel={mapped:t('Mapped to 7Network inventory','مرتبط بمخزون 7Network'),ignored:t('Explicitly excluded from inventory mapping','مستثنى صراحةً من ربط المخزون'),
              unmapped:t('Not mapped to 7Network inventory','غير مرتبط بمخزون 7Network'),target_unavailable:t('Mapped inventory product is unavailable','منتج المخزون المرتبط غير متاح'),
              not_supported:t('Mapping is not supported for this store provider','الربط غير مدعوم لمزود هذا المتجر')};
            add(line,'p',t('Inventory mapping: ','ربط المخزون: ')+(mappingLabel[lineData.mappingStatus]||mappingLabel.unmapped));
            if(lineData.target){
              const target=add(line,'p');add(target,'strong',t('7Network item: ','منتج 7Network: '));
              const targetName=t(lineData.target.nameEn,lineData.target.nameAr)||lineData.target.nameEn||lineData.target.id;
              add(target,'span',targetName+(lineData.target.sku?' · ':' '));if(lineData.target.sku){const targetSku=add(target,'bdi',lineData.target.sku);targetSku.dir='ltr';}
              if(lineData.skuMatches===false)add(line,'p',t('The Woo SKU and mapped 7Network SKU differ. Review the explicit mapping before accepting reconciliation.','يختلف رمز SKU في Woo عن رمز 7Network المرتبط. راجع الربط قبل اعتماد المطابقة.'));
            }
          }
          if(result.lineItemsTruncated)itemStatus.textContent=t('The source snapshot contains more than 100 items; only the first 100 are available here.','تحتوي لقطة المصدر على أكثر من 100 منتج؛ المتاح هنا أول 100 فقط.');
        }
        loadItems.textContent=t('Refresh item and SKU details','تحديث تفاصيل المنتجات ورموز SKU');
      }catch{itemStatus.textContent=t('Unable to load item details. Refresh the order list and try again.','تعذر تحميل تفاصيل المنتجات. حدّث قائمة الطلبات وحاول مرة أخرى.');}
      finally{loadItems.disabled=false;}
    };
    if(order.connectionStatus!=='active')add(body,'p',t('This store connection is '+String(order.connectionStatus||'inactive')+'. This snapshot may be out of date.','اتصال هذا المتجر '+String(order.connectionStatus||'غير نشط')+'. قد تكون هذه البيانات قديمة.'));
    add(body,'p',t('Read-only source record. Manage fulfilment and payment in the connected store; this view does not change stock or payment status.','سجل للقراءة فقط. أدر تنفيذ الطلب والدفع في المتجر المتصل؛ ولا يغيّر هذا العرض المخزون أو حالة الدفع.'));
  }
  async function orders(root,status,driver,canLinkLead,canConnectedStores){
    const list=add(root,'div');list.className='sx-retail-order-list';
    if(driver){
      const empty=add(root,'p');empty.className='sx-retail-empty';
      let rows=[];
      const render=()=>{list.replaceChildren();empty.hidden=rows.length>0;if(!rows.length)empty.textContent=t('No deliveries assigned yet.','لا توجد عمليات توصيل معيّنة بعد.');for(const order of rows)renderOrder(list,order,{driver,drivers:[],canLinkLead:false,status,refresh:refreshDriver});};
      const refreshDriver=async()=>{rows=await api('/deliveries');render();};
      await refreshDriver();
      return;
    }
    const intro=add(root,'p',t('Find and manage customer orders. Use dates, customer details or status to narrow the list.','ابحث عن طلبات العملاء وأدرها. استخدم التاريخ أو بيانات العميل أو الحالة لتصفية القائمة.'));intro.className='sx-retail-page-subtitle';
    const sourceTabs=add(root,'div');sourceTabs.className='sx-retail-filter-actions sx-retail-order-source-tabs';sourceTabs.setAttribute('role','group');sourceTabs.setAttribute('aria-label',t('Order source','مصدر الطلب'));
    const nativeTab=add(sourceTabs,'button',t('7Network orders','طلبات 7Network'));nativeTab.type='button';nativeTab.className='sx-retail-primary';
    const onlineTab=add(sourceTabs,'button',t('Connected store orders','طلبات المتاجر المتصلة'));onlineTab.type='button';onlineTab.className='sx-retail-secondary';
    onlineTab.hidden=!canConnectedStores;
    const filters=add(root,'section');filters.className='sx-retail-filter-panel';
    const form=add(filters,'form');form.className='sx-retail-order-filters';
    const from=input(form,t('From date','من تاريخ'),'','date');from.autocomplete='off';from.parentElement.className='sx-retail-filter-field';
    const to=input(form,t('To date','إلى تاريخ'),'','date');to.autocomplete='off';to.parentElement.className='sx-retail-filter-field';
    const customer=input(form,t('Customer: name, mobile or email','العميل: الاسم أو الهاتف أو البريد الإلكتروني'),'','search');customer.autocomplete='off';customer.maxLength=120;customer.parentElement.className='sx-retail-filter-field sx-retail-filter-customer';
    const onlineOrder=input(form,t('Store order number or ID','رقم الطلب أو معرّفه في المتجر'),'','search');onlineOrder.autocomplete='off';onlineOrder.maxLength=120;onlineOrder.parentElement.className='sx-retail-filter-field sx-retail-filter-customer';onlineOrder.parentElement.hidden=true;
    const statusLabel=add(form,'label',t('Order status','حالة الطلب'));statusLabel.className='sx-retail-filter-field';
    const statusSelect=add(statusLabel,'select');statusSelect.setAttribute('aria-label',t('Order status','حالة الطلب'));
    add(statusSelect,'option',t('All statuses','كل الحالات')).value='';
    for(const [key,value] of Object.entries(labels)){const option=add(statusSelect,'option',value);option.value=key;}
    const onlineStatus=input(form,t('Store order status','حالة طلب المتجر'),'','search');onlineStatus.placeholder='pending, processing, delivered, completed, failed, cancelled or custom';onlineStatus.autocomplete='off';onlineStatus.maxLength=64;onlineStatus.parentElement.className='sx-retail-filter-field';onlineStatus.parentElement.hidden=true;
    const controls=add(form,'div');controls.className='sx-retail-filter-actions';
    const searchButton=add(controls,'button',t('Search orders','بحث عن الطلبات'));searchButton.type='submit';searchButton.className='sx-retail-primary';
    const clearButton=add(controls,'button',t('Clear filters','مسح التصفية'));clearButton.type='button';clearButton.className='sx-retail-secondary';
    const resultCount=add(root,'p');resultCount.className='sx-retail-result-count';resultCount.setAttribute('aria-live','polite');
    const empty=add(root,'p');empty.className='sx-retail-empty';empty.hidden=true;
    const more=add(root,'button',t('Load more orders','تحميل المزيد من الطلبات'));more.type='button';more.className='sx-retail-load-more';more.hidden=true;
    let drivers=[];try{drivers=await api('/drivers');}catch{}
    const initialOrderQuery=new URLSearchParams(location.search);
    let page=0,loaded=0,hasMore=false,searchSequence=0;
    let sourceMode=initialOrderQuery.get('source')==='online'&&canConnectedStores?'online':'native';
    if(sourceMode==='online'&&initialOrderQuery.get('status'))onlineStatus.value=initialOrderQuery.get('status').slice(0,64);
    const localBoundary=(value,nextDay=false)=>{
      const [year,month,day]=value.split('-').map(Number),date=new Date(year,month-1,day);
      if(nextDay)date.setDate(date.getDate()+1);
      return date.toISOString();
    };
    async function runSearch(reset=true,nextPage=page){
      if(from.value&&to.value&&from.value>to.value){status.textContent=t('The start date must be on or before the end date.','يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو مساوياً له.');return;}
      const requestSequence=++searchSequence,requestedPage=reset?0:nextPage;
      if(reset){page=0;loaded=0;list.replaceChildren();empty.hidden=true;more.hidden=true;resultCount.textContent='';}
      searchButton.disabled=true;clearButton.disabled=true;more.disabled=true;status.textContent=t('Loading orders…','جار تحميل الطلبات…');
      const criteria={page:requestedPage};
      if(from.value)criteria.from=localBoundary(from.value);
      if(to.value)criteria.to=localBoundary(to.value,true);
      if(sourceMode==='native'){
        if(customer.value.trim())criteria.customer=customer.value.trim();
        if(statusSelect.value)criteria.status=statusSelect.value;
      }else{
        if(onlineOrder.value.trim())criteria.order=onlineOrder.value.trim();
        if(onlineStatus.value.trim())criteria.status=onlineStatus.value.trim();
      }
      try{
        const result=await api(sourceMode==='native'?'/orders/search':'/orders/online/search','POST',criteria);
        if(requestSequence!==searchSequence)return;
        for(const order of result.orders||[])sourceMode==='native'?renderOrder(list,order,{driver:false,drivers,canLinkLead,status,refresh:()=>runSearch(true)}):renderOnlineOrder(list,order);
        loaded+=result.orders?.length||0;hasMore=Boolean(result.hasMore);page=Number.isSafeInteger(result.page)?result.page:requestedPage;
        resultCount.textContent=loaded?t('Showing ','عرض ')+loaded+(sourceMode==='native'?t(' matching orders',' طلبات مطابقة'):t(' connected-store orders',' طلبات من المتاجر المتصلة')):'';
        more.hidden=!hasMore;empty.hidden=loaded>0;
        if(!loaded){
          const filtered=from.value||to.value||(sourceMode==='native'?(customer.value.trim()||statusSelect.value):(onlineOrder.value.trim()||onlineStatus.value.trim()));
          empty.textContent=sourceMode==='native'?(filtered?t('No orders match these filters.','لا توجد طلبات تطابق خيارات التصفية.'):
            t('No 7Network orders yet.','لا توجد طلبات 7Network بعد.')):(filtered?t('No connected-store orders match these filters.','لا توجد طلبات من المتاجر المتصلة تطابق خيارات التصفية.'):
            t('No imported online orders yet. Connect a store and complete a read-only sync in Connected Stores.','لا توجد طلبات إلكترونية مستوردة بعد. اربط متجراً وأكمل مزامنة للقراءة فقط من صفحة المتاجر المتصلة.'));
        }
        status.textContent='';
      }catch{
        if(requestSequence===searchSequence)status.textContent=t('Unable to load orders. Check your connection and try again.','تعذر تحميل الطلبات. تحقق من الاتصال وحاول مرة أخرى.');
      }finally{if(requestSequence===searchSequence){searchButton.disabled=false;clearButton.disabled=false;more.disabled=false;}}
    }
    const setSourceMode=(mode,search=true)=>{
      if(mode==='online'&&!canConnectedStores)return;
      sourceMode=mode;const online=mode==='online';nativeTab.setAttribute('aria-pressed',String(!online));onlineTab.setAttribute('aria-pressed',String(online));
      nativeTab.className=online?'sx-retail-secondary':'sx-retail-primary';onlineTab.className=online?'sx-retail-primary':'sx-retail-secondary';
      customer.parentElement.hidden=online;onlineOrder.parentElement.hidden=!online;statusLabel.hidden=online;onlineStatus.parentElement.hidden=!online;
      intro.textContent=online?t('Review imported orders from connected stores. These records are read-only in 7Network.','راجع الطلبات المستوردة من المتاجر المتصلة. هذه السجلات للقراءة فقط في 7Network.'):
        t('Find and manage customer orders. Use dates, customer details or status to narrow the list.','ابحث عن طلبات العملاء وأدرها. استخدم التاريخ أو بيانات العميل أو الحالة لتصفية القائمة.');
      if(search)runSearch(true);
    };
    nativeTab.setAttribute('aria-pressed','true');onlineTab.setAttribute('aria-pressed','false');
    setSourceMode(sourceMode,false);
    nativeTab.onclick=()=>setSourceMode('native');onlineTab.onclick=()=>setSourceMode('online');
    form.onsubmit=event=>{event.preventDefault();runSearch(true);};
    clearButton.onclick=()=>{form.reset();runSearch(true);};
    more.onclick=()=>runSearch(false,page+1);
    await runSearch(true);
  }
  function finance(root,status){
    root.classList.add('sx-retail-finance');
    root.querySelector('h1').after(Object.assign(document.createElement('p'),{
      className:'sx-retail-page-subtitle',
      textContent:t('Match cash handed over by drivers to completed deliveries.','طابق النقد الذي سلّمه السائقون مع عمليات التوصيل المكتملة.')
    }));
    status.className='sx-retail-finance-status';
    const layout=add(root,'div');layout.className='sx-retail-finance-layout';
    const work=add(layout,'div');
    const pending=add(work,'section');
    add(pending,'h2',t('Pending handovers','عمليات التسليم المعلّقة'));
    const batches=add(pending,'div');
    const history=add(work,'section');
    add(history,'h2',t('Recent handovers','عمليات التسليم الأخيرة'));
    const recent=add(history,'div');
    const exports=add(layout,'section');
    add(exports,'h2',t('Download accounting data','تنزيل بيانات المحاسبة'));
    add(exports,'p',t('Export cash receipts and returned item values for your records.','صدّر إيصالات النقد وقيم المنتجات المرتجعة لسجلاتك.'));
    const exportForm=add(exports,'form');
    const today=new Date().toISOString().slice(0,10);
    const from=input(exportForm,t('From date (UTC)','من تاريخ (UTC)'),today.slice(0,7)+'-01','date');
    const to=input(exportForm,t('To date (UTC)','إلى تاريخ (UTC)'),today,'date');
    from.required=to.required=true;
    const download=add(exportForm,'button',t('Download CSV','تنزيل CSV'));
    download.type='submit';
    const exportStatus=add(exports,'p');exportStatus.setAttribute('role','status');
    const refresh=add(pending,'button',t('Retry loading handovers','إعادة تحميل عمليات التسليم'));
    refresh.type='button';refresh.hidden=true;
    let saving=false;

    exportForm.onsubmit=async event=>{
      event.preventDefault();
      const range={from:from.value,to:to.value};
      if(range.from>range.to){
        exportStatus.textContent=t('The start date must be on or before the end date.','يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو مساوياً له.');
        return;
      }
      if(to.valueAsNumber-from.valueAsNumber>92*86400000){
        exportStatus.textContent=t('Choose a range of 93 calendar days or fewer.','اختر نطاقاً لا يتجاوز 93 يوماً تقويمياً.');
        return;
      }
      download.disabled=true;
      exportStatus.textContent=t('Preparing CSV…','جارٍ تجهيز ملف CSV…');
      try{
        const headers=await window.SaleMaxWorkspace.headers(false,false);
        const response=await fetch('/api/workspace/retail/finance/accounting-export.csv?'+new URLSearchParams(range),{credentials:'same-origin',cache:'no-store',headers});
        if(response.status===413){
          exportStatus.textContent=t('This export is too large. Choose a shorter date range.','حجم التصدير كبير. اختر نطاقاً زمنياً أقصر.');
          return;
        }
        if(!response.ok)throw Error('ACCOUNTING_EXPORT_FAILED');
        if(response.headers.get('X-Export-Row-Count')==='0'){
          exportStatus.textContent=t('No cash receipts or returns in this date range.','لا توجد إيصالات نقدية أو مرتجعات خلال هذه الفترة.');
          return;
        }
        const url=URL.createObjectURL(await response.blob());
        const anchor=add(document.body,'a');anchor.hidden=true;anchor.href=url;
        anchor.download='7network-retail-source-'+range.from+'-'+range.to+'.csv';
        anchor.click();anchor.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        exportStatus.textContent=t('CSV download started.','بدأ تنزيل ملف CSV.');
      }catch{
        exportStatus.textContent=t('Could not download the CSV. Try again.','تعذر تنزيل ملف CSV. حاول مرة أخرى.');
      }finally{download.disabled=false;}
    };

    function renderBatch(driver){
      const selected=driver.orders.slice(0,100);
      const expected=selected.reduce((total,order)=>total+order.amountMinor,0);
      const batch=add(batches,'article');batch.className='sx-retail-finance-batch';
      const heading=add(batch,'div');heading.className='sx-retail-finance-row';
      add(heading,'h3',driver.name);
      add(heading,'strong',t('Expected','المتوقع')+' '+money(expected));
      const details=add(batch,'details');
      const count=new Intl.NumberFormat(t('en-QA','ar-QA')).format(selected.length);
      add(details,'summary',t('View orders','عرض الطلبات')+' ('+count+')');
      for(const order of selected){
        const row=add(details,'p');row.className='sx-retail-finance-row';
        add(row,'bdi',order.id).dir='ltr';add(row,'span',money(order.amountMinor));
      }
      if(driver.orderCount>selected.length || driver.orders.length>selected.length || driver.hasMore){
        add(batch,'p',t('More orders are waiting for this driver. Record this batch to load the next one.','توجد طلبات إضافية لهذا السائق. سجّل هذه الدفعة لتحميل الدفعة التالية.'));
      }
      const form=add(batch,'form');
      const counted=input(form,t('Cash counted (QAR)','النقد المعدود (ريال قطري)'),'','number');
      counted.required=true;counted.min=0;counted.step=0.01;counted.inputMode='decimal';
      const submit=add(form,'button',t('Record handover','تسجيل التسليم'));submit.type='submit';
      const feedback=add(batch,'p');feedback.setAttribute('role','status');
      let attempt;
      form.onsubmit=async event=>{
        event.preventDefault();
        if(saving)return;
        const countedMinor=Math.round(counted.valueAsNumber*100);
        if(!Number.isSafeInteger(countedMinor)||countedMinor<0){
          feedback.textContent=t('Enter a valid counted amount.','أدخل مبلغاً معدوداً صالحاً.');
          return;
        }
        if(attempt&&attempt.countedMinor!==countedMinor){
          feedback.textContent=t('Retry the original amount to confirm the previous attempt.','أعد المحاولة بالمبلغ الأصلي لتأكيد المحاولة السابقة.');
          return;
        }
        attempt??={countedMinor,requestId:crypto.randomUUID()};
        saving=true;
        const buttons=batches.querySelectorAll('button[type=submit]');
        buttons.forEach(button=>button.disabled=true);
        counted.disabled=true;
        feedback.textContent=t('Recording handover…','جارٍ تسجيل التسليم…');
        try{
          const result=await api('/finance/settlements','POST',{...attempt,driverId:driver.id,orderIds:selected.map(order=>order.id)});
          const message=result.status==='matched'?t('Handover recorded and matched.','تم تسجيل التسليم ومطابقته.'):
            t('Difference recorded. These orders remain open.','تم تسجيل الفرق. تظل هذه الطلبات مفتوحة.');
          await load(message);
        }catch(error){
          if(['SETTLEMENT_ORDERS_UNAVAILABLE','DRIVER_UNAVAILABLE'].includes(error.message)){
            await load(t('This batch changed. Review the updated orders.','تغيّرت هذه الدفعة. راجع الطلبات المحدّثة.'));
          }else{
            feedback.textContent=t('Could not confirm the handover. Retry the same amount.','تعذر تأكيد تسجيل التسليم. أعد المحاولة بالمبلغ نفسه.');
          }
        }finally{
          saving=false;
          counted.disabled=false;
          buttons.forEach(button=>button.disabled=false);
        }
      };
    }

    async function load(message=''){
      refresh.hidden=true;batches.replaceChildren();recent.replaceChildren();
      status.textContent=t('Loading handovers…','جارٍ تحميل عمليات التسليم…');
      try{
        const data=await api('/finance');
        if(!data.drivers.length){
          const empty=add(batches,'div');empty.className='sx-retail-finance-empty';
          add(empty,'strong',t('No cash waiting to be reconciled','لا يوجد نقد بانتظار التسوية'));
          add(empty,'p',t('Completed cash-on-delivery orders appear here when a cash receipt has been recorded.','تظهر هنا طلبات الدفع عند الاستلام المكتملة بعد تسجيل إيصال النقد.'));
        }
        for(const driver of data.drivers)renderBatch(driver);
        if(!data.settlements.length)add(recent,'p',t('Recorded handovers will appear here.','ستظهر هنا عمليات التسليم المسجلة.'));
        for(const settlement of data.settlements){
          const row=add(recent,'article');row.className='sx-retail-finance-history';
          const heading=add(row,'div');heading.className='sx-retail-finance-row';
          add(heading,'strong',settlement.driverName);
          const matched=settlement.status==='matched';
          const badge=add(heading,'span',matched?t('Matched','مطابق'):t('Difference','فرق'));
          badge.className='sx-retail-finance-badge';badge.dataset.matched=String(matched);
          add(row,'p',t('Expected','المتوقع')+' '+money(settlement.expectedMinor)+' · '+t('Counted','المعدود')+' '+money(settlement.countedMinor));
          if(settlement.createdAt)add(row,'time',orderDate(settlement.createdAt)).dateTime=settlement.createdAt;
        }
        status.textContent=message;
      }catch{
        status.textContent=[message,t('Could not load handovers. Try again.','تعذر تحميل عمليات التسليم. حاول مرة أخرى.')].filter(Boolean).join(' ');
        refresh.hidden=false;
      }
    }
    refresh.onclick=()=>load();
    return load();
  }
  function showCode(status,error){status.textContent=t('Could not complete this action.','تعذر إكمال هذا الإجراء.')+(error?.message?' '+String(error.message).replace(/[^A-Z0-9_ -]/gi,'').slice(0,64):'');}
  async function connectedStores(root,status,access){
    root.classList.add('sx-retail-connected-stores');
    const intro=add(root,'p',t('Connect stores, run imports and review what WooCommerce reported. Imported products, orders and customers remain in their account sections. Sync reads store data and does not change the store.','اربط المتاجر ونفّذ الاستيراد وراجع ما أبلغ عنه WooCommerce. تبقى المنتجات والطلبات والعملاء المستوردة في أقسامها داخل الحساب. تقرأ المزامنة بيانات المتجر ولا تغيّره.'));
    intro.className='sx-retail-page-subtitle';
    const connectionsRoot=add(root,'section');connectionsRoot.className='sx-retail-connected-list';
    add(connectionsRoot,'h2',t('Connected stores','المتاجر المتصلة'));
    const connectDetails=add(root,'details');connectDetails.className='sx-retail-connect-another';
    add(connectDetails,'summary',t('Connect another store','ربط متجر آخر'));
    const connectForms=add(connectDetails,'div');connectForms.className='sx-retail-connect-forms';

    const shopify=add(connectForms,'section');shopify.className='sx-retail-connect-provider';
    add(shopify,'h3',t('Shopify','Shopify'));
    add(shopify,'p',t('Connect through Shopify authorization. The app requests read-only product, order and customer access. Orders cover the last 60 days by default; the optional older-order scope can be enabled only after Shopify approves it. Customer names and contact details also require protected customer data access. The authorizing Shopify staff account must also be allowed to view abandoned checkouts.','يتم الربط عبر تفويض Shopify. يطلب التطبيق قراءة المنتجات والطلبات والعملاء فقط. تشمل الطلبات آخر 60 يوماً افتراضياً؛ ولا يمكن تفعيل نطاق الطلبات الأقدم الاختياري إلا بعد موافقة Shopify. كما تتطلب أسماء العملاء وبيانات التواصل موافقة الوصول إلى بيانات العملاء المحمية. ويجب أن يملك حساب موظف Shopify المفوّض صلاحية عرض السلات المتروكة.'));
    const shopName=input(shopify,t('Shopify store domain','نطاق متجر Shopify'));
    shopName.autocomplete='url';shopName.placeholder='example.myshopify.com';shopName.setAttribute('aria-label',t('Shopify store domain','نطاق متجر Shopify'));
    const shopCurrency=input(shopify,t('Primary store currency (ISO 4217)','العملة الأساسية للمتجر (ISO 4217)'),'QAR');shopCurrency.maxLength=3;shopCurrency.autocomplete='off';
    const connectShopify=add(shopify,'button',t('Connect Shopify','ربط Shopify'));connectShopify.type='button';
    connectShopify.onclick=async()=>{connectShopify.disabled=true;try{const result=await api('/connectors/shopify/start','POST',{shop:shopName.value,currency:shopCurrency.value.toUpperCase()});location.assign(result.authorizationUrl);}catch(error){showCode(status,error);connectShopify.disabled=false;}};

    const woo=add(connectForms,'section');woo.className='sx-retail-connect-provider';
    add(woo,'h3',t('WooCommerce','WooCommerce'));
    add(woo,'p',t('Use a dedicated read-only WooCommerce REST key. The key is sent over HTTPS and stored encrypted in 7Network. This admin connection does not add storefront or checkout fields or change payment settings. After the first full sync reconciles, the owner can configure signed product, order and customer webhooks in WooCommerce admin; that setup changes admin settings only. The optional checkout-event plugin is separate and is not needed for catalog/order sync.','استخدم مفتاح REST مخصصاً للقراءة فقط في WooCommerce. يُرسل المفتاح عبر HTTPS ويُخزّن مشفراً في 7Network. لا يضيف هذا الربط الإداري حقولاً للمتجر أو الدفع ولا يغيّر إعدادات الدفع. بعد اكتمال أول مزامنة ومطابقتها، يمكن للمالك إعداد Webhooks موقّعة للمنتجات والطلبات والعملاء من لوحة WooCommerce؛ وهذا يغيّر إعدادات الإدارة فقط. إضافة أحداث الدفع اختيارية ومنفصلة وليست مطلوبة لمزامنة المنتجات والطلبات.'));
    add(woo,'p',t('If a previous WooCommerce key was exposed, revoke it in WooCommerce and enter the replacement key here. Existing connections must pass a fresh credential check before automatic sync resumes.','إذا كُشف مفتاح WooCommerce سابق، أبطله من لوحة WooCommerce وأدخل المفتاح البديل هنا. يجب إعادة التحقق من بيانات الاتصال الحالية قبل استئناف المزامنة التلقائية.'));
    const wooUrl=input(woo,t('Store URL','رابط المتجر'));wooUrl.placeholder='https://shop.example.com';wooUrl.autocomplete='url';
    const wooDisplay=input(woo,t('Display name','اسم العرض'));
    const wooCurrency=input(woo,t('Store currency (ISO 4217)','عملة المتجر (ISO 4217)'),'QAR');wooCurrency.maxLength=3;wooCurrency.autocomplete='off';
    const wooKey=input(woo,t('Consumer key (read only)','مفتاح المستهلك (قراءة فقط)'),'','password');wooKey.autocomplete='new-password';
    const wooSecret=input(woo,t('Consumer secret','السر الخاص بالمستهلك'),'','password');wooSecret.autocomplete='new-password';
    const connectWoo=add(woo,'button',t('Connect or revalidate WooCommerce','ربط WooCommerce أو إعادة التحقق'));connectWoo.type='button';
    connectWoo.onclick=async()=>{connectWoo.disabled=true;try{
      await api('/connectors/woocommerce','POST',{storeUrl:wooUrl.value,displayName:wooDisplay.value,currency:wooCurrency.value.toUpperCase(),consumerKey:wooKey.value,consumerSecret:wooSecret.value});
      wooKey.value='';wooSecret.value='';status.textContent=t('WooCommerce connected. API credentials were cleared from the form and stored encrypted. Read-only sync has not started. Configure signed webhooks only after reconciliation.','تم ربط WooCommerce. مُسحت بيانات API من النموذج وخُزنت مشفرة. لم تبدأ المزامنة للقراءة فقط بعد. أعدّ Webhooks الموقّعة بعد المطابقة فقط.');connectDetails.open=false;await refreshConnections();
    }catch(error){showCode(status,error);}finally{connectWoo.disabled=false;}};

    async function showSetup(connection,area){
      area.replaceChildren();add(area,'h3',t('Webhook setup','إعداد Webhook'));
      try{
        const result=await api('/connectors/'+encodeURIComponent(connection.id)+'/webhook-setup');
        add(area,'p',t('Endpoint','نقطة الاتصال')+': '+result.webhookUrl);
        if(result.webhookSecret){const field=add(add(area,'label',t('Signing secret','سر التوقيع')+' '),'textarea');field.readOnly=true;field.rows=3;field.value=result.webhookSecret;}
        add(area,'p',t('Subscribe to','اشترك في')+': '+result.topics.join(', '));
        if(connection.provider==='shopify'&&result.complianceWebhookUrl)add(area,'p',t('Shopify mandatory privacy topics (configured in Shopify Dev Dashboard): ','موضوعات الخصوصية الإلزامية في Shopify (تُعدّ في لوحة المطور): ')+result.complianceWebhookUrl);
        if(result.abandonedCheckoutPlugin){const link=add(area,'a',t('Download the WooCommerce abandoned-checkout plugin','تنزيل إضافة السلات المتروكة لـ WooCommerce'));link.href=result.abandonedCheckoutPlugin;link.download='7network-retail-connector.zip';link.rel='noopener noreferrer';}
        if(connection.provider==='woocommerce')add(area,'p',t('These signed webhooks keep the 7Network copy current; they do not write to WooCommerce products, stock, orders or payments. Configure them in WooCommerce admin after initial count and amount reconciliation. This does not change storefront pages, checkout, payment settings or checkout fields. Leave the optional checkout-event plugin unconfigured; its Checkout Blocks event coverage is unverified and it does not send customer messages.','تحافظ Webhooks الموقّعة هذه على تحديث نسخة 7Network؛ ولا تكتب إلى منتجات WooCommerce أو مخزونها أو طلباتها أو مدفوعاتها. أعدّها من لوحة WooCommerce بعد مطابقة أعداد المنتجات ومبالغ الطلبات أولاً. لا يغيّر ذلك صفحات المتجر أو الدفع أو إعدادات الدفع أو حقول الدفع. اترك إضافة أحداث الدفع الاختيارية دون إعداد؛ فدعمها لأحداث Checkout Blocks غير متحقق منه ولا ترسل رسائل للعملاء.'));
        if(connection.provider==='shopify')add(area,'p',t('The store will receive read-only resource webhook subscriptions. Complete the mandatory privacy topic configuration and Shopify protected-customer-data review before production activation.','سيتلقى المتجر اشتراكات Webhook للقراءة فقط. أكمل إعداد موضوعات الخصوصية الإلزامية ومراجعة بيانات العملاء المحمية من Shopify قبل التفعيل الإنتاجي.'));
      }catch(error){add(area,'p',t('Could not load setup details.','تعذر تحميل تفاصيل الإعداد.'));showCode(status,error);}
    }
    async function showPrivacy(connection,area){
      if(connection.provider!=='shopify')return;
      area.replaceChildren();add(area,'h3',t('Shopify privacy requests','طلبات خصوصية Shopify'));
      try{
        const requests=await api('/connectors/'+encodeURIComponent(connection.id)+'/privacy-requests');
        if(!requests.length){add(area,'p',t('No customer-data response requests are waiting.','لا توجد طلبات رد على بيانات العملاء بانتظار المعالجة.'));return;}
        for(const request of requests){const card=add(area,'article');add(card,'strong',request.kind+' · '+request.status);
          add(card,'p',t('Received','تاريخ الاستلام')+': '+request.receivedAt);
          if(request.status==='received'||request.status==='prepared'){
            action(card,t('Download response package','تنزيل حزمة الرد'),async()=>{
              const result=await api('/connectors/'+encodeURIComponent(connection.id)+'/privacy-requests/'+encodeURIComponent(request.id)+'/export');
              const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=add(card,'a',t('Save privacy response JSON','حفظ ملف رد الخصوصية JSON'));
              anchor.href=url;anchor.download='7network-privacy-response-'+request.id+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
              return t('Package prepared. Send it to the customer through your approved store process, then mark the request complete.','تم تجهيز الحزمة. أرسلها للعميل عبر إجراء متجرك المعتمد ثم علّم الطلب كمكتمل.');
            },status);
            if(request.status==='prepared')action(card,t('Mark response sent','تحديد الرد كمرسل'),async()=>{
              await api('/connectors/'+encodeURIComponent(connection.id)+'/privacy-requests/'+encodeURIComponent(request.id)+'/complete','POST',{confirmed:true});
              return t('Privacy request marked complete.','تم تحديد طلب الخصوصية كمكتمل.');
            },status,()=>showPrivacy(connection,area));
          }
        }
      }catch(error){add(area,'p',t('Unable to load privacy requests.','تعذر تحميل طلبات الخصوصية.'));showCode(status,error);}
    }

    const numberFormat=value=>new Intl.NumberFormat(t('en-QA','ar-QA')).format(Number(value||0));
    const canOpen=key=>Array.isArray(access?.roleNavigation)&&access.roleNavigation.includes(key);
    const hasPermission=key=>Boolean(access?.permissions?.[key]);
    const destination=(parent,label,page,query='')=>{
      const link=add(parent,'a',label);link.className='sx-retail-store-link';link.href=location.pathname+'?page='+encodeURIComponent(page)+query;return link;
    };
    const fieldLabel=field=>({total:t('Order total','إجمالي الطلبات'),subtotal:t('Subtotal','المجموع الفرعي'),discount:t('Discount','الخصم'),
      shipping:t('Shipping','الشحن'),tax:t('Tax','الضريبة'),fees:t('Fees','الرسوم'),refunds:t('Refunds','المبالغ المستردة')})[field]||field;
    async function refreshConnections(){
      connectionsRoot.replaceChildren();add(connectionsRoot,'h2',t('Connected stores','المتاجر المتصلة'));
      try{
        const {connections}=await api('/connectors');
        if(!connections.length){
          add(connectionsRoot,'p',t('No stores are connected yet. Open “Connect another store” to link Shopify or WooCommerce.','لا توجد متاجر متصلة بعد. افتح «ربط متجر آخر» لربط Shopify أو WooCommerce.'));
          connectDetails.open=true;
        }else connectDetails.open=false;
        for(const connection of connections){
          const card=add(connectionsRoot,'article');card.className='sx-retail-store-card';
          const heading=add(card,'div');heading.className='sx-retail-store-heading';
          const identity=add(heading,'div');identity.className='sx-retail-store-identity';
          add(identity,'span',connection.provider==='woocommerce'?'WooCommerce':'Shopify').className='sx-retail-store-provider';
          add(identity,'h3',(connection.displayName||connection.storeDomain)+' · '+connection.provider);
          add(identity,'p',connection.storeDomain+' · '+connection.currency).className='sx-retail-store-domain';
          const badges=add(heading,'div');badges.className='sx-retail-store-badges';
          add(badges,'span',connection.status==='active'?t('Active','نشط'):connection.status==='paused'?t('Paused','متوقف مؤقتاً'):sourceStatus(connection.status)).className='sx-retail-store-state';
          add(badges,'span',connection.syncEnabled?t('Credentials verified','تم التحقق من بيانات الاتصال'):t('Credential check required','يلزم التحقق من بيانات الاتصال')).className='sx-retail-store-state '+(connection.syncEnabled?'is-ready':'is-attention');

          const counts=connection.counts||{};
          const metrics=add(card,'div');metrics.className='sx-retail-store-metrics';
          const metric=(label,value,note)=>{
            const box=add(metrics,'article');box.className='sx-retail-store-metric';
            add(box,'span',label);add(box,'strong',numberFormat(value));
            if(note)add(box,'small',note);
          };
          metric(t('Orders','الطلبات'),counts.orders,t('Imported to account','مستورد إلى الحساب'));
          metric(t('Products','المنتجات'),counts.products,t('Imported to Products & services','مستورد إلى المنتجات والخدمات'));
          metric(t('Customers','العملاء'),counts.customers,t('Imported to Customers','مستورد إلى العملاء'));
          metric(t('Variants','المتغيرات'),counts.variations,t('Imported from the store','مستورد من المتجر'));
          metric(t('Abandoned checkouts','السلات المتروكة'),counts.checkouts,t('Imported from the store','مستورد من المتجر'));
          if(connection.provider==='woocommerce')metric(t('Inventory mappings','روابط المخزون'),counts.mappings,t('Woo to 7Network SKU links','روابط SKU بين Woo و7Network'));

          if(connection.lastSyncAt)add(card,'p',t('Last sync attempt','آخر محاولة مزامنة')+': '+orderDate(connection.lastSyncAt));
          if(connection.syncProgress?.lastCompleteScanAt)add(card,'p',t('Last complete read-only scan','آخر فحص كامل للقراءة فقط')+': '+orderDate(connection.syncProgress.lastCompleteScanAt));
          if(Number(connection.syncProgress?.pendingVariantProducts||connection.syncProgress?.pendingVariationParents||0)>0)
            add(card,'p',t('Products with more variants queued for import','منتجات بمتغيرات إضافية بانتظار الاستيراد')+': '+numberFormat(connection.syncProgress.pendingVariantProducts||connection.syncProgress.pendingVariationParents));
          if(connection.lastErrorCode)add(card,'p',t('Provider error','خطأ المزوّد')+': '+connection.lastErrorCode);
          if(!connection.syncEnabled)add(card,'p',t('Credential check required. Automatic and manual sync are paused until you reconnect and verify fresh store credentials.','يلزم التحقق من بيانات الاتصال. أوقفت المزامنة اليدوية والتلقائية حتى تعيد الربط وتتحقق من بيانات حديثة.'));
          else add(card,'p',connection.provider==='woocommerce'?t('Automatic read-only product, order and customer sync checks the store every 15 minutes. Configure signed WooCommerce product, order and customer webhooks in the setup section for near-real-time updates.','تتحقق المزامنة التلقائية للمنتجات والطلبات والعملاء من المتجر كل 15 دقيقة. أعدّ Webhooks موقّعة لمنتجات WooCommerce وطلباته وعملائه في قسم الإعداد للتحديث شبه الفوري.'):t('Automatic store reconciliation checks for updates every 15 minutes.','تتحقق المزامنة التلقائية من تحديثات المتجر كل 15 دقيقة.'));

          const progress=connection.syncProgress?.resources||{};
          const progressPanel=add(card,'section');progressPanel.className='sx-retail-store-progress';
          add(progressPanel,'h4',t('Import progress','تقدم الاستيراد'));
          const progressGrid=add(progressPanel,'div');progressGrid.className='sx-retail-store-progress-grid';
          for(const resource of ['products','orders','customers']){
            const item=progress[resource];if(!item)continue;
            const row=add(progressGrid,'div');row.className='sx-retail-store-progress-item';
            const label=add(row,'strong',t(resource==='products'?'Products':resource==='orders'?'Orders':'Customers',resource==='products'?'المنتجات':resource==='orders'?'الطلبات':'العملاء'));
            add(row,'span',item.complete?t('Complete','مكتمل'):t('In progress','قيد التنفيذ')).className='sx-retail-store-progress-state';
            if(item.sourceTotal!==null&&item.sourceTotal!==undefined)
              add(row,'small',numberFormat(item.scanned)+' / '+numberFormat(item.sourceTotal)+' '+t('scanned','تم فحصه')+' · '+t('page','صفحة')+' '+numberFormat(item.page||1));
            else add(row,'small',item.complete?t('Latest import finished','اكتمل آخر استيراد'):t('Waiting for the next sync','بانتظار المزامنة التالية'));
          }

          const actions=add(card,'div');actions.className='sx-retail-connector-actions';
          if(access.role==='owner'&&connection.provider==='woocommerce'&&!connection.syncEnabled){
            const revalidate=add(actions,'button',t('Revalidate WooCommerce key','إعادة التحقق من مفتاح WooCommerce'));revalidate.type='button';
            revalidate.onclick=()=>{wooUrl.value=connection.storeDomain||'';wooDisplay.value=connection.displayName||'';wooCurrency.value=connection.currency||'QAR';connectDetails.open=true;connectDetails.scrollIntoView({behavior:'smooth',block:'center'});wooKey.focus({preventScroll:true});};
          }
          if(connection.syncEnabled)action(actions,t('Sync all remaining pages','مزامنة كل الصفحات المتبقية'),async()=>{
            const connectionId=encodeURIComponent(connection.id),maxPasses=20;let result=null,passes=0,complete=false;
            for(;passes<maxPasses;passes++){
              result=await api('/connectors/'+connectionId+'/sync','POST',{});
              const resources=Object.values(result.resources||{}),hasErrors=resources.some(item=>item.errorCode),hasMore=resources.some(item=>item.hasMore===true);
              complete=result.complete===true||(resources.length>0&&!hasMore&&!hasErrors);
              status.textContent=t('Import pass ','دفعة الاستيراد ')+(passes+1)+'/'+maxPasses+' · '+resources.map(item=>numberFormat(item.imported||0)).join(' / ');
              await refreshConnections();
              if(complete||hasErrors)break;
              if(passes+1<maxPasses)await new Promise(resolve=>setTimeout(resolve,250));
            }
            const resources=Object.entries(result?.resources||{}).map(([name,value])=>name+': '+numberFormat(value.imported||0)+
              (value.hasMore?' · '+t('more pages','صفحات أخرى'):'')+(value.errorCode?' · '+value.errorCode:'')).join(' | ');
            if(complete){
              let imageBatches=0,imagesImported=0,failedImages=0,pendingImages=0,imageBackfillError=false;
              for(;imageBatches<25;){
                let batch;
                try{batch=await api('/connectors/'+connectionId+'/images/backfill','POST',{});}
                catch{imageBackfillError=true;break;}
                imageBatches++;imagesImported+=Number(batch.images||0);failedImages+=Number(batch.failed||0);
                pendingImages=Number(batch.pendingImages||0);
                status.textContent=t('Importing product images: ','جارٍ استيراد صور المنتجات: ')+numberFormat(imagesImported)+' · '+numberFormat(pendingImages)+' '+t('remaining','متبقية');
                await refreshConnections();
                if(pendingImages===0||Number(batch.images||0)===0||Number(batch.failed||0)>0)break;
              }
              const imageSummary=t(' Images imported: ',' الصور المستوردة: ')+numberFormat(imagesImported)+
                (failedImages?' · '+numberFormat(failedImages)+' '+t('failed, will retry','فشلت وستعاد المحاولة'):'')+
                (pendingImages?' · '+numberFormat(pendingImages)+' '+t('images remain for the automatic sync','صور ستستكمل في المزامنة التلقائية'):'')+
                (imageBatches>=25&&pendingImages?t(' · More images will continue automatically every 15 minutes.',' · ستستكمل الصور تلقائياً كل 15 دقيقة.'):'')+
                (imageBackfillError?t(' · Image import needs attention; the scheduled sync will retry.',' · يحتاج استيراد الصور إلى مراجعة؛ ستعيد المزامنة المجدولة المحاولة.'):'');
              return t('All available store pages are imported and reconciled. ','اكتمل استيراد صفحات المتجر المتاحة ومطابقتها. ')+
                (resources||t('No new records.','لا توجد سجلات جديدة.'))+imageSummary;
            }
            return (result?.resources&&Object.values(result.resources).some(item=>item.errorCode)?t('Sync paused after a provider error. Review the status above. ','توقفت المزامنة بعد خطأ من المزوّد. راجع الحالة أعلاه. '):t('Saved progress after ','تم حفظ التقدم بعد ')+passes+' '+t('passes. More pages remain; sync will continue automatically every 15 minutes. ','دفعات. ما زالت صفحات أخرى؛ ستستمر المزامنة تلقائياً كل 15 دقيقة. '))+(resources||'');
          },status);
          if(canOpen('retail-orders')&&hasPermission('retail.orders')){
            destination(actions,t('Open store orders','فتح طلبات المتجر'),'retail-orders','&source=online');
          }
          if(canOpen('products-services')||hasPermission('products.read')||hasPermission('products.manage')){
            destination(actions,t('Open Products & services','فتح المنتجات والخدمات'),'products-services');
          }
          if(canOpen('retail-customers')&&hasPermission('retail.customers.read')){
            destination(actions,t('Open customers','فتح العملاء'),'retail-customers');
          }
          if(['active','paused'].includes(connection.status))action(actions,t(connection.status==='active'?'Pause sync':'Resume sync',connection.status==='active'?'إيقاف المزامنة مؤقتاً':'استئناف المزامنة'),
            ()=>api('/connectors/'+encodeURIComponent(connection.id)+'/status','PUT',{status:connection.status==='active'?'paused':'active'}),status,()=>refreshConnections());
          if(connection.status!=='revoked'){
            const disconnect=add(actions,'button',t('Disconnect store','قطع اتصال المتجر'));disconnect.type='button';
            disconnect.onclick=async()=>{if(!window.confirm(t('Disconnect this store? Imported records remain in Retail & Inventory.','هل تريد قطع اتصال هذا المتجر؟ ستبقى السجلات المستوردة في التجزئة والمخزون.')))return;
              disconnect.disabled=true;try{await api('/connectors/'+encodeURIComponent(connection.id),'DELETE',{});status.textContent=t('Store disconnected. Imported records were retained.','تم قطع اتصال المتجر. تم الاحتفاظ بالسجلات المستوردة.');await refreshConnections();}catch(error){showCode(status,error);disconnect.disabled=false;}};
          }
          if(connection.status==='revoked'){
            const erase=add(actions,'button',t('Erase imported data','حذف البيانات المستوردة'));erase.type='button';
            erase.onclick=async()=>{const confirmation=window.prompt(t('This permanently erases imported orders, payment/refund evidence, customers, products, checkouts, privacy requests and webhook logs. Type the exact store domain to continue:','سيحذف هذا نهائياً الطلبات وسجلات الدفع والاسترداد والعملاء والمنتجات والسلات وطلبات الخصوصية وسجلات Webhook. اكتب نطاق المتجر كما هو للمتابعة:'));
              if(confirmation!==connection.storeDomain)return;erase.disabled=true;try{await api('/connectors/'+encodeURIComponent(connection.id)+'/erase-imported-data','POST',{confirmStoreDomain:confirmation});status.textContent=t('Imported store data erased. Connection metadata and audit record remain.','تم حذف بيانات المتجر المستوردة. بقيت بيانات الاتصال وسجل التدقيق.');await refreshConnections();}catch(error){showCode(status,error);erase.disabled=false;}};
          }
          if(connection.provider==='woocommerce'){
            const summary=connection.orderSummary;
            const panel=add(card,'section');panel.className='sx-retail-order-rollup';
            const rollupHeading=add(panel,'div');rollupHeading.className='sx-retail-order-rollup-heading';
            const rollupTitle=add(rollupHeading,'div');add(rollupTitle,'h4',t('WooCommerce order statuses & reported values','حالات الطلب وقيمها حسب WooCommerce'));
            add(rollupTitle,'p',t('Includes every status returned by WooCommerce, including custom statuses. Values are reported by WooCommerce and are not verified settlement.','يشمل كل الحالات التي يعيدها WooCommerce، بما فيها الحالات المخصصة. هذه القيم كما أبلغ عنها WooCommerce وليست تسوية مالية متحققاً منها.'));
            if(summary?.completedAt){
              const sourceOrders=summary.sourceCounts?.orders||{};
              add(panel,'p',t('Last source scan','آخر فحص للمصدر')+': '+orderDate(summary.completedAt)+' · '+
                (sourceOrders.scanned==null?'—':numberFormat(sourceOrders.scanned))+' / '+(sourceOrders.total==null?'—':numberFormat(sourceOrders.total))+' '+t('orders scanned','طلباً تم فحصه'));
              if(!summary.orderAmountMetadataAvailable)add(panel,'p',t('Order value groups do not yet reconcile to every scanned WooCommerce order. Continue Sync now and review again.','مجموعات قيم الطلبات لا تطابق بعد كل طلبات WooCommerce التي جرى فحصها. تابع المزامنة الآن وراجعها مجدداً.')).className='sx-retail-store-warning';
              if(summary.countsFullyScanned&&!summary.stableSourceCounts)add(panel,'p',t('WooCommerce totals changed while the import was running. Run another full sync to confirm a stable snapshot.','تغيرت إجماليات WooCommerce أثناء الاستيراد. نفّذ مزامنة كاملة أخرى لتأكيد لقطة مستقرة.')).className='sx-retail-store-warning';
              if(summary.truncated)add(panel,'p',t('Some status/payment groups are hidden because the source returned an unusually large number of groups.','تم إخفاء بعض مجموعات الحالة والدفع لأن المصدر أعاد عدداً كبيراً على نحو غير معتاد من المجموعات.')).className='sx-retail-store-warning';
              const groups=add(panel,'div');groups.className='sx-retail-order-groups';
              const sorted=[...(summary.groups||[])].sort((a,b)=>(a.status+'|'+a.financialStatus+'|'+a.currency).localeCompare(b.status+'|'+b.financialStatus+'|'+b.currency));
              if(!sorted.length)add(groups,'p',t('No order status totals were returned by WooCommerce on the last complete scan.','لم يُرجع WooCommerce إجماليات لحالات الطلب في آخر فحص مكتمل.'));
              for(const group of sorted){
                const bucket=add(groups,'article');bucket.className='sx-retail-order-group';
                const groupHeader=add(bucket,'div');groupHeader.className='sx-retail-order-group-heading';
                const statuses=add(groupHeader,'div');statuses.className='sx-retail-order-group-statuses';
                add(statuses,'strong',sourceStatus(group.status));
                add(statuses,'span',t('Payment','الدفع')+': '+sourceStatus(group.financialStatus));
                add(groupHeader,'span',numberFormat(group.count)+' '+t('orders','طلبات')).className='sx-retail-order-group-count';
                const amounts=add(bucket,'dl');amounts.className='sx-retail-order-amounts';
                for(const field of ['total','subtotal','discount','shipping','tax','fees','refunds']){
                  const cell=add(amounts,'div');cell.className='sx-retail-order-amount';
                  add(cell,'dt',fieldLabel(field));
                  const value=group.amounts?.[field];
                  const output=add(cell,'dd',value===null||value===undefined?t('Not provided','غير متاح من المتجر'):sourceMoney(value,group.currency));output.dir='auto';
                }
                if(canOpen('retail-orders')){
                  const query='&source=online&status='+encodeURIComponent(group.status);
                  destination(bucket,t('View these orders','عرض هذه الطلبات'),'retail-orders',query);
                }
              }
            }else{
              add(panel,'p',t('No complete WooCommerce source scan is available yet. Sync now imports the next product, order and customer pages; the status and value rollup appears after a full scan.','لا يتوفر فحص مكتمل لمصدر WooCommerce بعد. تستورد المزامنة صفحات المنتجات والطلبات والعملاء التالية؛ وستظهر الحالات والقيم بعد اكتمال الفحص.'));
            }
            const reconciliation=add(card,'details');reconciliation.className='sx-retail-advanced';
            add(reconciliation,'summary',t('Advanced reconciliation and inventory mapping health','تفاصيل المطابقة المتقدمة وحالة ربط المخزون'));
            const reportBody=add(reconciliation,'div');reportBody.className='sx-retail-advanced-body';
            reconciliation.addEventListener('toggle',async()=>{
              if(!reconciliation.open||reconciliation.dataset.loaded)return;
              reconciliation.dataset.loaded='true';reportBody.replaceChildren();add(reportBody,'p',t('Loading reconciliation…','جارٍ تحميل المطابقة…'));
              try{
                const report=await api('/connectors/'+encodeURIComponent(connection.id)+'/reconciliation');reportBody.replaceChildren();
                const counts=report.scan?.sourceCounts||{};
                add(reportBody,'p',t('Imported records','السجلات المستوردة')+': '+report.importedCounts.products+' '+t('products','منتجات')+' · '+report.importedCounts.variations+' '+t('variations','متغيرات')+
                  ' · '+report.importedCounts.orders+' '+t('orders','طلبات')+' · '+report.importedCounts.customers+' '+t('customers','عملاء'));
                const mapping=report.productMappings||{};
                add(reportBody,'p',t('Woo inventory mappings','روابط مخزون Woo')+': '+(mapping.mapped||0)+' '+t('mapped','مرتبط')+' · '+
                  (mapping.ignored||0)+' '+t('ignored','متجاهل')+' · '+(mapping.invalidTargets||0)+' '+t('invalid target','هدف غير صالح'));
                if(mapping.stock){
                  const stock=mapping.stock;
                  add(reportBody,'p',t('Read-only stock scope','نطاق المخزون للقراءة فقط')+': '+(stock.readyForReadOnlyComparison||0)+' '+
                    t('ready for location/unit comparison','جاهز لمقارنة الموقع والوحدة')+' · '+(stock.needsReview||0)+' '+t('need review','بحاجة إلى مراجعة'));
                  if(Number(stock.parentShared||0)>0)add(reportBody,'p',t('Some variable products share Woo stock at the parent level and cannot be reconciled separately by variation.','تشترك بعض المنتجات ذات المتغيرات في مخزون Woo على مستوى المنتج الرئيسي ولا يمكن مطابقتها لكل متغير على حدة.')+' '+stock.parentShared);
                  if(Number(stock.managedQuantityUnavailable||0)>0||Number(stock.sourceStockSnapshotUnknown||0)>0)
                    add(reportBody,'p',t('Some mapped products need a fresh Woo product sync before stock review.','تحتاج بعض المنتجات المرتبطة إلى مزامنة Woo حديثة قبل مراجعة المخزون.')+
                      ' · '+Number(stock.managedQuantityUnavailable||0)+' '+t('managed quantity unavailable','كمية مُدارة غير متاحة')+' · '+Number(stock.sourceStockSnapshotUnknown||0)+' '+t('stock snapshot not captured','لقطة المخزون غير محفوظة'));
                  add(reportBody,'p',t('A verified scope only identifies the unit and location relationship. It does not prove the balances match or authorize stock write-back.','يحدد النطاق المتحقق منه علاقة الوحدة والموقع فقط. ولا يثبت تطابق الأرصدة أو يسمح بالكتابة إلى المخزون.'));
                }
                const orderCheck=report.orderReconciliation||{state:report.scan?'needs_review':'scan_incomplete',groups:[]};
                const orderCheckLabels={matched:t('Observed order counts and available amounts match across Woo currency/status groups.','تتطابق أعداد الطلبات والمبالغ المتاحة حسب العملة والحالة في Woo.'),
                  mismatch:t('Order counts or amounts differ. Review each group before accepting the sync.','توجد فروق في أعداد الطلبات أو المبالغ. راجع كل مجموعة قبل اعتماد المزامنة.'),
                  needs_review:t('Some Woo order amounts are incomplete. Review unavailable components such as fees or refunds.','بعض مبالغ طلبات Woo غير مكتملة. راجع المكونات غير المتاحة مثل الرسوم أو المبالغ المستردة.'),
                  source_changed:t('Woo source totals changed during the scan. Run another complete sync before accepting reconciliation.','تغيرت إجماليات مصدر Woo أثناء الفحص. نفّذ مزامنة كاملة أخرى قبل اعتماد المطابقة.'),
                  scan_incomplete:t('Order reconciliation requires a complete source scan.','تتطلب مطابقة الطلبات فحصاً كاملاً للمصدر.')};
                add(reportBody,'p',t('Order totals check','فحص إجماليات الطلبات')+': '+(orderCheckLabels[orderCheck.state]||orderCheckLabels.needs_review));
                for(const group of orderCheck.groups||[]){
                  const panel=add(reportBody,'article');
                  add(panel,'strong',group.currency+' · '+sourceStatus(group.status)+' · '+sourceStatus(group.financialStatus));
                  add(panel,'p',t('Woo orders','طلبات Woo')+': '+group.sourceCount+' · '+t('7Network orders','طلبات 7Network')+': '+group.localCount+
                    ' · '+t('Count difference (7Network − Woo)','فرق العدد (7Network − Woo)')+': '+group.countDelta);
                  for(const field of ['total','subtotal','discount','shipping','tax','fees','refunds']){
                    const amount=group.amounts?.[field];if(!amount)continue;
                    if(amount.state==='unavailable')add(panel,'p',fieldLabel(field)+': Woo '+t('unavailable','غير متاح')+' · 7Network '+amount.local);
                    else add(panel,'p',fieldLabel(field)+': Woo '+amount.source+' · 7Network '+amount.local+' · '+
                      t('Amount difference (7Network − Woo)','فرق المبلغ (7Network − Woo)')+': '+amount.delta);
                  }
                }
                if(report.scan){
                  add(reportBody,'p',t('Last complete source scan','آخر فحص كامل للمصدر')+': '+orderDate(report.scan.completedAt));
                  for(const resource of ['products','orders','customers']){
                    const source=counts[resource]||{};add(reportBody,'p',t(resource,resource)+' · '+t('Woo total','إجمالي Woo')+': '+(source.total??'—')+' · '+
                      t('scanned','تم فحصه')+': '+(source.scanned??'—')+' · '+t('imported now','موجود محلياً')+': '+report.importedCounts[resource]);
                  }
                  add(reportBody,'p',t('Woo variations listed by products','المتغيرات المسجلة في المنتجات')+': '+(report.scan.sourceVariationCount??'—')+' · '+
                    t('imported variations','المتغيرات المستوردة')+': '+report.importedCounts.variations);
                  if(!report.scan.sourceCountMetadataAvailable)add(reportBody,'p',t('Woo source totals are incomplete. Complete the product, order and customer scan before accepting reconciliation.','إجماليات مصدر Woo غير مكتملة. أكمل فحص المنتجات والطلبات والعملاء قبل اعتماد المطابقة.'));
                  else if(!report.scan.countsFullyScanned)add(reportBody,'p',t('The scanned row count differs from Woo’s reported total. Finish a complete scan before accepting reconciliation.','يختلف عدد الصفوف المفحوصة عن الإجمالي الذي أبلغ عنه Woo. أكمل فحصاً كاملاً قبل اعتماد المطابقة.'));
                  if(!report.scan.orderAmountMetadataAvailable)add(reportBody,'p',t('The grouped Woo order totals do not cover every scanned order. Order reconciliation remains incomplete.','لا تغطي إجماليات طلبات Woo المجمعة كل الطلبات المفحوصة. تظل مطابقة الطلبات غير مكتملة.'));
                  if(report.scan.sourceCountMetadataAvailable&&!report.scan.stableSourceCounts)add(reportBody,'p',t('Woo source totals changed during this scan. Run another complete scan before accepting reconciliation.','تغيرت إجماليات مصدر Woo أثناء هذا الفحص. أعد فحصاً كاملاً قبل اعتماد المطابقة.'));
                  add(reportBody,'p',t('Woo pagination is not an atomic snapshot. A matched result compares the rows and totals observed by this scan; rerun after concurrent catalog or order changes.','لا توفر صفحات Woo لقطة ذرية واحدة. تقارن نتيجة المطابقة الصفوف والإجماليات التي رصدها هذا الفحص؛ أعد الفحص بعد أي تغييرات متزامنة في المنتجات أو الطلبات.'));
                }else add(reportBody,'p',t('A complete source scan is not available yet. Continue Sync now until products, variations, orders and customers finish.','لا يتوفر فحص كامل للمصدر بعد. تابع المزامنة حتى تنتهي المنتجات والمتغيرات والطلبات والعملاء.'));
                add(reportBody,'p',t('This report is read-only. WooCommerce remains the stock and order authority. No WordPress changes or customer messages are made.','هذا التقرير للقراءة فقط. يبقى WooCommerce المرجع للمخزون والطلبات. لا يتم تعديل WordPress أو إرسال رسائل للعملاء.'));
              }catch(error){reportBody.replaceChildren();add(reportBody,'p',t('Unable to load reconciliation.','تعذر تحميل المطابقة.'));showCode(status,error);}
            });
          }
          const setup=add(card,'details');setup.className='sx-retail-advanced';
          add(setup,'summary',t('Webhook setup','إعداد Webhook'));
          const setupArea=add(setup,'div');setupArea.className='sx-retail-store-setup-body';
          setup.addEventListener('toggle',()=>{if(setup.open&&!setup.dataset.loaded){setup.dataset.loaded='true';showSetup(connection,setupArea);}});
          if(connection.provider==='shopify'){
            const privacy=add(card,'details');privacy.className='sx-retail-advanced';
            add(privacy,'summary',t('Privacy request handling','معالجة طلبات الخصوصية'));
            const privacyBody=add(privacy,'div');privacy.addEventListener('toggle',()=>{if(privacy.open&&!privacy.dataset.loaded){privacy.dataset.loaded='true';showPrivacy(connection,privacyBody);}});
          }
        }
      }catch(error){add(connectionsRoot,'p',t('Unable to load connected stores.','تعذر تحميل المتاجر المتصلة.'));showCode(status,error);}
    }
    if(new URLSearchParams(location.search).has('connected'))status.textContent=t('Store connected. Its first import will start on the next reconciliation cycle.','تم ربط المتجر. سيبدأ الاستيراد الأول في دورة المزامنة التالية.');
    if(new URLSearchParams(location.search).has('connectionError'))showCode(status,{message:new URLSearchParams(location.search).get('connectionError')});
    await refreshConnections();
  }
  async function customerWorkspace(root,status){
    const consentLabel=value=>{
      const normalized=String(value??'').trim().toLowerCase();
      if(['yes','true','1','subscribed','opted_in','opted-in','granted'].includes(normalized))return t('Opted in (reported by store)','موافق، حسب المتجر');
      if(['no','false','0','unsubscribed','opted_out','opted-out','denied'].includes(normalized))return t('Opted out (reported by store)','غير موافق، حسب المتجر');
      return t('Unknown or not provided','غير معروف أو غير مسجل');
    };
    const intro=add(root,'p',t('Search customers from connected stores and Retail orders. Open a profile to review contact details, order history and payment evidence.','ابحث عن العملاء من المتاجر المتصلة وطلبات التجزئة. افتح الملف لمراجعة بيانات التواصل وسجل الطلبات وإثباتات الدفع.'));
    intro.className='sx-retail-page-subtitle';
    const view=add(root,'section');view.className='sx-retail-customers';
    const state={page:1,search:''};
    const updateCustomerUrl=(key,orderPage=1,replace=false)=>{
      const url=new URL(location.href);
      if(key)url.searchParams.set('customer',key);else url.searchParams.delete('customer');
      if(key&&orderPage>1)url.searchParams.set('customerOrdersPage',String(orderPage));else url.searchParams.delete('customerOrdersPage');
      if(replace)history.replaceState(history.state,'',url);else history.pushState(history.state,'',url);
    };
    const initials=value=>{
      const parts=String(value||'').trim().split(/[\s@._-]+/).filter(Boolean);
      return (parts.length>1?parts[0][0]+parts[1][0]:String(parts[0]||'C').slice(0,2)).toLocaleUpperCase();
    };
    const countLabel=count=>{
      const value=Number(count||0),formatted=new Intl.NumberFormat(t('en-QA','ar-QA')).format(value);
      return formatted+' '+t(value===1?'order':'orders',value===1?'طلب':'طلبات');
    };
    const showList=async()=>{
      view.replaceChildren();
      const searchPanel=add(view,'section');searchPanel.className='sx-retail-customer-search-panel';
      const searchHeading=add(searchPanel,'div');searchHeading.className='sx-retail-customer-panel-heading';
      add(searchHeading,'h2',t('Find a customer','ابحث عن عميل'));
      add(searchHeading,'p',t('Search by name, email or phone number.','ابحث بالاسم أو البريد الإلكتروني أو رقم الهاتف.'));
      const tools=add(searchPanel,'form');tools.className='sx-retail-customer-search';
      const search=input(tools,t('Name, email or phone','الاسم أو البريد أو الهاتف'),state.search,'search');
      search.maxLength=100;search.autocomplete='off';search.placeholder=t('e.g. customer name or email','مثال: اسم العميل أو بريده الإلكتروني');
      search.setAttribute('aria-label',t('Search customers by name, email or phone','ابحث عن العملاء بالاسم أو البريد أو الهاتف'));
      const find=add(tools,'button',t('Search','بحث'));find.type='submit';find.className='sx-retail-primary';
      const clear=add(tools,'button',t('Clear','مسح'));clear.type='button';clear.className='sx-retail-secondary';
      const results=add(view,'div');results.className='sx-retail-customer-results';
      const resultHeading=add(results,'div');resultHeading.className='sx-retail-customer-results-heading';
      add(resultHeading,'h2',t('Customer directory','دليل العملاء'));
      const resultCount=add(resultHeading,'span');resultCount.className='sx-retail-customer-result-count';
      const list=add(results,'div');list.className='sx-retail-customer-list';
      const pageTools=add(view,'div');pageTools.className='sx-retail-customer-pagination';
      const range=add(pageTools,'span');range.className='sx-retail-customer-range';
      const controls=add(pageTools,'div');controls.className='sx-retail-customer-page-controls';
      const previous=add(controls,'button',t('Previous','السابق'));previous.type='button';previous.className='sx-retail-secondary';
      const pageLabel=add(controls,'span');pageLabel.className='sx-retail-customer-page-label';
      const next=add(controls,'button',t('Next','التالي'));next.type='button';next.className='sx-retail-secondary';
      const render=async()=>{
        status.textContent=t('Loading customers…','جارٍ تحميل العملاء…');list.replaceChildren();
        try{
          const result=await api('/customers?page='+state.page+'&limit=20&search='+encodeURIComponent(state.search));
          const total=Number(result.total||0),first=total?(result.page-1)*result.limit+1:0,last=Math.min(result.page*result.limit,total);
          resultCount.textContent=new Intl.NumberFormat(t('en-QA','ar-QA')).format(total)+' '+t(total===1?'customer':'customers',total===1?'عميل':'عملاء');
          range.textContent=total?t('Showing ','عرض ')+first+'–'+last+t(' of ',' من ')+total:t('No customers','لا يوجد عملاء');
          pageLabel.textContent=t('Page ','صفحة ')+result.page;
          previous.disabled=result.page<=1;next.disabled=!result.hasMore;
          if(!result.items.length){
            const empty=add(list,'div');empty.className='sx-retail-empty sx-retail-customer-empty';
            const mark=add(empty,'span','');mark.className='sx-retail-customer-empty-mark';mark.setAttribute('aria-hidden','true');
            add(empty,'strong',t('No customers found','لم يتم العثور على عملاء'));
            add(empty,'p',state.search?t('Try a different name, email or phone number.','جرّب اسماً أو بريداً إلكترونياً أو رقم هاتف آخر.'):
              t('Customers will appear here when they are imported from a connected store or included in a Retail order.','سيظهر العملاء هنا بعد استيرادهم من متجر متصل أو تسجيلهم في طلب تجزئة.'));
            if(!state.search){const link=add(empty,'a',t('Open Store Connections','فتح اتصالات المتاجر'));link.href=location.pathname+'?page=retail-connected-stores';}
          }
          for(const customer of result.items){
            const card=add(list,'article');card.className='sx-retail-customer-card';
            const nameValue=customer.name||customer.email||customer.phone||t('Customer','العميل');
            const open=add(card,'button');open.type='button';open.className='sx-retail-customer-open';
            open.setAttribute('aria-label',t('Open customer profile for ','افتح ملف العميل ')+nameValue);
            open.onclick=()=>showDetail(customer.id,true);
            const avatar=add(open,'span',initials(nameValue));avatar.className='sx-retail-customer-avatar';avatar.setAttribute('aria-hidden','true');
            const identity=add(open,'span');identity.className='sx-retail-customer-identity';
            add(identity,'span',nameValue).className='sx-retail-customer-name';
            const contact=add(identity,'span');contact.className='sx-retail-customer-contact';
            const showEmail=customer.email&&String(customer.email).toLowerCase()!==String(nameValue).toLowerCase();
            if(showEmail){const email=add(contact,'bdi',customer.email);email.dir='auto';}
            if(showEmail&&customer.phone)add(contact,'span',' · ').setAttribute('aria-hidden','true');
            if(customer.phone){const phone=add(contact,'bdi',customer.phone);phone.dir='ltr';}
            if(!showEmail&&!customer.phone)add(contact,'span',t('Email is used as the customer name','يُستخدم البريد الإلكتروني اسماً للعميل'));
            const activity=add(open,'span');activity.className='sx-retail-customer-activity';
            add(activity,'span',t('Order activity','نشاط الطلبات')).className='sx-retail-customer-fact-label';
            add(activity,'strong',countLabel(customer.orderCount));
            const latest=customer.lastOrderAt? t('Last order ','آخر طلب ')+orderDate(customer.lastOrderAt):
              Number(customer.orderCount||0)>0&&customer.lastImportedAt?t('Last imported ','آخر استيراد ')+orderDate(customer.lastImportedAt):
              Number(customer.orderCount||0)>0?t('Order date unavailable','تاريخ الطلب غير متاح'):t('No orders yet','لا توجد طلبات بعد');
            add(activity,'span',latest).className='sx-retail-customer-fact-note';
            const value=add(open,'span');value.className='sx-retail-customer-value';
            let hasPaymentEvidence=false;
            if(customer.amountSpent?.length){
              hasPaymentEvidence=true;
              add(value,'span',t('Store-reported','حسب المتجر')).className='sx-retail-customer-fact-label';
              for(const row of customer.amountSpent){const amount=add(value,'bdi',sourceMoney(row.amount,row.currency));amount.dir='auto';}
            }
            if(customer.recordedPayments?.length){
              hasPaymentEvidence=true;
              add(value,'span',t('7Network receipts','إيصالات 7Network')).className='sx-retail-customer-fact-label';
              for(const row of customer.recordedPayments){const amount=add(value,'bdi',sourceMoney(row.amount,row.currency));amount.dir='auto';}
            }
            if(!hasPaymentEvidence){
              add(value,'span',t('Payment evidence','إثبات الدفع')).className='sx-retail-customer-fact-label';
              add(value,'span',t('No payment data','لا توجد بيانات دفع')).className='sx-retail-customer-fact-note';
            }
            const affordance=add(open,'span',t('View profile','عرض الملف'));affordance.className='sx-retail-customer-view';
          }
          status.textContent='';
        }catch{
          resultCount.textContent='';range.textContent='';
          const error=add(list,'div');error.className='sx-retail-empty sx-retail-customer-empty';
          add(error,'strong',t('Customers could not be loaded','تعذر تحميل العملاء'));
          add(error,'p',t('Check your connection and try again.','تحقق من الاتصال وحاول مرة أخرى.'));
          const retry=add(error,'button',t('Try again','إعادة المحاولة'));retry.type='button';retry.className='sx-retail-secondary';retry.onclick=render;
          status.textContent='';
        }
      };
      tools.onsubmit=event=>{event.preventDefault();state.search=search.value.trim();state.page=1;render();};
      clear.onclick=()=>{state.search='';state.page=1;showList();};
      previous.onclick=()=>{state.page=Math.max(1,state.page-1);render();};
      next.onclick=()=>{state.page++;render();};
      await render();
    };
    const showDetail=async(key,addHistory=false)=>{
      if(!/^[a-f0-9]{64}$/i.test(String(key||'')))return showList();
      let orderPage=Math.max(1,Number(new URLSearchParams(location.search).get('customerOrdersPage'))||1);
      if(addHistory)updateCustomerUrl(key,orderPage);
      const render=async()=>{
        view.replaceChildren();
        const detail=add(view,'div');detail.className='sx-retail-customer-detail';
        const toolbar=add(detail,'div');toolbar.className='sx-retail-customer-detail-toolbar';
        const back=add(toolbar,'button',t('Back to customers','العودة إلى العملاء'));back.type='button';back.className='sx-retail-secondary';
        back.onclick=()=>{updateCustomerUrl('',1,true);showList();};
        status.textContent=t('Loading customer details…','جارٍ تحميل تفاصيل العميل…');
        try{
          const profile=await api('/customers/'+encodeURIComponent(key)+'?page='+orderPage+'&limit=25');
          const hero=add(detail,'section');hero.className='sx-retail-customer-hero';
          const heroAvatar=add(hero,'span',initials(profile.name||profile.email||profile.phone));heroAvatar.className='sx-retail-customer-avatar sx-retail-customer-avatar-large';heroAvatar.setAttribute('aria-hidden','true');
          const identity=add(hero,'div');identity.className='sx-retail-customer-hero-identity';
          add(identity,'h2',profile.name||t('Customer','العميل')).tabIndex=-1;
          const primaryContact=add(identity,'p');primaryContact.className='sx-retail-customer-hero-contact';
          const showEmail=profile.email&&String(profile.email).toLowerCase()!==String(profile.name||'').toLowerCase();
          if(showEmail){const email=add(primaryContact,'bdi',profile.email);email.dir='auto';}
          if(showEmail&&profile.phone)add(primaryContact,'span',' · ').setAttribute('aria-hidden','true');
          if(profile.phone){const phone=add(primaryContact,'bdi',profile.phone);phone.dir='ltr';}
          if(!showEmail&&!profile.phone)add(primaryContact,'span',t('Email is used as the profile name','يُستخدم البريد الإلكتروني اسماً للملف'));
          const stores=add(identity,'div');stores.className='sx-retail-customer-store-badges';
          for(const source of profile.sourceRecords||[]){
            const badge=add(stores,'span',(source.storeName||t('Connected store','متجر متصل'))+' · '+(source.provider==='woocommerce'?'WooCommerce':String(source.provider||'').toUpperCase()));
            badge.className='sx-retail-customer-store-badge';
          }
          const orderCount=Number(profile.orderCount||0),activityAt=profile.lastOrderAt||null,importedAt=profile.lastImportedAt||null;
          const activityTitle=activityAt?t('Last order','آخر طلب'):importedAt?t('Last imported order','آخر طلب مستورد'):orderCount?t('Order date','تاريخ الطلب'):t('Last order','آخر طلب');
          const activityValue=activityAt?orderDate(activityAt):importedAt?orderDate(importedAt):orderCount?t('Date unavailable','التاريخ غير متاح'):'—';
          const metrics=add(detail,'section');metrics.className='sx-retail-customer-metrics';
          const addMetric=(label,value,note)=>{
            const metric=add(metrics,'article');metric.className='sx-retail-customer-metric';
            add(metric,'span',label).className='sx-retail-customer-fact-label';
            add(metric,'strong',value);
            if(note)add(metric,'span',note).className='sx-retail-customer-fact-note';
            return metric;
          };
          addMetric(t('Total orders','إجمالي الطلبات'),new Intl.NumberFormat(t('en-QA','ar-QA')).format(orderCount),countLabel(orderCount));
          addMetric(activityTitle,activityValue,orderCount&&!activityAt&&!importedAt?t('The store did not provide an order date.','لم يوفر المتجر تاريخ الطلب.'):null);
          const spendMetric=addMetric(t('Net paid reported by store','صافي المدفوع حسب المتجر'),profile.amountSpent?.length?profile.amountSpent.map(row=>sourceMoney(row.amount,row.currency)).join(' · '):t('No data','لا توجد بيانات'),t('Not verified by 7Network','غير متحقق منه من 7Network'));
          spendMetric.classList.add('sx-retail-customer-metric-multiline');
          const receiptsMetric=addMetric(t('7Network receipts','إيصالات 7Network'),profile.recordedPayments?.length?profile.recordedPayments.map(row=>sourceMoney(row.amount,row.currency)).join(' · '):t('None recorded','لا توجد إيصالات مسجلة'),t('Recorded business receipts','إيصالات النشاط المسجلة'));
          receiptsMetric.classList.add('sx-retail-customer-metric-multiline');
          const overview=add(detail,'div');overview.className='sx-retail-customer-overview';
          const contact=add(overview,'section');contact.className='sx-retail-customer-panel sx-retail-customer-contact-panel';
          add(contact,'h3',t('Contact details','بيانات التواصل'));
          const fields=add(contact,'dl');fields.className='sx-retail-customer-fields';
          const field=(label,value,{dir='auto',wide=false}={})=>{
            const row=add(fields,'div');row.className='sx-retail-customer-field'+(wide?' sx-retail-customer-field-wide':'');
            add(row,'dt',label);const dd=add(row,'dd');
            if(value&&typeof value==='object'&&value.nodeType){dd.append(value);return dd;}
            const present=value!==null&&value!==undefined&&value!=='';
            const text=add(dd,'bdi',present?value:t('Not provided','غير مسجل'));text.dir=dir;return dd;
          };
          field(t('Email','البريد الإلكتروني'),profile.email);
          field(t('Phone','الهاتف'),profile.phone,{dir:'ltr'});
          const address=profile.address,parts=address?[address.address1,address.address2,address.city,address.region,address.postalCode,address.country].filter(Boolean):[];
          field(t('Address','العنوان'),parts.length?parts.join(' · '):null,{wide:true});
          field(t('Marketing consent reported by store','موافقة التسويق حسب المتجر'),consentLabel(profile.marketingConsent),{wide:true});
          const storeField=field(t('Connected stores','المتاجر المتصلة'),null,{wide:true});
          storeField.replaceChildren();
          if(profile.sourceRecords?.length){const badges=add(storeField,'span');badges.className='sx-retail-customer-store-badges';
            for(const source of profile.sourceRecords)add(badges,'span',(source.storeName||t('Connected store','متجر متصل'))+' · '+(source.provider==='woocommerce'?'WooCommerce':String(source.provider||'').toUpperCase())).className='sx-retail-customer-store-badge';
          }else add(storeField,'span',t('No connected store source','لا يوجد متجر مصدر متصل'));
          const evidence=add(overview,'section');evidence.className='sx-retail-customer-panel sx-retail-customer-payment-panel';
          const evidenceHeading=add(evidence,'div');evidenceHeading.className='sx-retail-customer-panel-heading';
          add(evidenceHeading,'h3',t('Payment evidence','إثباتات الدفع'));
          add(evidenceHeading,'p',t('Store reports and 7Network receipts are shown separately.','تُعرض بلاغات المتجر وإيصالات 7Network كلٌ على حدة.'));
          const evidenceGrid=add(evidence,'div');evidenceGrid.className='sx-retail-customer-evidence-grid';
          const evidenceGroup=(title,rows,empty,helper)=>{
            const group=add(evidenceGrid,'article');group.className='sx-retail-customer-evidence-group';
            add(group,'h4',title);
            if(rows?.length){const list=add(group,'ul');list.className='sx-retail-customer-money-list';
              for(const row of rows){const item=add(list,'li'),amount=add(item,'bdi',sourceMoney(row.amount,row.currency));amount.dir='auto';}
            }else add(group,'p',empty);
            add(group,'p',helper).className='sx-retail-customer-evidence-note';
          };
          evidenceGroup(t('Store-reported net paid','صافي المدفوع حسب المتجر'),profile.amountSpent,t('No payment totals were provided by the store.','لم يقدم المتجر إجماليات للمدفوعات.'),t('This is provider data and is not verified settlement.','هذه بيانات من المزوّد وليست تسوية متحققاً منها.'));
          evidenceGroup(t('Recorded in 7Network','مسجل في 7Network'),profile.recordedPayments,t('No 7Network cash receipts are recorded.','لا توجد إيصالات نقدية مسجلة في 7Network.'),t('These are business-recorded receipts; reconcile them through Finance.','هذه إيصالات سجلها النشاط؛ طابقها عبر قسم المالية.'));
          const orders=add(detail,'section');orders.className='sx-retail-customer-orders';
          const ordersHeading=add(orders,'div');ordersHeading.className='sx-retail-customer-orders-heading';
          const orderHeading=add(ordersHeading,'div');add(orderHeading,'h3',t('Order history','سجل الطلبات'));
          add(orderHeading,'p',t('Connected-store orders are read-only. Local Retail orders retain their 7Network status and receipt history.','طلبات المتاجر المتصلة للعرض فقط. تحتفظ طلبات التجزئة المحلية بحالتها وسجل إيصالاتها في 7Network.'));
          add(ordersHeading,'span',countLabel(orderCount)).className='sx-retail-customer-result-count';
          if(!profile.orders?.length){
            const empty=add(orders,'div');empty.className='sx-retail-empty sx-retail-customer-order-empty';
            add(empty,'strong',orderPage>1?t('No orders on this page','لا توجد طلبات في هذه الصفحة'):t('No orders found','لم يتم العثور على طلبات'));
            add(empty,'p',orderCount?t('This page has no results. Return to the first page to see the available orders.','لا توجد نتائج في هذه الصفحة. ارجع إلى الصفحة الأولى لعرض الطلبات المتاحة.'):
              t('This customer does not have any connected-store or local Retail orders yet.','ليس لهذا العميل طلبات من متجر متصل أو طلبات تجزئة محلية حتى الآن.'));
          }
          for(const order of profile.orders||[]){
            const card=add(orders,'article');card.className='sx-retail-customer-order';
            const summary=add(card,'div');summary.className='sx-retail-customer-order-summary';
            const reference=add(summary,'div');reference.className='sx-retail-customer-order-reference';
            const orderNumber=add(reference,'bdi',(order.provider?'#':'')+String(order.orderNumber||order.sourceOrderId||order.id));orderNumber.dir='auto';
            add(reference,'time',order.date?orderDate(order.date):t('Date unavailable','التاريخ غير متاح'));
            const amount=add(summary,'strong',sourceMoney(order.total,order.currency));amount.className='sx-retail-customer-order-amount';amount.dir='auto';
            const badges=add(summary,'div');badges.className='sx-retail-customer-order-badges';
            if(order.provider){
              add(badges,'span',order.storeName|| (order.provider==='woocommerce'?'WooCommerce':String(order.provider).toUpperCase())).className='sx-retail-customer-store-badge';
              add(badges,'span',sourceStatus(order.status)).className='sx-retail-customer-status';
            }else{
              add(badges,'span',t('7Network order','طلب 7Network')).className='sx-retail-customer-store-badge';
              add(badges,'span',labels[order.localStatus]||sourceStatus(order.localStatus)).className='sx-retail-customer-status';
            }
            const details=add(card,'details');details.className='sx-retail-customer-order-details';
            add(details,'summary',t('View order details, items and payments','عرض تفاصيل الطلب والمنتجات والمدفوعات'));
            const body=add(details,'div');body.className='sx-retail-customer-order-body';
            const meta=add(body,'div');meta.className='sx-retail-customer-order-meta';
            const metaRow=(label,value)=>{const row=add(meta,'p');add(row,'strong',label);add(row,'span',value||'—').dir='auto';};
            if(order.provider){
              metaRow(t('Source store','المتجر المصدر'),(order.storeName||order.provider)+' · '+(order.provider==='woocommerce'?'WooCommerce':String(order.provider).toUpperCase()));
              metaRow(t('Store order status','حالة طلب المتجر'),sourceStatus(order.status));
              metaRow(t('Payment status reported by store','حالة الدفع حسب المتجر'),sourceStatus(order.financialStatus));
            }else{
              metaRow(t('7Network order status','حالة طلب 7Network'),labels[order.localStatus]||sourceStatus(order.localStatus));
              if(order.deliveryState)metaRow(t('Delivery status','حالة التوصيل'),deliveryLabels[order.deliveryState]||sourceStatus(order.deliveryState));
            }
            const orderAddress=order.shippingAddress||order.deliveryAddress;
            if(orderAddress){const addressParts=typeof orderAddress==='string'?[orderAddress]:[orderAddress.address1,orderAddress.address2,orderAddress.city,orderAddress.region,orderAddress.postalCode,orderAddress.country].filter(Boolean);
              if(addressParts.length)metaRow(t('Delivery address','عنوان التوصيل'),addressParts.join(' · '));}
            if(order.provider&&order.reportedNetPaid!=null){
              metaRow(t('Net paid reported by store','صافي المدفوع حسب المتجر'),sourceMoney(order.reportedNetPaid,order.currency));
              add(body,'p',t('Store payment events are not verified settlement records.','أحداث الدفع من المتجر ليست سجلات تسوية متحققاً منها.')).className='sx-retail-customer-evidence-note';
            }
            if(order.lines?.length){
              const lines=add(body,'div');lines.className='sx-retail-customer-order-lines';
              for(const lineData of order.lines){
                const line=add(lines,'div');line.className='sx-retail-customer-order-line';
                const description=add(line,'div');description.className='sx-retail-customer-order-line-description';
                add(description,'strong',lineData.name||t('Item','عنصر'));
                const detailText=[String(lineData.quantity||'0')+' ×',lineData.sku?'SKU '+lineData.sku:null].filter(Boolean).join(' · ');
                add(description,'span',detailText);
                const lineAmount=lineData.total!=null?sourceMoney(lineData.total,lineData.currency||order.currency):lineData.unitPrice!=null?t('Unit price ','سعر الوحدة ')+sourceMoney(lineData.unitPrice,lineData.currency||order.currency):'—';
                add(line,'bdi',lineAmount).dir='auto';
              }
            }
            const payments=[...(order.transactions||[]),...(order.payments||[])];
            if(payments.length){const paymentList=add(body,'div');paymentList.className='sx-retail-customer-order-payments';
              add(paymentList,'h4',order.provider?t('Store-reported payment events','أحداث الدفع حسب المتجر'):t('7Network receipt records','سجلات إيصالات 7Network'));
              for(const payment of payments){
                const row=add(paymentList,'p');
                const kind=payment.kind==='cash_receipt'?t('Cash receipt','إيصال نقدي'):sourceStatus(payment.kind);
                add(row,'span',kind+' · '+sourceStatus(payment.status));
                add(row,'bdi',sourceMoney(payment.amount,payment.currency||order.currency)).dir='auto';
                if(payment.gateway)add(row,'span',payment.gateway);
                if(payment.processedAt)add(row,'time',orderDate(payment.processedAt));
              }
            }else add(body,'p',order.provider?t('No payment events were included in the imported order.','لم تتضمن بيانات الطلب المستورد أحداث دفع.'):
              t('No 7Network receipt has been recorded for this order.','لم يسجل إيصال 7Network لهذا الطلب.')).className='sx-retail-customer-evidence-note';
          }
          const paging=profile.orderPagination;
          if(paging?.total>paging.limit){
            const controls=add(orders,'div');controls.className='sx-retail-customer-pagination';
            const pageRange=add(controls,'span',t('Page ','صفحة ')+paging.page+' · '+paging.total+' '+t('orders','طلبات'));pageRange.className='sx-retail-customer-range';
            const pageButtons=add(controls,'div');pageButtons.className='sx-retail-customer-page-controls';
            const previous=add(pageButtons,'button',t('Previous orders','الطلبات السابقة'));previous.type='button';previous.className='sx-retail-secondary';previous.disabled=orderPage<=1;
            const next=add(pageButtons,'button',t('Next orders','الطلبات التالية'));next.type='button';next.className='sx-retail-secondary';next.disabled=!paging.hasMore;
            previous.onclick=()=>{orderPage=Math.max(1,orderPage-1);updateCustomerUrl(key,orderPage,true);render();};
            next.onclick=()=>{orderPage++;updateCustomerUrl(key,orderPage,true);render();};
          }
          status.textContent='';
        }catch{
          const error=add(detail,'div');error.className='sx-retail-empty sx-retail-customer-empty';
          add(error,'strong',t('Customer profile could not be loaded','تعذر تحميل ملف العميل'));
          add(error,'p',t('The record may have changed, or you may no longer have access. Return to the directory and try again.','ربما تغير السجل أو لم يعد لديك إذن الوصول. ارجع إلى الدليل وحاول مرة أخرى.'));
          const retry=add(error,'button',t('Try again','إعادة المحاولة'));retry.type='button';retry.className='sx-retail-secondary';retry.onclick=render;
          status.textContent='';
        }
      };
      await render();
    };
    window.addEventListener('popstate',()=>{
      const query=new URLSearchParams(location.search),key=query.get('customer');
      if(query.get('page')!=='retail-customers')return;
      if(/^[a-f0-9]{64}$/i.test(String(key||'')))showDetail(key);else showList();
    });
    const initialKey=new URLSearchParams(location.search).get('customer');
    if(/^[a-f0-9]{64}$/i.test(String(initialKey||'')))await showDetail(initialKey);else await showList();
  }
  async function start(){
    const access=await window.SaleMaxWorkspace.session();
    const allowed=pages.filter(([key,permission])=>access.permissions[permission]&&access.roleNavigation.includes(key));
    const nav=()=>{
      // The shared sidebar can render a docked list and a separate mobile
      // drawer. Use each actual list; falling back to a row's parent can nest
      // new list items inside a menu item and make observer updates duplicate
      // them indefinitely.
      const lists=[...document.querySelectorAll('.MuiDrawer-paper')]
        .map(drawer=>drawer.querySelector('[data-sx-sidebar-list]')||drawer.querySelector('ul')).filter(Boolean);
      if(!lists.length){
        const anchors=[...document.querySelectorAll('[data-sx-stock-nav], [data-sx-course-nav]')];
        for(const anchor of anchors){const list=anchor.closest('[data-sx-sidebar-list]')||anchor.closest('ul');if(list&&!lists.includes(list))lists.push(list);}
      }
      const allowedKeys=new Set(allowed.map(([key])=>key));
      for(const list of lists){
        const seen=new Set();
        for(const row of [...list.querySelectorAll(':scope > [data-retail-nav]')]){
          const key=row.dataset.retailNav;
          if(!allowedKeys.has(key)||seen.has(key)){row.remove();continue;}
          seen.add(key);
        }
        for(const [key,,title] of allowed){
          let row=[...list.querySelectorAll(':scope > [data-retail-nav]')].find(item=>item.dataset.retailNav===key);
          if(!row){row=document.createElement('li');row.className='MuiListItem-root';row.dataset.retailNav=key;list.append(row);}
          row.classList.add('MuiListItem-root');
          let link=row.querySelector('a');
          if(!link)link=add(row,'a');
          link.className='MuiButtonBase-root MuiListItemButton-root';
          link.href=location.pathname+'?page='+key;
          link.style.color='inherit';link.style.textDecoration='none';link.style.display='flex';
          link.style.alignItems='center';link.style.minHeight='44px';link.style.paddingInline='16px';link.style.boxSizing='border-box';
          let icon=link.querySelector('.MuiListItemIcon-root');
          if(!icon){icon=document.createElement('span');icon.className='MuiListItemIcon-root';icon.setAttribute('aria-hidden','true');link.append(icon);}
          if(!icon.querySelector('svg')){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');for(const d of ['M3 6h18v14H3z','M7 6V4h10v2','M3 10h18','M9 14h6']){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);}icon.append(svg);}
          let text=link.querySelector('.MuiListItemText-root');
          if(!text){text=document.createElement('span');text.className='MuiListItemText-root';link.append(text);}
          let label=text.querySelector('.MuiListItemText-primary');
          if(!label){label=document.createElement('span');label.className='MuiTypography-root MuiListItemText-primary';text.append(label);}
          if(link.childNodes.length!==2||link.firstElementChild!==icon||link.lastElementChild!==text)link.replaceChildren(icon,text);
          if(label.textContent!==title)label.textContent=title;
          link.setAttribute('aria-label',title);
          if(active===key)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
        }
      }
    };
    let navQueued=false;
    const financeAllowed=active==='retail-finance'&&allowed.some(([key])=>key===active);
    function syncFinanceBreadcrumb(){
      if(!financeAllowed)return;
      const label=[...document.querySelectorAll('#root .MuiTypography-root')].find(node=>
        !node.childElementCount&&['Dashboard','لوحة التحكم','لوحة المعلومات'].includes(node.textContent.trim())&&
        !node.closest('.MuiDrawer-root')&&node.getBoundingClientRect().top<90);
      if(label)label.textContent=t('Cash reconciliation','تسوية النقد');
    }
    const scheduleNav=()=>{if(navQueued)return;navQueued=true;queueMicrotask(()=>{navQueued=false;nav();syncFinanceBreadcrumb();});};
    new MutationObserver(scheduleNav).observe(document.body,{childList:true,subtree:true});
    nav();
    syncFinanceBreadcrumb();
    const page=allowed.find(([key])=>key===active);
    if(!page)return;
    const root=add(document.body,'main');root.id='sx-retail-workspace';
    root.className='sx-retail-workspace';
    root.dir=t('ltr','rtl');
    syncTheme();
    if(!document.querySelector('[data-retail-workspace-css]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/retail-workspace.css?v=20261126-retail-store-control1';css.dataset.retailWorkspaceCss='';document.head.append(css);}
    new MutationObserver(syncTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-sx-theme']});
    window.addEventListener('storage',syncTheme);
    add(root,'h1',page[2]);
    const status=add(root,'p',t('Loading…','جار التحميل…'));status.setAttribute('role','status');
    try {
      if(active==='retail-finance')return await finance(root,status);
      else if(active==='retail-customers')await customerWorkspace(root,status);
      else if(active==='retail-connected-stores')await connectedStores(root,status,access);
      else {
        await orders(root,status,active==='retail-deliveries',access.role==='owner'&&access.permissions['leads.manage'],access.roleNavigation.includes('retail-connected-stores'));
      }
      status.textContent='';
    } catch {status.textContent=t('Unable to load this workspace.','تعذر تحميل مساحة العمل.');}
  }
  window.addEventListener('salemax:languagechange',()=>{
    if(/^\/(user|agent)\/?$/.test(location.pathname)&&pages.some(([key])=>key===new URLSearchParams(location.search).get('page')))location.reload();
  });
  function boot(){if(window.SaleMaxWorkspace)start().catch(()=>{});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
