(() => {
  if (location.pathname.replace(/\/$/, '') !== '/user') return;
  if (window.__sxBusinessInventoryLoaded) return;
  window.__sxBusinessInventoryLoaded = true;
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
  const retailRequest = async (path, options) => (await window.SaleMaxWorkspace.request('retail', path, options)).data;
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
      if (active()) await render(access.permissions['inventory.manage'], access.permissions['retail.configure'] === true);
    } catch {
      if (active()) make('p', tr('Inventory is unavailable. Reload to try again.', 'المخزون غير متاح. أعد تحميل الصفحة للمحاولة.'), document.body);
    }
  }

  async function render(canManage, canConfigureRetail) {
    const page = make('main', '', document.body);
    page.id = 'sx-business-inventory';
    page.dir = ar() ? 'rtl' : 'ltr';
    Object.assign(page.style, {position: 'fixed', insetBlock: '64px 0', insetInline: 'var(--sx-sidebar-inline-offset, 0px) 0', zIndex: '1200', overflow: 'auto', padding: 'clamp(1rem, 4vw, 3rem)', background: 'var(--sx-canvas, Canvas)', color: 'var(--sx-ink, CanvasText)', colorScheme: 'light dark'});
    make('style', '#sx-business-inventory label{display:inline-flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin:.25rem .5rem .25rem 0}#sx-business-inventory input,#sx-business-inventory select,#sx-business-inventory textarea,#sx-business-inventory button{min-height:44px;max-inline-size:100%;box-sizing:border-box}#sx-business-inventory input,#sx-business-inventory select,#sx-business-inventory textarea{padding:.55rem .7rem;border:1px solid var(--sx-border,GrayText);border-radius:9px;background:var(--sx-surface,Canvas);color:var(--sx-ink,CanvasText);font:inherit}#sx-business-inventory button{padding:.55rem .9rem;border:1px solid var(--sx-border,GrayText);border-radius:9px;background:var(--sx-surface,Canvas);color:var(--sx-ink,CanvasText);font-family:inherit;font-size:14px;font-weight:600;line-height:1.3;cursor:pointer}#sx-business-inventory form{margin-block:1rem}#sx-business-inventory section{overflow-wrap:anywhere;border:1px solid var(--sx-border,GrayText);border-radius:12px;background:var(--sx-surface,Canvas);padding:16px}#sx-business-inventory details{margin-block:10px}#sx-business-inventory summary{min-height:44px;padding:10px 0;cursor:pointer;font-weight:650}#sx-business-inventory [role=status]{min-height:1.5em;color:var(--sx-muted,GrayText)}#sx-business-inventory .sx-inventory-store-panel{max-width:1100px;margin-block:14px;padding:16px;border:1px solid var(--sx-border,GrayText);border-radius:14px;background:var(--sx-surface,Canvas)}#sx-business-inventory .sx-inventory-listing{margin-block:10px;padding:14px;border:1px solid var(--sx-border,GrayText);border-radius:12px;background:var(--sx-canvas,Canvas)}#sx-business-inventory .sx-inventory-listing-fields{display:flex;align-items:end;flex-wrap:wrap;gap:10px}#sx-business-inventory .sx-inventory-variant-values{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px}#sx-business-inventory .sx-inventory-variant-values section{min-width:0}#sx-business-inventory [hidden]{display:none!important}@media(max-width:767px){#sx-business-inventory{inset-inline:0!important;padding:16px!important}#sx-business-inventory section{padding:13px}#sx-business-inventory .sx-inventory-listing-fields{display:grid;grid-template-columns:1fr}#sx-business-inventory .sx-inventory-listing-fields label,#sx-business-inventory .sx-inventory-listing-fields input,#sx-business-inventory .sx-inventory-listing-fields select{width:100%;max-width:100%}}', page);
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
    let storeCatalogue = null;
    let storeCatalogueError = '';
    if (canConfigureRetail) {
      try { storeCatalogue = await retailRequest('/store/catalogue'); }
      catch (error) { storeCatalogueError = error?.message || 'STORE_CATALOGUE_UNAVAILABLE'; }
    }
    const storeProductById = new Map((storeCatalogue?.products || []).map(product => [product.id, product]));
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
    if (canConfigureRetail) {
      const panel = make('details', '', page); panel.className = 'sx-inventory-store-panel';
      make('summary', tr('Online store product options', 'خيارات منتجات المتجر الإلكتروني'), panel);
      make('p', tr('Choose public product photos and visibility inside each product card above. Group published products here when they share options such as size or colour.', 'اختر صور المنتجات وظهورها للزوار داخل بطاقة كل منتج أعلاه. اجمع المنتجات المنشورة هنا عندما تشترك في خيارات مثل المقاس أو اللون.'), panel);
      if (storeCatalogueError || !storeCatalogue) {
        make('p', tr('Store product options could not be loaded. Reload this page to try again.', 'تعذر تحميل خيارات منتجات المتجر. أعد تحميل الصفحة للمحاولة مرة أخرى.'), panel).setAttribute('role', 'alert');
      } else {
        const groups = storeCatalogue.variants || [];
        const groupPicker = make('select', '', make('label', tr('Variant group', 'مجموعة الخيارات') + ' ', panel));
        make('option', tr('Create a new group', 'إنشاء مجموعة جديدة'), groupPicker).value = '';
        for (const group of groups) { const option = make('option', (ar() ? group.titleAr : group.titleEn) || group.titleEn, groupPicker); option.value = group.id; }
        const titleEn = make('input', '', make('label', tr('Group name (English)', 'اسم المجموعة بالإنجليزية') + ' ', panel)); titleEn.maxLength = 160; titleEn.required = true;
        const titleAr = make('input', '', make('label', tr('Group name (Arabic)', 'اسم المجموعة بالعربية') + ' ', panel)); titleAr.maxLength = 160; titleAr.dir = 'auto';
        const labelEn = make('input', '', make('label', tr('Option label (English)', 'اسم الخيار بالإنجليزية') + ' ', panel)); labelEn.maxLength = 80; labelEn.required = true;
        const labelAr = make('input', '', make('label', tr('Option label (Arabic)', 'اسم الخيار بالعربية') + ' ', panel)); labelAr.maxLength = 80; labelAr.dir = 'auto';
        const picker = make('select', '', make('label', tr('Published products (choose at least two)', 'المنتجات المنشورة (اختر منتجين على الأقل)') + ' ', panel)); picker.multiple = true; picker.size = 8;
        const valuesArea = make('div', '', panel); valuesArea.className = 'sx-inventory-variant-values';
        const groupStatus = make('p', '', panel); groupStatus.setAttribute('role', 'status');
        const valueFields = new Map();
        const saveCurrentValues = () => { for (const [id, fields] of valueFields) valueFields.set(id, {valueEn: fields.en.value, valueAr: fields.ar.value}); };
        function populateValues(existing = new Map()) {
          const current = new Map(valueFields); valuesArea.replaceChildren(); valueFields.clear();
          for (const option of picker.selectedOptions) {
            const product = storeProductById.get(option.value), prior = existing.get(option.value) || current.get(option.value) || {};
            const row = make('section', '', valuesArea);
            make('strong', ((ar() ? product?.nameAr : product?.nameEn) || product?.nameEn || option.value) + ' · ' + (product?.code || ''), row);
            const en = make('input', '', make('label', tr('Option value (English)', 'قيمة الخيار بالإنجليزية') + ' ', row)); en.value = prior.valueEn ?? prior.en?.value ?? ''; en.required = true; en.maxLength = 100;
            const arInput = make('input', '', make('label', tr('Option value (Arabic)', 'قيمة الخيار بالعربية') + ' ', row)); arInput.value = prior.valueAr ?? prior.ar?.value ?? ''; arInput.dir = 'auto'; arInput.maxLength = 100;
            valueFields.set(option.value, {en, ar: arInput});
          }
        }
        function populateGroup(group) {
          saveCurrentValues(); picker.replaceChildren(); valueFields.clear();
          const occupied = new Set(groups.filter(item => item.id !== group?.id).flatMap(item => item.products.map(value => value.id)));
          const available = (storeCatalogue.products || []).filter(product => product.status === 'active' && product.published && !occupied.has(product.id));
          for (const product of available) { const option = make('option', ((ar() ? product.nameAr : product.nameEn) || product.nameEn) + ' · ' + product.code, picker); option.value = product.id; }
          const prior = new Map((group?.products || []).map(item => [item.id, item]));
          for (const option of picker.options) option.selected = prior.has(option.value);
          titleEn.value = group?.titleEn || ''; titleAr.value = group?.titleAr || '';
          labelEn.value = group?.optionLabelEn || ''; labelAr.value = group?.optionLabelAr || '';
          populateValues(prior);
        }
        groupPicker.onchange = () => populateGroup(groups.find(item => item.id === groupPicker.value) || null);
        picker.onchange = () => { const current = new Map([...valueFields].map(([id, fields]) => [id, {valueEn: fields.en.value, valueAr: fields.ar.value}])); populateValues(current); };
        populateGroup(null);
        const saveGroup = make('button', tr('Save variant group', 'حفظ مجموعة الخيارات'), panel); saveGroup.type = 'button';
        saveGroup.onclick = async () => {
          saveCurrentValues();
          const members = [...picker.selectedOptions].map(option => { const fields = valueFields.get(option.value); return {id: option.value, valueEn: fields?.en.value.trim() || '', valueAr: fields?.ar.value.trim() || ''}; });
          if (members.length < 2 || !titleEn.value.trim() || !labelEn.value.trim() || members.some(item => !item.valueEn) || new Set(members.map(item => item.valueEn.toLowerCase())).size !== members.length) {
            groupStatus.textContent = tr('Add a name and option label, select at least two products, and give each product a unique English option value.', 'أدخل اسم المجموعة والخيار، واختر منتجين على الأقل، وحدد قيمة إنجليزية مختلفة لكل منتج.'); return;
          }
          saveGroup.disabled = true;
          try { await retailRequest('/variants', {method: 'POST', body: {id: groupPicker.value || undefined, titleEn: titleEn.value.trim(), titleAr: titleAr.value.trim(), optionLabelEn: labelEn.value.trim(), optionLabelAr: labelAr.value.trim(), products: members}}); window.location.reload(); }
          catch { groupStatus.textContent = tr('Could not save this group. Confirm the selected products are published, active, have a current QAR price, and share one store category.', 'تعذر حفظ المجموعة. تأكد أن المنتجات المختارة منشورة ونشطة ولها سعر سارٍ بالريال القطري وتشترك في فئة متجر واحدة.'); saveGroup.disabled = false; }
        };
        for (const group of groups) {
          const remove = make('button', tr('Remove group: ', 'إزالة المجموعة: ') + (group.titleEn || ''), panel); remove.type = 'button';
          remove.onclick = async () => {
            if (!window.confirm(tr('Remove this product option group? The products remain in the store.', 'هل تريد إزالة مجموعة الخيارات؟ ستبقى المنتجات في المتجر.'))) return;
            remove.disabled = true;
            try { await retailRequest('/variants/' + encodeURIComponent(group.id), {method: 'DELETE'}); window.location.reload(); }
            catch { groupStatus.textContent = tr('Could not remove this group. Refresh and try again.', 'تعذر إزالة المجموعة. حدّث الصفحة وحاول مرة أخرى.'); remove.disabled = false; }
          };
        }
      }
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
          const storeProduct = storeProductById.get(item.id);
          if (canConfigureRetail && storeProduct) {
            const listing = make('details', '', row); listing.className = 'sx-inventory-listing';
            make('summary', tr('Public store listing', 'عرض المنتج في المتجر العام'), listing);
            make('p', tr('Product price and stock stay managed above. Choose whether this product appears in the online store and select its photo.', 'يظل سعر المنتج ومخزونه ضمن إدارة المنتج أعلاه. اختر ما إذا كان سيظهر في المتجر الإلكتروني وحدد صورته.'), listing);
            const fields = make('div', '', listing); fields.className = 'sx-inventory-listing-fields';
            const categoryLabel = make('label', tr('Store category', 'فئة المتجر') + ' ', fields);
            const category = make('input', '', categoryLabel); category.value = storeProduct.category || ''; category.maxLength = 100;
            const photoLabel = make('label', tr('Public product photo', 'صورة المنتج العامة') + ' ', fields);
            const photo = make('select', '', photoLabel);
            make('option', tr('No public photo', 'بدون صورة عامة'), photo).value = '';
            for (const image of (storeCatalogue?.photos || []).filter(entry => entry.productId === item.id)) {
              const option = make('option', image.name, photo); option.value = image.id;
            }
            photo.value = storeProduct.photoId || '';
            const publishLabel = make('label', '', fields);
            const publish = make('input', '', publishLabel); publish.type = 'checkbox'; publish.checked = Boolean(storeProduct.published);
            make('span', tr('Show in online store', 'إظهار في المتجر الإلكتروني'), publishLabel);
            const saveListing = make('button', tr('Save store listing', 'حفظ عرض المتجر'), listing); saveListing.type = 'button';
            if (storeProduct.status !== 'active') {
              publish.disabled = true;
              saveListing.disabled = true;
              make('p', tr('Activate this product in Products & services before changing its store listing.', 'فعّل هذا المنتج أولاً من صفحة المنتجات والخدمات قبل تعديل عرضه في المتجر.'), listing);
            }
            saveListing.onclick = async () => {
              saveListing.disabled = true;
              try {
                await retailRequest('/listings/' + encodeURIComponent(item.id), {method: 'PUT', body: {category: category.value.trim(), published: publish.checked, photoId: photo.value || null}});
                storeProduct.category = category.value.trim(); storeProduct.published = publish.checked; storeProduct.photoId = photo.value || null;
                message.textContent = tr('Store listing saved.', 'تم حفظ عرض المتجر.');
              } catch { message.textContent = tr('Could not save the store listing. Check the product and image, then try again.', 'تعذر حفظ عرض المتجر. تحقق من المنتج والصورة ثم حاول مرة أخرى.'); }
              finally { saveListing.disabled = false; }
            };
          }
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
