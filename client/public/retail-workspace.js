(() => {
  if (!/^\/(user|agent)\/?$/.test(location.pathname)) return;
  const t=(en,ar)=>(localStorage.getItem('language')||'').toLowerCase().startsWith('ar')?ar:en;
  const pages=[
    ['retail-orders','retail.orders',t('Retail orders','طلبات التجزئة')],
    ['retail-deliveries','retail.deliver',t('My deliveries','عمليات التوصيل الخاصة بي')]
  ];
  const active=new URLSearchParams(location.search).get('page');
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
  const labels={placed:t('Placed','جديد'),ready:t('Ready','جاهز'),dispatched:t('Dispatched','قيد التوصيل'),completed:t('Completed','مكتمل'),cancelled:t('Cancelled','ملغى'),returned:t('Returned','مرتجع')};
  function action(parent,title,operation,status,refresh){
    const button=add(parent,'button',title);
    button.type='button';
    button.onclick=async()=>{
      button.disabled=true;
      try {await operation();status.textContent=t('Saved','تم الحفظ');if(refresh)await refresh();}
      catch {status.textContent=t('Could not save. Refresh and try again.','تعذر الحفظ. حدّث الصفحة وحاول مرة أخرى.');}
      finally {button.disabled=false;}
    };
  }
  async function configure(root,status){
    const {store,products,photos}=await api('/store');
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
    action(section,t('Save storefront','حفظ المتجر'),()=>api('/store','PUT',{
      slug:slug.value,title:title.value,about:about.value,contact:contact.value,enabled:enabled.checked,
      deliveryFee:fee.value===''?null:Math.round(fee.valueAsNumber*100),
      deliveryZones:zones.value.split('\n').filter(line=>line.trim()).map(line=>{
        const [name,amount,...extra]=line.split('|');
        return {name:name.trim(),feeMinor:amount?.trim()&&!extra.length?Math.round(Number(amount)*100):null};
      })
    }),status,()=>location.reload());
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
  }
  async function orders(root,status,driver,canLinkLead){
    const base=driver?'/deliveries':'/orders';
    const [rows,drivers]=await Promise.all([api(base),driver?[]:api('/drivers')]);
    if(!rows.length)add(root,'p',t('No orders yet.','لا توجد طلبات.'));
    for(const order of rows){
      const card=add(root,'article');
      add(card,'h3',order.id+' · '+labels[order.status]);
      add(card,'p',order.buyerName+' · '+order.buyerPhone);
      add(card,'p',money(order.totalMinor)+' · '+(order.fulfillment==='delivery'?t('Delivery','توصيل'):t('Pickup','استلام')));
      for(const item of order.lines)add(card,'p',(t(item.nameEn,item.nameAr)||item.nameEn)+' × '+item.quantity);
      if(canLinkLead){
        if(order.leadId)add(card,'p',t('Linked to Lead Pipeline','مرتبط بمسار العملاء المحتملين'));
        else action(card,t('Add to Lead Pipeline','إضافة إلى مسار العملاء المحتملين'),()=>api('/orders/'+order.id+'/lead','POST',{}),status,()=>location.reload());
      }
      if(!driver&&order.status==='completed'){
        if(order.cashReceivedAt)add(card,'p',t('Cash recorded','تم تسجيل النقد'));
        else action(card,t('Record full cash receipt','تسجيل استلام المبلغ نقداً'),async()=>{
          if(!window.confirm(t('Confirm receipt of ','تأكيد استلام ')+money(order.totalMinor)))return;
          await api('/orders/'+order.id+'/cash-received','POST',{});
        },status,()=>location.reload());
      }
      if(order.deliveryAddress){
        add(card,'p',[order.deliveryZone,order.deliveryAddress].filter(Boolean).join(' · '));
        const map=add(card,'a','Google Maps');map.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(order.deliveryPin||order.deliveryAddress);
        map.target='_blank';map.rel='noopener noreferrer';
        const waze=add(card,'a','Waze');waze.href='https://www.waze.com/ul?'+(order.deliveryPin?'ll='+encodeURIComponent(order.deliveryPin):'q='+encodeURIComponent(order.deliveryAddress))+'&navigate=yes';
        waze.target='_blank';waze.rel='noopener noreferrer';
      }
      if(!driver&&order.fulfillment==='delivery'&&['placed','ready'].includes(order.status)){
        const select=add(add(card,'label',t('Assigned driver','السائق المعيّن')+' '),'select');
        add(select,'option',t('Select a driver','اختر سائقاً')).value='';
        for(const member of drivers)add(select,'option',member.name).value=member.id;
        select.value=order.driverId||'';
        action(card,t('Assign','تعيين'),()=>api('/orders/'+order.id+'/driver','PUT',{driverId:select.value}),status,()=>location.reload());
      }
      const options=order.status==='placed'&&!driver?['ready','cancelled']:
        order.status==='ready'?order.fulfillment==='delivery'?[...(order.driverId?['dispatched']:[]),...(!driver?['cancelled']:[])]:!driver?['completed','cancelled']:[]:
        order.status==='dispatched'?['completed']:order.status==='completed'&&!driver?['returned']:[];
      for(const next of options)action(card,labels[next],()=>{
        if(next==='returned'&&!window.confirm(t('Return all items to stock? Handle any refund separately.','إرجاع جميع المنتجات إلى المخزون؟ عالج رد المبلغ بشكل منفصل.')))return;
        return api(base+'/'+order.id+'/status','POST',{status:next});
      },status,()=>location.reload());
    }
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
    root.dir=t('ltr','rtl');
    add(root,'style','#sx-retail-workspace{position:fixed;inset-block:64px 0;inset-inline:var(--sx-sidebar-inline-offset,0px) 0;overflow:auto;z-index:1200;padding:clamp(1rem,3vw,3rem);background:Canvas;color:CanvasText;color-scheme:light dark;overflow-wrap:anywhere}#sx-retail-workspace label{display:block;margin:.5rem 0}#sx-retail-workspace input,#sx-retail-workspace button,#sx-retail-workspace select{min-height:44px;max-width:100%;margin:.25rem}#sx-retail-workspace article{border-block-end:1px solid GrayText;margin-block:1rem;padding-block:1rem}@media(max-width:767px){#sx-retail-workspace{inset-inline:0}}');
    add(root,'h1',page[2]);
    const status=add(root,'p',t('Loading…','جار التحميل…'));status.setAttribute('role','status');
    try {
      await orders(root,status,active==='retail-deliveries',access.role==='owner'&&access.permissions['leads.manage']);
      if(access.permissions['retail.configure']&&active==='retail-orders')await configure(root,status);
      status.textContent='';
    } catch {status.textContent=t('Unable to load this workspace.','تعذر تحميل مساحة العمل.');}
  }
  function boot(){if(window.SaleMaxWorkspace)start().catch(()=>{});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
