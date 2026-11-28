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
  const quantityScale = 1000000n;
  const quantityToMicro = value => {
    const text = String(value ?? '').trim();
    const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,6}))?$/.exec(text);
    return match ? BigInt(match[1]) * quantityScale + BigInt((match[2] || '').padEnd(6, '0') || '0') : null;
  };
  const quantityFromMicro = value => {
    const whole = value / quantityScale;
    const fraction = (value % quantityScale).toString().padStart(6, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
  };
  const quantityUnitNames = item => {
    const code = item.baseUnitCode || 'unit';
    if (code === 'yard') return ['yards','ياردة'];
    if (code === 'piece') return ['pieces','قطع'];
    if (code === 'panel') return ['panels','ألواح'];
    if (code === 'custom') return [item.baseUnitLabel||'units',item.baseUnitLabelAr||item.baseUnitLabel||'وحدة'];
    return ['units','وحدات'];
  };
  const quantityUnit = item => quantityUnitNames(item)[ar()?1:0];
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
    make('style',`
      #sx-business-inventory .sx-stock-summary{display:grid;grid-template-columns:minmax(140px,2fr) repeat(3,minmax(80px,1fr));align-items:center;gap:12px}
      #sx-business-inventory .sx-stock-summary small,#sx-business-inventory .sx-stock-summary strong{display:block}
      #sx-business-inventory .sx-stock-summary small{color:var(--sx-muted,GrayText)}
      @media(max-width:650px){#sx-business-inventory .sx-stock-summary{grid-template-columns:repeat(3,minmax(0,1fr))}#sx-business-inventory .sx-stock-summary>div:first-child{grid-column:1/-1}}
      #sx-business-inventory .sx-location-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));align-items:end;gap:1rem;max-width:900px;padding:clamp(1rem,3vw,2rem);background:var(--sx-surface,Canvas);border:1px solid var(--sx-border,GrayText);border-radius:14px}
      #sx-business-inventory .sx-location-form :is(h2,p){grid-column:1/-1;margin:0}
      #sx-business-inventory .sx-location-form label{display:grid;min-width:0;margin:0}
      #sx-business-inventory .sx-location-form label:has(input[type=checkbox]){display:flex;min-height:44px}
      #sx-business-inventory .sx-location-form button{justify-self:start;grid-column:1/-1}
    `,page);
    const back = make('a', tr('Products & services', 'المنتجات والخدمات'), page);
    back.href = '/user?page=products-services';
    make('h1', tr('Inventory', 'المخزون'), page);
    const locations=await request('/locations');
    const activeLocations=locations.filter(row=>row.status==='active');
    const hasLocations = activeLocations.length > 0;
    let selectedLocationId = activeLocations.find(row => row.isDefault)?.id || activeLocations[0]?.id;
    const filters = make('div', '', page);
    filters.hidden = !hasLocations;
    const locationPicker = make('select', '', make('label', tr('Stock location','موقع المخزون') + ' ', filters));
    for(const location of activeLocations){
      const title=(ar()?location.nameAr:location.nameEn)||location.nameEn;
      const option=make('option',title+(location.address?' · '+location.address:''),locationPicker);option.value=location.id;
    }
    locationPicker.value=selectedLocationId;
    const search = make('input', '', make('label', tr('Search products', 'البحث عن المنتجات') + ' ', filters));
    search.type = 'search';
    const lowStock=make('input','',make('label',tr('Low stock only','المخزون المنخفض فقط'),filters));lowStock.type='checkbox';
    lowStock.onchange=()=>load();
    const message = make('p', '', page);
    message.setAttribute('role', 'status');
    const list = make('div', '', page);
    let storeCatalogue = null;
    let storeCatalogueError = '';
    if (canConfigureRetail && hasLocations) {
      try { storeCatalogue = await retailRequest('/store/catalogue'); }
      catch (error) { storeCatalogueError = error?.message || 'STORE_CATALOGUE_UNAVAILABLE'; }
    }
    const storeProductById = new Map((storeCatalogue?.products || []).map(product => [product.id, product]));
    if(canManage){
      const management=make('details','',page);make('summary',tr('Manage locations','إدارة المواقع'),management);
      management.open = !hasLocations;
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
      form.className='sx-location-form';
      make('h2',hasLocations?tr('New stock location','موقع مخزون جديد'):tr('Set up your first stock location','إعداد أول موقع للمخزون'),form);
      make('p',tr('Track stock available for pickup or delivery at this location.','تتبّع المخزون المتاح للاستلام أو التوصيل من هذا الموقع.'),form);
      const code=make('input','',make('label',tr('Location code','رمز الموقع')+' ',form));code.required=true;code.maxLength=40;code.pattern='[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]';
      const nameEn=make('input','',make('label',tr('Name in English','الاسم بالإنجليزية')+' ',form));nameEn.required=true;nameEn.maxLength=120;
      const nameAr=make('input','',make('label',tr('Name in Arabic','الاسم بالعربية')+' ',form));nameAr.maxLength=120;nameAr.dir='auto';
      code.placeholder='doha-showroom';
      let suggestedCode='';
      nameEn.addEventListener('input',()=>{
        if(code.value!==suggestedCode)return;
        suggestedCode=nameEn.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40).replace(/^-|-$/g,'');
        code.value=suggestedCode;
      });
      form.append(nameEn.parentElement,nameAr.parentElement,code.parentElement);
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
    if (!hasLocations) {
      message.textContent = canManage
        ? tr('Add a stock location to start managing inventory.', 'أضف موقع مخزون للبدء في إدارة المخزون.')
        : tr('Inventory will appear once a manager adds a stock location.', 'سيظهر المخزون بعد أن يضيف المدير موقعاً للمخزون.');
      return;
    }
    if (canConfigureRetail) {
      const alertsPanel=make('section','',page);alertsPanel.className='sx-inventory-store-panel';
      make('h2',tr('Retail WhatsApp alerts','تنبيهات التجزئة عبر واتساب'),alertsPanel);
      make('p',tr('Order and stock alerts go to active owners and managers through the business WhatsApp connection. They do not message customers. Customer order updates are separate and require recorded consent.','تصل تنبيهات الطلبات والمخزون إلى المالكين والمديرين النشطين عبر اتصال واتساب الخاص بالنشاط، ولا ترسل رسائل للعملاء. تحديثات الطلبات للعملاء منفصلة وتتطلب موافقة مسجلة.'),alertsPanel);
      const alertStatus=make('p','',alertsPanel);alertStatus.setAttribute('role','status');
      try{
        const settings=await retailRequest('/store/settings'),notifications=settings.notifications||{};
        const ordersLabel=make('label','',alertsPanel),ordersToggle=make('input','',ordersLabel);ordersToggle.type='checkbox';ordersToggle.checked=Boolean(notifications.retailOrdersEnabled);
        make('span',tr('Enable staff order alerts','تفعيل تنبيهات الطلبات للموظفين'),ordersLabel);
        const inventoryLabel=make('label','',alertsPanel),inventoryToggle=make('input','',inventoryLabel);inventoryToggle.type='checkbox';inventoryToggle.checked=Boolean(notifications.retailInventoryEnabled);
        make('span',tr('Enable low-stock and back-in-stock alerts','تفعيل تنبيهات واتساب لانخفاض المخزون وعودته'),inventoryLabel);
        const saveAlerts=make('button',tr('Save notification settings','حفظ إعدادات الإشعارات'),alertsPanel);saveAlerts.type='button';
        saveAlerts.onclick=async()=>{
          saveAlerts.disabled=true;alertStatus.textContent=tr('Saving…','جارٍ الحفظ…');
          try{
            await retailRequest('/notifications',{method:'PUT',body:{retailOrdersEnabled:ordersToggle.checked,
              retailCustomerUpdatesEnabled:Boolean(notifications.retailCustomerUpdatesEnabled),retailInventoryEnabled:inventoryToggle.checked}});
            notifications.retailOrdersEnabled=ordersToggle.checked;notifications.retailInventoryEnabled=inventoryToggle.checked;
            alertStatus.textContent=tr('Notification settings saved.','تم حفظ إعدادات الإشعارات.');
          }catch{alertStatus.textContent=tr('Could not save the alert setting. Refresh and try again.','تعذر حفظ إعداد التنبيهات. حدّث الصفحة وحاول مرة أخرى.');}
          finally{saveAlerts.disabled=false;}
        };
      }catch{alertStatus.textContent=tr('Stock alert settings are unavailable. Reload this page to try again.','إعدادات تنبيهات المخزون غير متاحة. أعد تحميل الصفحة للمحاولة مرة أخرى.');alertStatus.setAttribute('role','alert');}
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
        const {items, hasMore} = await request('/?locationId='+encodeURIComponent(selectedLocationId)+'&offset=' + offset + '&search=' + encodeURIComponent(search.value)+(lowStock.checked?'&lowStock=1':''));
        if (current !== sequence) return;
        list.replaceChildren();
        message.textContent = items.length ? '' : tr('No matching products.', 'لا توجد منتجات مطابقة.');
        for (const item of items) {
          const row = make('section', '', list);
          const summary=make('div','',row);summary.className='sx-stock-summary';
          const identity=make('div','',summary);
          make('strong',(ar()?item.nameAr:item.nameEn)||item.nameEn||item.code,identity);
          make('small',item.code,identity).dir='auto';
          for(const [label,value] of [[tr('On hand','الكمية الفعلية'),item.quantity],[tr('Reserved','محجوز'),item.reserved],[tr('Available','متاح'),item.availableQuantity]]){
            const cell=make('div','',summary);make('small',label,cell);make('strong',value+' '+quantityUnit(item),cell);
          }
          if(item.lowStock)make('p',tr('Low stock at this location','مخزون منخفض في هذا الموقع'),row);
          const actions=make('details','',row);
          make('summary',tr('Stock details and actions','تفاصيل المخزون والإجراءات'),actions);
          const details = make('details', '', actions);
          make('summary', tr('Movement history', 'سجل الحركات'), details);
          details.addEventListener('toggle', async () => {
            if (!details.open || details.childElementCount > 1) return;
            const history = make('ul', '', details);
            try {
              const movements = await request('/' + item.id + '/history?locationId='+encodeURIComponent(selectedLocationId));
              if (!movements.length) make('li', tr('No movements yet.', 'لا توجد حركات بعد.'), history);
              for (const movement of movements) {
                const beforeUnit=quantityUnit({baseUnitCode:movement.previousUnit?.baseUnitCode||'unit',baseUnitLabel:movement.previousUnit?.baseUnitLabel||'',baseUnitLabelAr:movement.previousUnit?.baseUnitLabelAr||''});
                const afterUnit=quantityUnit({baseUnitCode:movement.unit?.baseUnitCode||'unit',baseUnitLabel:movement.unit?.baseUnitLabel||'',baseUnitLabelAr:movement.unit?.baseUnitLabelAr||''});
                make('li', movement.previousQuantity+' '+beforeUnit+' → '+movement.quantity+' '+afterUnit+' · '+movement.reason+' · '+new Date(movement.createdAt).toLocaleString(), history);
              }
            } catch { make('li', tr('Could not load history.', 'تعذر تحميل السجل.'), history); }
          });
          const storeProduct = storeProductById.get(item.id);
          if (canConfigureRetail && storeProduct) {
            const listing = make('details', '', actions); listing.className = 'sx-inventory-listing';
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
          const inventoryConfig=make('details','',actions);inventoryConfig.className='sx-inventory-store-panel';
          make('summary',tr('Unit and low-stock settings','إعدادات الوحدة والمخزون المنخفض'),inventoryConfig);
          make('p',tr('Set a base unit and the smallest allowed increment for this SKU. Unit conversions are not automatic. Keep whole units until the store confirms how each SKU is sold.',
            'حدد وحدة أساسية وأصغر زيادة مسموحة لهذا المنتج. لا يتم تحويل الوحدات تلقائياً. استخدم الوحدات الكاملة إلى أن يؤكد المتجر طريقة بيع كل منتج.'),inventoryConfig);
          const configFields=make('div','',inventoryConfig);configFields.className='sx-inventory-listing-fields';
          const unitSelect=make('select','',make('label',tr('Base unit','الوحدة الأساسية')+' ',configFields));
          for(const [value,labelEn,labelAr] of [['unit','Unit','وحدة'],['yard','Yard','ياردة'],['piece','Piece','قطعة'],['panel','Panel','لوحة'],['custom','Custom','مخصص']]){
            const option=make('option',tr(labelEn,labelAr),unitSelect);option.value=value;
          }
          unitSelect.value=item.baseUnitCode||'unit';
          const customLabel=make('input','',make('label',tr('Custom unit label','اسم الوحدة المخصصة')+' ',configFields));customLabel.maxLength=24;customLabel.value=item.baseUnitLabel||'';customLabel.hidden=unitSelect.value!=='custom';
          const customLabelAr=make('input','',make('label',tr('Custom unit label in Arabic','اسم الوحدة المخصصة بالعربية')+' ',configFields));customLabelAr.maxLength=24;customLabelAr.value=item.baseUnitLabelAr||'';customLabelAr.dir='auto';customLabelAr.hidden=unitSelect.value!=='custom';
          unitSelect.onchange=()=>{customLabel.hidden=customLabelAr.hidden=unitSelect.value!=='custom';};
          const precisionSelect=make('select','',make('label',tr('Maximum decimal places','أقصى عدد للمنازل العشرية')+' ',configFields));
          for(let precision=0;precision<=6;precision++){const option=make('option',String(precision),precisionSelect);option.value=String(precision);}
          precisionSelect.value=String(item.quantityPrecision||0);
          const incrementInput=make('input','',make('label',tr('Smallest allowed increment','أصغر زيادة مسموحة')+' ',configFields));
          incrementInput.type='text';incrementInput.inputMode='decimal';incrementInput.maxLength=12;incrementInput.value=item.quantityIncrement||'1';
          const saveUnit=make('button',tr('Save unit settings','حفظ إعدادات الوحدة'),inventoryConfig);saveUnit.type='button';
          saveUnit.onclick=async()=>{
            saveUnit.disabled=true;
            try{
              const saved=await request('/products/'+item.id+'/unit',{method:'PUT',body:{baseUnitCode:unitSelect.value,baseUnitLabel:customLabel.value.trim(),baseUnitLabelAr:customLabelAr.value.trim(),
                quantityPrecision:Number(precisionSelect.value),quantityIncrement:incrementInput.value.trim(),expectedRevision:String(item.unitRevision||0)}});
              message.textContent=saved.thresholdsDisabled?tr('Unit settings saved. Re-enter low-stock thresholds for each location.','تم حفظ إعدادات الوحدة. أعد إدخال حدود المخزون المنخفض لكل موقع.'):tr('Unit settings saved.','تم حفظ إعدادات الوحدة.');await load(offset);
            }catch(error){
              message.textContent=error.message==='INVENTORY_UNIT_LOCKED'?tr('This unit change needs a physical recount. Use the recount section below and count every location.',
                'يتطلب تغيير الوحدة إعادة جرد فعلي. استخدم قسم إعادة الجرد أدناه واحسب كل المواقع.'):
                error.message==='INVENTORY_UNIT_CHANGED'?tr('Unit settings changed. Reload and review the current values.','تغيرت إعدادات الوحدة. أعد التحميل وراجع القيم الحالية.'):
                tr('Unit settings could not be saved. Check the precision and increment.','تعذر حفظ إعدادات الوحدة. تحقق من الدقة والزيادة.');
            }finally{saveUnit.disabled=false;}
          };
          const rebaseDetails=make('details','',inventoryConfig);rebaseDetails.className='sx-inventory-listing';
          make('summary',tr('Change this SKU unit with a physical recount','تغيير وحدة المنتج عبر إعادة الجرد الفعلي'),rebaseDetails);
          make('p',tr('Use this only when recorded stock has been measured in a different unit. Enter a fresh physical count for every location. No conversion is inferred; previous movements keep their original unit, and low-stock thresholds are cleared.','استخدم هذا الخيار فقط إذا كان المخزون المسجل بوحدة مختلفة. أدخل الجرد الفعلي الجديد لكل موقع. لا يتم افتراض أي تحويل؛ تبقى الحركات السابقة بوحدتها الأصلية وتُمسح حدود المخزون المنخفض.'),rebaseDetails);
          const rebaseContent=make('div','',rebaseDetails);
          async function loadRebasePreview(){
            rebaseContent.replaceChildren();make('p',tr('Loading location balances…','جارٍ تحميل أرصدة المواقع…'),rebaseContent);
            try{
              const preview=await request('/products/'+item.id+'/unit/rebase-preview');
              rebaseContent.replaceChildren();
              const currentUnit={baseUnitCode:preview.product.baseUnitCode,baseUnitLabel:preview.product.baseUnitLabel,baseUnitLabelAr:preview.product.baseUnitLabelAr};
              make('p',tr('Current unit: ','الوحدة الحالية: ')+quantityUnit(currentUnit)+' · '+tr('profile revision ','مراجعة الإعداد ')+preview.product.unitRevision,rebaseContent);
              if(!preview.hasMovement){make('p',tr('This SKU has no stock movement history. Set its unit in the standard unit settings above.','لا توجد حركات مخزون لهذا المنتج. حدّد وحدته من الإعدادات أعلاه.'),rebaseContent);return;}
              if(preview.locationLimitExceeded){make('p',tr('This recount exceeds the supported 100-location limit. Contact support before changing this SKU’s unit.','تتجاوز إعادة الجرد الحد المدعوم البالغ 100 موقع. تواصل مع الدعم قبل تغيير وحدة هذا المنتج.'),rebaseContent);return;}
              if(preview.hasReservations||preview.hasOpenOrders)make('p',tr('Finish or cancel open orders and clear reservations before recounting this SKU.','أكمل الطلبات المفتوحة أو ألغها وأزل الحجوزات قبل إعادة جرد هذا المنتج.'),rebaseContent);
              if(preview.archivedStock)make('p',tr('An archived location still has stock. Restore that location and reconcile it before recounting.','لا يزال هناك مخزون في موقع مؤرشف. استعد الموقع وسوِّ مخزونه قبل إعادة الجرد.'),rebaseContent);
              if(!preview.canRebase){
                if(!preview.hasReservations&&!preview.hasOpenOrders&&!preview.archivedStock)make('p',tr('A physical recount is not available for this SKU right now. Refresh and review the stock history.','إعادة الجرد غير متاحة لهذا المنتج حالياً. حدّث الصفحة وراجع سجل المخزون.'),rebaseContent);
                return;
              }
              const form=make('form','',rebaseContent);const fields=[];
              make('h3',tr('Physical count by location','الجرد الفعلي حسب الموقع'),form);
              for(const location of preview.locations){
                const section=make('section','',form);section.style.marginBlock='10px';
                const locationName=(ar()?location.nameAr:location.nameEn)||location.nameEn||location.code;
                make('strong',locationName+(location.status==='archived'?' · '+tr('Archived','مؤرشف'):'')+' · '+location.code,section);
                make('p',tr('Recorded balance: ','الرصيد المسجل: ')+location.currentQuantity+' '+quantityUnit(currentUnit)+
                  ' · '+tr('Reserved: ','محجوز: ')+location.reserved+' '+quantityUnit(currentUnit),section);
                const input=make('input','',make('label',tr('New physical count in ','الكمية الفعلية الجديدة بوحدة ')+quantityUnit({baseUnitCode:unitSelect.value,baseUnitLabel:customLabel.value,baseUnitLabelAr:customLabelAr.value})+' ',section));
                input.type='text';input.inputMode='decimal';input.required=true;input.min='0';input.maxLength=12;input.autocomplete='off';input.placeholder=tr('Enter the count; it is not prefilled','أدخل الكمية؛ لن تُملأ تلقائياً');
                fields.push({locationId:location.id,expectedStockRevision:String(location.expectedStockRevision),archived:location.status==='archived',input});
              }
              const why=make('input','',make('label',tr('Recount reason','سبب إعادة الجرد')+' ',form));why.type='text';why.required=true;why.maxLength=120;
              const status=make('p','',form);status.setAttribute('role','status');
              const submit=make('button',tr('Apply physical recount','تطبيق الجرد الفعلي'),form);submit.type='submit';let pending=null;
              form.onsubmit=async event=>{
                event.preventDefault();const body={baseUnitCode:unitSelect.value,baseUnitLabel:customLabel.value.trim(),baseUnitLabelAr:customLabelAr.value.trim(),
                  quantityPrecision:Number(precisionSelect.value),quantityIncrement:incrementInput.value.trim(),expectedUnitRevision:String(preview.product.unitRevision),reason:why.value.trim(),
                  locations:fields.map(field=>({locationId:field.locationId,expectedStockRevision:field.expectedStockRevision,quantity:field.input.value.trim()}))};
                if(fields.some(field=>quantityToMicro(field.input.value)===null)){status.textContent=tr('Enter a valid non-negative count for every location.','أدخل كمية صحيحة غير سالبة لكل موقع.');return;}
                if(fields.some(field=>field.archived&&quantityToMicro(field.input.value)>0n)){status.textContent=tr('Archived locations must remain at zero. Restore the location before recording stock there.','يجب أن يبقى رصيد المواقع المؤرشفة صفراً. استعد الموقع قبل تسجيل مخزون فيه.');return;}
                const signature=JSON.stringify(body);if(pending?.signature!==signature)pending={signature,requestId:crypto.randomUUID()};
                submit.disabled=true;status.textContent=tr('Saving audited recount…','جارٍ حفظ إعادة الجرد وتوثيقها…');
                try{
                  const result=await request('/products/'+item.id+'/unit/rebase',{method:'POST',body:{...body,requestId:pending.requestId}});
                  await load(offset);message.textContent=result.replayed?tr('Recount was already applied.','تم تطبيق إعادة الجرد مسبقاً.'):tr('Unit changed and physical stock was recounted. Re-enter low-stock thresholds for each location.','تم تغيير الوحدة وإعادة جرد المخزون فعلياً. أعد إدخال حدود المخزون المنخفض لكل موقع.');
                }catch(error){
                  const messages={STOCK_CHANGED:tr('Stock changed after this preview. Close and reopen the recount, then review the new balances.','تغير المخزون بعد هذه المعاينة. أغلق إعادة الجرد وافتحها ثم راجع الأرصدة الجديدة.'),
                    INVENTORY_UNIT_CHANGED:tr('The unit profile changed. Refresh and review the current values.','تغير إعداد الوحدة. حدّث الصفحة وراجع القيم الحالية.'),
                    INVENTORY_REBASE_HAS_OPEN_STOCK:tr('Open orders or reservations now block this recount. Resolve them and refresh.','تمنع الطلبات المفتوحة أو الحجوزات إعادة الجرد الآن. عالجها ثم حدّث.'),
                    INVENTORY_REBASE_LOCATIONS_CHANGED:tr('The location list changed. Refresh the preview before recounting.','تغيرت قائمة المواقع. حدّث المعاينة قبل إعادة الجرد.'),
                    INVENTORY_REBASE_ARCHIVED_STOCK:tr('Restore the archived location and reconcile its stock before recounting.','استعد الموقع المؤرشف وسوِّ مخزونه قبل إعادة الجرد.'),
                    INVENTORY_REBASE_UNIT_UNCHANGED:tr('Choose a different unit profile above, or use a normal stock count.','اختر إعداد وحدة مختلفاً أعلاه أو استخدم تصحيح المخزون المعتاد.')};
                  status.textContent=messages[error.message]||tr('Recount was not applied. Check the target unit, precision, increment and all location counts.','لم تُطبق إعادة الجرد. تحقق من الوحدة والدقة والزيادة وكميات جميع المواقع.');
                }finally{submit.disabled=false;}
              };
            }catch{rebaseContent.replaceChildren();const error=make('p',tr('Could not load the recount preview. Refresh and try again.','تعذر تحميل معاينة إعادة الجرد. حدّث الصفحة وحاول مرة أخرى.'),rebaseContent);error.setAttribute('role','alert');}
          }
          rebaseDetails.addEventListener('toggle',()=>{if(rebaseDetails.open)loadRebasePreview();});
          const units=quantityUnitNames(item);
          const thresholdInput=make('input','',make('label',tr('Low-stock threshold at this location','حد المخزون المنخفض في هذا الموقع')+' · '+quantityUnit(item)+' ',configFields));
          thresholdInput.type='text';thresholdInput.inputMode='decimal';thresholdInput.maxLength=12;thresholdInput.value=item.lowStockThreshold||'';thresholdInput.placeholder=tr('Disabled','معطل');
          const saveThreshold=make('button',tr('Save threshold','حفظ الحد'),inventoryConfig);saveThreshold.type='button';
          saveThreshold.onclick=async()=>{
            saveThreshold.disabled=true;
            try{
              await request('/products/'+item.id+'/threshold',{method:'PUT',body:{locationId:selectedLocationId,lowStockThreshold:thresholdInput.value.trim()||null,
                expectedRevision:String(item.thresholdRevision||0)}});
              message.textContent=tr('Low-stock threshold saved.','تم حفظ حد المخزون المنخفض.');await load(offset);
            }catch{message.textContent=tr('Threshold could not be saved. Use a value that matches this SKU’s increment.','تعذر حفظ الحد. استخدم قيمة توافق زيادة هذا المنتج.');}
            finally{saveThreshold.disabled=false;}
          };
          const unitNotice=tr('Stock settings are per SKU and location. This pilot does not convert between yards, pieces, panels or other units.',
            'إعدادات المخزون لكل منتج وموقع. لا يحول هذا الإصدار بين الياردات والقطع والألواح أو الوحدات الأخرى.');make('p',unitNotice,inventoryConfig);
          const form = make('form', '', actions);
          const mode = make('select', '', make('label', tr('Stock action', 'إجراء المخزون'), form));
          make('option', tr('Adjust count', 'تصحيح الكمية'), mode).value = 'adjust';
          make('option', tr('Receive stock', 'استلام مخزون'), mode).value = 'receive';
          const quantityLabel = make('label', '', form);
          const quantityTitle = make('span', tr('New count ('+units[0]+')', 'الكمية الجديدة ('+units[1]+')'), quantityLabel);
          const quantity = make('input', '', quantityLabel);
          mode.onchange = () => {
            const receiving = mode.value === 'receive';
            quantityTitle.textContent = receiving ? tr('Receive ('+units[0]+')', 'استلام ('+units[1]+')') : tr('New count ('+units[0]+')', 'الكمية الجديدة ('+units[1]+')');
            quantity.min = receiving ? item.quantityIncrement : '0';
            quantity.max = '1000000000';
            quantity.value = receiving ? '' : item.quantity;
          };
          Object.assign(quantity, {type: 'number', step: item.quantityIncrement||'1', min: '0', max: '1000000000', required: true, value: item.quantity});
          const reason = make('input', '', make('label', tr('Reason', 'السبب') + ' ', form));
          Object.assign(reason, {required: true, maxLength: 200});
          const save = make('button', tr('Save count', 'حفظ الكمية'), form);
          let pending;
          form.onsubmit = async event => {
            event.preventDefault();
            const entered=quantityToMicro(quantity.value),onHand=quantityToMicro(item.quantity);
            if(entered===null||onHand===null)return;
            const total=mode.value==='receive'?entered+onHand:entered;
            const values = {locationId:selectedLocationId,expectedRevision: item.revision, quantity: quantityFromMicro(total), reason: reason.value.trim()};
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
            const transfer=make('details','',actions);make('summary',tr('Transfer stock to another location','نقل المخزون إلى موقع آخر'),transfer);
            const target=make('select','',make('label',tr('Destination','الوجهة')+' ',transfer));
            for(const location of activeLocations.filter(value=>value.id!==selectedLocationId)){
              const option=make('option',(ar()?location.nameAr:location.nameEn)||location.nameEn,target);option.value=location.id;
            }
            const amount=make('input','',make('label',tr('Quantity to transfer ('+units[0]+')','الكمية المراد نقلها ('+units[1]+')')+' ',transfer));
            amount.type='number';amount.step=item.quantityIncrement||'1';amount.min=item.quantityIncrement||'1';amount.max=item.availableQuantity;amount.required=true;
            const transferReason=make('input','',make('label',tr('Reason','السبب')+' ',transfer));transferReason.required=true;transferReason.maxLength=200;
            const transferButton=make('button',tr('Transfer','نقل'),transfer);transferButton.type='button';
            let transferPending;
            transferButton.onclick=async()=>{
              const amountMicro=quantityToMicro(amount.value);
              const stepMicro=quantityToMicro(item.quantityIncrement||'1');
              const body={productId:item.id,sourceLocationId:selectedLocationId,targetLocationId:target.value,quantity:amount.value,reason:transferReason.value.trim()};
              if(!body.targetLocationId||amountMicro===null||stepMicro===null||amountMicro<stepMicro||amountMicro%stepMicro!==0n||!body.reason)return;
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
    button(filters, tr('Search', 'بحث'), () => load());
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
})();
