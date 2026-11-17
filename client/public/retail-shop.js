(() => {
  const root=document.getElementById('shop');
  if (!root) return;
  const base=location.pathname.replace(/\/$/,'');
  const storageKey='7network-cart:'+base;
  const checkoutStorageKey='7network-checkout-request:'+base;
  const state={cart:new Map(),page:'home',request:null,selectedLocationId:null,selected:null};
  function saveCart(){
    try {sessionStorage.setItem(storageKey,JSON.stringify([...state.cart]));}catch{}
  }
  function loadCart(){
    try {
      const saved=JSON.parse(sessionStorage.getItem(storageKey)||'[]');
      if(!Array.isArray(saved))return;
      for(const line of saved.slice(0,30)){
        if(!Array.isArray(line))continue;
        const [id,quantity]=line;
        if(Number.isInteger(quantity)&&quantity>0&&quantity<=100&&state.items.some(item=>item.id===id&&item.available))state.cart.set(id,quantity);
      }
    }catch{}
  }
  const arabic=new URLSearchParams(location.search).get('lang')==='ar';
  const t=(en,ar)=>arabic?ar:en;
  document.documentElement.lang=t('en','ar');
  document.documentElement.dir=t('ltr','rtl');
  function setupInstallableStore(){
    const manifest=document.createElement('link');manifest.rel='manifest';manifest.href=base+'/manifest.webmanifest?lang='+(arabic?'ar':'en');document.head.append(manifest);
    if('serviceWorker' in navigator)navigator.serviceWorker.register(base+'/service-worker.js',{scope:base?base+'/':'/'}).catch(()=>{});
  }
  const add=(parent,tag,text)=>{
    const node=document.createElement(tag);
    if(text!==undefined) node.textContent=text;
    parent.append(node);
    return node;
  };
  const button=(parent,title,click)=>{
    const node=add(parent,'button',title);
    node.type='button'; node.onclick=click; return node;
  };
  const money=minor=>new Intl.NumberFormat(t('en-QA','ar-QA'),{style:'currency',currency:'QAR'}).format(Number(minor)/100);
  const name=item=>(arabic?item.nameAr:item.nameEn)||item.nameEn;
  const displayName=item=>item?.variantGroupId?((arabic?item.variantTitleAr:item.variantTitleEn)||item.variantTitleEn||name(item)):name(item);
  const variantValue=item=>(arabic?item.variantValueAr:item.variantValueEn)||item.variantValueEn||'';
  const show=page=>{state.page=page;render();root.querySelector('h2')?.focus();};
  async function request(path,options) {
    const response=await fetch(base+path,options);
    const json=await response.json().catch(()=>({}));
    if(!response.ok) throw Error(json.code||'REQUEST_FAILED');
    return json.data;
  }
  function lines() {return [...state.cart].map(([id,quantity])=>({id,quantity}));}
  function amount() {return lines().reduce((sum,line)=>sum+Number(state.items.find(p=>p.id===line.id).priceMinor)*line.quantity,0);}
  function checkoutRequestState(){
    if(state.request&&Number(state.request.expiresAt)>Date.now()&&/^[0-9a-f-]{36}$/i.test(state.request.id))return state.request;
    try{
      const saved=JSON.parse(sessionStorage.getItem(checkoutStorageKey)||'null');
      if(Number(saved?.expiresAt)>Date.now()&&/^[0-9a-f-]{36}$/i.test(saved.id)){state.request=saved;return saved;}
      const id=crypto.randomUUID();
      state.request={id,expiresAt:Date.now()+15*60*1000,pending:false};return state.request;
    }catch{state.request={id:crypto.randomUUID(),expiresAt:Date.now()+15*60*1000,pending:false};return state.request;}
  }
  function saveCheckoutRequest(requestState){
    state.request=requestState;
    try{sessionStorage.setItem(checkoutStorageKey,JSON.stringify(requestState));}catch{}
  }
  function change(item,count) {
    if(count>0) state.cart.set(item.id,Math.min(count,100));
    else state.cart.delete(item.id);
    saveCart();render();
  }
  function field(form,title,type='text') {
    const input=add(add(form,'label',title),'input');
    input.type=type;input.required=true;
    return input;
  }
  function catalog(body,selected) {
    const search=field(body,t('Search products','البحث عن المنتجات'),'search');
    search.required=false;
    const category=add(add(body,'label',t('Category','الفئة')),'select');
    add(category,'option',t('All categories','جميع الفئات')).value='';
    for(const value of new Set(state.items.map(item=>item.category).filter(Boolean))) add(category,'option',value).value=value;
    const grid=add(body,'div');grid.className='items';
    function fill(){
      grid.replaceChildren();
      let cards;
      if(selected){
        const variants=selected.variantGroupId?state.items.filter(item=>item.variantGroupId===selected.variantGroupId).sort((a,b)=>a.variantSortOrder-b.variantSortOrder):[selected];
        cards=[{item:selected,variants}];
      }else{
        const filtered=state.items.filter(item=>(!category.value||item.category===category.value)&&
          (displayName(item)+' '+name(item)).toLowerCase().includes(search.value.toLowerCase()));
        const seen=new Set();cards=[];
        for(const item of filtered){
          const key=item.variantGroupId||item.id;if(seen.has(key))continue;seen.add(key);
          const variants=item.variantGroupId?state.items.filter(row=>row.variantGroupId===item.variantGroupId).sort((a,b)=>a.variantSortOrder-b.variantSortOrder):[item];
          cards.push({item:variants.find(row=>row.available)||variants[0],variants});
        }
      }
      for(const entry of cards) {
        const item=entry.item,variants=entry.variants;
        const card=add(grid,'article');
        if(item.photoId){
          const photo=add(card,'img');
          photo.src=base+'/image/'+encodeURIComponent(item.id)+'/'+encodeURIComponent(item.photoId);
          photo.alt=name(item);photo.loading='lazy';photo.width=800;photo.height=600;
        }
        add(card,'h3',displayName(item));
        const current=selected?(variants.find(row=>row.id===state.selected?.id)||item):item;
        if(selected&&variants.length>1){
          const choice=add(add(card,'label',(arabic?current.optionLabelAr:current.optionLabelEn)||current.optionLabelEn||t('Choose option','اختر خياراً')+' '),'select');
          for(const variant of variants){const opt=add(choice,'option',variantValue(variant)+' · '+money(variant.priceMinor)+(variant.available?'':' · '+t('Sold out','نفد المخزون')));opt.value=variant.id;}
          choice.value=current.id;
          choice.onchange=()=>{state.selected=variants.find(row=>row.id===choice.value)||item;fill();};
        }
        add(card,'p',selected?money(current.priceMinor):variants.length>1?
          t('From ','ابتداءً من ')+money(Math.min(...variants.map(row=>Number(row.priceMinor)))):money(current.priceMinor));
        if(selected){
          add(card,'p',(arabic?current.descriptionAr:current.descriptionEn)||'');
          if(current.available)button(card,t('Add to cart','إضافة إلى السلة'),()=>change(current,(state.cart.get(current.id)||0)+1));
          else add(card,'p',t('Sold out','نفد المخزون'));
        }else{
          button(card,t('View item','عرض المنتج'),()=>{state.selected=item;show('item');});
          if(variants.length===1){
            if(item.available)button(card,t('Add to cart','إضافة إلى السلة'),()=>change(item,(state.cart.get(item.id)||0)+1));
            else add(card,'p',t('Sold out','نفد المخزون'));
          }else add(card,'p',t('Choose a variant','اختر خياراً'));
        }
      }
      if(!cards.length) add(grid,'p',t('No products found.','لا توجد منتجات.'));
    }
    search.hidden=Boolean(selected);category.hidden=Boolean(selected);
    search.oninput=category.onchange=fill;fill();
  }
  function checkout(body){
    const form=add(body,'form');
    const location=state.locations.find(row=>row.id===state.selectedLocationId);
    if(location)add(form,'p',t('Fulfilled from: ','التنفيذ من: ')+((arabic?location.nameAr:location.nameEn)||location.nameEn)+(location.address?' · '+location.address:''));
    const locationId=location?.id;
    const customer=field(form,t('Name','الاسم'));customer.maxLength=120;customer.autocomplete='name';
    const phone=field(form,t('Phone','الهاتف'),'tel');phone.maxLength=30;phone.autocomplete='tel';
    const email=field(form,t('Email (optional)','البريد الإلكتروني (اختياري)'),'email');email.maxLength=254;email.autocomplete='email';email.required=false;
    add(form,'p',t('Used only to help the store manage this order. No marketing email will be sent.','يُستخدم فقط لمساعدة المتجر على إدارة هذا الطلب. لن تُرسل رسائل تسويقية عبر البريد الإلكتروني.'));
    const orderUpdates=field(form,t('Send WhatsApp updates for this order only (optional; no marketing)','أرسل تحديثات واتساب لهذا الطلب فقط (اختياري؛ بلا رسائل تسويقية)'),'checkbox');
    orderUpdates.required=false;orderUpdates.checked=false;
    const mode=add(add(form,'label',t('Fulfillment','طريقة الاستلام')),'select');
    if(!location||Number(location.acceptsPickup))add(mode,'option',t('Pickup','استلام')).value='pickup';
    if((!location||Number(location.acceptsDelivery))&&(state.store.deliveryFee!==null||state.store.deliveryZones.length)) add(mode,'option',t('Delivery','توصيل')).value='delivery';
    const zone=add(add(form,'label',t('Delivery zone','منطقة التوصيل')),'select');
    add(zone,'option',t('Select a zone','اختر المنطقة')).value='';
    for(const entry of state.store.deliveryZones)add(zone,'option',entry.name).value=entry.name;
    const fee=()=>mode.value==='delivery'?Number(state.store.deliveryZones.find(entry=>entry.name===zone.value)?.feeMinor??state.store.deliveryFee??0):0;
    const address=field(form,t('Delivery address','عنوان التوصيل'));address.maxLength=500;
    const pin=field(form,t('Map coordinates (optional)','إحداثيات الموقع (اختياري)'));pin.maxLength=48;pin.required=false;pin.placeholder='25.2854, 51.5310';
    const total=add(form,'p');
    const update=()=>{
      address.parentElement.hidden=mode.value==='pickup';
      address.required=mode.value==='delivery';
      pin.parentElement.hidden=mode.value==='pickup';
      zone.parentElement.hidden=mode.value==='pickup'||!state.store.deliveryZones.length;
      zone.required=!zone.parentElement.hidden;
      total.textContent=t('Total: ','الإجمالي: ')+money(amount()+fee());
    };
    mode.onchange=zone.onchange=update;update();
    add(form,'p',t('Pay in cash at pickup or delivery. The name, phone and optional email you provide are shared with the seller to fulfill this order. WhatsApp updates are sent only if you choose the separate option above.','الدفع نقداً عند الاستلام أو التوصيل. يُشارك الاسم والهاتف والبريد الإلكتروني الاختياري الذي تقدمه مع البائع لتنفيذ الطلب. لا تُرسل تحديثات واتساب إلا عند اختيار الخيار المنفصل أعلاه.'));
    const submit=add(form,'button',t('Place order','إرسال الطلب'));
    const status=add(form,'p');status.setAttribute('role','status');
    form.onsubmit=async event=>{
      event.preventDefault();
      const order={name:customer.value,phone:phone.value,...(email.value.trim()?{email:email.value.trim()}:{}),orderUpdatesWhatsapp:orderUpdates.checked,fulfillment:mode.value,locationId,address:address.value,pin:pin.value,zone:zone.value,lines:lines(),
        expectedTotal:amount()+fee()};
      const retry=checkoutRequestState();
      submit.disabled=true;
      try {
        if(retry.pending){
          try{
            state.receipt=await request('/checkout/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:retry.id})});
            state.request=null;
            try{sessionStorage.removeItem(checkoutStorageKey);}catch{}
            state.cart.clear();saveCart();show('confirmation');return;
          }catch(error){if(error.message!=='CHECKOUT_NOT_FOUND')throw error;}
        }
        retry.pending=true;saveCheckoutRequest(retry);
        state.receipt=await request('/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...order,requestId:retry.id})});
        state.request=null;
        try{sessionStorage.removeItem(checkoutStorageKey);}catch{}
        state.cart.clear();saveCart();show('confirmation');
      } catch(error) {
        status.textContent=error.message==='INVALID_EMAIL'?t('Enter a valid email address or leave the field blank.','أدخل بريداً إلكترونياً صحيحاً أو اترك الحقل فارغاً.'):
          ['STOCK_CHANGED','PRICE_CHANGED','PRODUCT_UNAVAILABLE'].includes(error.message)?
          t('Price or availability changed. Reload and review your cart.','تغير السعر أو المخزون. أعد تحميل الصفحة وراجع السلة.'):
          error.message==='INVALID_WHATSAPP_NUMBER'?t('Enter a full international phone number for WhatsApp updates, or leave the optional box unchecked.','أدخل رقم هاتف دولياً كاملاً لتحديثات واتساب، أو أزل تحديد الخيار الاختياري.'):
          error.message==='RETAIL_CONSENT_KEY_UNAVAILABLE'?t('WhatsApp consent is temporarily unavailable. You can uncheck the optional box and place the order.','الموافقة على واتساب غير متاحة مؤقتاً. يمكنك إلغاء تحديد الخيار الاختياري وإرسال الطلب.'):
          t('The order could not be confirmed. Retry with the same details.','تعذر تأكيد الطلب. حاول مرة أخرى بنفس البيانات.');
      } finally {submit.disabled=false;}
    };
  }
  function render(){
    root.replaceChildren();
    add(root,'h1',state.store.title);
    const nav=add(root,'nav');
    for(const [page,title] of [['home',t('Home','الرئيسية')],['menu',t('Menu','المنتجات')],['cart',t('Cart','السلة')+' ('+lines().length+')'],
      ['track',t('Track order','تتبع الطلب')],['about',t('About','عن المتجر')],['contact',t('Contact','تواصل معنا')]]) button(nav,title,()=>show(page));
    const language=add(nav,'a',t('العربية','English'));language.href=arabic?'?lang=en':'?lang=ar';
    if(state.locations.length>1){
      const locationPicker=add(add(root,'label',t('Store location','موقع المتجر')+' '),'select');
      for(const location of state.locations){
        const title=(arabic?location.nameAr:location.nameEn)||location.nameEn;
        const option=add(locationPicker,'option',title+(location.address?' · '+location.address:''));option.value=location.id;
      }
      locationPicker.value=state.selectedLocationId;
      locationPicker.onchange=async()=>{
        locationPicker.disabled=true;
        try{
          const data=await request('/catalog?locationId='+encodeURIComponent(locationPicker.value));
          Object.assign(state,data);state.selected=state.selected?state.items.find(item=>item.id===state.selected.id)||null:null;render();
        }catch{locationPicker.disabled=false;}
      };
    }
    const body=add(root,'section');
    const headings={home:t('Welcome','مرحباً'),menu:t('Products','المنتجات'),item:state.selected&&name(state.selected),
      cart:t('Cart','السلة'),checkout:t('Checkout','إتمام الطلب'),about:t('About','عن المتجر'),
      contact:t('Contact','تواصل معنا'),track:t('Track order','تتبع الطلب'),confirmation:t('Order placed','تم إرسال الطلب')};
    const heading=add(body,'h2',headings[state.page]);heading.tabIndex=-1;
    if(state.page==='menu'||state.page==='item') catalog(body,state.page==='item'?state.selected:null);
    if(state.page==='home'){
      add(body,'p',state.store.about);
      button(body,t('Browse products','تصفح المنتجات'),()=>show('menu'));
    }
    if(state.page==='about') add(body,'p',state.store.about);
    if(state.page==='contact') add(body,'p',state.store.contact);
    if(state.page==='cart') {
      for(const line of lines()) {
        const item=state.items.find(p=>p.id===line.id);
        const row=add(body,'article');
        add(row,'p',name(item)+(item.variantGroupId?' · '+((arabic?item.optionLabelAr:item.optionLabelEn)||item.optionLabelEn)+' '+variantValue(item):'')+
          ' × '+line.quantity+' · '+money(line.quantity*Number(item.priceMinor)));
        if(!item.available)add(row,'p',t('This item is unavailable at the selected location. Remove it or choose another location.','هذا المنتج غير متوفر في الموقع المحدد. أزله أو اختر موقعاً آخر.'));
        button(row,t('Remove one','إزالة وحدة'),()=>change(item,line.quantity-1));
        button(row,t('Add one','إضافة وحدة'),()=>change(item,line.quantity+1));
      }
      add(body,'p',lines().length?money(amount()):t('Your cart is empty.','سلتك فارغة.'));
      if(lines().length&&lines().every(line=>state.items.find(item=>item.id===line.id)?.available)) button(body,t('Checkout','إتمام الطلب'),()=>show('checkout'));
    }
    if(state.page==='checkout') checkout(body);
    if(state.page==='confirmation'){
      add(body,'p',t('Order reference: ','مرجع الطلب: ')+state.receipt.reference);
      if(state.receipt.deliveryProofCode){
        add(body,'p',t('Show this one-time handoff code to the delivery person. Keep it private until your order arrives.','أظهر رمز الاستلام لمرة واحدة لمندوب التوصيل. احتفظ به سرياً حتى وصول طلبك.'));
        const proof=add(body,'strong',state.receipt.deliveryProofCode);proof.dir='ltr';proof.className='handoff-code';
      }
      if(state.receipt.consentRevocationToken){
        const revokeStatus=add(body,'p');revokeStatus.setAttribute('role','status');
        button(body,t('Stop WhatsApp updates for this order','إيقاف تحديثات واتساب لهذا الطلب'),async event=>{
          const actionButton=event.currentTarget;actionButton.disabled=true;
          try{
            await request('/notifications/consent/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:state.receipt.reference,token:state.receipt.consentRevocationToken})});
            state.receipt.consentRevocationToken=null;revokeStatus.textContent=t('WhatsApp updates for this order are stopped.','تم إيقاف تحديثات واتساب لهذا الطلب.');
          }catch{actionButton.disabled=false;revokeStatus.textContent=t('Could not update the preference. Try again.','تعذر تحديث التفضيل. حاول مرة أخرى.');}
        });
      }
      button(body,t('Track order','تتبع الطلب'),()=>show('track'));
    }
    if(state.page==='track'){
      const form=add(body,'form');
      const reference=field(form,t('Order reference','مرجع الطلب'));
      reference.maxLength=36;reference.value=state.receipt?.reference||'';
      const submit=add(form,'button',t('Check order','تحقق من الطلب'));
      const result=add(form,'p');result.setAttribute('role','status');
      const statuses={placed:t('Placed','جديد'),ready:t('Ready','جاهز'),dispatched:t('Dispatched','قيد التوصيل'),
        completed:t('Completed','مكتمل'),cancelled:t('Cancelled','ملغى'),returned:t('Returned','مرتجع')};
      form.onsubmit=async event=>{
        event.preventDefault();submit.disabled=true;
        try {
          const order=await request('/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:reference.value.trim()})});
          result.textContent=order.deliveryState==='failed'?t('The delivery attempt was unsuccessful. The store will arrange the next step.','تعذر إتمام محاولة التوصيل. سيقوم المتجر بترتيب الخطوة التالية.'):(statuses[order.status]||'');
        } catch {result.textContent=t('Order not found. Check the reference.','لم يتم العثور على الطلب. تحقق من المرجع.');}
        finally {submit.disabled=false;}
      };
    }
  }
  add(root,'p',t('Loading…','جار التحميل…'));
  setupInstallableStore();
  request('/catalog').then(data=>{Object.assign(state,data);state.selectedLocationId=data.selectedLocationId||data.store.defaultLocationId;loadCart();render();})
    .catch(()=>{root.textContent=t('This shop is unavailable.','هذا المتجر غير متاح.');});
})();
