(() => {
  'use strict';
  if (window.__sxTrainingSidebar) return;
  window.__sxTrainingSidebar = true;
  const ar = () => (localStorage.getItem('language') || '').toLowerCase().includes('arab') || document.documentElement.dir === 'rtl';
  const tr = (en, arabic) => ar() ? arabic : en;
  if (!window.__sxChatbotAdminLoader) {
    window.__sxChatbotAdminLoader = true;
    const chatbotScript = document.createElement('script');
    chatbotScript.src = '/chatbot-admin.js?v=20261005-bot-profile-dropdown7';
    chatbotScript.defer = true;
    document.head.append(chatbotScript);
  }
  const groups = [
    ['Overview', 'نظرة عامة', ['Dashboard']],
    ['Courses & Admissions', 'الدورات والقبول', ['Courses', 'Candidate Applications']],
    ['Leads & Reports', 'العملاء المحتملون والتقارير', ['Lead Pipeline', 'Lead Reports']],
    ['Contacts & Conversations', 'جهات الاتصال والمحادثات', ['Inbox', 'Phonebook', 'Call Center']],
    ['Finance', 'المالية', ['Invoices & Payments', 'Finance Reports']],
    ['WhatsApp & Campaigns', 'واتساب والحملات', ['Add WhatsApp by QR', 'Link Meta WhatsApp', 'Create Meta Template', 'Send Campaign', 'Campaign Dashboard', 'Web Notification']],
    ['Automation & Bots', 'الأتمتة والروبوتات', ['Automation Flows', 'WA Chatbot']],
    ['Team & Tasks', 'الفريق والمهام', ['Team access', 'Tasks', 'Agent Login', 'Agent Task']],
    ['API & Integrations', 'واجهات البرمجة والتكامل', ['Chat Widget', 'REST API', 'Conversational API', 'Template API', 'API Dashboard']],
    ['Webhooks', 'الويب هوك', ['Manage Webhooks', 'Webhook Automation', 'Webhook Logs']],
    ['WhatsApp Warmer', 'تهيئة واتساب', ['WhatsApp Warmer']],
    ['More Tools', 'أدوات أخرى', []]
  ];
  const aliases = {
    'الدورات': 'Courses', 'طلبات المتقدمين': 'Candidate Applications',
    'مسار العملاء المحتملين': 'Lead Pipeline', 'تقارير العملاء المحتملين': 'Lead Reports',
    'الفواتير والمدفوعات': 'Invoices & Payments', 'تقارير المالية': 'Finance Reports',
    'إدارة وصول الفريق': 'Team access', 'تسجيل دخول الوكيل': 'Agent Login',
    'دخول الوكيل': 'Agent Login', 'Rest API': 'REST API', 'Web Notificaion': 'Web Notification',
    'Web Notifications': 'Web Notification', 'إشعارات الويب': 'Web Notification', 'لوحة التحكم': 'Dashboard', 'المهام': 'Tasks', 'مركز الاتصال': 'Call Center'
  };
  const navigationKeys = {
    Dashboard:'dashboard', Inbox:'inbox', 'Add WhatsApp by QR':'whatsapp-qr', 'Link Meta WhatsApp':'whatsapp-meta',
    'Automation Flows':'flows', 'WA Chatbot':'chatbot', 'Create Meta Template':'templates', 'Send Campaign':'campaigns',
    'Campaign Dashboard':'campaign-dashboard', 'Lead Pipeline':'leads', Phonebook:'contacts', 'Agent Login':'agent-login',
    'Agent Task':'tasks', Tasks:'tasks', 'Call Center':'call-center', Courses:'courses', 'Candidate Applications':'forms', 'Invoices & Payments':'invoices',
    'Finance Reports':'reports', 'Lead Reports':'reports', 'Team access':'team', 'Team and Roles':'team',
    'Business Settings':'settings', Settings:'settings'
  };
  let assignedNavigation = null;
  let membershipRole = null;
  let navigationLoaded = false;
  window.__sxCallCenterAllowed = false;
  async function loadCallCenterAccess(){
    try{
      const token=localStorage.getItem('wacrm_user');
      const response=await fetch('/api/user/call-center/status',{credentials:'same-origin',headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{})}});
      if(!response.ok)return;
      const result=await response.json();
      window.__sxCallCenterAllowed=result?.data?.feature?.enabled===true;
    }catch(_){}finally{schedule();}
  }
  async function loadAssignedNavigation(){
    if(navigationLoaded)return;
    navigationLoaded=true;
    document.documentElement.setAttribute('data-sx-navigation-loading','');
    try{
      const token=localStorage.getItem('wacrm_user');
      const response=await fetch('/api/user/team-invitations/sidebar-access',{credentials:'same-origin',headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{})}});
      if(response.ok){
        const data=await response.json();
        const value=data?.data?.assignedNavigation;
        membershipRole=data?.data?.role||null;
        if(Array.isArray(value))assignedNavigation=new Set(value);
      }
    }catch(_){}finally{document.documentElement.removeAttribute('data-sx-navigation-loading');schedule();}
  }
  // Native labels remain intact so the original React search and actions still work.
  Object.assign(aliases, window.salemaxSidebarAliases || {});
  const style = document.createElement('style');
  style.textContent = `
    html[data-sx-navigation-loading] .MuiDrawer-paper{visibility:hidden!important}
    [data-sx-sidebar-list]{display:flex!important;flex-direction:column}
    [data-sx-sidebar-list]>p:not([data-sx-nav-section]){display:none!important}
    [data-sx-nav-section]{margin:20px 24px 6px;color:#6b7280;font:600 12px/1.6 Roboto,Arial,sans-serif;letter-spacing:.04em}
    [data-sx-sidebar-list]>li .MuiListItemButton-root{min-height:44px}
    [data-sx-search-hidden],[data-sx-nav-section][hidden]{display:none!important}
    [data-sx-sidebar-brand]{min-width:0!important;background:none!important;display:flex!important;align-items:center}
    [data-sx-sidebar-brand]>:not([data-sx-sidebar-logo]){display:none!important}
    [data-sx-sidebar-logo]{display:block!important;width:156px!important;max-width:100%!important;height:44px!important;object-fit:contain!important;background:transparent!important}
    [data-sx-sidebar-collapsed] [data-sx-nav-section]{display:none!important}
    [data-sx-sidebar-collapsed] [data-sx-sidebar-logo]{width:32px!important;height:32px!important}
  `;
  document.head.append(style);
  const observed = new WeakSet();
  const resizeObserver = new ResizeObserver(schedule);
  function label(row) {
    const spans = [...row.querySelectorAll('.MuiListItemText-primary span')];
    return (spans.at(-1)?.textContent || row.querySelector('.MuiListItemText-primary')?.textContent || row.textContent).trim();
  }
  function trainingIcon(row, name) {
    const paths = {
      Courses: 'M4 3h14a2 2 0 0 1 2 2v16H6a3 3 0 0 1-3-3V5a2 2 0 0 1 1-2zm2 2v11h12V5H6zm0 13a1 1 0 0 0 0 2h12v-2H6zm3-11h6v2H9V7zm0 4h6v2H9v-2z',
      'Candidate Applications': 'M5 2h10l5 5v15H5V2zm2 2v16h11V8h-4V4H7zm1 7h8v2H8v-2zm0 4h8v2H8v-2z',
      'Invoices & Payments': 'M5 2h14v20l-3-2-3 2-3-2-3 2-2-2V2zm2 2v14l3-1 3 2 3-2 1 1V4H7zm5 2h2v1h2v2h-4v1h3a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-1v1h-2v-1h-2v-2h5v-1h-3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2V6z'
    };
    const path = paths[name], svg = row.querySelector('svg');
    if (!path || !svg || svg.dataset.sxTrainingIcon === name) return;
    svg.dataset.sxTrainingIcon = name;
    svg.setAttribute('viewBox', '0 0 24 24');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.replaceChildren(shape);
  }
  function syncInjectedRows(list) {
    // The legacy shell mounts separate desktop and mobile drawers. Reuse only
    // entries already admitted by the maintained modules' permission checks.
    const entries = [
      ['[data-sx-course-nav]:not([data-sx-finance-nav])', 'courses'],
      ['[data-sx-forms-nav]', 'forms'],
      ['[data-sx-finance-nav]', 'finance-settings'],
      ['[data-sx-finance-report-nav]', 'finance-settings&section=reports'],
      ['[data-sx-team-nav]', 'team-invitations']
    ];
    entries.forEach(([selector, page]) => {
      if (list.querySelector(selector)) return;
      const source = document.querySelector(selector);
      if (!source) return;
      const copy = source.cloneNode(true);
      copy.removeAttribute('data-sx-search-hidden');
      copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      const button = copy.querySelector('[role=button],button,a') || copy;
      button.onclick = event => { event.preventDefault(); location.href = '/user?page=' + page; };
      list.append(copy);
    });
    const pipelineSource=document.querySelector('[data-salemax-pipeline-link]');
    if(pipelineSource&&!list.querySelector('[data-sx-tasks-nav]')){
      const copy=pipelineSource.cloneNode(true);copy.dataset.sxTasksNav='1';copy.removeAttribute('data-salemax-pipeline-link');copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
      const primary=copy.querySelector('.MuiListItemText-primary');if(primary)primary.textContent=tr('Tasks','المهام');
      copy.setAttribute('aria-label',tr('Tasks','المهام'));const button=copy.querySelector('.MuiListItemButton-root,[role=button],button,a')||copy;
      button.setAttribute('aria-label',tr('Tasks','المهام'));
      button.onclick=event=>{event.preventDefault();location.href='/user?page=tasks';};list.append(copy);
    }
    const leadSource=document.querySelector('[data-salemax-pipeline-link]');
    if(leadSource&&!list.querySelector('[data-sx-lead-reports-nav]')){
      const copy=leadSource.cloneNode(true);copy.dataset.sxLeadReportsNav='1';copy.removeAttribute('data-salemax-pipeline-link');copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
      // This is a synthetic row, so set its primary label directly. The legacy
      // row can wrap its text in different span structures across builds; only
      // replacing an exact child span leaves the copied "Lead Pipeline" label
      // behind in some versions of the shell.
      const primary=copy.querySelector('.MuiListItemText-primary');
      if(primary)primary.textContent=tr('Lead Reports','تقارير العملاء المحتملين');
      copy.setAttribute('aria-label',tr('Lead Reports','تقارير العملاء المحتملين'));
      const button=copy.querySelector('.MuiListItemButton-root,[role=button],button,a')||copy;button.setAttribute('aria-label',tr('Lead Reports','تقارير العملاء المحتملين'));button.onclick=event=>{event.preventDefault();location.href='/user?page=lead-reports';};
      list.append(copy);
    }
    if(window.__sxCallCenterAllowed&&pipelineSource&&!list.querySelector('[data-sx-call-center-nav]')){
      const copy=pipelineSource.cloneNode(true);copy.dataset.sxCallCenterNav='1';copy.removeAttribute('data-salemax-pipeline-link');copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
      const primary=copy.querySelector('.MuiListItemText-primary');if(primary)primary.textContent=tr('Call Center','مركز الاتصال');
      copy.setAttribute('aria-label',tr('Call Center','مركز الاتصال'));const button=copy.querySelector('.MuiListItemButton-root,[role=button],button,a')||copy;
      button.onclick=event=>{event.preventDefault();location.href='/user?page=call-center';};list.append(copy);
    }
  }
  function update() {
    if (location.pathname.replace(/\/$/, '') !== '/user') return;
    document.querySelectorAll('.MuiDrawer-paper').forEach(drawer => {
      if (!observed.has(drawer)) { observed.add(drawer); resizeObserver.observe(drawer); }
      const list = drawer.querySelector('ul');
      if (!list) return;
      syncInjectedRows(list);
      list.dataset.sxSidebarList = '1';
      const collapsed = drawer.getBoundingClientRect().width < 110;
      drawer.toggleAttribute('data-sx-sidebar-collapsed', collapsed);
      const brandText = [...drawer.querySelectorAll('p')].find(p => p.textContent.trim() === 'SaleMaX' && !p.closest('ul'));
      const brand = drawer.querySelector('[data-sx-sidebar-brand]') || brandText?.parentElement?.parentElement;
      if (brand) {
        brand.dataset.sxSidebarBrand = '1';
        let logo = brand.querySelector('[data-sx-sidebar-logo]');
        if (!logo) { logo = document.createElement('img'); logo.dataset.sxSidebarLogo = '1'; logo.alt = 'SaleMaX'; brand.append(logo); }
        const src = collapsed ? '/logo192.png' : '/media/salemax-logo.png';
        if (logo.getAttribute('src') !== src) logo.src = src;
      }
      const query = (drawer.querySelector('input')?.value || '').trim().toLowerCase();
      const active = new URLSearchParams(location.search).get('page');
      const routes = {Courses:'courses', 'Candidate Applications':'forms', 'Invoices & Payments':'finance-settings', 'Finance Reports':'finance-settings', 'Team access':'team-invitations', 'Lead Pipeline':'lead-pipeline', 'Lead Reports':'lead-reports', Tasks:'tasks', 'Call Center':'call-center', 'WA Chatbot':'wa-chatbot'};
      const present = new Set();
      [...list.children].filter(row => row.tagName === 'LI' && !row.hasAttribute('data-sx-nav-section')).forEach((row, index) => {
        const text = label(row), name = aliases[text] || text;
        if (Object.values(routes).includes(active)) {
          const button = row.querySelector('.MuiListItemButton-root');
          if (button) { const selected = name==='Finance Reports' ? active==='finance-settings'&&new URLSearchParams(location.search).get('section')==='reports' : name==='Invoices & Payments' ? active==='finance-settings'&&new URLSearchParams(location.search).get('section')!=='reports' : routes[name] === active; button.classList.toggle('Mui-selected', selected); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
        }
        const captions = {Dashboard:['Dashboard','لوحة التحكم'], 'Web Notification':['Web Notifications','إشعارات الويب'], 'Create Meta Template':['Create Meta Template','إنشاء قالب Meta']};
        const leaf = [...row.querySelectorAll('.MuiListItemText-primary span')].at(-1);
        if (leaf && captions[name]) { const next = tr(...captions[name]); if (leaf.textContent !== next) leaf.textContent = next; }
        trainingIcon(row, name);
        let group = groups.findIndex(g => g[2].includes(name));
        if (group < 0) {
          const feature = window.salemaxOptionalLabels?.[text];
          group = ({chat_widget:7, customer_api:7, webhooks:8, whatsapp_warmer:9})[feature] ?? -1;
        }
        if (group < 0) group = groups.length - 1;
        const rank = groups[group][2].indexOf(name);
        const order = String(group * 100 + 1 + (rank < 0 ? index : rank));
        if (row.style.order !== order) row.style.order = order;
        const navKey=navigationKeys[name]||navigationKeys[text];
        const hiddenByOwner=(assignedNavigation!==null&&navKey&&!assignedNavigation.has(navKey))||(name==='Team access'&&membershipRole&&membershipRole!=='owner');
        const hidden = hiddenByOwner || (!!query && !text.toLowerCase().includes(query) && !name.toLowerCase().includes(query));
        row.toggleAttribute('data-sx-search-hidden', hidden);
        if (!hidden && !row.hasAttribute('data-sx-optional-hidden') && getComputedStyle(row).display !== 'none') present.add(group);
      });
      groups.forEach(([en, arabic], index) => {
        let title = list.querySelector(`[data-sx-nav-section="${index}"]`);
        if (!title && !present.has(index)) return;
        if (!title) { title = document.createElement('li'); title.dataset.sxNavSection = String(index); title.style.order = String(index * 100); list.append(title); }
        const text = tr(en, arabic);
        if (title.textContent !== text) title.textContent = text;
        title.hidden = !present.has(index);
      });
      // Match keyboard traversal to the visual grouping without replacing the
      // native rows or their React navigation handlers.
      const rows = [...list.children].filter(row => row.tagName === 'LI');
      const ordered = [...rows].sort((a, b) => Number(a.style.order) - Number(b.style.order));
      if (rows.some((row, index) => row !== ordered[index])) ordered.forEach(row => list.append(row));
    });
    const page=new URLSearchParams(location.search).get('page');
    const routeKeys={courses:'courses',forms:'forms','lead-pipeline':'leads','lead-reports':'reports',tasks:'tasks','call-center':'call-center','finance-settings':new URLSearchParams(location.search).get('section')==='reports'?'reports':'invoices','team-invitations':'team','wa-chatbot':'chatbot'};
    const required=routeKeys[page];
    if((assignedNavigation!==null&&required&&!assignedNavigation.has(required))||(page==='team-invitations'&&membershipRole&&membershipRole!=='owner'))location.replace('/user?page=dashboard');
  }
  let queued = false;
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; update(); }); }
  document.addEventListener('click', event => {
    const button = event.target.closest('.MuiListItemButton-root');
    if (!button) return;
    const title = button.querySelector('.MuiListItemText-primary')?.textContent?.trim() || button.textContent.trim();
    const name = aliases[title] || window.salemaxSidebarAliases?.[title] || title;
    if (name !== 'WA Chatbot') return;
    event.preventDefault(); event.stopImmediatePropagation(); location.href = '/user?page=wa-chatbot';
  }, true);
  // Observe permission flags too: restoring a feature must restore its group heading.
  new MutationObserver(schedule).observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['data-sx-optional-hidden']});
  document.addEventListener('input', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('popstate', schedule);
  window.addEventListener('storage', schedule);
  loadAssignedNavigation();
  loadCallCenterAccess();
  schedule();
})();
