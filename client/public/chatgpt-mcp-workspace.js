(() => {
  'use strict';
  if (window.__sxChatGPTWorkspaceLoaded) return;
  window.__sxChatGPTWorkspaceLoaded = true;
  const translations = {
    en: { label:'ChatGPT', title:'ChatGPT for 7Network', intro:'Ask about permitted leads and follow-ups, then turn decisions into assigned 7Network tasks.', back:'Back to workspace', setupEyebrow:'Connect your own account', setupTitle:'Use 7Network from ChatGPT', setupBody:'Add the MCP server in ChatGPT. Sign in to 7Network in the authorization window and choose the access you want to grant.', endpointLabel:'MCP server URL', copy:'Copy URL', copied:'Copied', copyFailed:'Copy the URL from the field.', stepsTitle:'What you can do', step1:'Search permitted pipeline leads, review follow-ups, and prepare evidence-based next steps or reply drafts.', step2:'Read your follow-up tasks and create a task assigned to your connected account.', step3:'Update task status. ChatGPT cannot send WhatsApp messages or contact customers in this pilot.', step4:'If you separately grant conversation access, ChatGPT can read up to 20 recent text messages for a permitted lead to help draft a reply. Media and sender fields are omitted; message text may itself contain personal data. Messages are never sent.', setupLink:'Open ChatGPT', connectionsTitle:'Connected ChatGPT accounts', connectionsBody:'Each connection is tied to the signed-in 7Network account and its current role. Revoke it here to stop future requests.', loading:'Loading connection status…', empty:'No ChatGPT accounts are connected yet.', retry:'Try again', revoke:'Disconnect', revoked:'Disconnected', connected:'Connected', role:'7Network role', scopes:'Permissions', connectedAt:'Connected', usedAt:'Last used', never:'Not used yet', confirmRevoke:'Disconnect this ChatGPT account from 7Network?', error:'Could not load the connection settings. Refresh and try again.', revokeError:'Could not disconnect this account. Try again.', revokeSuccess:'Connection disconnected.', unavailable:'This role or plan cannot use the ChatGPT lead workflow.', permissionNote:'ChatGPT can only see the records allowed for the connected account. Staff assignments, plan access and account revocation are checked again on every request.', planNote:'Custom MCP connections are configured in ChatGPT by a workspace administrator. ChatGPT plan availability and write-action controls are managed by OpenAI.', scopePipeline:'Pipeline leads and follow-ups', scopeConversation:'Recent lead conversation text (optional)', scopeTaskRead:'Read follow-up tasks', scopeTaskManage:'Create and update follow-up tasks', scopeOffline:'Keep connection active', statusConnected:'Connected', statusRevoked:'Disconnected' },
    ar: { label:'ChatGPT', title:'ChatGPT لـ 7Network', intro:'اسأل عن العملاء والمتابعات المسموح بها، ثم حوّل القرارات إلى مهام مسندة داخل 7Network.', back:'العودة إلى مساحة العمل', setupEyebrow:'اربط حسابك الخاص', setupTitle:'استخدم 7Network من ChatGPT', setupBody:'أضف خادم MCP في ChatGPT. سجّل الدخول إلى 7Network في نافذة التفويض واختر الصلاحيات التي تريد منحها.', endpointLabel:'عنوان خادم MCP', copy:'نسخ الرابط', copied:'تم النسخ', copyFailed:'انسخ الرابط من الحقل.', stepsTitle:'ما الذي يمكنك فعله', step1:'ابحث في العملاء المسموحين وراجع المتابعات، وجهّز الخطوات التالية أو مسودات الردود استناداً إلى الأدلة.', step2:'اقرأ مهام المتابعة وأنشئ مهمة مسندة إلى حسابك المتصل.', step3:'حدّث حالة المهمة. لا يستطيع ChatGPT إرسال رسائل واتساب أو التواصل مع العملاء في هذه النسخة التجريبية.', step4:'إذا منحت صلاحية قراءة المحادثات بشكل منفصل، يمكن لـ ChatGPT قراءة آخر 20 رسالة نصية كحد أقصى لعميل مسموح به للمساعدة في إعداد مسودة رد. لا تتم مشاركة الوسائط أو حقول المرسل، وقد يتضمن نص الرسائل بيانات شخصية. لا يتم إرسال الرسائل.', setupLink:'فتح ChatGPT', connectionsTitle:'حسابات ChatGPT المتصلة', connectionsBody:'يرتبط كل اتصال بحساب 7Network المسجل حالياً ودوره الحالي. ألغِ الاتصال هنا لإيقاف الطلبات القادمة.', loading:'جارٍ تحميل حالة الاتصال…', empty:'لا توجد حسابات ChatGPT متصلة بعد.', retry:'إعادة المحاولة', revoke:'قطع الاتصال', revoked:'تم قطع الاتصال', connected:'متصل', role:'دور 7Network', scopes:'الصلاحيات', connectedAt:'تاريخ الاتصال', usedAt:'آخر استخدام', never:'لم يُستخدم بعد', confirmRevoke:'هل تريد قطع اتصال حساب ChatGPT هذا عن 7Network؟', error:'تعذر تحميل إعدادات الاتصال. حدّث الصفحة وحاول مرة أخرى.', revokeError:'تعذر قطع الاتصال. حاول مرة أخرى.', revokeSuccess:'تم قطع الاتصال.', unavailable:'هذا الدور أو الاشتراك لا يدعم سير عمل العملاء في ChatGPT.', permissionNote:'لا يرى ChatGPT إلا السجلات المسموح بها للحساب المتصل. يعاد التحقق من تعيينات الموظفين وصلاحيات الخطة وإلغاء الحساب مع كل طلب.', planNote:'يربط مسؤول مساحة العمل خوادم MCP المخصصة في ChatGPT. وتُدار إتاحة الخطط والتحكم بإجراءات الكتابة من OpenAI.', scopePipeline:'العملاء المحتملون والمتابعات', scopeConversation:'نصوص المحادثات الحديثة (اختياري)', scopeTaskRead:'قراءة مهام المتابعة', scopeTaskManage:'إنشاء مهام المتابعة وتحديثها', scopeOffline:'إبقاء الاتصال نشطاً', statusConnected:'متصل', statusRevoked:'مقطوع' },
  };
  const roleNames = { owner:['Owner','المالك'], manager:['Manager','المدير'], team_leader:['Team leader','قائد الفريق'], agent:['Agent','الوكيل'], accountant:['Accountant','المحاسب'] };
  const scopeNames = { 'pipeline.read':'scopePipeline', 'conversations.read':'scopeConversation', 'tasks.read':'scopeTaskRead', 'tasks.manage':'scopeTaskManage', offline_access:'scopeOffline' };
  const tr = key => translations[language()][key] || translations.en[key] || key;
  function language() { try { return /^(ar(?:[-_]|$)|arabic)/i.test(localStorage.getItem('language') || document.documentElement.lang || '') ? 'ar' : 'en'; } catch (_) { return 'en'; } }
  function addApiPath() { if (window.SaleMaxWorkspace?.paths) window.SaleMaxWorkspace.paths.chatgpt = '/api/workspace/chatgpt'; }
  let statusPromise = null;
  async function getStatus() {
    addApiPath();
    if (!window.SaleMaxWorkspace) throw new Error('WORKSPACE_API_UNAVAILABLE');
    const result = await window.SaleMaxWorkspace.request('chatgpt', '/connections');
    return result.data;
  }

  function addNavRow(list) {
    if (list.querySelector('[data-sx-chatgpt-nav]')) return;
    const template = list.querySelector(':scope > li:not([data-sx-nav-section])');
    if (!template) return;
    const row = template.cloneNode(true);
    row.dataset.sxChatgptNav = '1'; row.hidden = false;
    for (const attr of [...row.attributes]) if (/^data-sx-.*nav$/.test(attr.name) && attr.name !== 'data-sx-chatgpt-nav') row.removeAttribute(attr.name);
    row.removeAttribute('data-salemax-pipeline-link'); row.removeAttribute('data-sx-search-hidden'); row.removeAttribute('data-sx-optional-hidden'); row.removeAttribute('aria-label');
    row.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    const title = tr('label');
    const primary = row.querySelector('.MuiListItemText-primary');
    if (primary) primary.textContent = title;
    else { const fallback = row.querySelector('.MuiListItemText-root,.MuiListItemText-inset'); if (fallback) fallback.textContent = title; }
    const button = row.querySelector('.MuiListItemButton-root,[role="button"],button,a') || row;
    button.removeAttribute('aria-current'); button.removeAttribute('aria-label'); button.setAttribute('aria-label', title); button.setAttribute('type', 'button');
    button.addEventListener('click', event => { event.preventDefault(); location.href = '/user?page=chatgpt'; });
    const icon = row.querySelector('.MuiListItemIcon-root');
    if (icon) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '20'); svg.setAttribute('height', '20'); svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M8 7h8a4 4 0 0 1 0 8h-1m1-4H8a4 4 0 0 0 0 8h1m3-14v2m0 10v2');
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.8'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path); icon.replaceChildren(svg);
    }
    const anchor = [...list.children].find(item => /api dashboard|لوحة api|rest api|واجهة برمجة التطبيقات/i.test(item.textContent || ''));
    if (anchor?.parentNode === list) anchor.after(row); else list.append(row);
  }

  let overlay = null;
  function setTheme() {
    if (!overlay) return;
    const target = document.querySelector('.MuiDrawer-paper') || document.querySelector('#root main') || document.body;
    const computed = getComputedStyle(target);
    let bg = computed.backgroundColor;
    if (!bg || bg === 'rgba(0, 0, 0, 0)') bg = '#f5f7fb';
    overlay.style.setProperty('--sx-chatgpt-bg', bg);
    overlay.style.setProperty('--sx-chatgpt-fg', computed.color || '#18253a');
    const drawer = document.querySelector('.MuiDrawer-root.MuiDrawer-docked');
    const width = drawer ? Math.max(0, Math.round(drawer.getBoundingClientRect().width)) : 0;
    overlay.style.setProperty('--sx-chatgpt-sidebar-width', `${width}px`);
    overlay.dir = language() === 'ar' ? 'rtl' : 'ltr';
  }
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('section');
    overlay.className = 'sx-chatgpt-screen'; overlay.setAttribute('aria-labelledby', 'sx-chatgpt-title'); overlay.setAttribute('role', 'region'); overlay.tabIndex = -1;
    overlay.innerHTML = `
      <div class="shell">
        <header class="top"><div class="brand"><span class="brand-mark" aria-hidden="true">7</span><span>7Network</span></div><button class="close" type="button" data-action="back"></button></header>
        <p class="eyebrow" data-text="setupEyebrow"></p><h1 id="sx-chatgpt-title" data-text="title"></h1><p data-text="intro"></p>
        <div class="grid">
          <section class="card" aria-labelledby="sx-chatgpt-setup-title"><h2 id="sx-chatgpt-setup-title" data-text="setupTitle"></h2><p data-text="setupBody"></p><label class="muted" for="sx-chatgpt-endpoint" data-text="endpointLabel"></label><div class="endpoint"><input id="sx-chatgpt-endpoint" readonly dir="ltr"><button class="primary" type="button" data-action="copy"></button></div><p><a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer" data-text="setupLink"></a></p></section>
          <section class="card" aria-labelledby="sx-chatgpt-features-title"><h2 id="sx-chatgpt-features-title" data-text="stepsTitle"></h2><ul class="features"><li><span class="check" aria-hidden="true">✓</span><span data-text="step1"></span></li><li><span class="check" aria-hidden="true">✓</span><span data-text="step2"></span></li><li><span class="check" aria-hidden="true">✓</span><span data-text="step3"></span></li><li><span class="check" aria-hidden="true">✓</span><span data-text="step4"></span></li></ul></section>
          <section class="card wide" aria-labelledby="sx-chatgpt-connections-title"><h2 id="sx-chatgpt-connections-title" data-text="connectionsTitle"></h2><p data-text="connectionsBody"></p><div class="notice" role="status" aria-live="polite" data-notice></div><div class="empty" data-empty hidden></div><div class="connection-list" data-list></div><button class="secondary" type="button" data-action="retry" hidden></button></section>
          <p class="card wide privacy" data-text="permissionNote"></p>
          <p class="card wide muted" data-text="planNote"></p>
        </div><footer>7Network · ChatGPT MCP</footer>
      </div>`;
    document.body.append(overlay);
    overlay.querySelectorAll('[data-text]').forEach(node => { node.textContent = tr(node.dataset.text); });
    overlay.querySelector('[data-action="back"]').textContent = tr('back');
    overlay.querySelector('[data-action="copy"]').textContent = tr('copy');
    overlay.querySelector('[data-action="retry"]').textContent = tr('retry');
    overlay.querySelector('[data-action="back"]').addEventListener('click', () => location.assign('/user'));
    overlay.querySelector('[data-action="retry"]').addEventListener('click', loadStatus);
    overlay.querySelector('[data-action="copy"]').addEventListener('click', copyEndpoint);
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape') location.assign('/user'); });
    window.addEventListener('resize', setTheme);
    setTheme();
    return overlay;
  }
  function formatDate(value) {
    if (!value) return tr('never');
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return tr('never');
    try { return new Intl.DateTimeFormat(language() === 'ar' ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(date); } catch (_) { return date.toLocaleString(); }
  }
  function connectionCard(connection) {
    const card = document.createElement('article'); card.className = 'connection';
    const details = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = connection.name || 'ChatGPT'; details.append(name);
    const roleLine = document.createElement('div'); roleLine.className = 'meta'; roleLine.textContent = `${tr('role')}: ${roleNames[connection.role]?.[language() === 'ar' ? 1 : 0] || connection.role}`; details.append(roleLine);
    const scopeLine = document.createElement('div'); scopeLine.className = 'meta';
    const scopeLabels = (connection.scopes || []).filter(scope => scopeNames[scope]).map(scope => tr(scopeNames[scope])).join(language() === 'ar' ? '، ' : ', ');
    scopeLine.textContent = `${tr('scopes')}: ${scopeLabels || '—'}`; details.append(scopeLine);
    const status = document.createElement('span'); status.className = `status${connection.revokedAt ? ' revoked' : ''}`; status.textContent = tr(connection.revokedAt ? 'statusRevoked' : 'statusConnected'); details.append(status);
    const dates = document.createElement('div'); dates.className = 'meta'; dates.textContent = `${tr('connectedAt')}: ${formatDate(connection.connectedAt)} · ${tr('usedAt')}: ${formatDate(connection.lastUsedAt)}`; details.append(dates);
    card.append(details);
    if (!connection.revokedAt) {
      const button = document.createElement('button'); button.className = 'secondary'; button.type = 'button'; button.textContent = tr('revoke');
      button.setAttribute('aria-label', `${tr('revoke')} ${connection.name || 'ChatGPT'}`);
      button.addEventListener('click', () => revokeConnection(connection.id, button)); card.append(button);
    }
    return card;
  }
  async function loadStatus() {
    const current = ensureOverlay();
    current.querySelector('[data-notice]').textContent = tr('loading');
    current.querySelector('[data-empty]').hidden = true;
    current.querySelector('[data-action="retry"]').hidden = true;
    current.querySelector('[data-list]').replaceChildren();
    if (statusPromise) return statusPromise;
    statusPromise = getStatus().then(data => {
      const list = current.querySelector('[data-list]'); list.replaceChildren(...(data.connections || []).map(connectionCard));
      current.querySelector('[data-notice]').textContent = '';
      current.querySelector('[data-empty]').hidden = Boolean((data.connections || []).length);
      current.querySelector('[data-empty]').textContent = data.eligible ? tr('empty') : tr('unavailable');
      current.querySelector('[data-action="retry"]').hidden = true;
      current.querySelector('#sx-chatgpt-endpoint').value = data.endpoint || `${location.origin}/mcp`;
      return data;
    }).catch(() => {
      current.querySelector('[data-notice]').textContent = tr('error');
      current.querySelector('[data-action="retry"]').hidden = false;
      return null;
    }).finally(() => { statusPromise = null; });
    return statusPromise;
  }
  async function copyEndpoint() {
    const input = overlay.querySelector('#sx-chatgpt-endpoint');
    try { await navigator.clipboard.writeText(input.value); overlay.querySelector('[data-action="copy"]').textContent = tr('copied'); }
    catch (_) { input.focus(); input.select(); overlay.querySelector('[data-notice]').textContent = tr('copyFailed'); }
  }
  async function revokeConnection(id, button) {
    if (!window.confirm(tr('confirmRevoke'))) return;
    button.disabled = true;
    try {
      await window.SaleMaxWorkspace.request('chatgpt', `/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
      overlay.querySelector('[data-notice]').textContent = tr('revokeSuccess');
      await loadStatus();
    } catch (_) { button.disabled = false; overlay.querySelector('[data-notice]').textContent = tr('revokeError'); }
  }
  function openRoute() {
    if (location.pathname !== '/user' || new URLSearchParams(location.search).get('page') !== 'chatgpt') {
      overlay?.remove(); overlay = null; return;
    }
    ensureOverlay(); loadStatus();
    window.requestAnimationFrame(() => overlay?.focus());
  }
  async function ensureNavPermission() {
    try {
      const data = await getStatus();
      if (!data.eligible) return;
      document.querySelectorAll('[data-sx-sidebar-list]').forEach(addNavRow);
    } catch (_) {}
  }
  function start() {
    addApiPath();
    openRoute();
    ensureNavPermission();
    window.addEventListener('popstate', openRoute);
    const observer = new MutationObserver(() => {
      addApiPath();
      if (location.pathname === '/user') document.querySelectorAll('[data-sx-sidebar-list]').forEach(addNavRow);
      openRoute();
    });
    const root = document.getElementById('root');
    if (root) observer.observe(root, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
