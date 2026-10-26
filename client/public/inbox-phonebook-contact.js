(() => {
  'use strict';
  if (window.__sxInboxPhonebookContact) return;
  window.__sxInboxPhonebookContact = true;

  const isArabic = () => window.SaleMaxLocale?.isArabic?.() ?? ((document.documentElement.lang || localStorage.getItem('language') || '').toLowerCase().startsWith('ar') || document.documentElement.dir === 'rtl');
  const copy = () => isArabic()
    ? { title: 'تفاصيل دفتر الهاتف', loading: 'جارٍ تحميل تفاصيل دفتر الهاتف…', empty: 'لا توجد جهة اتصال محفوظة لهذا الرقم في دفتر الهاتف.', unavailable: 'تعذر تحميل تفاصيل دفتر الهاتف. تحقق من صلاحية الوصول وحاول مجددًا.', retry: 'إعادة المحاولة', phonebook: 'دفتر الهاتف', name: 'الاسم', mobile: 'رقم الهاتف', added: 'تاريخ الإضافة', more: 'توجد نتائج إضافية؛ عُرضت أول 100 جهة اتصال.' }
    : { title: 'Phonebook details', loading: 'Loading saved Phonebook details…', empty: 'No saved Phonebook contacts match this number.', unavailable: 'Phonebook details could not be loaded. Check access and retry.', retry: 'Retry', phonebook: 'Phonebook', name: 'Name', mobile: 'Mobile number', added: 'Added', more: 'More matches exist; showing the first 100 contacts.' };
  const active = () => {
    const path = location.pathname.replace(/\/$/, '');
    const page = new URLSearchParams(location.search).get('page');
    return (path === '/user' || path === '/agent') && page === 'inbox';
  };
  const chat = () => { try { return JSON.parse(localStorage.getItem('currentChat') || 'null'); } catch { return null; } };
  const mobileDigits = value => String(value || '').replace(/\D/g, '');
  const identityKey = value => { let hash = 2166136261; for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return `${value.length}:${hash >>> 0}`; };
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  let root = null, currentKey = '', sequence = 0, lastLookupAt = 0, expanded = false;

  function contactBlock() {
    const heading = [...document.querySelectorAll('span,h2,h3,h4,div')].find(node => node.children.length === 0 && ['Contact Info', 'معلومات الاتصال', 'معلومات جهة الاتصال'].includes((node.textContent || '').trim()));
    return heading?.parentElement?.parentElement?.parentElement || null;
  }

  function mobileFromPanel() {
    const block = contactBlock();
    if (!block) return '';
    const label = [...block.querySelectorAll('*')].find(node => node.children.length === 0 && /^(mobile number|phone|رقم الهاتف|رقم الجوال)$/i.test((node.textContent || '').trim()));
    const text = label?.parentElement?.innerText || '';
    return text.replace(label?.textContent || '', '').match(/\+?[0-9][0-9\s().-]{6,20}/)?.[0]?.trim() || '';
  }

  function currentMobile() {
    const current = chat();
    return String(current?.sender_mobile || current?.senderMobile || current?.mobile || current?.mobile_number || current?.phone || mobileFromPanel()).trim();
  }

  function ensureRoot(block) {
    if (!root || !root.isConnected) {
      root = el('section', 'sx-inbox-phonebook');
      root.id = 'sx-inbox-phonebook-contact-details';
      root.setAttribute('aria-live', 'polite');
    }
    if (root.previousElementSibling !== block) block.after(root);
  }

  function addLine(container, label, value) {
    if (value == null || String(value).trim() === '') return;
    const row = el('div', 'sx-inbox-phonebook__row');
    row.append(el('dt', '', label), el('dd', '', String(value)));
    container.append(row);
  }

  function render(contacts = [], status = '', truncated = false, retry = null) {
    if (!root?.isConnected) return;
    const text = copy();
    root.replaceChildren();
    const toggle = el('button', 'sx-inbox-phonebook__toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-controls', 'sx-inbox-phonebook-contact-details-body');
    toggle.append(el('span', '', text.title), el('span', 'sx-inbox-phonebook__chevron', expanded ? '−' : '+'));
    toggle.addEventListener('click', () => { expanded = !expanded; render(contacts, status, truncated, retry); });
    const body = el('div', 'sx-inbox-phonebook__body');
    body.id = 'sx-inbox-phonebook-contact-details-body';
    body.hidden = !expanded;
    root.append(toggle, body);
    if (status) {
      body.append(el('p', 'sx-inbox-phonebook__status', status));
      if (retry) {
        const button = el('button', 'sx-inbox-phonebook__retry', copy().retry);
        button.type = 'button'; button.addEventListener('click', retry); body.append(button);
      }
      return;
    }
    for (const contact of contacts) {
      const card = el('article', 'sx-inbox-phonebook__card');
      const title = el('div', 'sx-inbox-phonebook__card-title');
      title.append(el('strong', '', contact.name || text.name));
      if (contact.phonebookName) title.append(el('span', '', contact.phonebookName));
      const fields = el('dl', 'sx-inbox-phonebook__fields');
      addLine(fields, text.mobile, contact.mobile);
      for (const field of contact.fields || []) addLine(fields, field.label, field.value);
      if (contact.createdAt) {
        const date = new Date(contact.createdAt);
        addLine(fields, text.added, Number.isNaN(date.getTime()) ? contact.createdAt : date.toLocaleString(isArabic() ? 'ar-QA' : 'en-QA'));
      }
      card.append(title, fields);
      body.append(card);
    }
    if (truncated) body.append(el('p', 'sx-inbox-phonebook__status', text.more));
    if (!contacts.length) body.append(el('p', 'sx-inbox-phonebook__status', text.empty));
  }

  function addStyles() {
    if (document.getElementById('sx-inbox-phonebook-styles')) return;
    const style = el('style');
    style.id = 'sx-inbox-phonebook-styles';
    style.textContent = `
      .sx-inbox-phonebook{border-top:1px solid #e6eaf0;padding:10px 12px 12px;color:#172033;font-size:12px;line-height:1.45}
      .sx-inbox-phonebook__toggle{display:flex;align-items:center;justify-content:space-between;width:100%;border:0;padding:0;background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:700;text-align:start;cursor:pointer}
      .sx-inbox-phonebook__chevron{font-size:16px;line-height:1;color:#667085}
      .sx-inbox-phonebook__body{padding-top:8px}.sx-inbox-phonebook__body[hidden]{display:none}
      .sx-inbox-phonebook__status{margin:0;color:#718096;font-size:11px}
      .sx-inbox-phonebook__card{border:1px solid #e6eaf0;border-radius:8px;padding:8px;margin:0 0 7px;overflow-wrap:anywhere}
      .sx-inbox-phonebook__card-title{display:flex;flex-direction:column;gap:2px;margin-bottom:5px}
      .sx-inbox-phonebook__card-title strong{font-size:12px}
      .sx-inbox-phonebook__card-title span{color:#667085;font-size:11px}
      .sx-inbox-phonebook__fields{margin:0;display:grid;gap:4px}
      .sx-inbox-phonebook__row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:8px}
      .sx-inbox-phonebook__row dt{color:#748094}.sx-inbox-phonebook__row dd{margin:0;text-align:end;font-weight:600;white-space:pre-wrap}
      .sx-inbox-phonebook__retry{margin-top:7px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:4px 8px;color:#2459a6;cursor:pointer;font-size:11px}
    `;
    document.head.append(style);
  }

  async function load(key, mobile) {
    const seq = ++sequence;
    lastLookupAt = Date.now();
    render([], copy().loading);
    try {
      const result = await window.SaleMaxWorkspace.request('phonebook', '/contact-matches', { method: 'POST', body: { mobile } });
      if (seq !== sequence || key !== currentKey) return;
      render(Array.isArray(result.contacts) ? result.contacts : [], '', !!result.truncated);
    } catch {
      if (seq === sequence && key === currentKey) render([], copy().unavailable, false, () => { lastLookupAt = 0; load(key, mobile); });
    }
  }

  function mount() {
    const block = active() ? contactBlock() : null;
    if (!block) {
      root?.remove(); root = null; currentKey = ''; sequence++;
      return;
    }
    addStyles();
    ensureRoot(block);
    const current = chat(), mobile = currentMobile(), digits = mobileDigits(mobile);
    const actor = location.pathname.replace(/\/$/, '') === '/agent' ? 'agent' : 'user';
    const identity = identityKey(localStorage.getItem(actor === 'agent' ? 'wacrm_agent' : 'wacrm_user') || 'cookie');
    const key = `${actor}:${identity}:${current?.chat_id || current?.id || ''}:${digits}`;
    if (!digits || key.endsWith(':')) {
      if (currentKey !== key) { currentKey = key; sequence++; expanded = false; }
      render([], copy().empty);
      return;
    }
    if (key === currentKey && Date.now() - lastLookupAt < 60000) return;
    if (key !== currentKey) expanded = false;
    currentKey = key;
    lastLookupAt = Date.now();
    load(key, mobile);
  }

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; mount(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(mount, 1200);
  mount();
})();
