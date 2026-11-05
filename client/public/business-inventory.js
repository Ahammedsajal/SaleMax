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
      if (active()) render(access.permissions['inventory.manage']);
    } catch {
      if (active()) make('p', tr('Inventory is unavailable. Reload to try again.', 'المخزون غير متاح. أعد تحميل الصفحة للمحاولة.'), document.body);
    }
  }

  function render(canManage) {
    const page = make('main', '', document.body);
    page.id = 'sx-business-inventory';
    page.dir = ar() ? 'rtl' : 'ltr';
    Object.assign(page.style, {position: 'fixed', insetBlock: '64px 0', insetInline: 'var(--sx-sidebar-inline-offset, 0px) 0', zIndex: '1200', overflow: 'auto', padding: 'clamp(1rem, 4vw, 3rem)', background: 'Canvas', color: 'CanvasText', colorScheme: 'light dark'});
    make('style', '#sx-business-inventory label{display:inline-flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin:.25rem .5rem .25rem 0}#sx-business-inventory input,#sx-business-inventory button{min-height:44px;max-inline-size:100%;box-sizing:border-box}#sx-business-inventory form{margin-block:1rem}#sx-business-inventory section{overflow-wrap:anywhere}@media(max-width:767px){#sx-business-inventory{inset-inline:0!important}}', page);
    const back = make('a', tr('Products & services', 'المنتجات والخدمات'), page);
    back.href = '/user?page=products-services';
    make('h1', tr('Inventory', 'المخزون'), page);
    const search = make('input', '', make('label', tr('Search products', 'البحث عن المنتجات') + ' ', page));
    search.type = 'search';
    const message = make('p', '', page);
    message.setAttribute('role', 'status');
    const list = make('div', '', page);
    let sequence = 0;
    async function load(offset = 0) {
      const current = ++sequence;
      message.textContent = tr('Loading…', 'جارٍ التحميل…');
      try {
        const {items, hasMore} = await request('/?offset=' + offset + '&search=' + encodeURIComponent(search.value));
        if (current !== sequence) return;
        list.replaceChildren();
        message.textContent = items.length ? '' : tr('No matching products.', 'لا توجد منتجات مطابقة.');
        for (const item of items) {
          const row = make('section', '', list);
          row.style.borderBlockEnd = '1px solid GrayText';
          make('h2', (ar() ? item.nameAr : item.nameEn) || item.nameEn || item.code, row);
          make('p', item.code + ' · ' + tr('On hand', 'المتوفر') + ' ' + item.quantity, row);
          const details = make('details', '', row);
          make('summary', tr('Movement history', 'سجل الحركات'), details);
          details.addEventListener('toggle', async () => {
            if (!details.open || details.childElementCount > 1) return;
            const history = make('ul', '', details);
            try {
              const movements = await request('/' + item.id + '/history');
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
            const values = {expectedRevision: item.revision, quantity: quantity.valueAsNumber + (mode.value === 'receive' ? item.quantity : 0), reason: reason.value.trim()};
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
              } else {
                message.textContent = tr('Could not save the count. Try again.', 'تعذر حفظ الكمية. حاول مرة أخرى.');
              }
            } finally { save.disabled = false; }
          };
        }
        if (offset) button(list, tr('Previous', 'السابق'), () => load(Math.max(0, offset - 50)));
        if (hasMore) button(list, tr('Next', 'التالي'), () => load(offset + 50));
      } catch { if (current === sequence) message.textContent = tr('Could not load inventory.', 'تعذر تحميل المخزون.'); }
    }
    search.addEventListener('search', () => load());
    search.addEventListener('change', () => load());
    button(page, tr('Search', 'بحث'), () => load());
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
})();
