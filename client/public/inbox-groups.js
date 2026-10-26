(() => {
  'use strict';
  if (window.__sxInboxGroups) return;
  window.__sxInboxGroups = true;
  const ar = () => document.documentElement.dir === 'rtl' || /^(ar|arabic)/i.test(localStorage.getItem('language') || '');
  const tr = (english, arabic) => ar() ? arabic : english;
  const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const element = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
  const api = (path, options) => window.SaleMaxWorkspace.request('inbox', '/groups' + path, options);
  const active = () => /^\/(user|agent)\/?$/.test(location.pathname) && new URLSearchParams(location.search).get('page') === 'inbox';
  const selectedGroup = () => { const chat = read('currentChat'); return String(chat?.chat_id || '').startsWith('qrgroup_') ? chat : null; };
  const button = (text, action) => { const node = element('button', text); node.type = 'button'; if (typeof action === 'function') node.onclick = event => { event.preventDefault(); event.stopPropagation(); try { Promise.resolve(action()).catch(error => { if (notice) notice.textContent = String(error?.message || error); }); } catch (error) { if (notice) notice.textContent = String(error?.message || error); } }; return node; };
  let controls, notice, info, host, currentKey = '', sequence = 0, lastLoad = 0, queued = false;

  function clearInfo() {
    sequence++; currentKey = ''; info?.remove(); info = null;
    host?.removeAttribute('data-sx-group-info-host'); host = null;
    document.documentElement.removeAttribute('data-sx-group-selected');
    for (const node of document.querySelectorAll('[data-sx-group-original]')) { node.textContent = node.dataset.sxGroupOriginal; delete node.dataset.sxGroupOriginal; }
  }
  function contactBlock() {
    const label = [...document.querySelectorAll('span')].find(node => node.children.length === 0 && ['Contact Info', 'معلومات الاتصال', 'معلومات جهة الاتصال'].includes(node.textContent.trim()));
    return label?.parentElement?.parentElement?.parentElement || null;
  }
  function filterPanel() {
    const titles = ['Filters', 'الفلاتر', 'تصفية', 'عوامل التصفية'];
    const title = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,span,p,div')].find(node => titles.includes(node.textContent.trim()) && node.getBoundingClientRect().width > 0);
    if (!title) return null;
    for (let panel = title.parentElement, depth = 0; panel && depth < 8; panel = panel.parentElement, depth++) {
      const text = panel.textContent;
      const hasSections = ar()
        ? ['التعيين', 'الأصل', 'الوكيل', 'رقم واتساب'].filter(label => text.includes(label)).length >= 2
        : ['Assignment', 'Origin', 'Agent', 'WhatsApp Number'].filter(label => text.includes(label)).length >= 2;
      if (hasSections && panel.querySelectorAll('select,input,[role="combobox"],[aria-haspopup="listbox"]').length >= 1) return { panel, anchor: title.parentElement };
    }
    return null;
  }
  function section(title, expanded = false) {
    const node = element('details', null, 'sx-group-section'); node.open = expanded;
    node.append(element('summary', title)); return node;
  }
  function safeUrl(value) { try { const url = new URL(value, location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
  function insertMention(member) {
    if (!member.phone) return;
    const input = document.querySelector('textarea:not([readonly])');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(input, `${input.value || ''} @${member.phone} `);
    input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
  }
  function memberImport(chat) {
    const panel = section(tr('Save members to Phonebook', 'حفظ الأعضاء في دليل الهاتف'));
    const body = element('div'), status = element('p'); status.setAttribute('role', 'status');
    const errorText = error => {
      const text = String(error?.message || error);
      const messages = {
        PHONEBOOK_NAME_EXISTS: tr('This phonebook name exists. Choose it from the list or use another name.', 'اسم دليل الهاتف موجود. اختره من القائمة أو استخدم اسمًا آخر.'),
        CONTACT_LIMIT_EXCEEDED: tr('This selection exceeds your contact limit. Select fewer members.', 'يتجاوز التحديد حد جهات الاتصال. اختر عددًا أقل.'),
        GROUP_REFRESH_REQUIRED: tr('Connect the QR number and fetch the members again.', 'صل رقم QR واجلب الأعضاء مرة أخرى.'),
        GROUP_MEMBERS_CHANGED: tr('Group membership changed. Fetch the members again.', 'تغير أعضاء المجموعة. اجلب الأعضاء مرة أخرى.'),
        GROUP_CONTACT_IMPORT_DENIED: tr('Phonebook management permission is required.', 'يلزم إذن إدارة دليل الهاتف.'),
      };
      return Object.entries(messages).find(([code]) => text.includes(code))?.[1] || text;
    };
    const fetch = button(tr('Fetch members', 'جلب الأعضاء'), async () => {
      fetch.disabled = true; status.textContent = tr('Fetching current members…', 'جارٍ جلب الأعضاء الحاليين…');
      try {
        const preview = await api('/member-import?chatId=' + encodeURIComponent(chat.chat_id));
        if (selectedGroup()?.chat_id !== chat.chat_id || !panel.isConnected) return;
        body.replaceChildren();
        const selected = new Set(preview.members.map(member => member.mobile));
        const targetLabel = element('label', tr('Target phonebook', 'دليل الهاتف المستهدف'));
        const target = element('select'); target.setAttribute('aria-label', targetLabel.textContent);
        const create = element('option', tr('Create a new phonebook', 'إنشاء دليل هاتف جديد')); create.value = ''; target.append(create);
        for (const book of preview.books) { const option = element('option', book.name); option.value = book.id; target.append(option); }
        targetLabel.append(target);
        const nameLabel = element('label', tr('New phonebook name', 'اسم دليل الهاتف الجديد'));
        const name = element('input'); name.maxLength = 200; name.value = preview.suggestedName; name.setAttribute('aria-label', nameLabel.textContent); nameLabel.append(name);
        target.onchange = () => { nameLabel.hidden = !!target.value; };
        const summary = element('p', `${preview.members.length} ${tr('available', 'متاح')} · ${preview.unavailable} ${tr('without a usable number', 'بدون رقم صالح')} · ${preview.remaining} ${tr('contact slots remaining', 'جهة اتصال متبقية')}`);
        const allLabel = element('label'), all = element('input'); all.type = 'checkbox'; all.checked = selected.size > 0;
        allLabel.append(all, document.createTextNode(tr(' Select all available members', ' تحديد جميع الأعضاء المتاحين')));
        const search = element('input'); search.type = 'search'; search.placeholder = tr('Search members to import', 'البحث عن أعضاء للاستيراد'); search.setAttribute('aria-label', search.placeholder);
        const list = element('div', null, 'sx-group-member-list'); let limit = 100;
        const fieldset = element('fieldset', null, 'sx-group-import-fields');
        const save = button('', async () => {
          if (!selected.size) return;
          fieldset.disabled = true; fetch.disabled = true; status.textContent = tr('Importing selected members…', 'جارٍ استيراد الأعضاء المحددين…');
          try {
            const result = await api('/member-import', { method: 'POST', body: { chatId: chat.chat_id, mobiles: [...selected], ...(target.value ? { bookId: Number(target.value) } : { newBookName: name.value.trim() }) } });
            status.textContent = `${result.imported} ${tr('added', 'تمت إضافتهم')} · ${result.duplicates} ${tr('already in this phonebook', 'موجودون بالفعل في دليل الهاتف')} · ${result.book.name}`;
            if (![...target.options].some(option => option.value === String(result.book.id))) { const option = element('option', result.book.name); option.value = result.book.id; target.append(option); }
            target.value = result.book.id; target.onchange();
            selected.clear(); draw();
          } catch (error) { status.textContent = errorText(error); }
          finally { fieldset.disabled = false; fetch.disabled = false; update(); }
        });
        const update = () => { save.textContent = `${tr('Import selected', 'استيراد المحدد')} (${selected.size})`; save.disabled = !selected.size; all.checked = selected.size === preview.members.length && selected.size > 0; all.indeterminate = selected.size > 0 && selected.size < preview.members.length; };
        const draw = () => {
          list.replaceChildren(); const term = search.value.toLowerCase();
          const matches = preview.members.filter(member => `${member.name} ${member.mobile}`.toLowerCase().includes(term));
          for (const member of matches.slice(0, limit)) {
            const label = element('label', null, 'sx-group-member'), checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(member.mobile);
            checkbox.onchange = () => { if (checkbox.checked) selected.add(member.mobile); else selected.delete(member.mobile); update(); };
            const identity = element('span');
            if (member.name !== member.mobile) identity.append(element('bdi', member.name));
            const number = element('small', '+' + member.mobile); number.dir = 'ltr'; identity.append(number);
            label.append(checkbox, identity); list.append(label);
          }
          if (matches.length > limit) list.append(button(tr('Show more members', 'عرض المزيد من الأعضاء'), () => { limit += 100; draw(); }));
          update();
        };
        all.onchange = () => { selected.clear(); if (all.checked) for (const member of preview.members) selected.add(member.mobile); draw(); };
        search.oninput = () => { limit = 100; draw(); };
        fieldset.append(targetLabel, nameLabel, summary, allLabel, search, list, save); body.append(fieldset); draw(); status.textContent = '';
      } catch (error) { status.textContent = errorText(error); }
      finally { fetch.disabled = false; }
    });
    panel.append(fetch, body, status); return panel;
  }
  function render(data, chat) {
    if (!info?.isConnected) return;
    const group = data.group; info.replaceChildren();
    const overview = section(tr('Group details', 'تفاصيل المجموعة'), true);
    overview.append(element('strong', group.subject), element('p', group.description || tr('No group description', 'لا يوجد وصف للمجموعة')));
    const connected = (() => { try { return JSON.parse(chat.origin_instance_id || '{}').id?.split('@')[0]?.split(':')[0]; } catch { return ''; } })();
    if (connected) overview.append(element('p', tr('Connected number: ', 'الرقم المتصل: ') + connected));
    overview.append(element('p', group.announce ? tr('Only admins can send messages', 'يمكن للمشرفين فقط إرسال الرسائل') : tr('Members can send messages', 'يمكن للأعضاء إرسال الرسائل')));
    if (group.createdAt) overview.append(element('small', tr('Created ', 'أُنشئت في ') + new Date(group.createdAt * 1000).toLocaleDateString(ar() ? 'ar-QA' : 'en-QA')));
    if (data.stale) overview.append(element('p', tr('Showing saved group information', 'عرض معلومات المجموعة المحفوظة')));
    overview.append(button(tr('Refresh group info', 'تحديث معلومات المجموعة'), () => load(chat, true)));
    const members = section(`${tr('Members', 'الأعضاء')} (${group.participants?.length || 0})`);
    const search = element('input'); search.type = 'search'; search.placeholder = tr('Search members', 'البحث عن أعضاء'); search.setAttribute('aria-label', search.placeholder);
    const list = element('div', null, 'sx-group-member-list');
    let limit = 80;
    const draw = () => {
      list.replaceChildren();
      const matches = (group.participants || []).filter(member => `${member.name} ${member.phone} ${member.jid}`.toLowerCase().includes(search.value.toLowerCase()));
      for (const member of matches.slice(0, limit)) {
        const row = element('div', null, 'sx-group-member');
        row.append(element('strong', member.name || member.phone || member.jid));
        if (member.phone && member.name) row.append(element('small', '+' + member.phone));
        if (['admin', 'superadmin'].includes(member.role)) row.append(element('span', tr('Admin', 'مشرف'), 'sx-group-admin'));
        if (member.phone) row.append(button('@', () => insertMention(member)));
        list.append(row);
      }
      if (matches.length > limit) list.append(button(tr('Show more members', 'عرض المزيد من الأعضاء'), () => { limit += 80; draw(); }));
    };
    search.oninput = () => { limit = 80; draw(); }; members.append(search, list); draw();
    const shared = section(tr('Shared media & files', 'الوسائط والملفات المشتركة'));
    const media = element('div', null, 'sx-group-shared-media'); shared.append(media);
    let before = 0, loading = false, loaded = false;
    const more = button(tr('Load more', 'تحميل المزيد'), () => loadMedia());
    async function loadMedia() {
      if (loading) return; loading = true; more.disabled = true;
      try {
        const result = await api('/messages?media=1&chatId=' + encodeURIComponent(chat.chat_id) + (before ? '&before=' + before : ''));
        if (selectedGroup()?.chat_id !== chat.chat_id) return;
        more.remove();
        for (const message of [...(result.messages || [])].reverse()) {
          const payload = message.msgContext?.[message.type] || {}, link = safeUrl(payload.link); if (!link) continue;
          const card = element('article');
          if (message.type === 'image') { const image = element('img'); image.src = link; image.loading = 'lazy'; image.alt = payload.caption || tr('Group image', 'صورة المجموعة'); card.append(image); }
          const open = element('a', payload.filename || payload.caption || tr(message.type, message.type)); open.href = link; open.target = '_blank'; open.rel = 'noopener noreferrer'; card.append(open);
          card.append(element('small', message.senderName || '')); media.append(card);
        }
        if (result.messages?.length) before = result.messages[0].id;
        if (!before) media.append(element('p', tr('No shared media saved yet', 'لا توجد وسائط مشتركة محفوظة بعد')));
        if (result.more) media.append(more);
        loaded = true;
      } catch (error) { media.append(element('p', String(error.message))); }
      finally { loading = false; more.disabled = false; }
    }
    shared.ontoggle = () => { if (shared.open && !loaded) loadMedia(); };
    info.append(overview, members);
    if (data.canImportMembers) info.append(memberImport(chat));
    info.append(shared);
  }
  async function load(chat, force = false) {
    const id = ++sequence; lastLoad = Date.now();
    try {
      const data = await api('/details?chatId=' + encodeURIComponent(chat.chat_id) + (force ? '&refresh=1' : ''));
      if (id !== sequence || selectedGroup()?.chat_id !== chat.chat_id) return;
      render(data, chat);
      for (const node of document.querySelectorAll('[data-sx-group-original]')) if (node.dataset.sxGroupOriginal.includes('@g.us')) node.textContent = `${data.group.participants?.length || 0} ${tr('members', 'أعضاء')}`;
    } catch (error) { if (id === sequence && info) info.replaceChildren(element('p', tr('Group info could not load: ', 'تعذر تحميل معلومات المجموعة: ') + error.message), button(tr('Retry', 'إعادة المحاولة'), () => load(chat, true))); }
  }
  function mount() {
    if (!active()) { controls?.remove(); controls = null; clearInfo(); return; }
    const target = filterPanel();
    // Migrate a persisted old Groups-only filter once, while preserving other
    // Inbox filters. The backend now includes both conversation kinds even if
    // a cached client still sends the old direct-only value.
    const savedFilters = read('chatFilters');
    if (savedFilters?.conversationKind === 'group') {
      const unifiedFilters = { ...savedFilters, conversationKind: 'all' };
      if (unifiedFilters.origin === 'qr') unifiedFilters.origin = '';
      localStorage.setItem('chatFilters', JSON.stringify(unifiedFilters));
      if (!sessionStorage.getItem('sxInboxUnifiedGroupsReload')) {
        sessionStorage.setItem('sxInboxUnifiedGroupsReload', '1');
        location.reload();
        return;
      }
    }
    // Remove controls left in the old Chats / Groups toggle location.
    for (const stale of document.querySelectorAll('.sx-inbox-view-switch')) stale.remove();
    const heading = [...document.querySelectorAll('h6')].find(node => ['Inbox', 'صندوق الوارد', 'الوارد'].includes(node.textContent.trim()));
    if (heading && target && (!controls || !controls.isConnected)) {
      controls = element('div', null, 'sx-group-sync-control');
      const sync = button(tr('Sync groups', 'مزامنة المجموعات'), async () => {
        sync.disabled = true; notice.textContent = tr('Syncing…', 'جارٍ المزامنة…');
        try {
          const data = await api('/'), selected = read('chatFilters')?.instance || '';
          const instances = data.instances.filter(item => !selected || item.uniqueId === selected || item.number === selected);
          let synced = 0;
          for (const item of instances) if (item.status === 'ACTIVE') { await api('/sync', { method: 'POST', body: { instanceId: item.uniqueId } }); synced++; }
          if (!synced) { notice.textContent = tr('No connected QR numbers are available to sync.', 'لا توجد أرقام QR متصلة للمزامنة.'); return; }
          notice.textContent = tr('Groups synced. Refreshing Inbox…', 'تمت مزامنة المجموعات. جارٍ تحديث صندوق الوارد…');
          location.reload();
        }
        finally { sync.disabled = false; }
      }); sync.dataset.sxGroupSync = '1'; controls.append(sync);
      notice = element('small', '', 'sx-group-notice'); notice.setAttribute('role', 'status'); controls.append(notice);
    }
    if (controls) {
      if (target) {
        if (controls.parentElement !== target.panel) target.anchor.insertAdjacentElement('afterend', controls);
      } else if (controls.isConnected) controls.remove();
    }
    const chat = selectedGroup();
    if (!chat) { if (info || host) clearInfo(); return; }
    document.documentElement.setAttribute('data-sx-group-selected', '1');
    for (const node of document.querySelectorAll('span,p')) {
      if (node.children.length || node.closest('#sx-inbox-group-info')) continue;
      const text = node.textContent.trim();
      if (text === '+' + chat.sender_mobile || text === chat.sender_mobile || ['Chat Info', 'معلومات المحادثة', 'معلومات الدردشة'].includes(text)) {
        if (!node.dataset.sxGroupOriginal) node.dataset.sxGroupOriginal = text;
        node.textContent = text.includes('@g.us') ? tr('WhatsApp group', 'مجموعة واتساب') : tr('Group Info', 'معلومات المجموعة');
      }
    }
    const block = contactBlock();
    if (!block?.parentElement) return;
    if (host !== block.parentElement) { host?.removeAttribute('data-sx-group-info-host'); host = block.parentElement; }
    host.setAttribute('data-sx-group-info-host', '1');
    if (!info || !info.isConnected) { info = element('section'); info.id = 'sx-inbox-group-info'; host.append(info); }
    const key = `${chat.chat_id}:${ar()}:${localStorage.getItem('wacrm_user') || localStorage.getItem('wacrm_agent') || 'cookie'}`;
    if (key !== currentKey || Date.now() - lastLoad > 300000) { currentKey = key; info.replaceChildren(element('p', tr('Loading group info…', 'جارٍ تحميل معلومات المجموعة…'))); load(chat); }
  }
  const style = element('style'); style.textContent = '.sx-group-sync-control{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;padding:8px 12px;border-top:1px solid #e6ebf2}.sx-group-sync-control button{border:1px solid #cbd5e1;border-radius:7px;background:transparent;color:inherit;min-height:32px;padding:5px 12px;font:600 12px Arial;cursor:pointer}.sx-group-sync-control button:disabled{opacity:.6;cursor:wait}.sx-group-notice{font-size:11px;color:#64748b}[data-sx-group-info-host]>:nth-child(n+3):not(#sx-inbox-group-info){display:none!important}#sx-inbox-group-info{font:12px/1.5 Arial;color:inherit;overflow-wrap:anywhere}#sx-inbox-group-info p{white-space:pre-wrap;margin:7px 0}#sx-inbox-group-info small{display:block;color:#718096}.sx-group-section{padding:10px 12px;border-bottom:1px solid #e4e9f1}.sx-group-section>summary{font-weight:700;cursor:pointer;padding:3px 0}.sx-group-section input{box-sizing:border-box;width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:6px;margin:8px 0;background:transparent;color:inherit}.sx-group-section button{font:inherit;border:1px solid #cbd5e1;border-radius:6px;padding:4px 7px;margin:5px 0;background:transparent;color:inherit;cursor:pointer}.sx-group-member-list{max-height:360px;overflow:auto}.sx-group-member{border-bottom:1px solid #eef1f5;padding:7px 0;display:flex;align-items:center;gap:5px;flex-wrap:wrap}.sx-group-member strong{flex:1 1 110px}.sx-group-admin{font-size:10px;background:#eaf2ff;color:#1768d4;border-radius:8px;padding:2px 5px}.sx-group-shared-media article{padding:8px 0;border-bottom:1px solid #e4e9f1}.sx-group-shared-media img{width:100%;max-height:180px;object-fit:contain;border-radius:7px}.sx-group-shared-media a{color:#1768d4;display:block;overflow-wrap:anywhere}'; document.head.append(style);
  style.textContent += '.sx-group-import-fields{border:0;padding:0;min-width:0}.sx-group-import-fields label{display:block;margin:8px 0}.sx-group-import-fields label[hidden]{display:none!important}.sx-group-import-fields select{box-sizing:border-box;width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:6px;background:transparent;color:inherit}.sx-group-import-fields input[type=checkbox]{width:auto;flex:0 0 auto;margin:0 6px 0 0}.sx-group-import-fields .sx-group-member{display:flex;font-weight:400}.sx-group-import-fields .sx-group-member span{flex:1;min-width:0}.sx-group-import-fields bdi{display:block}.sx-group-import-fields small[dir=ltr]{unicode-bidi:isolate;text-align:start}';
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; mount(); }); }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(mount, 1500); mount();
})();
