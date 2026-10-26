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
  const groupMode = () => read('chatFilters')?.conversationKind === 'group';
  const selectedGroup = () => { const chat = read('currentChat'); return String(chat?.chat_id || '').startsWith('qrgroup_') ? chat : null; };
  const button = (text, action) => { const node = element('button', text); node.type = 'button'; node.onclick = () => Promise.resolve(action()).catch(error => { notice.textContent = String(error?.message || error); }); return node; };
  let controls, notice, info, host, currentKey = '', sequence = 0, lastLoad = 0, queued = false;

  // Reuse the native Inbox provider's existing actions. This maintained hook
  // never changes the compiled bundle or creates a second conversation layout.
  function nativeInbox(node) {
    for (let parent = node; parent; parent = parent.parentElement) {
      const key = Object.keys(parent).find(name => name.startsWith('__reactFiber$'));
      for (let fiber = key && parent[key], depth = 0; fiber && depth < 60; fiber = fiber.return, depth++) {
        const value = fiber.memoizedProps?.value;
        if (typeof value?.loadChatList === 'function' && typeof value?.loadConversation === 'function') return value;
      }
    }
    return null;
  }

  function switchMode(kind) {
    const filters = { ...(read('chatFilters') || {}), conversationKind: kind, origin: kind === 'group' ? 'qr' : '', offset: 0, search: '' };
    localStorage.setItem('chatFilters', JSON.stringify(filters));
    localStorage.removeItem('currentChat'); localStorage.removeItem('chatInfo'); localStorage.removeItem('conversationArr');
    const inbox = nativeInbox(controls);
    if (inbox) { inbox.clearConversation(); inbox.clearChatInfo(); inbox.loadChatList(filters, false); mount(); }
    else { localStorage.removeItem('chatList'); location.reload(); }
  }

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
    info.append(overview, members, shared);
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
    // Remove controls left in the old heading location by a cached earlier hook.
    for (const stale of document.querySelectorAll('.sx-inbox-view-switch')) if (stale !== controls && (!target || !target.panel.contains(stale))) stale.remove();
    const heading = [...document.querySelectorAll('h6')].find(node => ['Inbox', 'صندوق الوارد', 'الوارد'].includes(node.textContent.trim()));
    if (heading && (!controls || !controls.isConnected)) {
      controls = element('div', null, 'sx-inbox-view-switch');
      controls.append(button(tr('Chats', 'المحادثات'), () => switchMode('direct')), button(tr('Groups', 'المجموعات'), () => switchMode('group')));
      const sync = button(tr('Sync groups', 'مزامنة المجموعات'), async () => {
        sync.disabled = true; notice.textContent = tr('Syncing…', 'جارٍ المزامنة…');
        try { const data = await api('/'), selected = read('chatFilters')?.instance || ''; const instances = data.instances.filter(item => !selected || item.uniqueId === selected || item.number === selected); for (const item of instances) if (item.status === 'ACTIVE') await api('/sync', { method: 'POST', body: { instanceId: item.uniqueId } }); notice.textContent = ''; const inbox = nativeInbox(controls); if (inbox) inbox.loadChatList({ conversationKind: 'group', origin: 'qr', offset: 0 }); else location.reload(); }
        finally { sync.disabled = false; }
      }); sync.dataset.sxGroupSync = '1'; controls.append(sync);
      notice = element('small', '', 'sx-group-notice'); notice.setAttribute('role', 'status'); controls.append(notice);
      const title = element('strong', tr('Conversation type', 'نوع المحادثة'), 'sx-inbox-view-title');
      controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', tr('Conversation type', 'نوع المحادثة'));
      controls.prepend(title);
    }
    if (controls) {
      if (target) {
        if (controls.parentElement !== target.panel) target.anchor.insertAdjacentElement('afterend', controls);
      } else if (controls.isConnected) controls.remove();
      const buttons = controls.querySelectorAll('button'); buttons[0].setAttribute('aria-pressed', String(!groupMode())); buttons[1].setAttribute('aria-pressed', String(groupMode())); buttons[2].hidden = !groupMode();
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
  const style = element('style'); style.textContent = '.sx-inbox-view-switch{display:flex;align-items:center;gap:6px;flex-wrap:wrap;box-sizing:border-box;width:100%;padding:10px 12px;margin:8px 0;border-block:1px solid #e6ebf2}.sx-inbox-view-title{flex:0 0 100%;font-size:11px;color:#64748b}.sx-inbox-view-switch button{border:1px solid #cbd5e1;border-radius:7px;background:transparent;color:inherit;min-height:32px;padding:5px 12px;font:600 12px Arial;cursor:pointer;white-space:nowrap}.sx-inbox-view-switch button[aria-pressed=true]{background:#1768d4;color:white;border-color:#1768d4}.sx-inbox-view-switch button[hidden]{display:none}.sx-group-notice{font-size:10px;color:#64748b}[data-sx-group-info-host]>:nth-child(n+3):not(#sx-inbox-group-info){display:none!important}#sx-inbox-group-info{font:12px/1.5 Arial;color:inherit;overflow-wrap:anywhere}#sx-inbox-group-info p{white-space:pre-wrap;margin:7px 0}#sx-inbox-group-info small{display:block;color:#718096}.sx-group-section{padding:10px 12px;border-bottom:1px solid #e4e9f1}.sx-group-section>summary{font-weight:700;cursor:pointer;padding:3px 0}.sx-group-section input{box-sizing:border-box;width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:6px;margin:8px 0;background:transparent;color:inherit}.sx-group-section button{font:inherit;border:1px solid #cbd5e1;border-radius:6px;padding:4px 7px;margin:5px 0;background:transparent;color:inherit;cursor:pointer}.sx-group-member-list{max-height:360px;overflow:auto}.sx-group-member{border-bottom:1px solid #eef1f5;padding:7px 0;display:flex;align-items:center;gap:5px;flex-wrap:wrap}.sx-group-member strong{flex:1 1 110px}.sx-group-admin{font-size:10px;background:#eaf2ff;color:#1768d4;border-radius:8px;padding:2px 5px}.sx-group-shared-media article{padding:8px 0;border-bottom:1px solid #e4e9f1}.sx-group-shared-media img{width:100%;max-height:180px;object-fit:contain;border-radius:7px}.sx-group-shared-media a{color:#1768d4;display:block;overflow-wrap:anywhere}'; document.head.append(style);
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; mount(); }); }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(mount, 1500); mount();
})();
