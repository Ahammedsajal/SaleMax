(() => {
  const root=document.getElementById('shop');
  if (!root) return;
  const base=location.pathname.replace(/\/$/,'');
  const storageKey='7network-cart:'+base;
  const checkoutStorageKey='7network-checkout-request:'+base;
  const state={cart:new Map(),page:'home',request:null};
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
    const manifest=document.createElement('link');manifest.rel='manifest';manifest.href=base+'/manifest.webmanifest';document.head.append(manifest);
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
      const items=selected?[selected]:state.items.filter(item=>
        (!category.value||item.category===category.value)&&name(item).toLowerCase().includes(search.value.toLowerCase()));
      for(const item of items) {
        const card=add(grid,'article');
        if(item.photoId){
          const photo=add(card,'img');
          photo.src=base+'/image/'+encodeURIComponent(item.id)+'/'+encodeURIComponent(item.photoId);
          photo.alt=name(item);photo.loading='lazy';photo.width=800;photo.height=600;
        }
        add(card,'h3',name(item));
        add(card,'p',money(item.priceMinor));
        if(selected) add(card,'p',(arabic?item.descriptionAr:item.descriptionEn)||'');
        else button(card,t('View item','عرض المنتج'),()=>{state.selected=item;show('item');});
        if(item.available) button(card,t('Add to cart','إضافة إلى السلة'),()=>change(item,(state.cart.get(item.id)||0)+1));
        else add(card,'p',t('Sold out','نفد المخزون'));
      }
      if(!items.length) add(grid,'p',t('No products found.','لا توجد منتجات.'));
    }
    search.hidden=Boolean(selected);category.hidden=Boolean(selected);
    search.oninput=category.onchange=fill;fill();
  }
  function checkout(body){
    const form=add(body,'form');
    const customer=field(form,t('Name','الاسم'));customer.maxLength=120;customer.autocomplete='name';
    const phone=field(form,t('Phone','الهاتف'),'tel');phone.maxLength=30;phone.autocomplete='tel';
    const mode=add(add(form,'label',t('Fulfillment','طريقة الاستلام')),'select');
    add(mode,'option',t('Pickup','استلام')).value='pickup';
    if(state.store.deliveryFee!==null||state.store.deliveryZones.length) add(mode,'option',t('Delivery','توصيل')).value='delivery';
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
    add(form,'p',t('Pay in cash at pickup or delivery. Your contact details are shared with the seller to fulfill this order.','الدفع نقداً عند الاستلام أو التوصيل. تُشارك بيانات التواصل مع البائع لتنفيذ الطلب.'));
    const submit=add(form,'button',t('Place order','إرسال الطلب'));
    const status=add(form,'p');status.setAttribute('role','status');
    form.onsubmit=async event=>{
      event.preventDefault();
      const order={name:customer.value,phone:phone.value,fulfillment:mode.value,address:address.value,pin:pin.value,zone:zone.value,lines:lines(),
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
        status.textContent=['STOCK_CHANGED','PRICE_CHANGED','PRODUCT_UNAVAILABLE'].includes(error.message)?
          t('Price or availability changed. Reload and review your cart.','تغير السعر أو المخزون. أعد تحميل الصفحة وراجع السلة.'):
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
        add(row,'p',name(item)+' × '+line.quantity+' · '+money(line.quantity*Number(item.priceMinor)));
        button(row,t('Remove one','إزالة وحدة'),()=>change(item,line.quantity-1));
        button(row,t('Add one','إضافة وحدة'),()=>change(item,line.quantity+1));
      }
      add(body,'p',lines().length?money(amount()):t('Your cart is empty.','سلتك فارغة.'));
      if(lines().length) button(body,t('Checkout','إتمام الطلب'),()=>show('checkout'));
    }
    if(state.page==='checkout') checkout(body);
    if(state.page==='confirmation'){
      add(body,'p',t('Order reference: ','مرجع الطلب: ')+state.receipt.reference);
      if(state.receipt.deliveryProofCode){
        add(body,'p',t('Show this one-time handoff code to the delivery person. Keep it private until your order arrives.','أظهر رمز الاستلام لمرة واحدة لمندوب التوصيل. احتفظ به سرياً حتى وصول طلبك.'));
        const proof=add(body,'strong',state.receipt.deliveryProofCode);proof.dir='ltr';proof.className='handoff-code';
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
  request('/catalog').then(data=>{Object.assign(state,data);loadCart();render();})
    .catch(()=>{root.textContent=t('This shop is unavailable.','هذا المتجر غير متاح.');});
})();
