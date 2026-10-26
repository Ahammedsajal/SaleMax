(() => {
  'use strict';
  if (window.__sxInboxGroups) return;
  window.__sxInboxGroups = true;
  const ar = () => document.documentElement.dir === 'rtl' || /^(ar|arabic)/i.test(localStorage.getItem('language') || '');
  const tr = (english, arabic) => ar() ? arabic : english;
  const element = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
  const api = (path, options) => window.SaleMaxWorkspace.request('inbox', '/groups' + path, options);
  let dialog, content, status, selected = '', page = 'messages', details, replyTo = '', timer, generation = 0;
  const button = (text, action) => { const node = element('button', text); node.type = 'button'; node.onclick = () => Promise.resolve(action()).catch(showError); return node; };
  const showError = error => { if (status) status.textContent = tr('Could not complete this action: ', 'تعذر إكمال الإجراء: ') + String(error?.message || error); };
  function safeUrl(value) { try { const url = new URL(value, location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
  function shell() {
    if (dialog?.isConnected) return;
    dialog = element('dialog', null, 'sx-groups-dialog');
    dialog.setAttribute('aria-label', tr('WhatsApp groups', 'مجموعات واتساب'));
    const header = element('header');
    header.append(element('h2', tr('WhatsApp groups', 'مجموعات واتساب')), button('×', () => dialog.close()));
    status = element('p', '', 'sx-groups-status'); status.setAttribute('role', 'status');
    content = element('div', null, 'sx-groups-content');
    dialog.append(header, status, content); document.body.append(dialog);
    dialog.addEventListener('close', () => { clearInterval(timer); generation++; selected = ''; });
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  }
  async function directory() {
    selected = ''; generation++;
    const result = await api('/');
    content.replaceChildren();
    const toolbar = element('div', null, 'sx-groups-toolbar');
    const instances = element('select'); instances.setAttribute('aria-label', tr('WhatsApp number', 'رقم واتساب'));
    for (const item of result.instances || []) { const option = element('option', `${item.title || ''} ${item.number || ''}`); option.value = item.uniqueId; instances.append(option); }
    const search = element('input'); search.type = 'search'; search.placeholder = tr('Search groups', 'البحث في المجموعات');
    const list = element('div', null, 'sx-groups-directory');
    const render = () => {
      list.replaceChildren();
      const matches = (result.groups || []).filter(group => group.instanceId === instances.value && group.subject.toLowerCase().includes(search.value.toLowerCase()));
      for (const group of matches) list.append(button(`${group.subject} · ${group.members} ${tr('members', 'أعضاء')}${group.unread ? ` · ${group.unread} ${tr('unread', 'غير مقروءة')}` : ''}`, () => openGroup(group.chatId)));
      if (!matches.length) list.append(element('p', tr('No groups loaded. Choose a connected number and sync groups.', 'لا توجد مجموعات محملة. اختر رقماً متصلاً ثم مزامنة المجموعات.')));
    };
    search.oninput = render; instances.onchange = render;
    toolbar.append(instances, button(tr('Sync groups', 'مزامنة المجموعات'), async () => {
      status.textContent = tr('Loading groups…', 'جارٍ تحميل المجموعات…');
      await api('/sync', { method: 'POST', body: { instanceId: instances.value } });
      status.textContent = ''; await directory();
    }), search);
    content.append(toolbar, element('p', tr('Groups do not create leads or Phonebook contacts. Bots and automation are disabled.', 'المجموعات لا تنشئ عملاء محتملين أو جهات اتصال في دفتر الهاتف. الروبوتات والأتمتة معطلة.')), list);
    render();
  }
  async function openGroup(chatId) {
    selected = chatId; page = 'messages'; replyTo = ''; const seq = ++generation;
    details = await api('/details?chatId=' + encodeURIComponent(chatId));
    if (seq !== generation) return;
    content.replaceChildren(); status.textContent = details.stale ? tr('Showing saved group information; WhatsApp is unavailable.', 'عرض المعلومات المحفوظة؛ واتساب غير متاح.') : '';
    const toolbar = element('div', null, 'sx-groups-toolbar');
    toolbar.append(button(tr('All groups', 'كل المجموعات'), directory), element('strong', details.group.subject));
    if (safeUrl(details.group.photo)) { const photo = element('img'); photo.src = safeUrl(details.group.photo); photo.alt = ''; photo.width = 40; photo.height = 40; photo.style.borderRadius = '50%'; toolbar.prepend(photo); }
    for (const [key, english, arabic] of [['messages', 'Messages', 'الرسائل'], ['members', 'Members', 'الأعضاء'], ['media', 'Media', 'الوسائط']]) toolbar.append(button(tr(english, arabic), async () => { page = key; await renderGroup(); }));
    content.append(toolbar, element('p', details.group.description || ''), element('div', null, 'sx-groups-body'));
    await renderGroup();
  }
  async function renderGroup() {
    if (!selected || !dialog.open) return;
    const area = content.querySelector('.sx-groups-body'); if (!area) return;
    const seq = generation, chatId = selected, view = page;
    if (view === 'members') {
      area.replaceChildren();
      const search = element('input'); search.type = 'search'; search.placeholder = tr('Search members', 'البحث عن أعضاء');
      const list = element('div');
      const render = () => { list.replaceChildren(); for (const member of details.group.participants || []) {
        const label = `${member.name || member.phone || member.jid} ${member.phone && member.name ? '· ' + member.phone : ''} · ${member.role}`;
        if (label.toLowerCase().includes(search.value.toLowerCase())) list.append(element('p', label));
      } };
      search.oninput = render; area.append(search, element('p', tr('Member list is read-only. Manage membership in WhatsApp.', 'قائمة الأعضاء للعرض فقط. إدارة العضوية من واتساب.')), list); render(); return;
    }
    const result = await api('/messages?chatId=' + encodeURIComponent(chatId) + (view === 'media' ? '&media=1' : ''));
    if (seq !== generation || view !== page || chatId !== selected) return;
    area.replaceChildren();
    const list = element('div', null, 'sx-groups-messages');
    function messageRow(message, prepend = false) {
      const card = element('article', null, 'sx-group-message');
      card.dataset.route = message.route;
      const context = message.msgContext || {}, payload = context[message.type] || {};
      card.append(element('strong', message.route === 'OUTGOING' ? tr('You', 'أنت') : context.group?.participantName || message.senderName || message.senderMobile || tr('Member', 'عضو')));
      card.append(element('small', new Date(Number(message.timestamp) * 1000).toLocaleString()));
      if (message.context?.conversation) card.append(element('blockquote', message.context.conversation));
      if (message.type === 'text') card.append(element('p', context.text?.body || ''));
      else if (message.type === 'contact') card.append(element('p', [payload.name || payload.displayName || tr('Contact', 'جهة اتصال'), payload.vcard || ''].filter(Boolean).join('\n')));
      else if (message.type === 'location') {
        card.append(element('p', [payload.name, payload.address].filter(Boolean).join('\n')));
        if (Number.isFinite(Number(payload.latitude)) && Number.isFinite(Number(payload.longitude))) { const map = element('a', tr('Open location', 'فتح الموقع')); map.href = `https://maps.google.com/?q=${encodeURIComponent(payload.latitude + ',' + payload.longitude)}`; map.target = '_blank'; map.rel = 'noopener noreferrer'; card.append(map); }
      }
      else {
        const link = safeUrl(payload.link);
        if (link && ['image', 'video', 'audio'].includes(message.type)) {
          const media = element(message.type === 'image' ? 'img' : message.type);
          media.src = link; if (message.type !== 'image') { media.controls = true; media.preload = 'none'; } else { media.loading = 'lazy'; media.alt = payload.caption || tr('Group image', 'صورة المجموعة'); }
          card.append(media);
        } else if (link) { const file = element('a', payload.filename || tr('Open document', 'فتح المستند')); file.href = link; file.target = '_blank'; file.rel = 'noopener noreferrer'; card.append(file); }
        else card.append(element('p', `[${message.type}]`));
        if (payload.caption) card.append(element('p', payload.caption));
      }
      if (message.reaction) card.append(element('span', message.reaction));
      if (view === 'messages') card.append(button(tr('Reply', 'رد'), () => { replyTo = message.metaChatId; status.textContent = tr('Replying to ', 'الرد على ') + (message.senderName || ''); area.querySelector('textarea')?.focus(); }));
      if (prepend) list.prepend(card); else list.append(card);
    }
    for (const message of result.messages || []) messageRow(message);
    if (result.more && result.messages?.length) {
      const older = button(tr('Load older', 'تحميل الأقدم'), async () => {
        const more = await api('/messages?chatId=' + encodeURIComponent(chatId) + '&before=' + result.messages[0].id + (view === 'media' ? '&media=1' : ''));
        for (const message of [...(more.messages || [])].reverse()) messageRow(message, true);
        older.remove();
      }); area.append(older);
    }
    area.append(list);
    if (!result.messages?.length) list.append(element('p', tr('New group messages will appear here. Earlier WhatsApp history is not guaranteed.', 'ستظهر رسائل المجموعة الجديدة هنا. سجل واتساب السابق غير مضمون.')));
    if (view === 'messages') {
      const form = element('form', null, 'sx-groups-compose'), text = element('textarea'); text.maxLength = 4000; text.placeholder = tr('Message this group', 'رسالة لهذه المجموعة'); text.setAttribute('aria-label', text.placeholder);
      const mention = element('select'); mention.setAttribute('aria-label', tr('Mention member', 'ذكر عضو')); mention.append(element('option', tr('Mention member…', 'ذكر عضو…')));
      const mentions = new Set();
      for (const member of details.group.participants || []) { const option = element('option', member.name || member.phone || member.jid); option.value = member.jid; mention.append(option); }
      mention.onchange = () => { if (mention.selectedIndex > 0) { mentions.add(mention.value); text.value += ` @${mention.selectedOptions[0].textContent} `; mention.selectedIndex = 0; text.focus(); } };
      const send = element('button', tr('Send to group', 'إرسال للمجموعة')); send.type = 'submit';
      form.onsubmit = async event => { event.preventDefault(); if (!text.value.trim()) return; send.disabled = true; try {
        await api('/send', { method: 'POST', body: { chatId, text: text.value, mentions: [...mentions], replyTo: replyTo || undefined } });
        replyTo = ''; status.textContent = ''; await renderGroup();
      } catch (error) { showError(error); send.disabled = false; } };
      form.append(text, mention, button(tr('Cancel reply', 'إلغاء الرد'), () => { replyTo = ''; status.textContent = ''; }), send); area.append(form);
    }
    list.scrollTop = list.scrollHeight;
  }
  function mount() {
    if (!/^\/(user|agent)\/?$/.test(location.pathname) || new URLSearchParams(location.search).get('page') !== 'inbox') { document.getElementById('sx-inbox-groups-entry')?.remove(); if (dialog?.open) dialog.close(); return; }
    if (!document.getElementById('sx-inbox-groups-entry')) {
      const entry = button(tr('WhatsApp groups', 'مجموعات واتساب'), async () => { shell(); dialog.dir = ar() ? 'rtl' : 'ltr'; dialog.showModal(); await directory(); clearInterval(timer); timer = setInterval(() => { if (selected && page === 'messages' && !content.querySelector('textarea')?.value) renderGroup().catch(showError); }, 12000); });
      entry.id = 'sx-inbox-groups-entry'; entry.className = 'sx-groups-entry'; document.body.append(entry);
    }
    document.getElementById('sx-inbox-groups-entry').textContent = tr('WhatsApp groups', 'مجموعات واتساب');
    const entry = document.getElementById('sx-inbox-groups-entry');
    const heading = [...document.querySelectorAll('h6')].find(node => ['Inbox', 'صندوق الوارد', 'الوارد'].includes(node.textContent.trim()));
    if (heading?.parentElement && entry.parentElement !== heading.parentElement) {
      heading.parentElement.append(entry);
      entry.style.cssText = 'position:static;z-index:auto;margin-inline-start:8px;padding:6px 9px;border-radius:8px;font-size:11px;white-space:nowrap';
    }
  }
  const style = element('style'); style.textContent = '.sx-groups-entry{position:fixed;bottom:16px;inset-inline-end:22px;z-index:1250;background:#1768d4;color:white;border:0;border-radius:20px;padding:10px 18px;font:600 13px Arial;cursor:pointer}.sx-groups-dialog{box-sizing:border-box;width:min(1080px,96vw);height:min(880px,94dvh);max-height:94dvh;border:1px solid #d7deea;border-radius:16px;padding:18px;background:#fff;color:#172033;font:14px/1.5 Arial;overflow:auto}.sx-groups-dialog::backdrop{background:#10203988}.sx-groups-dialog header,.sx-groups-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.sx-groups-dialog header{justify-content:space-between}.sx-groups-dialog h2{margin:0}.sx-groups-dialog button,.sx-groups-dialog select,.sx-groups-dialog input{font:inherit;min-height:36px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:7px;background:white;color:inherit}.sx-groups-dialog button{cursor:pointer}.sx-groups-directory{display:grid;gap:8px}.sx-groups-directory button{text-align:start}.sx-groups-status{color:#ad3449;min-height:20px}.sx-groups-messages{max-height:50dvh;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:10px;background:#f3f6fa}.sx-group-message{align-self:flex-start;max-width:85%;padding:12px;border:1px solid #d8e0eb;border-radius:10px;background:white;overflow-wrap:anywhere}.sx-group-message[data-route=OUTGOING]{align-self:flex-end;background:#e6efff}.sx-group-message strong,.sx-group-message small{display:block}.sx-group-message small{color:#667085}.sx-group-message p{white-space:pre-wrap;margin:6px 0}.sx-group-message img,.sx-group-message video{max-width:100%;max-height:260px}.sx-group-message audio{max-width:100%}.sx-group-message blockquote{border-inline-start:3px solid #1768d4;padding:6px;margin:6px 0;background:#eef3fa}.sx-groups-compose{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.sx-groups-compose textarea{box-sizing:border-box;flex:1 0 100%;min-height:75px;font:inherit;padding:10px;border:1px solid #cbd5e1;border-radius:8px}'; document.head.append(style);
  setInterval(mount, 1500); mount();
})();
