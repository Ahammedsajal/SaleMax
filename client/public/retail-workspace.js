(() => {
  if (!/^\/(user|agent)\/?$/.test(location.pathname)) return;
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
  async function configure(root,status){
    const {store,products,photos,variants,locations,notifications}=await api('/store');
    const section=add(root,'section');
    add(section,'h2',t('Storefront settings','إعدادات واجهة المتجر'));
    const slug=input(section,t('Store link name','اسم رابط المتجر'),store?.slug);
    const title=input(section,t('Store name','اسم المتجر'),store?.title);
    const about=add(add(section,'label',t('About','عن المتجر')+' '),'textarea');about.value=store?.about||'';
    const contact=input(section,t('Public contact','بيانات التواصل العامة'),store?.contact);
    const fee=input(section,t('Delivery fee (QAR). Leave empty for pickup only.','رسوم التوصيل بالريال. اتركها فارغة للاستلام فقط.'),store?.deliveryFee==null?'':store.deliveryFee/100,'number');
    fee.min=0;fee.step=0.01;
    const zones=add(add(section,'label',t('Delivery zones, one per line: name | QAR','مناطق التوصيل، منطقة لكل سطر: الاسم | الرسوم')),'textarea');
    zones.value=(store?.deliveryZones||[]).map(zone=>zone.name+' | '+zone.feeMinor/100).join('\n');
    const enabled=input(section,t('Enable public storefront','تفعيل واجهة المتجر العامة'),'','checkbox');enabled.checked=Boolean(store?.enabled);
    if(store?.enabled){
      const link=add(section,'a',t('Open storefront','افتح المتجر'));link.href='/business/'+encodeURIComponent(store.slug)+'/shop';
      action(section,t('Copy link','نسخ الرابط'),()=>navigator.clipboard.writeText(link.href),status);
    }
    const locationHelp=add(section,'p',t('Products keep their own SKU, price and stock. Create and manage stock locations in Inventory.','يحتفظ كل منتج برمزه وسعره ومخزونه. أنشئ مواقع المخزون وأدرها من صفحة المخزون.' )+' ');
    const inventoryLink=add(locationHelp,'a',t('Manage locations','إدارة المواقع'));inventoryLink.href='/user?page=business-inventory';
    action(section,t('Save storefront','حفظ المتجر'),()=>api('/store','PUT',{
      slug:slug.value,title:title.value,about:about.value,contact:contact.value,enabled:enabled.checked,
      deliveryFee:fee.value===''?null:Math.round(fee.valueAsNumber*100),
      deliveryZones:zones.value.split('\n').filter(line=>line.trim()).map(line=>{
        const [name,amount,...extra]=line.split('|');
        return {name:name.trim(),feeMinor:amount?.trim()&&!extra.length?Math.round(Number(amount)*100):null};
      })
    }),status,()=>location.reload());
    const alertSettings=add(section,'details');add(alertSettings,'summary',t('Order notifications','إشعارات الطلبات'));
    const orderAlerts=input(alertSettings,t('Send order alerts to owners and managers','إرسال إشعارات الطلبات إلى المالكين والمديرين'),'','checkbox');
    orderAlerts.checked=Boolean(notifications?.retailOrdersEnabled);
    add(alertSettings,'p',t('Uses the business WhatsApp sender already configured for 7Network. Alerts contain an order reference and status, not buyer contact or address.','يستخدم مرسل واتساب التجاري المُعدّ مسبقاً في 7Network. تتضمن الإشعارات مرجع الطلب وحالته دون بيانات اتصال المشتري أو عنوانه.'));
    const customerUpdates=input(alertSettings,t('Customer WhatsApp updates (only customers who opt in; no marketing)','تحديثات واتساب للعملاء (لمن يوافق فقط؛ بلا تسويق)'),'','checkbox');
    customerUpdates.checked=Boolean(notifications?.retailCustomerUpdatesEnabled);
    add(alertSettings,'p',t('A customer update is sent only when this business switch and that customer’s separate order-only consent are both on.','لا يُرسل تحديث للعميل إلا عند تفعيل هذا الخيار وموافقة العميل المنفصلة على تحديثات الطلب فقط.'));
    action(alertSettings,t('Save notification settings','حفظ إعدادات الإشعارات'),()=>api('/notifications','PUT',{
      retailOrdersEnabled:orderAlerts.checked,retailCustomerUpdatesEnabled:customerUpdates.checked}),status);
    add(section,'h3',t('Products selected for the public store','المنتجات المختارة للمتجر العام'));
    for(const product of products){
      const row=add(section,'article');
      add(row,'strong',t(product.nameEn,product.nameAr)||product.nameEn);
      const category=input(row,t('Store category','فئة المتجر'),product.category||'');
      const image=add(add(row,'label',t('Public product photo','صورة المنتج العامة')+' '),'select');
      add(image,'option',t('No public photo','بدون صورة عامة')).value='';
      for(const photo of photos.filter(item=>item.productId===product.id))add(image,'option',photo.name).value=photo.id;
      image.value=product.photoId||'';
      const publish=input(row,t('Publish this product','نشر هذا المنتج'),'','checkbox');publish.checked=Boolean(product.published);
      action(row,t('Save listing','حفظ عرض المنتج'),()=>api('/listings/'+product.id,'PUT',{category:category.value,published:publish.checked,photoId:image.value||null}),status);
    }
    const variantSection=add(section,'details');add(variantSection,'summary',t('Product variants','خيارات المنتج'));
    add(variantSection,'p',t('Each variant is an existing product with its own SKU, price, photo and stock. Group published products here to offer a selector in the public shop.','كل خيار هو منتج موجود له رمز وسعر وصورة ومخزون مستقل. اجمع المنتجات المنشورة هنا لعرض قائمة خيارات في المتجر العام.'));
    const groupPicker=add(add(variantSection,'label',t('Variant group','مجموعة الخيارات')+' '),'select');
    add(groupPicker,'option',t('Create a new group','إنشاء مجموعة جديدة')).value='';
    for(const group of variants||[])add(groupPicker,t(group.titleEn,group.titleAr)||group.titleEn).value=group.id;
    const titleEn=input(variantSection,t('Product name in English','اسم المنتج بالإنجليزية'));
    const titleAr=input(variantSection,t('Product name in Arabic','اسم المنتج بالعربية'));titleAr.dir='auto';
    const labelEn=input(variantSection,t('Option label in English','اسم الخيار بالإنجليزية'));
    const labelAr=input(variantSection,t('Option label in Arabic','اسم الخيار بالعربية'));labelAr.dir='auto';
    const picker=add(add(variantSection,'label',t('Published products (select at least two)','المنتجات المنشورة (اختر منتجين على الأقل)')+' '),'select');
    picker.multiple=true;picker.size=8;
    const valuesArea=add(variantSection,'div');
    const valueFields=new Map();
    function saveCurrentValues(){for(const [id,fields] of valueFields)valueFields.set(id,{valueEn:fields.en.value,valueAr:fields.ar.value});}
    function populateProductOptions(group){
      saveCurrentValues();picker.replaceChildren();valueFields.clear();
      const occupied=new Set((variants||[]).filter(item=>item.id!==group?.id).flatMap(item=>item.products.map(value=>value.id)));
      const available=products.filter(product=>product.status==='active'&&product.published&&!occupied.has(product.id));
      for(const product of available){const option=add(picker,'option',(t(product.nameEn,product.nameAr)||product.nameEn)+' · '+product.code);option.value=product.id;}
      const values=new Map((group?.products||[]).map(item=>[item.id,item]));
      for(const option of picker.options)option.selected=values.has(option.value);
      titleEn.value=group?.titleEn||'';titleAr.value=group?.titleAr||'';
      labelEn.value=group?.optionLabelEn||'';labelAr.value=group?.optionLabelAr||'';
      populateValueFields(values);
    }
    function populateValueFields(existing=new Map()){
      saveCurrentValues();valuesArea.replaceChildren();valueFields.clear();
      for(const option of picker.selectedOptions){
        const product=products.find(item=>item.id===option.value),prior=existing.get(option.value)||valueFields.get(option.value)||{};
        const row=add(valuesArea,'section');add(row,'strong',(t(product?.nameEn,product?.nameAr)||product?.nameEn||option.value)+' · '+(product?.code||''));
        const en=input(row,t('Option value in English','قيمة الخيار بالإنجليزية'),prior.valueEn??prior.en?.value??'');en.required=true;en.maxLength=100;
        const arInput=input(row,t('Option value in Arabic','قيمة الخيار بالعربية'),prior.valueAr??prior.ar?.value??'');arInput.dir='auto';arInput.maxLength=100;
        valueFields.set(option.value,{en,ar:arInput});
      }
    }
    groupPicker.onchange=()=>populateProductOptions((variants||[]).find(item=>item.id===groupPicker.value)||null);
    picker.onchange=()=>populateValueFields(new Map(valueFields));
    populateProductOptions(null);
    action(variantSection,t('Save variant group','حفظ مجموعة الخيارات'),async()=>{
      saveCurrentValues();
      const chosen=[...picker.selectedOptions];if(chosen.length<2)throw Error('INVALID_VARIANTS');
      const members=chosen.map(option=>{const fields=valueFields.get(option.value);return {id:option.value,valueEn:fields?.valueEn||fields?.en?.value||'',valueAr:fields?.valueAr||fields?.ar?.value||''};});
      if(members.some(item=>!item.valueEn.trim())||new Set(members.map(item=>item.valueEn.trim().toLowerCase())).size!==members.length)throw Error('INVALID_VARIANTS');
      return api('/variants','POST',{id:groupPicker.value||undefined,titleEn:titleEn.value,titleAr:titleAr.value,optionLabelEn:labelEn.value,optionLabelAr:labelAr.value,products:members});
    },status,()=>location.reload());
    for(const group of variants||[])action(variantSection,t('Remove group: ','إزالة المجموعة: ')+group.titleEn,()=>api('/variants/'+group.id,'DELETE'),status,()=>location.reload());
  }
  async function orders(root,status,driver,canLinkLead){
    const base=driver?'/deliveries':'/orders';
    const [rows,drivers]=await Promise.all([api(base),driver?[]:api('/drivers')]);
    if(!rows.length)add(root,'p',t('No orders yet.','لا توجد طلبات.'));
    for(const order of rows){
      const card=add(root,'article');
      const heading=add(card,'h3');add(heading,'bdi',order.id).dir='ltr';add(heading,'span',' · '+labels[order.status]);
      const buyer=add(card,'p');add(buyer,'span',order.buyerName+' · ');add(buyer,'bdi',order.buyerPhone).dir='ltr';
      add(card,'p',money(order.totalMinor)+' · '+(order.fulfillment==='delivery'?t('Delivery','توصيل'):t('Pickup','استلام')));
      if(order.locationNameEn)add(card,'p',t('Location: ','الموقع: ')+(t(order.locationNameEn,order.locationNameAr)||order.locationNameEn));
      if(order.fulfillment==='delivery'){
        add(card,'p',t('Delivery status: ','حالة التوصيل: ')+(deliveryLabels[order.deliveryState]||deliveryLabels.unassigned));
        if(order.deliveryState==='failed')add(card,'p',t('Last issue: ','آخر مشكلة: ')+(failureLabels[order.lastDeliveryFailureReason]||t('Not specified','غير محدد'))+' · '+t('Attempts: ','المحاولات: ')+order.deliveryAttemptCount);
      }
      for(const item of order.lines)add(card,'p',(t(item.nameEn,item.nameAr)||item.nameEn)+(item.variantValueEn?' · '+t(item.variantValueEn,item.variantValueAr):'')+' × '+item.quantity);
      if(order.cashReceived)add(card,'p',t('Cash collected','تم تحصيل النقد'));
      if(driver&&order.fulfillment==='delivery'&&order.status==='dispatched'&&order.deliveryState==='in_transit'&&order.deliveryProofRequired&&!order.proofVerified){
        const code=input(card,t('Buyer handoff code','رمز استلام العميل'));
        code.inputMode='numeric';code.autocomplete='one-time-code';code.maxLength=6;code.pattern='[0-9]{6}';
        action(card,t('Verify handoff','تحقق من رمز الاستلام'),async()=>{
          if(!/^\d{6}$/.test(code.value))throw Error('INVALID_DELIVERY_PROOF');
          const result=await api('/deliveries/'+order.id+'/proof','POST',{requestId:crypto.randomUUID(),code:code.value});
          return {verified:result.verified,message:result.verified?t('Handoff verified. Cash collection is now available.','تم التحقق من الاستلام. أصبح تسجيل تحصيل النقد متاحاً.'):
            t('Code did not match. Check with the customer and try again.','الرمز غير صحيح. تحقق مع العميل وحاول مرة أخرى.'),refresh:result.verified};
        },status,()=>location.reload());
      }
      if(driver&&order.fulfillment==='delivery'&&order.status==='dispatched'&&order.deliveryState==='in_transit'){
        const reason=add(add(card,'label',t('Delivery issue','مشكلة في التوصيل')+' '),'select');
        for(const [value,label] of Object.entries(failureLabels))add(reason,label).value=value;
        action(card,t('Report delivery failure','الإبلاغ عن تعذر التسليم'),()=>api('/deliveries/'+order.id+'/failed','POST',{requestId:crypto.randomUUID(),reason:reason.value}),status,()=>location.reload());
      }
      if(driver&&order.fulfillment==='delivery'&&order.status==='dispatched'&&order.deliveryState==='failed'){
        action(card,t('Retry delivery','إعادة محاولة التوصيل'),()=>api('/deliveries/'+order.id+'/retry','POST',{requestId:crypto.randomUUID()}),status,()=>location.reload());
      }
      const canCollect=!order.cashReceived&&((order.fulfillment==='delivery'&&order.status==='dispatched'&&(!order.deliveryProofRequired||order.proofVerified))||(order.fulfillment==='pickup'&&order.status==='ready'));
      if(canCollect){
        action(card,t('Record full cash collected','تسجيل تحصيل المبلغ نقداً'),async()=>{
          if(!window.confirm(t('Confirm that the full amount was collected: ','تأكيد تحصيل كامل المبلغ: ')+money(order.totalMinor)))return;
          const base=driver?'/deliveries':'/orders';
          await api(base+'/'+order.id+'/cash-received','POST',{requestId:crypto.randomUUID(),amountMinor:Number(order.totalMinor)});
        },status,()=>location.reload());
      }
      if(canLinkLead){
        if(order.leadId)add(card,'p',t('Linked to Lead Pipeline','مرتبط بمسار العملاء المحتملين'));
        else action(card,t('Add to Lead Pipeline','إضافة إلى مسار العملاء المحتملين'),()=>api('/orders/'+order.id+'/lead','POST',{}),status,()=>location.reload());
      }
      if(!driver&&['completed','partially_returned'].includes(order.status)){
        const details=add(card,'details');add(details,'summary',t('Record returned items','تسجيل المنتجات المرتجعة'));
        const reason=input(details,t('Return reason','سبب الإرجاع'));
        const restock=input(details,t('Restock after inspection','إعادة للمخزون بعد الفحص'),'','checkbox');
        const qtyFields=[];
        for(const line of order.lines.filter(item=>item.returnableQuantity>0)){
          const quantity=input(details,(t(line.nameEn,line.nameAr)||line.nameEn)+' · '+t('Return quantity (up to ','الكمية المرتجعة (بحد أقصى ')+line.returnableQuantity+')','','number');
          quantity.min=0;quantity.max=line.returnableQuantity;quantity.step=1;quantity.value=0;
          qtyFields.push({id:line.id,quantity});
        }
        action(details,t('Save return','حفظ الإرجاع'),()=>{
          const lines=qtyFields.filter(item=>item.quantity.valueAsNumber>0).map(item=>({id:item.id,quantity:item.quantity.valueAsNumber}));
          if(!lines.length||!reason.value.trim())throw Error('INVALID_RETURN');
          return api('/orders/'+order.id+'/returns','POST',{requestId:crypto.randomUUID(),reason:reason.value,restock:restock.checked,lines});
        },status,()=>location.reload());
      }
      if(order.deliveryAddress){
        add(card,'p',[order.deliveryZone,order.deliveryAddress].filter(Boolean).join(' · '));
        const mapLinks=add(card,'div');mapLinks.className='sx-retail-map-links';
        const map=add(mapLinks,'a','Google Maps');map.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(order.deliveryPin||order.deliveryAddress);
        map.target='_blank';map.rel='noopener noreferrer';
        const waze=add(mapLinks,'a','Waze');waze.href='https://www.waze.com/ul?'+(order.deliveryPin?'ll='+encodeURIComponent(order.deliveryPin):'q='+encodeURIComponent(order.deliveryAddress))+'&navigate=yes';
        waze.target='_blank';waze.rel='noopener noreferrer';
      }
      if(!driver&&order.fulfillment==='delivery'&&(['placed','ready'].includes(order.status)||(order.status==='dispatched'&&order.deliveryState==='failed'))){
        const select=add(add(card,'label',t('Assigned driver','السائق المعيّن')+' '),'select');
        add(select,'option',t('Select a driver','اختر سائقاً')).value='';
        for(const member of drivers)add(select,'option',member.name).value=member.id;
        select.value=order.driverId||'';
        action(card,t('Assign','تعيين'),()=>api('/orders/'+order.id+'/driver','PUT',{driverId:select.value}),status,()=>location.reload());
      }
      const options=order.status==='placed'&&!driver?['ready','cancelled']:
        order.status==='ready'?order.fulfillment==='delivery'?[...(order.driverId?['dispatched']:[]),...(!driver?['cancelled']:[])]:!driver?[...(order.cashReceived?['completed']:[]),...(!order.cashReceived?['cancelled']:[])]:[]:
        order.status==='dispatched'?(order.cashReceived?['completed']:[]):order.status==='completed'&&!driver?['returned']:order.status==='partially_returned'&&!driver?['returned']:[];
      for(const next of options)action(card,labels[next],()=>{
        if(next==='returned'&&!window.confirm(t('Return all remaining items to stock? Inspect items before restocking. Refunds are recorded separately.','إرجاع كل المنتجات المتبقية للمخزون؟ افحص المنتجات قبل إعادتها. يتم تسجيل المبالغ المستردة بشكل منفصل.')))return;
        return api(base+'/'+order.id+'/status','POST',{status:next});
      },status,()=>location.reload());
    }
  }
  async function finance(root,status){
    const data=await api('/finance');
    add(root,'p',t('Record each driver handover against completed cash on delivery orders. A mismatch stays open for review. This does not transfer or refund money.','سجّل تسليم كل سائق مقابل طلبات الدفع النقدي المكتملة. يبقى أي فرق مفتوحاً للمراجعة. لا ينفذ هذا تحويل الأموال أو ردها.'));
    if(!data.drivers.length)add(root,'p',t('No driver cash is waiting for reconciliation.','لا توجد مبالغ نقدية من السائقين بانتظار التسوية.'));
    for(const driverRow of data.drivers){
      const selected=driverRow.orders.slice(0,100);
      const batchExpected=selected.reduce((sum,order)=>sum+order.amountMinor,0);
      const section=add(root,'section');add(section,'h2',driverRow.name+' · '+money(batchExpected));
      for(const order of selected){const detail=add(section,'p');add(detail,'bdi',order.id).dir='ltr';add(detail,'span',' · '+money(order.amountMinor));}
      if(driverRow.hasMore)add(section,'p',t('This batch covers 100 open orders. Reconcile it, then review the next batch.','تشمل هذه الدفعة 100 طلب مفتوح. سوِّها ثم راجع الدفعة التالية.'));
      const counted=input(section,t('Cash handed over (QAR)','النقد المسلّم (ريال)'),(batchExpected/100).toFixed(2),'number');
      counted.min=0;counted.step=0.01;
      action(section,t('Record handover','تسجيل التسليم'),async()=>{
        const result=await api('/finance/settlements','POST',{requestId:crypto.randomUUID(),driverId:driverRow.id,orderIds:selected.map(order=>order.id),countedMinor:Math.round(counted.valueAsNumber*100)});
        return result.status==='matched'?t('Handover matched and recorded.','تمت مطابقة التسليم وتسجيله.'):t('Difference recorded for review. The orders remain open.','تم تسجيل الفرق للمراجعة. ما زالت الطلبات مفتوحة.');
      },status,()=>location.reload());
    }
    add(root,'h2',t('Recent handovers','عمليات التسليم الأخيرة'));
    if(!data.settlements.length)add(root,'p',t('No handovers recorded yet.','لم يتم تسجيل عمليات تسليم بعد.'));
    for(const settlement of data.settlements){
      const row=add(root,'article');
      add(row,'strong',settlement.driverName+' · '+t(settlement.status==='matched'?'Matched':'Difference',settlement.status==='matched'?'مطابق':'فرق'));
      add(row,'p',t('Expected','المتوقع')+' '+money(settlement.expectedMinor)+' · '+t('Counted','المعدود')+' '+money(settlement.countedMinor));
    }
    const exportSection=add(root,'section');add(exportSection,'h2',t('Accounting source export','تصدير بيانات المحاسبة'));
    add(exportSection,'p',t('Download cash receipts and returned item values for a date range. This file contains operational source data; it does not post a journal, map tax or accounts, or represent refunds paid. Connect a provider only after its account and refund mappings are reviewed.','نزّل إيصالات النقد وقيم المنتجات المرتجعة ضمن فترة محددة. يحتوي الملف على بيانات تشغيلية ولا ينشئ قيوداً محاسبية أو يحدد الحسابات والضرائب ولا يمثل مبالغ مستردة مدفوعة. اربط مزوداً بعد مراجعة الحسابات والمرتجعات.'));
    const from=input(exportSection,t('From (UTC)','من (UTC)'),new Date(Date.now()-new Date().getUTCDate()*86400000+86400000).toISOString().slice(0,10),'date');
    const to=input(exportSection,t('To (UTC)','إلى (UTC)'),new Date().toISOString().slice(0,10),'date');
    action(exportSection,t('Download CSV','تنزيل CSV'),async()=>{
      const query=new URLSearchParams({from:from.value,to:to.value});
      const headers=await window.SaleMaxWorkspace.headers(false,false);
      const response=await fetch('/api/workspace/retail/finance/accounting-export.csv?'+query,{credentials:'same-origin',cache:'no-store',headers});
      if(!response.ok)throw Error('ACCOUNTING_EXPORT_FAILED');
      const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download=`7network-retail-source-${from.value}-${to.value}.csv`;anchor.click();URL.revokeObjectURL(url);
      return t('Operational CSV downloaded.','تم تنزيل ملف CSV التشغيلي.');
    },status);
  }
  function showCode(status,error){status.textContent=t('Could not complete this action.','تعذر إكمال هذا الإجراء.')+(error?.message?' '+String(error.message).replace(/[^A-Z0-9_ -]/gi,'').slice(0,64):'');}
  async function connectedStores(root,status){
    const intro=add(root,'p',t('Connect your existing Shopify or WooCommerce store. Imported data stays in this business workspace; it does not change 7Network stock, fulfilment, accounting or customer messages.','اربط متجرك الحالي على Shopify أو WooCommerce. تبقى البيانات المستوردة في مساحة العمل هذه ولا تغيّر مخزون 7Network أو التنفيذ أو المحاسبة أو رسائل العملاء.'));
    const shopify=add(root,'section');add(shopify,'h2',t('Shopify','Shopify'));
    add(shopify,'p',t('Connect through Shopify authorization. The app requests read-only product, order and customer access. Orders cover the last 60 days by default; the optional older-order scope can be enabled only after Shopify approves it. Customer names and contact details also require protected customer data access. The authorizing Shopify staff account must also be allowed to view abandoned checkouts.','يتم الربط عبر تفويض Shopify. يطلب التطبيق قراءة المنتجات والطلبات والعملاء فقط. تشمل الطلبات آخر 60 يوماً افتراضياً؛ ولا يمكن تفعيل نطاق الطلبات الأقدم الاختياري إلا بعد موافقة Shopify. كما تتطلب أسماء العملاء وبيانات التواصل موافقة الوصول إلى بيانات العملاء المحمية. ويجب أن يملك حساب موظف Shopify المفوّض صلاحية عرض السلات المتروكة.'));
    const shopName=input(shopify,t('Shopify store domain','نطاق متجر Shopify'));
    shopName.autocomplete='url';shopName.placeholder='example.myshopify.com';shopName.setAttribute('aria-label',t('Shopify store domain','نطاق متجر Shopify'));
    const shopCurrency=input(shopify,t('Primary store currency (ISO 4217)','العملة الأساسية للمتجر (ISO 4217)'),'QAR');shopCurrency.maxLength=3;shopCurrency.autocomplete='off';
    const connectShopify=add(shopify,'button',t('Connect Shopify','ربط Shopify'));connectShopify.type='button';
    connectShopify.onclick=async()=>{connectShopify.disabled=true;try{const result=await api('/connectors/shopify/start','POST',{shop:shopName.value,currency:shopCurrency.value.toUpperCase()});location.assign(result.authorizationUrl);}catch(error){showCode(status,error);connectShopify.disabled=false;}};

    const woo=add(root,'section');add(woo,'h2',t('WooCommerce','WooCommerce'));
    add(woo,'p',t('Create a dedicated read-only WooCommerce REST API key over HTTPS. Checkout abandonment capture uses the optional 7Network plugin; standard WooCommerce webhooks keep orders, customers and products current.','أنشئ مفتاح REST API مخصصاً للقراءة فقط في WooCommerce عبر HTTPS. يستخدم التقاط السلات المتروكة إضافة 7Network الاختيارية؛ وتبقي Webhooks القياسية الطلبات والعملاء والمنتجات محدثة.'));
    const wooUrl=input(woo,t('Store URL','رابط المتجر'));wooUrl.placeholder='https://shop.example.com';wooUrl.autocomplete='url';
    const wooDisplay=input(woo,t('Display name','اسم العرض'));
    const wooCurrency=input(woo,t('Store currency (ISO 4217)','عملة المتجر (ISO 4217)'),'QAR');wooCurrency.maxLength=3;wooCurrency.autocomplete='off';
    const wooKey=input(woo,t('Consumer key (read only)','مفتاح المستهلك (قراءة فقط)'),'','password');wooKey.autocomplete='new-password';
    const wooSecret=input(woo,t('Consumer secret','السر الخاص بالمستهلك'),'','password');wooSecret.autocomplete='new-password';
    const connectWoo=add(woo,'button',t('Connect WooCommerce','ربط WooCommerce'));connectWoo.type='button';
    const oneTime=add(woo,'div');oneTime.className='sx-retail-one-time-secret';oneTime.hidden=true;
    connectWoo.onclick=async()=>{connectWoo.disabled=true;try{
      const result=await api('/connectors/woocommerce','POST',{storeUrl:wooUrl.value,displayName:wooDisplay.value,currency:wooCurrency.value.toUpperCase(),consumerKey:wooKey.value,consumerSecret:wooSecret.value});
      wooKey.value='';wooSecret.value='';oneTime.replaceChildren();add(oneTime,'h3',t('Save this webhook secret now','احفظ سر Webhook الآن'));
      add(oneTime,'p',t('Use it for the WooCommerce order/customer/product webhooks and the abandoned-checkout plugin. You can reveal it later from the setup panel, and the value is never saved in this browser.','استخدمه مع Webhooks الطلبات والعملاء والمنتجات وإضافة السلات المتروكة. يمكنك إظهاره لاحقاً من إعدادات الربط، ولا يُحفظ في المتصفح.'));
      const secretArea=add(add(oneTime,'label',t('Webhook secret','سر Webhook')+' '),'textarea');secretArea.readOnly=true;secretArea.value=result.webhookSecret;secretArea.rows=3;
      oneTime.hidden=false;status.textContent=t('WooCommerce connected. Set up its signed webhooks next.','تم ربط WooCommerce. أعدّ Webhooks الموقعة الآن.');await refreshConnections();
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
            for(const line of item.lineItems)add(card,'p',(line.quantity||0)+' × '+(line.name||t('Item','عنصر'))+(line.sku?' · '+line.sku:''));
            if(item.lineItemsTruncated||item.transactionsTruncated)add(card,'p',t('Some line items or payment transactions need a full-detail import.','تحتاج بعض المنتجات أو معاملات الدفع إلى استيراد التفاصيل الكاملة.'));
            for(const transaction of item.transactions||[])add(card,'p',t('Payment record','سجل دفع')+': '+transaction.kind+' · '+transaction.status+' · '+transaction.currency+' '+transaction.amount+(transaction.gateway?' · '+transaction.gateway:''));
            add(card,'p',t('Payment records are source evidence only; 7Network has not verified settlement or posted accounting.','سجلات الدفع أدلة من المصدر فقط؛ لم يتحقق 7Network من التسوية ولم يسجل قيوداً محاسبية.'));
          }else if(kind==='customers'){
            add(card,'strong',item.name||t('Customer','عميل'));add(card,'p',[item.email,item.phone].filter(Boolean).join(' · ')||t('No contact details supplied by the store.','لم يرسل المتجر بيانات تواصل.'));
            add(card,'p',t('Marketing consent from the provider','موافقة التسويق من المزوّد')+': '+item.marketingConsent);
          }else if(kind==='products'){
            if(item.imageUrl){const image=document.createElement('img');image.className='sx-retail-product-image';image.src=item.imageUrl;image.alt=item.title||t('Product image','صورة المنتج');image.loading='lazy';image.referrerPolicy='no-referrer';card.appendChild(image);}
            add(card,'strong',item.title);add(card,'p',(item.sku||'—')+' · '+item.status+' · '+item.currency+' '+item.price);
            for(const variant of item.variants||[])add(card,'p',(variant.title||t('Variant','متغير'))+' · '+(variant.sku||'—')+(variant.price?' · '+item.currency+' '+variant.price:''));
            if(item.variantsTruncated)add(card,'p',t('Some product variants need a full-detail import.','تحتاج بعض متغيرات المنتج إلى استيراد التفاصيل الكاملة.'));
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
        if(connection.provider==='woocommerce')add(area,'p',t('In WooCommerce, create active webhooks for the listed topics. Install the downloaded plugin ZIP in WordPress and activate it; then put the signed endpoint and secret into its settings for checkout events. Import remains read only. The plugin supports classic checkout, not Checkout Blocks.','في WooCommerce، أنشئ Webhooks نشطة للموضوعات المذكورة. ثبّت ملف ZIP الذي تم تنزيله في WordPress وفعّله، ثم ضع نقطة الاتصال الموقعة والسر في إعداداته لأحداث السلة. يبقى الاستيراد للقراءة فقط. تدعم الإضافة صفحة الدفع الكلاسيكية ولا تدعم Checkout Blocks.'));
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
          add(card,'p',t('Imported','مستورد')+': '+connection.counts.orders+' '+t('orders','طلبات')+' · '+connection.counts.customers+' '+t('customers','عملاء')+' · '+connection.counts.products+' '+t('products','منتجات')+' · '+connection.counts.checkouts+' '+t('checkouts','سلات'));
          if(connection.lastSyncAt)add(card,'p',t('Last sync','آخر مزامنة')+': '+connection.lastSyncAt);
          if(connection.lastErrorCode)add(card,'p',t('Provider status','حالة المزوّد')+': '+connection.lastErrorCode);
          const tools=add(card,'div');tools.className='sx-retail-connector-actions';
          action(tools,t('Sync now','مزامنة الآن'),async()=>{
            const result=await api('/connectors/'+encodeURIComponent(connection.id)+'/sync','POST',{});
            await refreshConnections();
            return Object.entries(result.resources||{}).map(([name,value])=>name+': '+value.imported+(value.hasMore?' · '+t('more pages','صفحات أخرى'):'')+(value.errorCode?' · '+value.errorCode:'')).join(' | ')||t('No new data.','لا توجد بيانات جديدة.');
          },status);
          action(tools,t('Webhook setup','إعداد Webhook'),()=>showSetup(connection,setup),status);
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
      const anchor=document.querySelector('[data-sx-stock-nav], [data-sx-course-nav]')||
        [...document.querySelectorAll('li')].find(row=>['Dashboard','لوحة التحكم'].includes(row.textContent.trim()));
      if(!anchor)return;
      for(const [key,,title] of allowed){
        if(anchor.parentElement.querySelector('[data-retail-nav="'+key+'"]'))continue;
        const row=document.createElement('li');row.dataset.retailNav=key;anchor.after(row);
        const link=add(row,'a',title);link.href=location.pathname+'?page='+key;
        if(active===key)link.setAttribute('aria-current','page');
      }
    };
    new MutationObserver(nav).observe(document.body,{childList:true,subtree:true});
    nav();
    const page=allowed.find(([key])=>key===active);
    if(!page)return;
    const root=add(document.body,'main');root.id='sx-retail-workspace';
    root.className='sx-retail-workspace';
    root.dir=t('ltr','rtl');
    syncTheme();
    if(!document.querySelector('[data-retail-workspace-css]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/retail-workspace.css?v=20261106-shopify-woo-images3';css.dataset.retailWorkspaceCss='';document.head.append(css);}
    new MutationObserver(syncTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-sx-theme']});
    window.addEventListener('storage',syncTheme);
    add(root,'h1',page[2]);
    const status=add(root,'p',t('Loading…','جار التحميل…'));status.setAttribute('role','status');
    try {
      if(active==='retail-finance')await finance(root,status);
      else if(active==='retail-connected-stores')await connectedStores(root,status);
      else {
        await orders(root,status,active==='retail-deliveries',access.role==='owner'&&access.permissions['leads.manage']);
        if(access.permissions['retail.configure']&&active==='retail-orders')await configure(root,status);
      }
      status.textContent='';
    } catch {status.textContent=t('Unable to load this workspace.','تعذر تحميل مساحة العمل.');}
  }
  function boot(){if(window.SaleMaxWorkspace)start().catch(()=>{});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
