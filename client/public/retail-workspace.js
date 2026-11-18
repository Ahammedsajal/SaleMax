(() => {
  if (!/^\/(user|agent)\/?$/.test(location.pathname)) return;
  if (window.__sxRetailWorkspaceLoaded) return;
  window.__sxRetailWorkspaceLoaded = true;
  const t=(en,ar)=>(localStorage.getItem('language')||'').toLowerCase().startsWith('ar')?ar:en;
  const pages=[
    ['retail-orders','retail.orders',t('Retail orders','طلبات التجزئة')],
    ['retail-connected-stores','retail.connect',t('Connected Stores','المتاجر المتصلة')],
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
    const card=add(root,'article');card.className='sx-retail-order';
    const row=add(card,'div');row.className='sx-retail-order-summary';
    const reference=add(row,'div');reference.className='sx-retail-order-reference';
    add(reference,'span',t('Order','طلب')).className='sx-retail-order-label';
    const orderId=add(reference,'bdi',String(order.id).slice(0,8).toUpperCase());orderId.dir='ltr';orderId.className='sx-retail-order-id';
    const date=add(reference,'time',orderDate(order.createdAt));date.dateTime=order.createdAt||'';date.className='sx-retail-order-date';
    const buyer=add(row,'div');buyer.className='sx-retail-order-buyer';
    add(buyer,'strong',order.buyerName||t('Customer','العميل'));
    const phone=add(buyer,'bdi',order.buyerPhone||'');phone.dir='ltr';phone.className='sx-retail-order-phone';
    const total=add(row,'strong',money(order.totalMinor));total.className='sx-retail-order-total';
    const badges=add(row,'div');badges.className='sx-retail-order-badges';
    const state=add(badges,'span',labels[order.status]||order.status);state.className='sx-retail-order-status sx-retail-status-'+String(order.status||'').replace(/[^a-z_]/g,'');
    const fulfillment=add(badges,'span',order.fulfillment==='delivery'?t('Delivery','توصيل'):t('Pickup','استلام'));fulfillment.className='sx-retail-order-fulfillment';
    const details=add(card,'details');details.className='sx-retail-order-details';
    add(details,'summary',t('Order details and actions','تفاصيل الطلب والإجراءات'));
    const body=add(details,'div');body.className='sx-retail-order-body';
    const fullReference=add(body,'p');add(fullReference,'strong',t('Reference: ','المرجع: '));const fullId=add(fullReference,'bdi',order.id);fullId.dir='ltr';
    const contact=add(body,'div');contact.className='sx-retail-order-contact';
    const contactName=add(contact,'p');add(contactName,'strong',t('Customer: ','العميل: '));add(contactName,'span',order.buyerName||'—');
    const contactPhone=add(contact,'p');add(contactPhone,'strong',t('Mobile: ','الهاتف: '));const phoneValue=add(contactPhone,'bdi',order.buyerPhone||'—');phoneValue.dir='ltr';
    if(order.buyerEmail){const contactEmail=add(contact,'p');add(contactEmail,'strong',t('Email: ','البريد الإلكتروني: '));const emailValue=add(contactEmail,'bdi',order.buyerEmail);emailValue.dir='auto';}
    add(body,'p',money(order.totalMinor)+' · '+(order.fulfillment==='delivery'?t('Delivery','توصيل'):t('Pickup','استلام')));
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
    const key=String(value||'unknown').toLowerCase(),en={pending:'Pending',processing:'Processing', 'on-hold':'On hold',completed:'Completed',cancelled:'Cancelled',refunded:'Refunded',failed:'Failed','checkout-draft':'Checkout draft',open:'Open',closed:'Closed',unknown:'Unknown',paid:'Paid','paid_reported_by_store':'Paid (reported by store)','refunded_reported_by_store':'Refunded (reported by store)'};
    const ar={pending:'قيد الانتظار',processing:'قيد المعالجة','on-hold':'معلّق',completed:'مكتمل',cancelled:'ملغى',refunded:'مسترد',failed:'فشل','checkout-draft':'مسودة الدفع',open:'مفتوح',closed:'مغلق',unknown:'غير معروف',paid:'مدفوع','paid_reported_by_store':'مدفوع (حسب المتجر)','refunded_reported_by_store':'مسترد (حسب المتجر)'};
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
  async function orders(root,status,driver,canLinkLead){
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
    const onlineStatus=input(form,t('Store status (optional)','حالة المتجر (اختياري)'),'','search');onlineStatus.autocomplete='off';onlineStatus.maxLength=64;onlineStatus.parentElement.className='sx-retail-filter-field';onlineStatus.parentElement.hidden=true;
    const controls=add(form,'div');controls.className='sx-retail-filter-actions';
    const searchButton=add(controls,'button',t('Search orders','بحث عن الطلبات'));searchButton.type='submit';searchButton.className='sx-retail-primary';
    const clearButton=add(controls,'button',t('Clear filters','مسح التصفية'));clearButton.type='button';clearButton.className='sx-retail-secondary';
    const resultCount=add(root,'p');resultCount.className='sx-retail-result-count';resultCount.setAttribute('aria-live','polite');
    const empty=add(root,'p');empty.className='sx-retail-empty';empty.hidden=true;
    const more=add(root,'button',t('Load more orders','تحميل المزيد من الطلبات'));more.type='button';more.className='sx-retail-load-more';more.hidden=true;
    let drivers=[];try{drivers=await api('/drivers');}catch{}
    let page=0,loaded=0,hasMore=false,searchSequence=0,sourceMode='native';
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
    const setSourceMode=mode=>{
      sourceMode=mode;const online=mode==='online';nativeTab.setAttribute('aria-pressed',String(!online));onlineTab.setAttribute('aria-pressed',String(online));
      nativeTab.className=online?'sx-retail-secondary':'sx-retail-primary';onlineTab.className=online?'sx-retail-primary':'sx-retail-secondary';
      customer.parentElement.hidden=online;onlineOrder.parentElement.hidden=!online;statusLabel.hidden=online;onlineStatus.parentElement.hidden=!online;
      intro.textContent=online?t('Review imported orders from connected stores. These records are read-only in 7Network.','راجع الطلبات المستوردة من المتاجر المتصلة. هذه السجلات للقراءة فقط في 7Network.'):
        t('Find and manage customer orders. Use dates, customer details or status to narrow the list.','ابحث عن طلبات العملاء وأدرها. استخدم التاريخ أو بيانات العميل أو الحالة لتصفية القائمة.');
      runSearch(true);
    };
    nativeTab.setAttribute('aria-pressed','true');onlineTab.setAttribute('aria-pressed','false');
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
  async function connectedStores(root,status){
    const intro=add(root,'p',t('Connect the store to this 7Network business workspace. Read-only sync imports products, variations, orders and customers; it does not edit storefront pages, checkout, payment settings, prices, stock or orders. Customer messages stay off.','اربط المتجر بمساحة عمل النشاط هذه في 7Network. تستورد المزامنة للقراءة فقط المنتجات والمتغيرات والطلبات والعملاء؛ ولا تعدّل صفحات المتجر أو الدفع أو إعدادات الدفع أو الأسعار أو المخزون أو الطلبات. تظل رسائل العملاء متوقفة.'));
    const shopify=add(root,'section');add(shopify,'h2',t('Shopify','Shopify'));
    add(shopify,'p',t('Connect through Shopify authorization. The app requests read-only product, order and customer access. Orders cover the last 60 days by default; the optional older-order scope can be enabled only after Shopify approves it. Customer names and contact details also require protected customer data access. The authorizing Shopify staff account must also be allowed to view abandoned checkouts.','يتم الربط عبر تفويض Shopify. يطلب التطبيق قراءة المنتجات والطلبات والعملاء فقط. تشمل الطلبات آخر 60 يوماً افتراضياً؛ ولا يمكن تفعيل نطاق الطلبات الأقدم الاختياري إلا بعد موافقة Shopify. كما تتطلب أسماء العملاء وبيانات التواصل موافقة الوصول إلى بيانات العملاء المحمية. ويجب أن يملك حساب موظف Shopify المفوّض صلاحية عرض السلات المتروكة.'));
    const shopName=input(shopify,t('Shopify store domain','نطاق متجر Shopify'));
    shopName.autocomplete='url';shopName.placeholder='example.myshopify.com';shopName.setAttribute('aria-label',t('Shopify store domain','نطاق متجر Shopify'));
    const shopCurrency=input(shopify,t('Primary store currency (ISO 4217)','العملة الأساسية للمتجر (ISO 4217)'),'QAR');shopCurrency.maxLength=3;shopCurrency.autocomplete='off';
    const connectShopify=add(shopify,'button',t('Connect Shopify','ربط Shopify'));connectShopify.type='button';
    connectShopify.onclick=async()=>{connectShopify.disabled=true;try{const result=await api('/connectors/shopify/start','POST',{shop:shopName.value,currency:shopCurrency.value.toUpperCase()});location.assign(result.authorizationUrl);}catch(error){showCode(status,error);connectShopify.disabled=false;}};

    const woo=add(root,'section');add(woo,'h2',t('WooCommerce','WooCommerce'));
    add(woo,'p',t('Use a dedicated read-only WooCommerce REST key. The key is sent over HTTPS and stored encrypted in 7Network. This admin connection does not add storefront or checkout fields or change payment settings. After the first full sync reconciles, the owner can configure signed product, order and customer webhooks in WooCommerce admin; that setup changes admin settings only. The optional checkout-event plugin is separate and is not needed for catalog/order sync.','استخدم مفتاح REST مخصصاً للقراءة فقط في WooCommerce. يُرسل المفتاح عبر HTTPS ويُخزّن مشفراً في 7Network. لا يضيف هذا الربط الإداري حقولاً للمتجر أو الدفع ولا يغيّر إعدادات الدفع. بعد اكتمال أول مزامنة ومطابقتها، يمكن للمالك إعداد Webhooks موقّعة للمنتجات والطلبات والعملاء من لوحة WooCommerce؛ وهذا يغيّر إعدادات الإدارة فقط. إضافة أحداث الدفع اختيارية ومنفصلة وليست مطلوبة لمزامنة المنتجات والطلبات.'));
    const wooUrl=input(woo,t('Store URL','رابط المتجر'));wooUrl.placeholder='https://shop.example.com';wooUrl.autocomplete='url';
    const wooDisplay=input(woo,t('Display name','اسم العرض'));
    const wooCurrency=input(woo,t('Store currency (ISO 4217)','عملة المتجر (ISO 4217)'),'QAR');wooCurrency.maxLength=3;wooCurrency.autocomplete='off';
    const wooKey=input(woo,t('Consumer key (read only)','مفتاح المستهلك (قراءة فقط)'),'','password');wooKey.autocomplete='new-password';
    const wooSecret=input(woo,t('Consumer secret','السر الخاص بالمستهلك'),'','password');wooSecret.autocomplete='new-password';
    const connectWoo=add(woo,'button',t('Connect WooCommerce','ربط WooCommerce'));connectWoo.type='button';
    connectWoo.onclick=async()=>{connectWoo.disabled=true;try{
      await api('/connectors/woocommerce','POST',{storeUrl:wooUrl.value,displayName:wooDisplay.value,currency:wooCurrency.value.toUpperCase(),consumerKey:wooKey.value,consumerSecret:wooSecret.value});
      wooKey.value='';wooSecret.value='';status.textContent=t('WooCommerce connected. API credentials were cleared from the form and stored encrypted. Read-only sync has not started. Configure signed webhooks only after reconciliation.','تم ربط WooCommerce. مُسحت بيانات API من النموذج وخُزنت مشفرة. لم تبدأ المزامنة للقراءة فقط بعد. أعدّ Webhooks الموقّعة بعد المطابقة فقط.');await refreshConnections();
    }catch(error){showCode(status,error);}finally{connectWoo.disabled=false;}};

    const connectionsRoot=add(root,'div');connectionsRoot.setAttribute('aria-live','polite');
    async function loadItems(connection,kind,holder,page=1){
      holder.replaceChildren();add(holder,'p',t('Loading…','جار التحميل…'));
      try{
        const result=await api('/connectors/'+encodeURIComponent(connection.id)+'/data/'+kind+'?page='+page);
        holder.replaceChildren();
        if(!result.items.length)add(holder,'p',t('No imported '+kind+' yet. Choose Sync now to start importing.','لا توجد بيانات '+kind+' مستوردة بعد. اختر المزامنة الآن لبدء الاستيراد.'));
        for(const item of result.items){
          const card=add(holder,'article');
          if(kind==='orders'){
            add(card,'strong',t('Order ','طلب ')+String(item.number||item.id));add(card,'p',item.status+' · '+item.financialStatus+' · '+item.currency+' '+item.total);
            if(item.customer?.name||item.customer?.email||item.customer?.phone)add(card,'p',[item.customer.name,item.customer.email,item.customer.phone].filter(Boolean).join(' · '));
            add(card,'p',t('Follow-up permission','إذن المتابعة')+': '+item.contactConsent);
            for(const line of item.lineItems)add(card,'p',(line.quantity||0)+' × '+(line.name||t('Item','عنصر'))+(line.sku?' · '+line.sku:'')+
              (line.total!=null?' · '+item.currency+' '+line.total:''));
            if(item.breakdown){const parts=[['subtotal',item.breakdown.subtotal],['discount',item.breakdown.discount],['shipping',item.breakdown.shipping],['tax',item.breakdown.tax],['fees',item.breakdown.fees],['refunds',item.breakdown.refunds]].filter(([,value])=>value!=null);
              if(parts.length)add(card,'p',parts.map(([name,value])=>t(name,name)+' '+item.currency+' '+value).join(' · '));}
            if(item.lineItemsTruncated||item.transactionsTruncated)add(card,'p',t('Some line items or payment transactions need a full-detail import.','تحتاج بعض المنتجات أو معاملات الدفع إلى استيراد التفاصيل الكاملة.'));
            for(const transaction of item.transactions||[])add(card,'p',t('Payment record','سجل دفع')+': '+transaction.kind+' · '+transaction.status+' · '+transaction.currency+' '+transaction.amount+(transaction.gateway?' · '+transaction.gateway:''));
            add(card,'p',t('Payment records are source evidence only; 7Network has not verified settlement or posted accounting.','سجلات الدفع أدلة من المصدر فقط؛ لم يتحقق 7Network من التسوية ولم يسجل قيوداً محاسبية.'));
          }else if(kind==='customers'){
            add(card,'strong',item.name||t('Customer','عميل'));add(card,'p',[item.email,item.phone].filter(Boolean).join(' · ')||t('No contact details supplied by the store.','لم يرسل المتجر بيانات تواصل.'));
            add(card,'p',t('Marketing consent from the provider','موافقة التسويق من المزوّد')+': '+item.marketingConsent);
          }else if(kind==='products'){
            if(item.imageUrl){const image=document.createElement('img');image.className='sx-retail-product-image';image.src=item.imageUrl;image.alt=item.title||t('Product image','صورة المنتج');image.loading='lazy';image.referrerPolicy='no-referrer';card.appendChild(image);}
            add(card,'strong',item.title);add(card,'p',(item.sku||'—')+' · '+item.status+' · '+(item.priceUnavailable?t('See variation prices','راجع أسعار المتغيرات'):item.currency+' '+item.price));
            if(item.sourceStock?.managed||item.sourceStock?.quantity!=null)add(card,'p',t('Woo stock quantity (read only)','كمية مخزون Woo (قراءة فقط)')+': '+
              (item.sourceStock.quantity??'—')+' · '+item.sourceStock.status+' · '+t('unit not mapped','الوحدة غير محددة'));
            if(item.sourceVariationCount||item.variationCount)add(card,'p',t('Woo variations imported','متغيرات Woo المستوردة')+': '+item.variationCount+
              (item.sourceVariationCount!=null?' / '+item.sourceVariationCount:''));
            if(connection.provider==='woocommerce'&&item.sourceVariationCount){
              const variantSection=add(card,'details');add(variantSection,'summary',t('Woo variations and SKUs','متغيرات Woo وSKU'));
              const variantHolder=add(variantSection,'div');let variantLoaded=false;
              const loadVariantPage=async(pageNumber)=>{
                try{
                  const result=await api('/connectors/'+encodeURIComponent(connection.id)+'/data/variations?page='+pageNumber+'&productId='+encodeURIComponent(item.id));
                  for(const variant of result.items){const line=add(variantHolder,'article');add(line,'p',(variant.title||t('Variation','متغير'))+' · ID '+variant.id+' · '+(variant.sku||'—')+' · '+variant.status+
                    (variant.purchasable===false?' · '+t('not purchasable','غير قابل للشراء'):'')+' · '+variant.currency+' '+variant.price);
                    if(variant.sourceStock?.managed||variant.sourceStock?.quantity!=null)add(line,'p',t('Woo stock quantity (read only)','كمية مخزون Woo (قراءة فقط)')+': '+
                      (variant.sourceStock.quantity??'—')+' · '+variant.sourceStock.status+' · '+t('unit not mapped','الوحدة غير محددة'));}
                  if(result.hasMore)action(variantHolder,t('Load more variations','تحميل المزيد من المتغيرات'),()=>loadVariantPage(pageNumber+1).then(()=>({message:t('More variations loaded.','تم تحميل المزيد من المتغيرات.'),refresh:false})),status);
                  else if(!result.items.length&&pageNumber===1)add(variantHolder,'p',t('No variation records imported yet. Continue Sync now.','لم تُستورد سجلات المتغيرات بعد. تابع المزامنة الآن.'));
                }catch(error){add(variantHolder,'p',t('Unable to load Woo variations.','تعذر تحميل متغيرات Woo.'));showCode(status,error);}
              };
              variantSection.addEventListener('toggle',()=>{if(variantSection.open&&!variantLoaded){variantLoaded=true;loadVariantPage(1);}});
            }else for(const variant of item.variants||[])add(card,'p',(variant.title||t('Variation','متغير'))+' · '+(variant.sku||'—')+
              (variant.price?' · '+item.currency+' '+variant.price:''));
            if(item.variantsTruncated&&connection.provider!=='woocommerce')add(card,'p',t('Some product variants need a full-detail import.','تحتاج بعض متغيرات المنتج إلى استيراد التفاصيل الكاملة.'));
            if(connection.provider==='woocommerce'){
              const mappingSection=add(card,'details');mappingSection.className='sx-retail-mapping';
              add(mappingSection,'summary',t('Map Woo product or variation to 7Network inventory','ربط منتج أو متغير Woo بمخزون 7Network'));
              const mappingHolder=add(mappingSection,'div');let mappingLoaded=false;
              const renderMappingRow=(source,pageNumber)=>{
                const line=add(mappingHolder,'article');line.className='sx-retail-mapping-row';
                const sourceLabel=source.sourceType==='variation'?t('Woo variation','متغير Woo'):t('Woo product','منتج Woo');
                add(line,'strong',sourceLabel+' · '+source.title);
                add(line,'p','ID '+source.productId+(source.variationId?' / '+source.variationId:'')+' · SKU '+(source.sku||'—')+' · '+source.status);
                const mappingState=add(line,'p');
                if(source.mappingStatus==='mapped'&&source.targetProduct){
                  const target=source.targetProduct;
                  mappingState.textContent=t('Mapped to 7Network','مرتبط بمنتج 7Network')+': '+(target.sku||'—')+' · '+(t(target.nameEn,target.nameAr)||target.nameEn||target.id)+
                    (target.isVariant?' · '+(target.variantGroupTitleEn||'')+' '+(target.variantValueEn||''):'');
                  if(target.status!=='active')add(line,'p',t('Mapped target is not active. Review it before accepting reconciliation.','المنتج المرتبط غير نشط. راجعه قبل اعتماد المطابقة.'));
                  if(target.skuMatches===false)add(line,'p',t('The mapped SKU differs from Woo. Review this explicit mapping before accepting reconciliation.','يختلف SKU المرتبط عن Woo. راجع الربط قبل اعتماد المطابقة.'));
                  const stockStateLabels={ready_read_only_comparison:t('Location and unit scope verified. Stock remains read-only; this is not a balance reconciliation.','تم التحقق من الموقع والوحدة. يظل المخزون للقراءة فقط؛ وهذه ليست مطابقة للأرصدة.'),
                    needs_review:t('Stock location or unit scope still needs owner review.','لا يزال نطاق الموقع أو الوحدة بحاجة إلى مراجعة المالك.'),
                    parent_shared:t('Woo stock is shared at the parent product level and cannot be allocated per variation.','مخزون Woo مشترك على مستوى المنتج الرئيسي ولا يمكن توزيعه على المتغيرات.'),
                    unit_profile_changed:t('The 7Network SKU unit profile changed. Review and confirm the mapping again.','تغير إعداد وحدة SKU في 7Network. راجع الربط وأكده مجدداً.'),
                    unit_incompatible:t('Woo quantity does not match the current 7Network unit precision or increment.','كمية Woo لا تتوافق مع دقة أو زيادة وحدة 7Network الحالية.'),
                    location_unavailable:t('The mapped 7Network location is inactive or unavailable.','موقع 7Network المرتبط غير نشط أو غير متاح.'),
                    quantity_unavailable:t('Woo manages stock but has no numeric quantity in this snapshot.','يدير Woo المخزون لكن لا توجد كمية رقمية في هذه اللقطة.'),
                    unmapped:t('Map this product before reviewing its stock scope.','اربط هذا المنتج قبل مراجعة نطاق مخزونه.'),
                    not_managed:t('Woo does not manage numeric stock for this item.','لا يدير Woo مخزوناً رقمياً لهذا العنصر.')};
                  if(target.stockMapping?.state)add(line,'p',stockStateLabels[target.stockMapping.state]||t('Stock mapping needs review.','يحتاج ربط المخزون إلى مراجعة.'));
                  if(target.stockMapping?.state==='ready_read_only_comparison'&&target.stockMapping.stockScope==='single_location')
                    add(line,'p',t('Woo stock scope: ','نطاق مخزون Woo: ')+(t(target.stockMapping.targetLocationNameEn,target.stockMapping.targetLocationNameAr)||target.stockMapping.targetLocationNameEn));
                  if(target.stockMapping?.state==='ready_read_only_comparison'&&target.stockMapping.stockScope==='aggregate')
                    add(line,'p',t('Woo stock scope: aggregate across all locations','نطاق مخزون Woo: إجمالي عبر جميع المواقع'));
                }else if(source.mappingStatus==='ignored')mappingState.textContent=t('Explicitly ignored for inventory mapping','تم استثناؤه صراحةً من ربط المخزون');
                else mappingState.textContent=t('Not mapped','غير مرتبط');
                if(!source.mappable){add(line,'p',t('Only published simple products and purchasable variations under a published parent can be mapped.','يمكن ربط المنتجات البسيطة المنشورة والمتغيرات القابلة للشراء ضمن منتج رئيسي منشور فقط.'));return;}
                const search=input(line,t('Find 7Network SKU or product','ابحث عن SKU أو منتج 7Network'),source.sku||'','search');
                search.maxLength=100;search.autocomplete='off';
                const selectLabel=add(line,'label',t('Target product or variant','المنتج أو المتغير المستهدف')+' ');
                const select=add(selectLabel,'select');select.setAttribute('aria-label',t('Target product or variant','المنتج أو المتغير المستهدف'));select.disabled=true;
                const optionsById=new Map();
                let locations=[];
                const selectStatus=add(line,'p');
                const placeholder=add(select,'option',t('Choose a 7Network product','اختر منتج 7Network'));placeholder.value='';
                const hasIndependentStock=Boolean(source.sourceStock?.managed&&source.sourceStock.quantity!=null&&!source.parentStock?.managed);
                const stockControls=add(line,'div');stockControls.className='sx-retail-stock-mapping-controls';
                let stockScopeSelect=null,stockLocationSelect=null,unitConfirmed=null,save=null;
                let lastTargetId=source.targetProduct?.id||'',lastUnitRevision=Number(source.targetProduct?.unitProfile?.revision||0);
                if(source.parentStock?.managed){
                  add(stockControls,'p',t('Woo stock is managed by the parent product and shared across variations. This quantity cannot be reconciled separately per variation.','يدير منتج Woo الرئيسي المخزون المشترك بين المتغيرات. لا يمكن مطابقة هذه الكمية لكل متغير على حدة.'));
                }else if(source.sourceStock?.managed&&source.sourceStock.quantity==null){
                  add(stockControls,'p',t('Woo manages stock for this item but did not provide a numeric quantity. Map product identity only until a quantity is available.','يدير Woo المخزون لهذا العنصر لكنه لم يرسل كمية رقمية. اربط هوية المنتج فقط إلى حين توفر الكمية.'));
                }else if(hasIndependentStock){
                  add(stockControls,'p',t('Woo quantity: ','كمية Woo: ')+source.sourceStock.quantity+' · '+t('read only','للقراءة فقط'));
                  const scopeLabel=add(stockControls,'label',t('What does this Woo quantity represent?','ماذا تمثل كمية Woo هذه؟')+' ');
                  stockScopeSelect=add(scopeLabel,'select');
                  for(const [value,label] of [['unverified',t('Not verified: identity mapping only','غير متحقق: ربط الهوية فقط')],
                    ['single_location',t('Stock for one 7Network location','مخزون موقع 7Network واحد')],
                    ['aggregate',t('Woo total across all locations; no per-location assignment','إجمالي Woo لكل المواقع؛ دون تخصيص لموقع')]]){
                    const option=add(stockScopeSelect,'option',label);option.value=value;
                  }
                  stockScopeSelect.value=source.targetProduct?.stockMapping?.stockScope||'unverified';
                  const locationLabel=add(stockControls,'label',t('7Network location','موقع 7Network')+' ');
                  stockLocationSelect=add(locationLabel,'select');
                  add(stockLocationSelect,'option',t('Choose a location','اختر موقعاً')).value='';
                  stockLocationSelect.value=source.targetProduct?.stockMapping?.targetLocationId||'';
                  const unitProfileLine=add(stockControls,'p');
                  const unitConfirmLabel=add(stockControls,'label');unitConfirmLabel.className='sx-retail-unit-confirm';
                  unitConfirmed=add(unitConfirmLabel,'input');unitConfirmed.type='checkbox';
                  add(unitConfirmLabel,'span',' '+t('I confirm Woo quantity uses the selected SKU’s 7Network base unit. No unit conversion will be applied.','أؤكد أن كمية Woo تستخدم وحدة SKU الأساسية في 7Network. لن يتم تحويل الوحدات.'));
                  unitConfirmed.checked=Boolean(source.targetProduct?.stockMapping?.sourceUnitConfirmed&&
                    Number(source.targetProduct.stockMapping.targetUnitRevision)===Number(source.targetProduct.stockMapping.currentUnitRevision));
                  add(stockControls,'p',t('This records a read-only comparison scope. It does not change stock in WooCommerce or 7Network. Choose aggregate only when Woo reports the total across all locations; leave the location blank.','يسجل هذا نطاق مقارنة للقراءة فقط. لا يغيّر المخزون في WooCommerce أو 7Network. اختر الإجمالي فقط عندما تعرض Woo مخزون جميع المواقع؛ واترك الموقع فارغاً.'));
                  stockScopeSelect.addEventListener('change',()=>updateMappingControls());
                  stockLocationSelect.addEventListener('change',()=>updateMappingControls());
                  unitConfirmed.addEventListener('change',()=>updateMappingControls());
                  unitProfileLine.dataset.unitProfile='true';
                }
                function updateMappingControls(){
                  const target=optionsById.get(select.value);
                  const hasTarget=Boolean(target);
                  const currentRevision=Number(target?.unitProfile?.revision??source.targetProduct?.unitProfile?.revision??0);
                  if(hasTarget&&select.value===lastTargetId&&currentRevision!==lastUnitRevision){
                    if(unitConfirmed)unitConfirmed.checked=false;
                    lastUnitRevision=currentRevision;
                  }
                  selectStatus.dataset.skuReady=hasTarget?'true':'false';
                  if(stockScopeSelect){
                    stockScopeSelect.disabled=!hasTarget;stockLocationSelect.disabled=!hasTarget||stockScopeSelect.value!=='single_location';
                    unitConfirmed.disabled=!hasTarget||stockScopeSelect.value==='unverified';
                    const profile=target?.unitProfile||source.targetProduct?.unitProfile||{};
                    const unitNames={unit:t('unit','وحدة'),yard:t('yard','ياردة'),piece:t('piece','قطعة'),panel:t('panel','لوح')};
                    const base=profile.baseUnitCode==='custom'?(t(profile.baseUnitLabel,profile.baseUnitLabelAr)||t('custom unit','وحدة مخصصة')):
                      (unitNames[profile.baseUnitCode]||profile.baseUnitCode||unitNames.unit);
                    const unitProfileLine=stockControls.querySelector('[data-unit-profile="true"]');
                    if(unitProfileLine)unitProfileLine.textContent=t('Target SKU base unit: ','وحدة SKU المستهدفة: ')+base+' · '+
                      t('precision','الدقة')+' '+Number(profile.quantityPrecision||0)+' · '+t('increment','الزيادة')+' '+String(profile.quantityIncrement||'1');
                  }
                  if(save){
                    const scope=stockScopeSelect?.value||'unverified';
                    const scopeReady=!hasIndependentStock||scope==='unverified'||Boolean(unitConfirmed?.checked&&
                      (scope!=='single_location'||stockLocationSelect?.value));
                    save.disabled=!hasTarget||!scopeReady;
                  }
                }
                async function searchTargets(){
                  const query=(search.value.trim()||source.sku||'').trim();
                  if(query.length<2){selectStatus.textContent=t('Enter at least two characters to search.','أدخل حرفين على الأقل للبحث.');return;}
                  select.disabled=true;select.replaceChildren();optionsById.clear();
                  add(select,'option',t('Searching…','جارٍ البحث…')).value='';
                  try{
                    const result=await api('/connectors/'+encodeURIComponent(connection.id)+'/mapping-options?search='+encodeURIComponent(query));
                    locations=result.locations||[];
                    if(stockLocationSelect){
                      const selectedLocation=stockLocationSelect.value;stockLocationSelect.replaceChildren();
                      add(stockLocationSelect,'option',t('Choose a location','اختر موقعاً')).value='';
                      for(const location of locations){const option=add(stockLocationSelect,'option',(location.code||'')+' · '+(t(location.nameEn,location.nameAr)||location.nameEn));option.value=location.id;}
                      const current=source.targetProduct?.stockMapping;
                      if(current?.targetLocationId&&!locations.some(location=>location.id===current.targetLocationId)){
                        const option=add(stockLocationSelect,'option',(current.targetLocationNameEn||current.targetLocationId)+' · '+t('inactive or unavailable','غير نشط أو غير متاح'));
                        option.value=current.targetLocationId;option.disabled=true;
                      }
                      stockLocationSelect.value=selectedLocation||current?.targetLocationId||'';
                    }
                    select.replaceChildren();add(select,'option',t('Choose a 7Network product','اختر منتج 7Network')).value='';
                    for(const target of result.items||[]){optionsById.set(target.id,target);const label=(target.sku||'—')+' · '+(t(target.nameEn,target.nameAr)||target.nameEn||target.id)+
                      (target.isVariant?' · '+(target.variantGroupTitleEn||'')+' '+(target.variantValueEn||''):'');const option=add(select,'option',label);option.value=target.id;}
                    if(source.targetProduct&&!optionsById.has(source.targetProduct.id)){
                      const target=source.targetProduct;optionsById.set(target.id,target);const option=add(select,'option',(target.sku||'—')+' · '+(target.nameEn||target.id)+' · '+t('current mapping','الربط الحالي'));option.value=target.id;
                    }
                    select.disabled=false;select.value=source.targetProduct?.id||'';
                    selectStatus.textContent=result.items?.length?t('Choose a target, then review the SKU comparison. Matches are suggestions only.','اختر هدفاً ثم راجع مقارنة SKU. المطابقات اقتراحات فقط.'):
                      t('No matching 7Network products. Search by another SKU or name.','لا توجد منتجات 7Network مطابقة. ابحث باستخدام SKU أو اسم آخر.');
                    showSkuComparison();
                    updateMappingControls();
                  }catch(error){select.replaceChildren();add(select,'option',t('Search failed','فشل البحث')).value='';selectStatus.textContent=t('Could not search the 7Network catalogue.','تعذر البحث في كتالوج 7Network.');showCode(status,error);}
                }
                function showSkuComparison(){
                  const target=optionsById.get(select.value);
                  if(!target){selectStatus.textContent=t('Select a target product to compare SKUs.','اختر منتجاً مستهدفاً لمقارنة SKU.');return;}
                  if(!source.sku||!target.sku)selectStatus.textContent=t('At least one SKU is missing. Confirm the product identity manually.','SKU مفقود في أحد الطرفين. تحقق من هوية المنتج يدوياً.');
                  else if(source.sku.trim().toUpperCase()===target.sku.trim().toUpperCase())selectStatus.textContent=t('SKU matches. Confirm the product and variation before saving.','SKU متطابق. تحقق من المنتج والمتغير قبل الحفظ.');
                  else selectStatus.textContent=t('SKU differs. Confirm this mapping manually before saving.','SKU مختلف. تحقق من الربط يدوياً قبل الحفظ.');
                }
                select.addEventListener('change',()=>{
                  const target=optionsById.get(select.value),revision=Number(target?.unitProfile?.revision||0);
                  if(select.value!==lastTargetId||revision!==lastUnitRevision){
                    if(stockScopeSelect)stockScopeSelect.value='unverified';
                    if(stockLocationSelect)stockLocationSelect.value='';
                    if(unitConfirmed)unitConfirmed.checked=false;
                    lastTargetId=select.value;lastUnitRevision=revision;
                  }
                  showSkuComparison();
                });
                const findButton=add(line,'button',t('Search catalogue','ابحث في الكتالوج'));findButton.type='button';findButton.onclick=searchTargets;
                if(source.sku&&source.sku.length>=2)searchTargets();
                save=add(line,'button',t('Save mapping','حفظ الربط'));save.type='button';save.disabled=true;
                select.addEventListener('change',updateMappingControls);
                updateMappingControls();
                async function saveMapping(actionName,targetProductId=null){
                  const button=actionName==='map'?save:actionName==='ignore'?ignore:clear;
                  button.disabled=true;
                  try{
                    const selected=optionsById.get(select.value);
                    const scope=actionName==='map'&&hasIndependentStock?stockScopeSelect?.value||'unverified':'unverified';
                    const stockMapping=scope==='unverified'?{}:{stockScope:scope,targetLocationId:scope==='single_location'?stockLocationSelect.value:null,
                      sourceUnitConfirmed:Boolean(unitConfirmed.checked),expectedUnitRevision:Number(selected?.unitProfile?.revision||0)};
                    await api('/connectors/'+encodeURIComponent(connection.id)+'/mappings','PUT',{externalProductId:source.productId,
                      externalVariationId:source.variationId||null,targetProductId,action:actionName,expectedRevision:source.mappingRevision,expectedSku:source.sku??null,
                      ...stockMapping});
                    await loadMappings(pageNumber,false);
                  }catch(error){await loadMappings(pageNumber,false);showCode(status,error);}
                }
                save.onclick=()=>{if(select.value)saveMapping('map',select.value);};
                const ignore=add(line,'button',t('Ignore this Woo item','تجاهل عنصر Woo'));ignore.type='button';ignore.onclick=()=>saveMapping('ignore');
                const clear=add(line,'button',t('Clear mapping','إزالة الربط'));clear.type='button';clear.disabled=source.mappingStatus==='unmapped';clear.onclick=()=>saveMapping('clear');
              };
              const loadMappings=async(pageNumber=1,append=false)=>{
                if(!append){mappingHolder.replaceChildren();add(mappingHolder,'p',t('Loading product mappings…','جارٍ تحميل روابط المنتجات…'));}
                try{
                  const result=await api('/connectors/'+encodeURIComponent(connection.id)+'/mappings?productId='+encodeURIComponent(item.id)+'&page='+pageNumber);
                  if(!append)mappingHolder.replaceChildren();
                  if(result.product.type==='unknown')add(mappingHolder,'p',t('Woo product type was not captured. Refresh the read-only product sync before mapping.','لم يُحفظ نوع منتج Woo. حدّث مزامنة المنتجات للقراءة فقط قبل الربط.'));
                  else if(!result.items.length&&pageNumber===1)add(mappingHolder,'p',t('No variation records were imported for this product yet.','لم تُستورد متغيرات لهذا المنتج بعد.'));
                  for(const source of result.items)renderMappingRow(source,pageNumber);
                  if(result.hasMore)action(mappingHolder,t('Load more mapping rows','تحميل مزيد من روابط المنتجات'),()=>loadMappings(pageNumber+1,true).then(()=>({message:t('More mapping rows loaded.','تم تحميل مزيد من روابط المنتجات.'),refresh:false})),status);
                }catch(error){if(!append)mappingHolder.replaceChildren();add(mappingHolder,'p',t('Unable to load product mappings.','تعذر تحميل روابط المنتجات.'));showCode(status,error);}
              };
              mappingSection.addEventListener('toggle',()=>{if(mappingSection.open&&!mappingLoaded){mappingLoaded=true;loadMappings(1);}});
            }
          }else{
            add(card,'strong',t(item.status==='abandoned'?'Abandoned checkout':item.status==='recovered'?'Recovered checkout':'Checkout',item.status==='abandoned'?'سلة متروكة':item.status==='recovered'?'سلة مستعادة':'سلة'));
            add(card,'p',item.currency+' '+item.total+' · '+t('Follow-up permission','إذن المتابعة')+': '+item.contactConsent);
            if(item.customer?.name||item.customer?.email||item.customer?.phone)add(card,'p',[item.customer.name,item.customer.email,item.customer.phone].filter(Boolean).join(' · '));
            for(const line of item.lineItems)add(card,'p',(line.quantity||0)+' × '+(line.name||t('Item','عنصر')));
            if(item.lineItemsTruncated)add(card,'p',t('Some checkout items need a full-detail import.','تحتاج بعض عناصر السلة إلى استيراد التفاصيل الكاملة.'));
            if(item.canRevealRecoveryLink){action(card,t('Reveal recovery link','إظهار رابط الاستعادة'),async()=>{
              const recovered=await api('/connectors/'+encodeURIComponent(connection.id)+'/recovery-link?checkoutId='+encodeURIComponent(item.id));
              const link=add(card,'a',t('Open recovery link','فتح رابط الاستعادة'));link.href=recovered.url;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';return t('Recovery link ready. Share it only with the matching customer when permitted.','رابط الاستعادة جاهز. شاركه مع العميل المعني فقط عند السماح.');
            },status);}
          }
        }
        if(result.hasMore)action(holder,t('Load more','تحميل المزيد'),()=>loadItems(connection,kind,holder,page+1).then(()=>({message:t('More records loaded.','تم تحميل سجلات إضافية.'),refresh:false})),status);
      }catch(error){holder.replaceChildren();add(holder,'p',t('Unable to load these records.','تعذر تحميل هذه السجلات.'));showCode(status,error);}
    }
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
    async function refreshConnections(){
      connectionsRoot.replaceChildren();
      try{
        const {connections}=await api('/connectors');
        if(!connections.length)add(connectionsRoot,'p',t('No stores connected yet. Connect Shopify or WooCommerce above.','لم يتم ربط أي متجر بعد. اربط Shopify أو WooCommerce أعلاه.'));
        for(const connection of connections){
          const card=add(connectionsRoot,'section');add(card,'h2',connection.displayName+' · '+connection.provider);add(card,'p',connection.storeDomain+' · '+connection.status+' · '+connection.currency);
          add(card,'p',t('Imported','مستورد')+': '+connection.counts.orders+' '+t('orders','طلبات')+' · '+connection.counts.customers+' '+t('customers','عملاء')+' · '+connection.counts.products+' '+t('products','منتجات')+
            (connection.provider==='woocommerce'?' · '+connection.counts.variations+' '+t('variations','متغيرات')+' · '+(connection.counts.mappings||0)+' '+t('inventory mappings','روابط المخزون'):'')+' · '+connection.counts.checkouts+' '+t('checkouts','سلات'));
          if(connection.lastSyncAt)add(card,'p',t('Last sync attempt','آخر محاولة مزامنة')+': '+connection.lastSyncAt);
          if(connection.syncProgress?.lastCompleteScanAt)add(card,'p',t('Last complete read-only scan','آخر فحص كامل للقراءة فقط')+': '+connection.syncProgress.lastCompleteScanAt);
          if(connection.lastErrorCode)add(card,'p',t('Provider status','حالة المزوّد')+': '+connection.lastErrorCode);
          const tools=add(card,'div');tools.className='sx-retail-connector-actions';
          action(tools,t('Sync now','مزامنة الآن'),async()=>{
            const result=await api('/connectors/'+encodeURIComponent(connection.id)+'/sync','POST',{});
            await refreshConnections();
            return Object.entries(result.resources||{}).map(([name,value])=>name+': '+value.imported+(value.hasMore?' · '+t('more pages','صفحات أخرى'):'')+(value.errorCode?' · '+value.errorCode:'')).join(' | ')||t('No new data.','لا توجد بيانات جديدة.');
          },status);
          action(tools,t('Webhook setup','إعداد Webhook'),()=>showSetup(connection,setup),status);
          if(connection.provider==='woocommerce'){
            const reconciliation=add(card,'details');add(reconciliation,'summary',t('Read-only reconciliation','مطابقة للقراءة فقط'));
            const reportBody=add(reconciliation,'div');
            reconciliation.addEventListener('toggle',async()=>{
              if(!reconciliation.open||reconciliation.dataset.loaded)return;
              reconciliation.dataset.loaded='true';reportBody.replaceChildren();add(reportBody,'p',t('Loading reconciliation…','جارٍ تحميل المطابقة…'));
              try{
                const report=await api('/connectors/'+encodeURIComponent(connection.id)+'/reconciliation');reportBody.replaceChildren();
                const counts=report.scan?.sourceCounts||{};
                add(reportBody,'p',t('Imported records','السجلات المستوردة')+': '+report.importedCounts.products+' '+t('products','منتجات')+' · '+report.importedCounts.variations+' '+t('variations','متغيرات')+
                  ' · '+report.importedCounts.orders+' '+t('orders','طلبات')+' · '+report.importedCounts.customers+' '+t('customers','عملاء'));
                const mapping=report.productMappings||{};
                add(reportBody,'p',t('7Network inventory mappings','روابط مخزون 7Network')+': '+(mapping.mapped||0)+' '+t('mapped','مرتبط')+' · '+
                  (mapping.ignored||0)+' '+t('ignored','متجاهل')+' · '+(mapping.invalidTargets||0)+' '+t('invalid target','هدف غير صالح'));
                if(mapping.stock){
                  const stock=mapping.stock;
                  add(reportBody,'p',t('Read-only stock scope','نطاق المخزون للقراءة فقط')+': '+(stock.readyForReadOnlyComparison||0)+' '+
                    t('ready for location/unit comparison','جاهز لمقارنة الموقع والوحدة')+' · '+(stock.needsReview||0)+' '+t('need review','بحاجة إلى مراجعة'));
                  if(Number(stock.parentShared||0)>0)add(reportBody,'p',t('Some variable products share Woo stock at the parent level. They cannot be reconciled separately by variation.','تشترك بعض المنتجات ذات المتغيرات في مخزون Woo على مستوى المنتج الرئيسي ولا يمكن مطابقتها لكل متغير على حدة.')+' '+stock.parentShared);
                  if(Number(stock.managedQuantityUnavailable||0)>0||Number(stock.sourceStockSnapshotUnknown||0)>0)
                    add(reportBody,'p',t('Some mapped products need a fresh Woo product sync before stock review.','تحتاج بعض المنتجات المرتبطة إلى مزامنة Woo حديثة قبل مراجعة المخزون.')+
                      ' · '+Number(stock.managedQuantityUnavailable||0)+' '+t('managed quantity unavailable','كمية مُدارة غير متاحة')+' · '+Number(stock.sourceStockSnapshotUnknown||0)+' '+t('stock snapshot not captured','لقطة المخزون غير محفوظة'));
                  add(reportBody,'p',t('A verified scope only identifies the unit and location relationship. It does not prove the balances match or authorize stock write-back.','يحدد النطاق المتحقق منه علاقة الوحدة والموقع فقط. ولا يثبت تطابق الأرصدة أو يسمح بالكتابة إلى المخزون.'));
                }
                if(Number(mapping.invalidTargets||0)>0)add(reportBody,'p',t('One or more mappings point to a missing inventory product. Review these before accepting reconciliation.','يشير رابط واحد أو أكثر إلى منتج مخزون غير موجود. راجع الروابط قبل اعتماد المطابقة.'));
                add(reportBody,'p',t('SKU review','مراجعة SKU')+': '+report.skuAudit.missingProductSku+' '+t('products without SKU','منتجات بلا SKU')+' · '+
                  report.skuAudit.missingVariationSku+' '+t('variations without SKU','متغيرات بلا SKU')+' · '+report.skuAudit.duplicateSkuCount+' '+t('duplicate SKU values','قيم SKU مكررة'));
                for(const duplicate of report.skuAudit.duplicateSkus)add(reportBody,'p',t('Duplicate SKU','SKU مكرر')+': '+duplicate.sku+' · '+duplicate.count+' '+t('records','سجلات'));
                if(report.scan){
                  add(reportBody,'p',t('Last complete source scan','آخر فحص كامل للمصدر')+': '+report.scan.completedAt);
                  if(report.scan.queryScope)add(reportBody,'p',t('Woo API status scope: products, variations, and orders include all statuses the read key can access; customers include all API-visible records.','نطاق حالة Woo API: تشمل المنتجات والمتغيرات والطلبات كل الحالات التي يتيحها مفتاح القراءة، ويشمل العملاء كل السجلات المتاحة عبر API.'));
                  for(const resource of ['products','orders','customers']){
                    const source=counts[resource]||{};add(reportBody,'p',t(resource,resource)+' · '+t('Woo total','إجمالي Woo')+': '+(source.total??'—')+' · '+
                      t('scanned','تم فحصه')+': '+(source.scanned??'—')+' · '+t('imported now','موجود محلياً')+': '+report.importedCounts[resource]);
                  }
                  add(reportBody,'p',t('Woo variations listed by products','المتغيرات المسجلة في المنتجات')+': '+(report.scan.sourceVariationCount??'—')+' · '+
                    t('imported variations','المتغيرات المستوردة')+': '+report.importedCounts.variations);
                  if(report.scan.sourceVariationCount!=null&&report.scan.sourceVariationCount!==report.importedCounts.variations)
                    add(reportBody,'p',t('Woo variation count and imported active count differ. Review missing or deleted variations before accepting reconciliation.','يختلف عدد متغيرات Woo عن عدد المتغيرات النشطة المستوردة. راجع المتغيرات المفقودة أو المحذوفة قبل اعتماد المطابقة.'));
                  if(!report.scan.stableSourceCounts)add(reportBody,'p',t('Woo counts changed during this scan. Run another complete scan before accepting reconciliation.','تغيرت أعداد Woo أثناء الفحص. أعد فحصاً كاملاً قبل اعتماد المطابقة.'));
                  const local=new Map(report.localOrderAmounts.map(row=>[row.currency+'|'+row.status+'|'+row.financialStatus,row]));
                  const source=new Map(report.scan.sourceOrderAmounts.map(row=>[row.currency+'|'+row.status+'|'+row.financialStatus,row]));
                  const keys=new Set([...local.keys(),...source.keys()]);
                  for(const key of keys){const l=local.get(key)||{},s=source.get(key)||{};const panel=add(reportBody,'article');
                    add(panel,'strong',key.replaceAll('|',' · '));add(panel,'p',t('Woo scanned orders','طلبات Woo المفحوصة')+': '+(s.count??0)+' · '+t('Imported locally','المستورد محلياً')+': '+(l.count??0));
                    for(const [name,sourceValue,localValue] of [['total',s.total,l.total],['subtotal',s.subtotal,l.subtotal],['discount',s.discount,l.discount],['shipping',s.shipping,l.shipping],['tax',s.tax,l.tax],['fees',s.feeComplete===false?null:s.fee,l.fees],['refunds',s.refundComplete===false?null:s.refund,l.refunds]]){
                      if(sourceValue!=null||localValue!=null)add(panel,t(name,name)+': Woo '+(sourceValue??'—')+' · 7Network '+(localValue??'—'));
                    }
                  }
                }else add(reportBody,'p',t('A complete source scan is not available yet. Continue Sync now until products, variations, orders and customers finish.','لا يتوفر فحص كامل للمصدر بعد. تابع المزامنة حتى تنتهي المنتجات والمتغيرات والطلبات والعملاء.'));
                add(reportBody,'p',t('This report is read-only. WooCommerce remains the stock and order authority. No WordPress changes or customer messages are made.','هذا التقرير للقراءة فقط. يبقى WooCommerce المرجع للمخزون والطلبات. لا يتم تعديل WordPress أو إرسال رسائل للعملاء.'));
              }catch(error){reportBody.replaceChildren();add(reportBody,'p',t('Unable to load reconciliation.','تعذر تحميل المطابقة.'));showCode(status,error);}
            });
          }
          const nextStatus=connection.status==='active'?'paused':'active';
          if(['active','paused'].includes(connection.status))action(tools,t(connection.status==='active'?'Pause sync':'Resume sync',connection.status==='active'?'إيقاف المزامنة مؤقتاً':'استئناف المزامنة'),
            ()=>api('/connectors/'+encodeURIComponent(connection.id)+'/status','PUT',{status:nextStatus}),status,()=>refreshConnections());
          if(connection.status!=='revoked'){
            const disconnect=add(tools,'button',t('Disconnect store','قطع اتصال المتجر'));disconnect.type='button';
            disconnect.onclick=async()=>{if(!window.confirm(t('Disconnect this store? Imported records remain in Retail & Inventory.','هل تريد قطع اتصال هذا المتجر؟ ستبقى السجلات المستوردة في التجزئة والمخزون.')))return;
              disconnect.disabled=true;try{await api('/connectors/'+encodeURIComponent(connection.id),'DELETE',{});status.textContent=t('Store disconnected. Imported records were retained.','تم قطع اتصال المتجر. تم الاحتفاظ بالسجلات المستوردة.');await refreshConnections();}catch(error){showCode(status,error);disconnect.disabled=false;}};
          }
          if(connection.status==='revoked'){
            const erase=add(tools,'button',t('Erase imported data','حذف البيانات المستوردة'));erase.type='button';
            erase.onclick=async()=>{const confirmation=window.prompt(t('This permanently erases imported orders, payment/refund evidence, customers, products, checkouts, privacy requests and webhook logs. Type the exact store domain to continue:','سيحذف هذا نهائياً الطلبات وسجلات الدفع والاسترداد والعملاء والمنتجات والسلات وطلبات الخصوصية وسجلات Webhook. اكتب نطاق المتجر كما هو للمتابعة:'));
              if(confirmation!==connection.storeDomain)return;erase.disabled=true;try{await api('/connectors/'+encodeURIComponent(connection.id)+'/erase-imported-data','POST',{confirmStoreDomain:confirmation});status.textContent=t('Imported store data erased. Connection metadata and audit record remain.','تم حذف بيانات المتجر المستوردة. بقيت بيانات الاتصال وسجل التدقيق.');await refreshConnections();}catch(error){showCode(status,error);erase.disabled=false;}};
          }
          const setup=add(card,'div');
          for(const [kind,label] of [['orders',t('Orders & payments','الطلبات والمدفوعات')],['customers',t('Customers','العملاء')],['products',t('Products','المنتجات')],['checkouts',t('Abandoned checkouts','السلات المتروكة')]]){
            const section=add(card,'details');const summary=add(section,'summary',label);summary.tabIndex=0;
            const holder=add(section,'div');section.addEventListener('toggle',()=>{if(section.open&&!holder.dataset.loaded){holder.dataset.loaded='true';loadItems(connection,kind,holder);}});
          }
          const privacy=add(card,'details');add(privacy,'summary',t('Privacy request handling','معالجة طلبات الخصوصية'));
          const privacyBody=add(privacy,'div');privacy.addEventListener('toggle',()=>{if(privacy.open&&!privacy.dataset.loaded){privacy.dataset.loaded='true';showPrivacy(connection,privacyBody);}});
        }
      }catch(error){add(connectionsRoot,'p',t('Unable to load connected stores.','تعذر تحميل المتاجر المتصلة.'));showCode(status,error);}
    }
    if(new URLSearchParams(location.search).has('connected'))status.textContent=t('Store connected. Import data with Sync now.','تم ربط المتجر. استورد البيانات باختيار مزامنة الآن.');
    if(new URLSearchParams(location.search).has('connectionError'))showCode(status,{message:new URLSearchParams(location.search).get('connectionError')});
    await refreshConnections();
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
    if(!document.querySelector('[data-retail-workspace-css]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/retail-workspace.css?v=20261117-woo-stock-scope1';css.dataset.retailWorkspaceCss='';document.head.append(css);}
    new MutationObserver(syncTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-sx-theme']});
    window.addEventListener('storage',syncTheme);
    add(root,'h1',page[2]);
    const status=add(root,'p',t('Loading…','جار التحميل…'));status.setAttribute('role','status');
    try {
      if(active==='retail-finance')return await finance(root,status);
      else if(active==='retail-connected-stores')await connectedStores(root,status);
      else {
        await orders(root,status,active==='retail-deliveries',access.role==='owner'&&access.permissions['leads.manage']);
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
