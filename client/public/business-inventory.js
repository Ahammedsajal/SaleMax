(() => {
  if (location.pathname.replace(/\/$/, '') !== '/user') return;
  const href = '/user?page=business-inventory';
  const active = () => new URLSearchParams(location.search).get('page') === 'business-inventory';
  const ar = () => {
    const language = (localStorage.getItem('language') || document.documentElement.lang).toLowerCase();
    return language.startsWith('ar') || language.includes('arabic');
  };
  const tr = (en, arabic) => ar() ? arabic : en;
  const make = (tag, value, parent) => {
    const node = document.createElement(tag);
    if (value) node.textContent = value;
    parent?.append(node);
    return node;
  };
  const button = (parent, title, run) => {
    const node = make('button', title, parent);
    node.type = 'button';
    node.onclick = run;
    return node;
  };
  const request = async (path, options) => (await window.SaleMaxWorkspace.request('inventory', path, options)).data;
  let started = false;
  async function start() {
    if (started || !window.SaleMaxWorkspace) return;
    started = true;
    try {
      const access = await window.SaleMaxWorkspace.session();
      if (!access.modules.inventory || !access.roleNavigation.includes('business-inventory')) {
        if (active()) make('p', tr('You do not have inventory access.', 'ليس لديك صلاحية الوصول إلى المخزون.'), document.body);
        return;
      }
      function addNav() {
        const anchor = document.querySelector('[data-sx-course-nav][data-sx-catalog-kind="products"]') ||
          [...document.querySelectorAll('li')].find(row => ['Dashboard', 'لوحة التحكم'].includes(row.textContent.trim()));
        if (!anchor || anchor.parentElement.querySelector('[data-sx-stock-nav]')) return;
        const row = make('li');
        row.dataset.sxStockNav = '1';
        row.style.padding = '0.65rem 1rem';
        const link = make('a', tr('Inventory', 'المخزون'), row);
        link.href = href;
        link.style.color = 'inherit';
        if (active()) link.setAttribute('aria-current', 'page');
        anchor.after(row);
      }
      const observer = new MutationObserver(addNav);
      observer.observe(document.body, {childList: true, subtree: true});
      addNav();
      if (active()) await render(access.permissions['inventory.manage']);
    } catch {
      if (active()) make('p', tr('Inventory is unavailable. Reload to try again.', 'المخزون غير متاح. أعد تحميل الصفحة للمحاولة.'), document.body);
    }
  }

  async function render(canManage) {
    const page = make('main', '', document.body);
    page.id = 'sx-business-inventory';
    page.dir = ar() ? 'rtl' : 'ltr';
    Object.assign(page.style, {position: 'fixed', insetBlock: '64px 0', insetInline: 'var(--sx-sidebar-inline-offset, 0px) 0', zIndex: '1200', overflow: 'auto', padding: 'clamp(1rem, 4vw, 3rem)', background: 'Canvas', color: 'CanvasText', colorScheme: 'light dark'});
    make('style', '#sx-business-inventory label{display:inline-flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin:.25rem .5rem .25rem 0}#sx-business-inventory input,#sx-business-inventory select,#sx-business-inventory textarea,#sx-business-inventory button{min-height:44px;max-inline-size:100%;box-sizing:border-box}#sx-business-inventory form{margin-block:1rem}#sx-business-inventory section{overflow-wrap:anywhere}@media(max-width:767px){#sx-business-inventory{inset-inline:0!important}}', page);
    const back = make('a', tr('Products & services', 'المنتجات والخدمات'), page);
    back.href = '/user?page=products-services';
    make('h1', tr('Inventory', 'المخزون'), page);
    const locations=await request('/locations');
    const activeLocations=locations.filter(row=>row.status==='active');
    if(!activeLocations.length)throw Error('LOCATION_NOT_FOUND');
    let selectedLocationId=activeLocations.find(row=>row.isDefault)?.id||activeLocations[0].id;
    const locationPicker=make('select','',make('label',tr('Stock location','موقع المخزون')+' ',page));
    for(const location of activeLocations){
      const title=(ar()?location.nameAr:location.nameEn)||location.nameEn;
      const option=make('option',title+(location.address?' · '+location.address:''),locationPicker);option.value=location.id;
    }
    locationPicker.value=selectedLocationId;
    const search = make('input', '', make('label', tr('Search products', 'البحث عن المنتجات') + ' ', page));
    search.type = 'search';
    const message = make('p', '', page);
    message.setAttribute('role', 'status');
    const list = make('div', '', page);
    if(canManage){
      const management=make('details','',page);make('summary',tr('Manage locations','إدارة المواقع'),management);
      for(const location of activeLocations){
        const row=make('section','',management);make('strong',(ar()?location.nameAr:location.nameEn)||location.nameEn,row);
        make('p',location.code+(location.address?' · '+location.address:''),row);
        if(!location.isDefault)button(row,tr('Set as default','تعيين كموقع افتراضي'),async()=>{
          await request('/locations/'+location.id+'/default',{method:'POST'});message.textContent=tr('Default location updated.','تم تحديث الموقع الافتراضي.');
        });
        if(!location.isDefault)button(row,tr('Archive location','أرشفة الموقع'),async()=>{
          await request('/locations/'+location.id+'/archive',{method:'POST'});
          const remaining=activeLocations.filter(value=>value.id!==location.id);locationPicker.replaceChildren();
          for(const item of remaining){const option=make('option',(ar()?item.nameAr:item.nameEn)||item.nameEn,locationPicker);option.value=item.id;}
          if(selectedLocationId===location.id){selectedLocationId=remaining.find(item=>item.isDefault)?.id||remaining[0].id;locationPicker.value=selectedLocationId;await load();}
          message.textContent=tr('Location archived.','تمت أرشفة الموقع.');
        });
      }
      const archivedLocations=locations.filter(row=>row.status==='archived');
      if(archivedLocations.length){const archived=make('details','',management);make('summary',tr('Archived locations','المواقع المؤرشفة'),archived);
        for(const location of archivedLocations){const row=make('section','',archived);make('strong',(ar()?location.nameAr:location.nameEn)||location.nameEn,row);
          make('p',location.code+(location.address?' · '+location.address:''),row);
          button(row,tr('Restore location','استعادة الموقع'),async()=>{await request('/locations/'+location.id+'/restore',{method:'POST'});window.location.reload();});
        }
      }
      const form=make('form','',management);
      const code=make('input','',make('label',tr('Location code','رمز الموقع')+' ',form));code.required=true;code.maxLength=40;code.pattern='[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]';
      const nameEn=make('input','',make('label',tr('Name in English','الاسم بالإنجليزية')+' ',form));nameEn.required=true;nameEn.maxLength=120;
      const nameAr=make('input','',make('label',tr('Name in Arabic','الاسم بالعربية')+' ',form));nameAr.maxLength=120;nameAr.dir='auto';
      const address=make('input','',make('label',tr('Address','العنوان')+' ',form));address.maxLength=500;
      const pin=make('input','',make('label',tr('Map coordinates','إحداثيات الخريطة')+' ',form));pin.placeholder='25.2854, 51.5310';
      const pickup=make('input','',make('label',tr('Pickup available','الاستلام متاح')+' ',form));pickup.type='checkbox';pickup.checked=true;
      const delivery=make('input','',make('label',tr('Delivery available','التوصيل متاح')+' ',form));delivery.type='checkbox';delivery.checked=true;
      const save=make('button',tr('Add location','إضافة موقع'),form);save.type='submit';
      form.onsubmit=async event=>{
        event.preventDefault();save.disabled=true;
        try{await request('/locations',{method:'POST',body:{code:code.value,nameEn:nameEn.value,nameAr:nameAr.value,address:address.value,mapPin:pin.value,acceptsPickup:pickup.checked,acceptsDelivery:delivery.checked}});location.reload();}
        catch{message.textContent=tr('Could not add location. Check the code and fulfillment options.','تعذر إضافة الموقع. تحقق من الرمز وخيارات الاستلام والتوصيل.');save.disabled=false;}
      };
    }
    let sequence = 0;
    async function load(offset = 0) {
      const current = ++sequence;
      message.textContent = tr('Loading…', 'جارٍ التحميل…');
      try {
        const {items, hasMore} = await request('/?locationId='+encodeURIComponent(selectedLocationId)+'&offset=' + offset + '&search=' + encodeURIComponent(search.value));
        if (current !== sequence) return;
        list.replaceChildren();
        message.textContent = items.length ? '' : tr('No matching products.', 'لا توجد منتجات مطابقة.');
        for (const item of items) {
          const row = make('section', '', list);
          row.style.borderBlockEnd = '1px solid GrayText';
          make('h2', (ar() ? item.nameAr : item.nameEn) || item.nameEn || item.code, row);
          make('p', item.code + ' · ' + tr('On hand', 'المتوفر') + ' ' + item.quantity, row);
          make('p', tr('Reserved', 'محجوز')+' '+Number(item.reserved||0)+' · '+tr('Available','متاح')+' '+(item.quantity-Number(item.reserved||0)),row);
          const details = make('details', '', row);
          make('summary', tr('Movement history', 'سجل الحركات'), details);
          details.addEventListener('toggle', async () => {
            if (!details.open || details.childElementCount > 1) return;
            const history = make('ul', '', details);
            try {
              const movements = await request('/' + item.id + '/history?locationId='+encodeURIComponent(selectedLocationId));
              if (!movements.length) make('li', tr('No movements yet.', 'لا توجد حركات بعد.'), history);
              for (const movement of movements) {
                make('li', movement.previousQuantity + ' → ' + movement.quantity + ' · ' + movement.reason + ' · ' + new Date(movement.createdAt).toLocaleString(), history);
              }
            } catch { make('li', tr('Could not load history.', 'تعذر تحميل السجل.'), history); }
          });
          if (!canManage) continue;
          const form = make('form', '', row);
          const mode = make('select', '', make('label', tr('Stock action', 'إجراء المخزون'), form));
          make('option', tr('Adjust count', 'تصحيح الكمية'), mode).value = 'adjust';
          make('option', tr('Receive stock', 'استلام مخزون'), mode).value = 'receive';
          const quantityLabel = make('label', '', form);
          const quantityTitle = make('span', tr('New count', 'الكمية الجديدة'), quantityLabel);
          const quantity = make('input', '', quantityLabel);
          mode.onchange = () => {
            const receiving = mode.value === 'receive';
            quantityTitle.textContent = receiving ? tr('Units received', 'الوحدات المستلمة') : tr('New count', 'الكمية الجديدة');
            quantity.min = receiving ? '1' : '0';
            quantity.max = String(receiving ? 1000000000 - item.quantity : 1000000000);
            quantity.value = receiving ? '' : item.quantity;
          };
          Object.assign(quantity, {type: 'number', min: '0', max: '1000000000', required: true, value: item.quantity});
          const reason = make('input', '', make('label', tr('Reason', 'السبب') + ' ', form));
          Object.assign(reason, {required: true, maxLength: 200});
          const save = make('button', tr('Save count', 'حفظ الكمية'), form);
          let pending;
          form.onsubmit = async event => {
            event.preventDefault();
            const values = {locationId:selectedLocationId,expectedRevision: item.revision, quantity: quantity.valueAsNumber + (mode.value === 'receive' ? item.quantity : 0), reason: reason.value.trim()};
            if (!values.reason) return;
            const signature = JSON.stringify(values);
            if (pending?.signature !== signature) pending = {signature, requestId: crypto.randomUUID()};
            save.disabled = true;
            try {
              await request('/' + item.id + '/count', {method: 'POST', body: {...values, requestId: pending.requestId}});
              await load(offset);
            } catch (error) {
              if (error.message === 'STOCK_CHANGED') {
                await load(offset);
                message.textContent = tr('Stock changed. Review the current count and try again.', 'تغير المخزون. راجع الكمية الحالية وحاول مرة أخرى.');
              } else if (error.message === 'STOCK_RESERVED') {
                message.textContent = tr('The count cannot be lower than reserved stock.', 'لا يمكن أن تقل الكمية عن المخزون المحجوز.');
              } else {
                message.textContent = tr('Could not save the count. Try again.', 'تعذر حفظ الكمية. حاول مرة أخرى.');
              }
            } finally { save.disabled = false; }
          };
          if(activeLocations.length>1){
            const transfer=make('details','',row);make('summary',tr('Transfer stock to another location','نقل المخزون إلى موقع آخر'),transfer);
            const target=make('select','',make('label',tr('Destination','الوجهة')+' ',transfer));
            for(const location of activeLocations.filter(value=>value.id!==selectedLocationId)){
              const option=make('option',(ar()?location.nameAr:location.nameEn)||location.nameEn,target);option.value=location.id;
            }
            const amount=make('input','',make('label',tr('Units to transfer','الوحدات المراد نقلها')+' ',transfer));
            amount.type='number';amount.min='1';amount.max=String(Math.max(1,item.quantity-Number(item.reserved||0)));amount.required=true;
            const transferReason=make('input','',make('label',tr('Reason','السبب')+' ',transfer));transferReason.required=true;transferReason.maxLength=200;
            const transferButton=make('button',tr('Transfer','نقل'),transfer);transferButton.type='button';
            let transferPending;
            transferButton.onclick=async()=>{
              const body={productId:item.id,sourceLocationId:selectedLocationId,targetLocationId:target.value,quantity:amount.valueAsNumber,reason:transferReason.value.trim()};
              if(!body.targetLocationId||!Number.isInteger(body.quantity)||body.quantity<1||!body.reason)return;
              const signature=JSON.stringify(body);if(transferPending?.signature!==signature)transferPending={signature,requestId:crypto.randomUUID()};
              transferButton.disabled=true;
              try{await request('/stock/transfers',{method:'POST',body:{...body,requestId:transferPending.requestId}});await load(offset);message.textContent=tr('Stock transferred.','تم نقل المخزون.');}
              catch(error){message.textContent=error.message==='STOCK_RESERVED'?tr('Reserved units cannot be transferred.','لا يمكن نقل الوحدات المحجوزة.'):
                tr('Transfer could not be completed. Refresh and review stock.','تعذر إكمال النقل. حدّث الصفحة وراجع المخزون.');}
              finally{transferButton.disabled=false;}
            };
          }
        }
        if (offset) button(list, tr('Previous', 'السابق'), () => load(Math.max(0, offset - 50)));
        if (hasMore) button(list, tr('Next', 'التالي'), () => load(offset + 50));
      } catch { if (current === sequence) message.textContent = tr('Could not load inventory.', 'تعذر تحميل المخزون.'); }
    }
    search.addEventListener('search', () => load());
    search.addEventListener('change', () => load());
    locationPicker.addEventListener('change',()=>{selectedLocationId=locationPicker.value;load();});
    button(page, tr('Search', 'بحث'), () => load());
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
})();
