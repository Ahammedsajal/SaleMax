(() => {
  'use strict';
  if (window.__sxTrainingSidebar) return;
  window.__sxTrainingSidebar = true;
  const ar = () => window.SaleMaxLocale?.isArabic() ?? /^(ar(?:[-_]|$)|arabic)/i.test(localStorage.getItem('language') || document.documentElement.lang || 'en');
  const tr = (en, arabic) => ar() ? arabic : en;
  if (!window.__sxChatbotAdminLoader) {
    window.__sxChatbotAdminLoader = true;
    const chatbotScript = document.createElement('script');
    chatbotScript.src = '/chatbot-admin.js?v=20261013-language-layout1';
    chatbotScript.defer = true;
    document.head.append(chatbotScript);
  }
  if (!window.__sxTrainingFormsEditorLayoutLoader) {
    window.__sxTrainingFormsEditorLayoutLoader = true;
    const formsEditorStyle = document.createElement('link');
    formsEditorStyle.rel = 'stylesheet';
    formsEditorStyle.href = '/training-forms-editor.css?v=20261012-editor-scroll1';
    document.head.append(formsEditorStyle);
  }
  if (!window.__sxFaqManagerLoader) {
    window.__sxFaqManagerLoader = true;
    const faqStyle = document.createElement('link'); faqStyle.rel = 'stylesheet'; faqStyle.href = '/training-faqs.css?v=20261012-faq-library5'; document.head.append(faqStyle);
    const faqScript = document.createElement('script'); faqScript.src = '/training-faqs.js?v=20261013-language-layout1'; faqScript.defer = true; document.head.append(faqScript);
  }
  const groups = [
    ['Overview', 'نظرة عامة', ['Dashboard']],
    ['Courses & Admissions', 'الدورات والقبول', ['Courses', 'Products & services', 'Candidate Applications']],
    ['Leads & Reports', 'العملاء المحتملون والتقارير', ['Lead Pipeline', 'Lead Reports']],
    ['Contacts & Conversations', 'جهات الاتصال والمحادثات', ['Inbox', 'Phonebook', 'Call Center']],
    ['Finance', 'المالية', ['Invoices & Payments', 'Finance Reports', 'Sales Finance']],
    ['WhatsApp & Campaigns', 'واتساب والحملات', ['Add WhatsApp by QR', 'Link Meta WhatsApp', 'Create Meta Template', 'Send Campaign', 'Campaign Dashboard', 'Web Notification']],
    ['Automation & Bots', 'الأتمتة والروبوتات', ['Automation Flows', 'WA Chatbot', 'FAQs']],
    ['Team & Tasks', 'الفريق والمهام', ['Team access', 'Tasks', 'Team Login', 'Agent Task']],
    ['API & Integrations', 'واجهات البرمجة والتكامل', ['Chat Widget', 'REST API', 'Conversational API', 'Template API', 'API Dashboard']],
    ['Webhooks', 'الويب هوك', ['Manage Webhooks', 'Webhook Automation', 'Webhook Logs']],
    ['WhatsApp Warmer', 'تهيئة واتساب', ['WhatsApp Warmer']],
    ['Sales Operations', 'عمليات المبيعات', ['Sales Overview','Organization','Sales Targets','Sales Reports','Sales Deals','My Commissions','Commission Payouts','Commission Policy','Audit Trail']],
    ['More Tools', 'أدوات أخرى', []]
  ];
  const aliases = {
    'المنتجات والخدمات':'Products & services', 'الدورات': 'Courses', 'طلبات المتقدمين': 'Candidate Applications', 'الأسئلة الشائعة': 'FAQs',
    'مسار العملاء المحتملين': 'Lead Pipeline', 'تقارير العملاء المحتملين': 'Lead Reports',
    'الفواتير والمدفوعات': 'Invoices & Payments', 'تقارير المالية': 'Finance Reports',
    'إدارة وصول الفريق': 'Team access', 'تسجيل دخول الوكيل': 'Team Login',
    'دخول الوكيل': 'Team Login', 'Rest API': 'REST API', 'Web Notificaion': 'Web Notification',
    'Web Notifications': 'Web Notification', 'إشعارات الويب': 'Web Notification', 'لوحة التحكم': 'Dashboard', 'المهام': 'Tasks', 'مركز الاتصال': 'Call Center',
    'سياسة العمولات':'Commission Policy','صفقات المبيعات':'Sales Deals','أهداف المبيعات':'Sales Targets','عمولاتي':'My Commissions','مدفوعات العمولات':'Commission Payouts','مالية المبيعات':'Sales Finance','الهيكل التنظيمي':'Organization','سجل التدقيق':'Audit Trail'
  };
  const navigationKeys = {
    Dashboard:'dashboard', Inbox:'inbox', 'Add WhatsApp by QR':'whatsapp-qr', 'Link Meta WhatsApp':'whatsapp-meta',
    'Automation Flows':'flows', 'WA Chatbot':'chatbot', 'FAQs':'faqs', 'Create Meta Template':'templates', 'Send Campaign':'campaigns',
    'Campaign Dashboard':'campaign-dashboard', 'Lead Pipeline':'leads', 'Lead Reports':'reports', Phonebook:'contacts', 'Team Login':'agent-login','Agent Login':'agent-login','CRM appearance':'settings','Web Notification':'notifications','Web Notifications':'notifications',
    'Agent Task':'tasks', Tasks:'tasks', 'Call Center':'call-center', 'Products & services':'products-services', Courses:'courses', Students:'students', 'Center profile':'training-profile', 'Candidate Applications':'forms', 'Invoices & Payments':'invoices',
    'Finance Reports':'finance-reports', 'Team access':'team', 'People & Roles':'team', 'الأشخاص والأدوار':'team', 'Team and Roles':'team', 'Commission Policy':'commission-policy', 'Sales Deals':'sales-deals','Sales Targets':'sales-targets','Sales Reports':'sales-targets', 'My Commissions':'sales-commissions','Commission Payouts':'sales-commissions','Sales Finance':'sales-finance','Sales Overview':'sales-workspace',
    'Business Settings':'settings', Settings:'settings', Organization:'sales-organization', 'Sales Overview':'sales-targets','Audit Trail':'sales-audit'
  };
  const salesNavLabels={
    overview:{owner:['Business Overview','نظرة عامة على الأعمال'],manager:['Team Overview','نظرة عامة على الفريق'],team_leader:['Team Overview','نظرة عامة على الفريق'],agent:['My Day','مهامي اليوم']},
    organization:{owner:['Organization','الهيكل التنظيمي'],manager:['My Teams','فرقي'],team_leader:['My Team','فريقي']},
    calls:{owner:['Calls & Recordings','المكالمات والتسجيلات'],manager:['Call Review','مراجعة المكالمات'],team_leader:['Call Coaching','تدريب المكالمات'],agent:['Call Center','مركز الاتصال']},
    targets:{owner:['Targets & Performance','الأهداف والأداء'],manager:['Team Performance','أداء الفريق'],team_leader:['Team Performance','أداء الفريق'],agent:['My Performance','أدائي']},
    reports:{owner:['Sales Reports','تقارير المبيعات'],manager:['Team Reports','تقارير الفريق'],team_leader:['Team Reports','تقارير الفريق'],agent:['My Reports','تقاريري']},
    deals:{owner:['Sales Deals','صفقات المبيعات'],manager:['Team Deals','صفقات الفريق'],team_leader:['Team Deals','صفقات الفريق'],agent:['My Deals','صفقاتي']},
    commissions:{owner:['Sales Commissions','عمولات المبيعات'],manager:['Team Commissions','عمولات الفريق'],team_leader:['Team Commissions','عمولات الفريق'],agent:['My Commission','عمولتي'],accountant:['Commission Payouts','مدفوعات العمولات']}
  };
  function applySalesRoleAliases(){
    const canonical={overview:'Sales Overview',organization:'Organization',calls:'Call Center',targets:'Sales Targets',reports:'Sales Reports',deals:'Sales Deals',commissions:membershipRole==='accountant'?'Commission Payouts':'My Commissions'};
    for(const [key,labels] of Object.entries(salesNavLabels))for(const pair of Object.values(labels)){aliases[pair[0]]=canonical[key];aliases[pair[1]]=canonical[key];}
    if(membershipRole==='owner'){
      aliases['Team access']='People & Roles';
      aliases['إدارة وصول الفريق']='People & Roles';
    }
  }
  let assignedNavigation = null;
  let roleNavigation = null;
  let membershipRole = null;
  let membershipCategoryKey = null;
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
      const data={data:await window.SaleMaxWorkspace.session()};
      {
        const value=data?.data?.assignedNavigation;
        const allowedByRole=data?.data?.roleNavigation;
        membershipRole=data?.data?.role||null;
        membershipCategoryKey=data?.data?.categoryKey||null;
        if(membershipCategoryKey==='salemax_sales')applySalesRoleAliases();
        assignedNavigation=Array.isArray(value)?new Set(value):null;
        roleNavigation=Array.isArray(allowedByRole)?new Set(allowedByRole):new Set();
      }
    }catch(_){roleNavigation=new Set();}finally{navigationCheckComplete();}
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
    [data-sx-sidebar-collapsed] [data-sx-sidebar-list] .MuiListItemText-root{display:none!important}
    [data-sx-sidebar-list] .MuiListItemIcon-root svg{display:block!important;width:20px!important;height:20px!important;flex:0 0 20px!important}
    [data-sx-sidebar-list] svg[data-sx-training-icon]{fill:none!important;stroke:currentColor!important;stroke-width:1.8px!important;stroke-linecap:round!important;stroke-linejoin:round!important}
    [data-sx-search-hidden],[data-sx-nav-section][hidden]{display:none!important}
    .MuiDrawer-paper input[data-sx-search-empty]:-webkit-autofill{-webkit-text-fill-color:transparent!important;caret-color:transparent!important}
    [data-sx-sidebar-brand]{min-width:0!important;background:none!important;display:flex!important;align-items:center}
    [data-sx-sidebar-brand]>:not([data-sx-sidebar-logo]){display:none!important}
    [data-sx-sidebar-logo]{display:block!important;width:156px!important;max-width:100%!important;height:44px!important;object-fit:contain!important;background:transparent!important}
    [data-sx-sidebar-collapsed] [data-sx-nav-section]{display:none!important}
    [data-sx-sidebar-collapsed] [data-sx-sidebar-logo]{width:32px!important;height:32px!important}
    [data-sx-sidebar-collapsed] [data-sx-sidebar-list] .MuiListItemText-root,
    [data-sx-sidebar-collapsed] [data-sx-sidebar-list] .MuiTypography-root{display:none!important}
    @media(min-width:701px){
      .MuiDrawer-root.MuiDrawer-docked:has(>.MuiDrawer-paper[data-sx-sidebar-collapsed]){box-sizing:border-box!important;width:72px!important;min-width:72px!important;max-width:72px!important;flex:0 0 72px!important}
      .MuiDrawer-paper[data-sx-sidebar-collapsed]{box-sizing:border-box!important;width:72px!important;min-width:72px!important;max-width:72px!important;overflow-x:hidden!important}
    }
  `;
  document.head.append(style);
  const observed = new WeakSet();
  const sidebarExpandedOverride = new WeakMap();
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
      FAQs:['M5 3h14v18H5z','M8 8h8','M8 12h6','M9 16h.01','M15 16h.01'],
      'Team access':['M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2','M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M20 8v6','M17 11h6'],
      'People & Roles':['M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2','M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M20 8v6','M17 11h6'],
      Tasks:['M9 6h11','M9 12h11','M9 18h11','M4 6l1 1 2-2','M4 12l1 1 2-2','M4 18l1 1 2-2'],
      Organization:['M12 3 3 8v13h18V8z','M8 21v-7h8v7','M7 10h.01','M12 10h.01','M17 10h.01'],
      'Team Login':['M15 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M18 8v6','M15 11h6'],
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
      ['[data-sx-course-nav]:not([data-sx-finance-nav]):not([data-sx-profile-nav])', membershipCategoryKey==='salemax_sales'?'products-services':'courses'],
      ['[data-sx-forms-nav]', 'forms'],
      ['[data-sx-finance-nav]', 'finance-settings'],
      ['[data-sx-finance-report-nav]', 'finance-settings&section=reports'],
      ['[data-sx-team-nav]', 'team-invitations']
    ];
    if(!list.querySelector('[data-sx-faq-nav]')){
      const source=[...list.children].find(row=>row.tagName==='LI'&&(aliases[label(row)]||label(row))==='WA Chatbot');
      if(source){
        const copy=source.cloneNode(true);copy.dataset.sxFaqNav='1';copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
        const primary=copy.querySelector('.MuiListItemText-primary');if(primary)primary.textContent=tr('FAQs','الأسئلة الشائعة');
        const button=copy.querySelector('.MuiListItemButton-root,[role=button],button,a')||copy;button.setAttribute('aria-label',tr('FAQs','الأسئلة الشائعة'));
        button.onclick=event=>{event.preventDefault();event.stopPropagation();location.href='/user?page=faqs';};
        list.append(copy);
      }
    }
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
      const [label,arabic]=membershipCategoryKey==='salemax_sales'?(salesNavLabels.calls[membershipRole]||salesNavLabels.calls.agent):['Call Center','مركز الاتصال'],primary=copy.querySelector('.MuiListItemText-primary');if(primary)primary.textContent=tr(label,arabic);
      copy.setAttribute('aria-label',tr(label,arabic));const button=copy.querySelector('.MuiListItemButton-root,[role=button],button,a')||copy;
      button.setAttribute('aria-label',tr(label,arabic));button.onclick=event=>{event.preventDefault();location.href='/user?page=call-center';};list.append(copy);
    }
    if(membershipCategoryKey==='salemax_sales'&&membershipRole==='owner'&&pipelineSource&&!list.querySelector('[data-sx-commission-policy-nav]')){
      const copy=pipelineSource.cloneNode(true);copy.dataset.sxCommissionPolicyNav='1';copy.removeAttribute('data-salemax-pipeline-link');copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
      const primary=copy.querySelector('.MuiListItemText-primary');if(primary)primary.textContent=tr('Commission Policy','سياسة العمولات');
      copy.setAttribute('aria-label',tr('Commission Policy','سياسة العمولات'));const button=copy.querySelector('.MuiListItemButton-root,[role=button],button,a')||copy;
      button.onclick=event=>{event.preventDefault();location.href='/user?page=commission-policy';};list.append(copy);
    }
    if(membershipCategoryKey==='salemax_sales'&&roleNavigation?.has('sales-audit')&&(assignedNavigation===null||assignedNavigation.has('sales-audit'))&&pipelineSource&&!list.querySelector('[data-sx-sales-audit-nav]')){
      const copy=pipelineSource.cloneNode(true);copy.dataset.sxSalesAuditNav='1';copy.removeAttribute('data-salemax-pipeline-link');copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
      const primary=copy.querySelector('.MuiListItemText-primary');if(primary)primary.textContent=tr('Audit Trail','سجل التدقيق');
      copy.setAttribute('aria-label',tr('Audit Trail','سجل التدقيق'));const button=copy.querySelector('.MuiListItemButton-root,[role=button],button,a')||copy;
      button.setAttribute('aria-label',tr('Audit Trail','سجل التدقيق'));button.onclick=event=>{event.preventDefault();location.href='/user?page=sales-audit';};list.append(copy);
    }
    if(membershipCategoryKey==='salemax_sales'&&roleNavigation?.has('sales-organization')&&(assignedNavigation===null||assignedNavigation.has('sales-organization'))&&pipelineSource&&!list.querySelector('[data-sx-sales-organization-nav]')){
      const copy=pipelineSource.cloneNode(true);copy.dataset.sxSalesOrganizationNav='1';copy.removeAttribute('data-salemax-pipeline-link');copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
      const [label,arabic]=salesNavLabels.organization[membershipRole]||salesNavLabels.organization.owner,primary=copy.querySelector('.MuiListItemText-primary');if(primary)primary.textContent=tr(label,arabic);
      copy.setAttribute('aria-label',tr(label,arabic));const button=copy.querySelector('.MuiListItemButton-root,[role=button],button,a')||copy;
      button.setAttribute('aria-label',tr(label,arabic));button.onclick=event=>{event.preventDefault();location.href='/user?page=sales-organization';};list.append(copy);
    }
    if(membershipCategoryKey==='salemax_sales'&&pipelineSource){
      if(roleNavigation?.has('sales-targets')&&(assignedNavigation===null||assignedNavigation.has('sales-targets'))&&!list.querySelector('[data-sx-sales-overview-nav]')){
        const [label,arabic]=salesNavLabels.overview[membershipRole]||['Sales Overview','نظرة عامة على المبيعات'];
        const copy=pipelineSource.cloneNode(true);copy.dataset.sxSalesOverviewNav='1';copy.dataset.sxSalesSection='overview';copy.removeAttribute('data-salemax-pipeline-link');copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
        const primary=copy.querySelector('.MuiListItemText-primary');if(primary)primary.textContent=tr(label,arabic);
        copy.setAttribute('aria-label',tr(label,arabic));const button=copy.querySelector('.MuiListItemButton-root,[role=button],button,a')||copy;
        button.setAttribute('aria-label',tr(label,arabic));button.onclick=event=>{event.preventDefault();location.href='/user?page=sales-workspace&section=overview';};list.append(copy);
      }
      const salesLinks=[['targets','sales-targets','targets'],['reports','sales-targets','reports'],['deals','sales-deals','deals'],['commissions','sales-commissions','commissions']];
      for(const [labelKey,key,section] of salesLinks){
        if(roleNavigation&&!roleNavigation.has(key))continue;if(assignedNavigation!==null&&!assignedNavigation.has(key))continue;
        const marker=`data-sx-sales-${section}-nav`;if(list.querySelector(`[${marker}]`))continue;
        const [label,arabic]=salesNavLabels[labelKey][membershipRole]||salesNavLabels[labelKey].owner;
        const copy=pipelineSource.cloneNode(true);copy.setAttribute(marker,'1');copy.dataset.sxSalesSection=section;copy.removeAttribute('data-salemax-pipeline-link');copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
        const primary=copy.querySelector('.MuiListItemText-primary');if(primary)primary.textContent=tr(label,arabic);
        copy.setAttribute('aria-label',tr(label,arabic));const button=copy.querySelector('.MuiListItemButton-root,[role=button],button,a')||copy;
        button.setAttribute('aria-label',tr(label,arabic));button.onclick=event=>{event.preventDefault();location.href=`/user?page=sales-workspace&section=${section}`;};list.append(copy);
      }
      if((!roleNavigation||roleNavigation.has('sales-finance'))&&(assignedNavigation===null||assignedNavigation.has('sales-finance'))&&!list.querySelector('[data-sx-sales-finance-nav]')){
        const copy=pipelineSource.cloneNode(true);copy.dataset.sxSalesFinanceNav='1';copy.removeAttribute('data-salemax-pipeline-link');copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
        const primary=copy.querySelector('.MuiListItemText-primary');if(primary)primary.textContent=tr('Sales Finance','مالية المبيعات');
        copy.setAttribute('aria-label',tr('Sales Finance','مالية المبيعات'));const button=copy.querySelector('.MuiListItemButton-root,[role=button],button,a')||copy;
        button.setAttribute('aria-label',tr('Sales Finance','مالية المبيعات'));button.onclick=event=>{event.preventDefault();location.href='/user?page=sales-finance&view=overview';};list.append(copy);
      }
    }
  }
  function update() {
    if (location.pathname.replace(/\/$/, '') !== '/user') return;
    resetAgentLoginSearch();
    document.querySelectorAll('.MuiDrawer-paper').forEach(drawer => {
      if (!observed.has(drawer)) { observed.add(drawer); resizeObserver.observe(drawer); }
      const list = drawer.querySelector('ul');
      if (!list) return;
      const searchInput = drawer.querySelector('input');
      if (searchInput) {
        if (searchInput.type !== 'search') searchInput.type = 'search';
        if (searchInput.autocomplete !== 'new-password') searchInput.setAttribute('autocomplete', 'new-password');
        if (searchInput.name !== 'salemax-navigation-query') searchInput.setAttribute('name', 'salemax-navigation-query');
        searchInput.toggleAttribute('data-sx-search-empty', !searchInput.value);
      }
      syncInjectedRows(list);
      list.dataset.sxSidebarList = '1';
      const expanded = sidebarExpandedOverride.get(drawer);
      const collapsed = expanded === undefined ? drawer.getBoundingClientRect().width < 110 : !expanded;
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
      const routes = {'Products & services':'products-services', Courses:'courses', 'Candidate Applications':'forms', 'Invoices & Payments':'finance-settings', 'Finance Reports':'finance-settings', 'Team access':'team-invitations', 'People & Roles':'team-invitations', 'Lead Pipeline':'lead-pipeline', 'Lead Reports':'lead-reports', Tasks:'tasks', 'Call Center':'call-center', 'WA Chatbot':'wa-chatbot', FAQs:'faqs','Commission Policy':'commission-policy','Organization':'sales-organization','Sales Overview':'sales-workspace','Sales Deals':'sales-workspace','Sales Targets':'sales-workspace','Sales Reports':'sales-workspace','My Commissions':'sales-workspace','Commission Payouts':'sales-workspace','Sales Finance':'sales-finance'};
      const present = new Set();
      [...list.children].filter(row => row.tagName === 'LI' && !row.hasAttribute('data-sx-nav-section')).forEach((row, index) => {
        const text = label(row), name = aliases[text] || text;
        const navButton = row.querySelector('.MuiListItemButton-root,[role="button"],button,a');
        const tooltip = name === 'Web Notification' ? tr('Web Notifications', 'إشعارات الويب') : text;
        if (Object.values(routes).includes(active)) {
          const button = row.querySelector('.MuiListItemButton-root');
          if (button) { const selected = row.dataset.sxSalesSection ? active==='sales-workspace'&&(new URLSearchParams(location.search).get('section')||'overview')===row.dataset.sxSalesSection : name==='Finance Reports' ? active==='finance-settings'&&new URLSearchParams(location.search).get('section')==='reports' : name==='Invoices & Payments' ? active==='finance-settings'&&new URLSearchParams(location.search).get('section')!=='reports' : name==='Sales Reports' ? active==='sales-workspace'&&new URLSearchParams(location.search).get('section')==='reports' : name==='Sales Deals' ? active==='sales-workspace'&&new URLSearchParams(location.search).get('section')==='deals' : name==='Sales Targets' ? active==='sales-workspace'&&new URLSearchParams(location.search).get('section')==='targets' : ['My Commissions','Commission Payouts'].includes(name) ? active==='sales-workspace'&&new URLSearchParams(location.search).get('section')==='commissions' : routes[name] === active; button.classList.toggle('Mui-selected', selected); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
        }
        const captions = {Dashboard:['Dashboard','لوحة التحكم'], 'Web Notification':['Web Notifications','إشعارات الويب'], 'Create Meta Template':['Create Meta Template','إنشاء قالب Meta']};
        const leaf = [...row.querySelectorAll('.MuiListItemText-primary span')].at(-1);
        if (leaf && captions[name]) { const next = tr(...captions[name]); if (leaf.textContent !== next) leaf.textContent = next; }
        let group = groups.findIndex(g => g[2].includes(name));
        if(membershipCategoryKey==='salemax_sales'&&membershipRole==='owner'&&name==='People & Roles')group=11;
        if (group < 0) {
          const feature = window.salemaxOptionalLabels?.[text];
          group = ({chat_widget:7, customer_api:7, webhooks:8, whatsapp_warmer:9})[feature] ?? -1;
        }
        if (group < 0) group = groups.length - 1;
        const rank = groups[group][2].indexOf(name);
        const order = String(group * 100 + 1 + (rank < 0 ? index : rank));
        if (row.style.order !== order) row.style.order = order;
        const navKey=row.dataset.sxSalesSection?({overview:'sales-targets',targets:'sales-targets',reports:'sales-targets',deals:'sales-deals',commissions:'sales-commissions'})[row.dataset.sxSalesSection]:navigationKeys[name]||navigationKeys[text];
        const salesTeamEntryHidden=membershipCategoryKey==='salemax_sales'&&(name==='Agent Login'||(name==='Team access'&&membershipRole!=='owner'));
        const duplicateTask=name==='Agent Task'&&!!list.querySelector('[data-sx-tasks-nav]');
        const unknownStaffItem=roleNavigation!==null&&membershipRole!=='owner'&&!navKey&&!['Logout','Sign out'].includes(name);
        const hiddenByOwner=duplicateTask||unknownStaffItem||(assignedNavigation!==null&&navKey&&!assignedNavigation.has(navKey))||(roleNavigation!==null&&navKey&&!roleNavigation.has(navKey))||salesTeamEntryHidden;
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
        const salesGroupLabels={owner:['Sales Operations','عمليات المبيعات'],manager:['My Teams & Sales','فرقي ومبيعاتي'],team_leader:['Team Workspace','مساحة الفريق'],agent:['My Sales Work','عملي في المبيعات'],accountant:['Finance & Payouts','المالية والمدفوعات']};
        const groupLabel=membershipCategoryKey==='salemax_sales'&&index===1?['Products & services','المنتجات والخدمات']:membershipCategoryKey==='salemax_sales'&&index===11?(salesGroupLabels[membershipRole]||salesGroupLabels.owner):[en,arabic];
        const text = tr(...groupLabel);
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
    const salesSection=new URLSearchParams(location.search).get('section')||'overview';const salesRouteKey=({overview:'sales-targets',targets:'sales-targets',reports:'sales-targets',deals:'sales-deals',commissions:'sales-commissions'})[salesSection]||'sales-targets';
    const routeKeys={students:'students','training-profile':'training-profile','products-services':'products-services',courses:'courses',forms:'forms','lead-pipeline':'leads','lead-reports':'reports',tasks:'tasks','call-center':'call-center','finance-settings':new URLSearchParams(location.search).get('section')==='reports'?'finance-reports':'invoices','team-invitations':'team','wa-chatbot':'chatbot',faqs:'faqs','commission-policy':'commission-policy','sales-workspace':salesRouteKey,'sales-finance':'sales-finance','sales-organization':'sales-organization'};
    const required=routeKeys[page];
    // Team access is available to any membership whose role/navigation grants
    // it. The API still enforces team.invite (including owner-approved manager
    // delegation), so category/role-specific redirects here only create a
    // refresh loop for otherwise-authorized Training Center managers.
    if((assignedNavigation!==null&&required&&!assignedNavigation.has(required))||(roleNavigation!==null&&required&&!roleNavigation.has(required)))location.replace('/user?page=dashboard');
  }
  let inboxRetryRoute = '';
  let inboxRetryCount = 0;
  let inboxRetryTimers = [];
  function scheduleInboxRecovery() {
    const params = new URLSearchParams(location.search);
    const route = location.pathname.replace(/\/$/, '') === '/user' && params.get('page') === 'inbox' ? '/user?page=inbox' : '';
    if (route === inboxRetryRoute) return;
    inboxRetryTimers.forEach(clearTimeout);
    inboxRetryTimers = [];
    inboxRetryRoute = route;
    inboxRetryCount = 0;
    if (!route) return;
    [1600, 4200].forEach(delay => inboxRetryTimers.push(setTimeout(() => retryInboxIfEmpty(route), delay)));
  }
  function retryInboxIfEmpty(route) {
    if (route !== inboxRetryRoute || inboxRetryCount >= 2) return;
    const emptyState = [...document.querySelectorAll('body *')].find(node =>
      node.children.length === 0 && /^(No conversations found|لم يتم العثور على محادثات)$/i.test((node.textContent || '').trim())
    );
    if (!emptyState) return;
    const search = document.querySelector('input[placeholder*="Search" i]');
    if (search?.value?.trim()) return;
    const chips = [...document.querySelectorAll('button,[role="button"]')].filter(node => /^(All|Unread|Read|الكل|غير المقروءة|المقروءة)$/i.test((node.textContent || '').trim()));
    const active = chips.find(node => /MuiChip-filledPrimary|Mui-selected/.test(String(node.className)) || node.getAttribute('aria-pressed') === 'true');
    const refresh = active || chips.find(node => /^(All|الكل)$/i.test((node.textContent || '').trim()));
    if (!refresh) return;
    inboxRetryCount++;
    refresh.click();
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
  document.addEventListener('click', event => {
    const button = event.target.closest('.MuiDrawer-paper button, .MuiDrawer-paper [role="button"]');
    if (!button) return;
    const action = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent]
      .filter(Boolean).join(' ').trim();
    const drawer = button.closest('.MuiDrawer-paper');
    if (/\bexpand\b/i.test(action)) {
      // The collapsed CSS pins the paper to 72px; keep explicit state so the
      // resize observer cannot infer the old width and collapse it again.
      if (drawer) sidebarExpandedOverride.set(drawer, true);
      drawer?.removeAttribute('data-sx-sidebar-collapsed');
      clearSidebarSearch(drawer);
      clearLateSidebarEmail(drawer);
      return;
    }
    const buttonRect = button.getBoundingClientRect();
    const drawerRect = drawer?.getBoundingClientRect();
    if (drawerRect && buttonRect.top < drawerRect.top + 64 && buttonRect.right > drawerRect.right - 60) {
      sidebarExpandedOverride.set(drawer, false);
      drawer.setAttribute('data-sx-sidebar-collapsed', '');
    }
  }, true);
  function clearLateSidebarEmail(drawer, attempt = 0) {
    setTimeout(() => {
      if (new URLSearchParams(location.search).get('page') !== 'agent-login') return;
      const input = drawer?.querySelector('input');
      if (input && /@/.test(input.value)) clearSidebarSearch(drawer);
      if (attempt < 11) clearLateSidebarEmail(drawer, attempt + 1);
    }, 250);
  }
  function clearSidebarSearch(drawer) {
    const input = drawer?.querySelector('input');
    if (!input || !input.value) return;
    // Use the search component's own clear button so React updates its
    // controlled value instead of restoring browser autofill on the next render.
    const inputRect = input.getBoundingClientRect();
    const clearButton = [...drawer.querySelectorAll('button,[role="button"]')]
      .filter(button => {
        const rect = button.getBoundingClientRect();
        return rect.width && rect.height && rect.top < inputRect.bottom && rect.bottom > inputRect.top
          && Math.abs(rect.right - inputRect.right) < 28;
      })
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
    if (clearButton) {
      clearButton.click();
      return;
    }
    // Keep a fallback for layouts where the search component has no clear control.
    input.focus({ preventScroll: true });
    input.select();
    try { document.execCommand('delete'); } catch (_) {}
    input.blur();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (input.value && setter) setter.call(input, '');
    else if (input.value) input.value = '';
    const event = typeof InputEvent === 'function'
      ? new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null })
      : new Event('input', { bubbles: true });
    input.dispatchEvent(event);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  let agentLoginSearchResetForRoute = false;
  function resetAgentLoginSearch() {
    const active = new URLSearchParams(location.search).get('page');
    if (active === 'agent-login' && !agentLoginSearchResetForRoute) {
      const drawers = [...document.querySelectorAll('.MuiDrawer-paper')];
      if (!drawers.some(drawer => drawer.querySelector('input'))) return;
      drawers.forEach(drawer => {
        const input = drawer.querySelector('input');
        if (input) {
          input.setAttribute('autocomplete', 'new-password');
          input.setAttribute('name', 'salemax-navigation-query');
        }
        clearSidebarSearch(drawer);
      });
      agentLoginSearchResetForRoute = true;
      // Browser autofill can arrive after React mounts the controlled search
      // input. Clear that late value briefly while the Agent Login route settles.
      drawers.forEach(drawer => clearLateSidebarEmail(drawer));
    } else if (active !== 'agent-login') {
      agentLoginSearchResetForRoute = false;
    }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('.MuiListItemButton-root');
    if (!button) return;
    const title = button.querySelector('.MuiListItemText-primary')?.textContent?.trim() || button.textContent.trim();
    const name = aliases[title] || window.salemaxSidebarAliases?.[title] || title;
    if (name === 'Team Login' || name === 'Agent Login') {
      document.querySelectorAll('.MuiDrawer-paper').forEach(drawer => {
        const input = drawer.querySelector('input');
        if (input) {
          input.setAttribute('autocomplete', 'new-password');
          input.setAttribute('name', 'salemax-navigation-query');
        }
        clearSidebarSearch(drawer);
      });
    }
  }, true);
  // Observe permission flags too: restoring a feature must restore its group heading.
  new MutationObserver(schedule).observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['data-sx-optional-hidden']});
  document.addEventListener('input', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('popstate', schedule);
  window.addEventListener('storage', schedule);
  const refreshSidebarAccess=()=>{navigationLoaded=false;loadAssignedNavigation().then(schedule);};
  window.addEventListener('focus',refreshSidebarAccess);
  window.setInterval(refreshSidebarAccess,30000);
  loadAssignedNavigation();
  loadOptionalNavigation();
  loadCallCenterAccess();
  schedule();
  scheduleInboxRecovery();
  window.addEventListener('popstate', scheduleInboxRecovery);
  window.addEventListener('hashchange', scheduleInboxRecovery);
})();
