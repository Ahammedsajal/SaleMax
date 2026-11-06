(() => {
  if (!/^\/(user|agent)\/?$/.test(location.pathname)) return;
  const t=(en,ar)=>(localStorage.getItem('language')||'').toLowerCase().startsWith('ar')?ar:en;
  const pages=[
    ['retail-orders','retail.orders',t('Retail orders','طلبات التجزئة')],
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
    if(!document.querySelector('[data-retail-workspace-css]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/retail-workspace.css?v=ec06-consented-notices1';css.dataset.retailWorkspaceCss='';document.head.append(css);}
    new MutationObserver(syncTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-sx-theme']});
    window.addEventListener('storage',syncTheme);
    add(root,'h1',page[2]);
    const status=add(root,'p',t('Loading…','جار التحميل…'));status.setAttribute('role','status');
    try {
      if(active==='retail-finance')await finance(root,status);
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
