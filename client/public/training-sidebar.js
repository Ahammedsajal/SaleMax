(() => {
  'use strict';
  if (window.__sxTrainingSidebar) return;
  window.__sxTrainingSidebar = true;
  const ar = () => (localStorage.getItem('language') || '').toLowerCase().includes('arab') || document.documentElement.dir === 'rtl';
  const tr = (en, arabic) => ar() ? arabic : en;
  if (!window.__sxChatbotAdminLoader) {
    window.__sxChatbotAdminLoader = true;
    const chatbotScript = document.createElement('script');
    chatbotScript.src = '/chatbot-admin.js?v=20261009-staff-controls2';
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
    'Campaign Dashboard':'campaign-dashboard', 'Lead Pipeline':'leads', 'Lead Reports':'reports', Phonebook:'contacts', 'Agent Login':'agent-login',
    'Agent Task':'tasks', Tasks:'tasks', 'Call Center':'call-center', Courses:'courses', Students:'enrollments', 'Center profile':'enrollments', 'Candidate Applications':'forms', 'Invoices & Payments':'invoices',
    'Finance Reports':'reports', 'Team access':'team', 'Team and Roles':'team',
    'Business Settings':'settings', Settings:'settings'
  };
  let assignedNavigation = null;
  let roleNavigation = null;
  let membershipRole = null;
  let optionalFeatures = {};
  let navigationLoaded = false;
  let navigationChecksPending = 2;
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
        const allowedByRole=data?.data?.roleNavigation;
        membershipRole=data?.data?.role||null;
        if(Array.isArray(value))assignedNavigation=new Set(value);
        if(Array.isArray(allowedByRole))roleNavigation=new Set(allowedByRole);
      }
    }catch(_){}finally{navigationCheckComplete();}
  }
  async function loadOptionalNavigation(){
    try{
      const token=localStorage.getItem('wacrm_user');
      if(token){
        const response=await fetch('/api/user/optional-features',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',Authorization:'Bearer '+token}});
        if(response.ok){const data=await response.json();if(data?.success&&token===localStorage.getItem('wacrm_user'))optionalFeatures=data?.data?.features||{};}
      }
    }catch(_){}finally{navigationCheckComplete();}
  }
  function navigationCheckComplete(){
    navigationChecksPending=Math.max(0,navigationChecksPending-1);
    if(!navigationChecksPending){document.documentElement.removeAttribute('data-sx-navigation-loading');schedule();}
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
    [data-sx-sidebar-list] .MuiListItemIcon-root{box-sizing:border-box!important;display:inline-flex!important;flex:0 0 34px!important;align-items:center!important;justify-content:center!important;width:34px!important;min-width:34px!important;margin:0!important}
    [data-sx-sidebar-collapsed] [data-sx-sidebar-list]{box-sizing:border-box!important;width:64px!important;min-width:64px!important;max-width:none!important;margin-inline:0!important;padding-inline:0!important}
    [data-sx-sidebar-collapsed] [data-sx-sidebar-list]>li{box-sizing:border-box!important;width:100%!important}
    [data-sx-sidebar-collapsed] [data-sx-sidebar-list] .MuiListItemButton-root{box-sizing:border-box!important;justify-content:center!important;padding-inline:0!important}
    [data-sx-sidebar-collapsed] [data-sx-sidebar-list] .MuiListItemIcon-root{flex:1 1 100%!important;width:100%!important;min-width:100%!important}
    [data-sx-sidebar-list] .MuiListItemIcon-root svg{display:block!important;width:20px!important;height:20px!important;flex:0 0 20px!important}
    [data-sx-sidebar-list] svg[data-sx-training-icon]{fill:none!important;stroke:currentColor!important;stroke-width:1.8px!important;stroke-linecap:round!important;stroke-linejoin:round!important}
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
    const visible = spans.at(-1)?.textContent || row.querySelector('.MuiListItemText-primary')?.textContent || row.textContent;
    const accessible = row.getAttribute('aria-label') || row.querySelector('.MuiListItemButton-root')?.getAttribute('aria-label');
    return (visible.trim() || accessible || '').trim().replace(/\s+[—-]\s+PRO Addon Required.*$/i, '');
  }
  function trainingIcon(row, name) {
    const icons = {
      Dashboard:['M3 3h8v8H3z','M13 3h8v5h-8z','M13 10h8v11h-8z','M3 13h8v8H3z'],
      Courses:['M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21z','M4 4.5V21','M8 6h8','M8 10h8'],
      'Candidate Applications':['M8 3h8','M9 2h6v4H9z','M6 4H4v18h16V4h-2','M8 11h8','M8 15h8','M8 19h5'],
      'Lead Pipeline':['M4 19V5','M4 19h17','M7 15l4-4 3 2 6-7','M16 6h4v4'],
      'Lead Reports':['M4 19V5','M4 19h17','M8 16v-4','M13 16V8','M18 16V5'],
      Inbox:['M4 5h16v13H8l-4 3z','M8 10h8','M8 14h5'],
      Phonebook:['M5 3h14v18H5z','M8 7h3v3H8z','M13 8h3','M13 11h3','M8 14h8','M8 17h8'],
      'Call Center':['M4 13v-2a8 8 0 0 1 16 0v2','M4 12H3v5h4v-5z','M20 12h1v5h-4v-5z','M17 19a5 5 0 0 1-5 3h-2'],
      'Invoices & Payments':['M6 2h12v20l-3-2-3 2-3-2-3 2z','M9 7h6','M9 11h6','M12 14v4','M10 16h4'],
      'Finance Reports':['M4 19V5','M4 19h17','M8 16v-3','M13 16V8','M18 16V5'],
      'Add WhatsApp by QR':['M3 8V3h5','M16 3h5v5','M21 16v5h-5','M8 21H3v-5','M8 8h3v3H8z','M15 8v2','M15 14h2v2h-2z','M10 15v2'],
      'Link Meta WhatsApp':['M4 5h16v12H8l-4 4z','M8 9h8','M8 13h5'],
      'Create Meta Template':['M5 3h10l4 4v14H5z','M14 3v5h5','M8 12h8','M8 16h8'],
      'Send Campaign':['M22 2 11 13','M22 2l-7 20-4-9-9-4z'],
      'Campaign Dashboard':['M3 11v3h4l9 5V6l-9 5z','M7 14l2 7h4l-3-8','M19 9a5 5 0 0 1 0 7'],
      'Web Notification':['M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9','M10 21h4'],
      'Web Notifications':['M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9','M10 21h4'],
      'Automation Flows':['M6 4v5','M6 15v5','M18 4v5','M18 15v5','M6 9h12v6H6z','M9 12h.01','M12 12h.01','M15 12h.01'],
      'WA Chatbot':['M4 5h16v12H9l-5 4z','M8 10h.01','M12 10h.01','M16 10h.01','M9 14h6'],
      'Team access':['M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2','M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M20 8v6','M17 11h6'],
      Tasks:['M9 6h11','M9 12h11','M9 18h11','M4 6l1 1 2-2','M4 12l1 1 2-2','M4 18l1 1 2-2'],
      'Agent Login':['M15 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M18 8v6','M15 11h6'],
      'Agent Task':['M9 6h11','M9 12h11','M9 18h11','M4 6l1 1 2-2','M4 12l1 1 2-2','M4 18l1 1 2-2'],
      'Chat Widget':['M4 5h16v12H9l-5 4z','M8 9h8','M8 13h5'],
      'REST API':['M8 4 3 12l5 8','M16 4l5 8-5 8','M14 3l-4 18'],
      'Conversational API':['M4 5h16v12H9l-5 4z','M8 9h8','M8 13h5'],
      'Template API':['M5 3h10l4 4v14H5z','M14 3v5h5','M8 12h8','M8 16h5'],
      'API Dashboard':['M4 19V5','M4 19h17','M8 16v-3','M13 16V8','M18 16V5'],
      'Manage Webhooks':['M8 12a4 4 0 0 1 0-8h4','M16 12a4 4 0 0 1 0 8h-4','M9 12h6','M12 9l3 3-3 3'],
      'Webhook Automation':['M8 12a4 4 0 0 1 0-8h4','M16 12a4 4 0 0 1 0 8h-4','M9 12h6','M12 9l3 3-3 3'],
      'Webhook Logs':['M5 3h14v18H5z','M8 8h8','M8 12h8','M8 16h5'],
      'WhatsApp Warmer':['M12 22s8-4 8-11a8 8 0 0 0-16 0c0 7 8 11 8 11z','M12 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
      'Center profile':['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M4 21a8 8 0 0 1 16 0','M17 4h4','M19 2v4'],
      Students:['M3 5h18v14H3z','M7 9h4v4H7z','M14 9h4','M14 12h4','M7 16h11'],
      Settings:['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8','M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.8.1l-.2.1h-3.4l-.1-.2a1.7 1.7 0 0 0-1.5-1l-.2-.1-1.7-2.9.1-.2a1.7 1.7 0 0 0-.3-1.8l-.1-.2V10l.2-.1a1.7 1.7 0 0 0 1-1.5l.1-.2 2.9-1.7.2.1a1.7 1.7 0 0 0 1.8-.3l.2-.1h3.4l.1.2a1.7 1.7 0 0 0 1.5 1l.2.1 1.7 2.9-.1.2a1.7 1.7 0 0 0 .3 1.8l.1.2v3.4z']
    };
    const paths = icons[name], svg = row.querySelector('svg');
    if (!paths || !svg || svg.dataset.sxTrainingIcon === name) return;
    svg.dataset.sxTrainingIcon = name;
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.replaceChildren(...paths.map(path => {
      const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      shape.setAttribute('d', path);
      return shape;
    }));
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
        const navButton = row.querySelector('.MuiListItemButton-root,[role="button"],button,a');
        const tooltip = name === 'Web Notification' ? tr('Web Notifications', 'إشعارات الويب') : text;
        if (Object.values(routes).includes(active)) {
          const button = row.querySelector('.MuiListItemButton-root');
          if (button) { const selected = name==='Finance Reports' ? active==='finance-settings'&&new URLSearchParams(location.search).get('section')==='reports' : name==='Invoices & Payments' ? active==='finance-settings'&&new URLSearchParams(location.search).get('section')!=='reports' : routes[name] === active; button.classList.toggle('Mui-selected', selected); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
        }
        const captions = {Dashboard:['Dashboard','لوحة التحكم'], 'Web Notification':['Web Notifications','إشعارات الويب'], 'Create Meta Template':['Create Meta Template','إنشاء قالب Meta']};
        const leaf = [...row.querySelectorAll('.MuiListItemText-primary span')].at(-1);
        if (leaf && captions[name]) { const next = tr(...captions[name]); if (leaf.textContent !== next) leaf.textContent = next; }
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
        const hiddenByOwner=(assignedNavigation!==null&&navKey&&!assignedNavigation.has(navKey))||(roleNavigation!==null&&navKey&&!roleNavigation.has(navKey))||(name==='Team access'&&membershipRole&&membershipRole!=='owner');
        const optionalFeature=window.salemaxOptionalLabels?.[text]||window.salemaxOptionalLabels?.[name];
        const hiddenByFeature=!!optionalFeature&&optionalFeatures[optionalFeature]!==true;
        if(hiddenByFeature)row.setAttribute('data-sx-optional-hidden','1');
        else if(optionalFeature)row.removeAttribute('data-sx-optional-hidden');
        const hidden = hiddenByOwner || (!!query && !text.toLowerCase().includes(query) && !name.toLowerCase().includes(query));
        row.toggleAttribute('data-sx-search-hidden', hidden);
        const available = !hidden && !row.hidden && !row.hasAttribute('data-sx-optional-hidden') && getComputedStyle(row).display !== 'none';
        if (navButton) {
          if (available) { trainingIcon(row, name); if (navButton.getAttribute('title') !== tooltip) navButton.setAttribute('title', tooltip); }
          else navButton.removeAttribute('title');
        }
        if (available) present.add(group);
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
    if((assignedNavigation!==null&&required&&!assignedNavigation.has(required))||(roleNavigation!==null&&required&&!roleNavigation.has(required))||(page==='team-invitations'&&membershipRole&&membershipRole!=='owner'))location.replace('/user?page=dashboard');
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
  loadOptionalNavigation();
  loadCallCenterAccess();
  schedule();
})();
