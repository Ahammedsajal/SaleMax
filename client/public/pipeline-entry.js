(() => {
  if (window.__salemaxPipelineEntry) return;
  window.__salemaxPipelineEntry = true;

  const isArabic = () => { const language = (localStorage.getItem('language') || '').toLowerCase(); return language === 'ar' || language.startsWith('ar-') || language.includes('arabic'); };
  const isLeadReportsRoute = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'lead-reports';
  const pipelineView = () => isLeadReportsRoute()?'reports':(['board','list','followups'].includes(new URLSearchParams(location.search).get('view'))?new URLSearchParams(location.search).get('view'):'');
  const pipelineSource = () => '/pipeline/?embed=1'+(pipelineView()?'&view='+encodeURIComponent(pipelineView()):'')+(new URLSearchParams(location.search).get('lead')?'&lead='+encodeURIComponent(new URLSearchParams(location.search).get('lead')):'');
  const isTasksRoute = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'tasks';
  const isCallCenterRoute = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'call-center';
  const isCommissionPolicyRoute = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'commission-policy';
  const isSalesWorkspaceRoute = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'sales-workspace';
  const isSalesFinanceRoute = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'sales-finance';
  const isSalesOrganizationRoute = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'sales-organization';
  const isSalesAuditRoute = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'sales-audit';
  const isDashboardRoute = () => location.pathname.replace(/\/$/, '') === '/user' && (!new URLSearchParams(location.search).get('page') || new URLSearchParams(location.search).get('page') === 'dashboard');
  const isPipelineRoute = () => location.pathname.replace(/\/$/, '') === '/user' && ['lead-pipeline','lead-reports'].includes(new URLSearchParams(location.search).get('page'));
  const pipelineLabel = () => isArabic() ? (isLeadReportsRoute()?'تقارير العملاء المحتملين':'مسار العملاء المحتملين') : (isLeadReportsRoute()?'Lead Reports':'Lead Pipeline');
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  // Measure the actual shell once for every embedded workspace. Temporary
  // drawers overlay the page; docked drawers consume the physical side they occupy.
  function workspaceBounds(){
    const viewportWidth=window.innerWidth,viewportHeight=window.innerHeight;
    let left=0,right=0;
    for(const drawer of document.querySelectorAll('.MuiDrawer-paper')){
      if(!visible(drawer)||getComputedStyle(drawer).display==='none')continue;
      const r=drawer.getBoundingClientRect();
      const docked=drawer.closest('.MuiDrawer-docked')||drawer.classList.contains('MuiDrawer-paperAnchorDockedLeft')||drawer.classList.contains('MuiDrawer-paperAnchorDockedRight');
      const compactPersistent=viewportWidth>720&&drawer.querySelector('[data-sx-sidebar-list]');
      if(drawer.closest('.MuiModal-root')&&!docked&&!compactPersistent)continue;
      if(r.right<=0||r.left>=viewportWidth||r.width>=viewportWidth*.75)continue;
      if(r.left<=1)left=Math.max(left,Math.min(viewportWidth,r.right));
      else if(r.right>=viewportWidth-1)right=Math.max(right,viewportWidth-Math.max(0,r.left));
    }
    const candidates=[...document.querySelectorAll('header.MuiAppBar-root, .MuiAppBar-root, .MuiBox-root')];
    const topbar=candidates.filter(el=>{const r=el.getBoundingClientRect();return visible(el)&&getComputedStyle(el).display!=='none'&&r.y>=-1&&r.y<=5&&r.height>=30&&r.height<100&&r.width>viewportWidth*.5;}).sort((a,b)=>{const primary=el=>el.matches('.MuiAppBar-root')?0:1;return primary(a)-primary(b)||a.getBoundingClientRect().height-b.getBoundingClientRect().height;})[0];
    const top=Math.min(viewportHeight,Math.max(0,topbar?.getBoundingClientRect().bottom||0));
    return {left,top,width:Math.max(0,viewportWidth-left-right),height:Math.max(0,viewportHeight-top),topbar};
  }

  function bindWorkspaceNavigation(frame){
    if(frame.__shellNavigationBound)return;
    frame.__shellNavigationBound=true;
    const bind=()=>{
      try{
        frame.contentDocument?.addEventListener('click',event=>{
          const link=event.target.closest?.('a[href]');
          if(!link||link.hasAttribute('target')||link.hasAttribute('download'))return;
          const destination=new URL(link.href,location.href);
          if(destination.origin===location.origin&&/^\/(user|agent|admin)(\/|$)/.test(destination.pathname))link.target='_top';
        },true);
      }catch{}
    };
    frame.addEventListener('load',bind);bind();
  }

  // Three connected stages make the destination recognizable as a pipeline
  // even when the sidebar is reduced to icons only.
  function setPipelineIcon(row) {
    const icon = row.querySelector('.MuiListItemIcon-root, svg.MuiSvgIcon-root') || row.querySelector('svg');
    if (!icon) return;
    const svg = icon.tagName.toLowerCase() === 'svg' ? icon : icon.querySelector('svg');
    if (!svg) return;
    svg.replaceChildren();
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', 'M3 4h7v6H3V4zm11 0h7v6h-7V4zM3 14h7v6H3v-6zm11 0h7v6h-7v-6zM10 7h4v1h-4zm1 1h2v7h-2zm-1 6h4v1h-4z');
    svg.appendChild(path);
  }

  function addNavigationItem() {
    document.querySelectorAll('[data-salemax-pipeline-fallback]').forEach((el) => el.remove());
    document.querySelectorAll('[data-salemax-pipeline-link]').forEach((el) => {
      if (el.tagName !== 'LI') (el.closest('li') || el).remove();
    });
    const phonebooks = [...document.querySelectorAll('[role="button"],button,a')]
      .filter((el) => ['phonebook', 'دفتر الهاتف'].includes((el.innerText || '').trim().toLowerCase()) && el.closest('.MuiDrawer-root'));
    phonebooks.forEach((phonebook) => {
      const row = phonebook.closest('li') || phonebook.parentElement;
      if (!row || row.parentElement.querySelector(':scope > li[data-salemax-pipeline-link]')) return;
      const pipelineRow = row.cloneNode(true);
      pipelineRow.dataset.salemaxPipelineLink = '1';
      pipelineRow.setAttribute('aria-label', pipelineLabel());
      pipelineRow.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
      pipelineRow.querySelectorAll('span').forEach((node) => {
        if (['Phonebook', 'دفتر الهاتف'].includes((node.textContent || '').trim())) node.textContent = pipelineLabel();
      });
      setPipelineIcon(pipelineRow);
      const button = pipelineRow.querySelector('[role="button"],button,a') || pipelineRow;
      button.setAttribute('aria-label', pipelineLabel());
      button.setAttribute('tabindex', '0');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        location.href = '/user?page=lead-pipeline';
      });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          location.href = '/user?page=lead-pipeline';
        }
      });
      row.parentElement.insertBefore(pipelineRow, row);
    });

    const active = isPipelineRoute()&&!isLeadReportsRoute();
    document.querySelectorAll('[data-salemax-pipeline-link] .MuiListItemButton-root').forEach((item) => {
      item.classList.toggle('Mui-selected', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    if (active) {
      document.querySelectorAll('.MuiListItemButton-root.Mui-selected').forEach((item) => {
        if (!item.closest('[data-salemax-pipeline-link]')) item.classList.remove('Mui-selected');
      });
    }
  }

  function syncPipelineWorkspace() {
    const existing = document.getElementById('salemax-pipeline-workspace');
    if (!isPipelineRoute()) {
      existing?.remove();
      return;
    }

    const {left,top,width,height,topbar}=workspaceBounds();
    if (isPipelineRoute() && topbar) {
      const breadcrumb = [...topbar.querySelectorAll('*')].find((el) =>
        el.childElementCount === 0 && ['Dashboard', 'لوحة التحكم'].includes((el.textContent || '').trim()));
      if (breadcrumb) breadcrumb.textContent = pipelineLabel();
    }

    let workspace = existing;
    if (!workspace) {
      workspace = document.createElement('iframe');
      workspace.id = 'salemax-pipeline-workspace';
      workspace.title = pipelineLabel();
      workspace.src = pipelineSource();
      workspace.style.cssText = 'position:fixed;z-index:1100;border:0;background:#f5f7fa;display:block;';
      document.body.appendChild(workspace);
    }
    const expectedSrc=pipelineSource();
    if(workspace.getAttribute('src')!==expectedSrc)workspace.src=expectedSrc;
    bindWorkspaceNavigation(workspace);
    workspace.style.left = `${left}px`;
    workspace.style.top = `${top}px`;
    workspace.style.width = `${width}px`;
    workspace.style.height = `${height}px`;
  }

  function syncBusinessDashboard(){
    const existing=document.getElementById('salemax-business-dashboard');
    if(!isDashboardRoute()){existing?.remove();return;}
    const {left,top,width,height,topbar}=workspaceBounds();
    if(topbar){const crumb=[...topbar.querySelectorAll('*')].find(el=>el.childElementCount===0&&['Dashboard','لوحة التحكم'].includes((el.textContent||'').trim()));if(crumb)crumb.textContent=isArabic()?'لوحة المعلومات':'Dashboard';}
    let frame=existing;if(!frame){frame=document.createElement('iframe');frame.id='salemax-business-dashboard';frame.title=isArabic()?'لوحة المعلومات':'SaleMaX dashboard';frame.src='/business-dashboard/?embed=1&v=20261018-auth2';frame.style.cssText='position:fixed;z-index:1100;border:0;background:#f5f7fb;display:block;';document.body.append(frame);}
    bindWorkspaceNavigation(frame);
    frame.style.left=`${left}px`;frame.style.top=`${top}px`;frame.style.width=`${width}px`;frame.style.height=`${height}px`;
  }

  function syncTasksWorkspace(){
    const existing=document.getElementById('salemax-tasks-workspace');
    if(!isTasksRoute()){existing?.remove();return;}
    const {left,top,width,height,topbar}=workspaceBounds();
    if(topbar){const crumb=[...topbar.querySelectorAll('*')].find(el=>el.childElementCount===0&&['Dashboard','لوحة التحكم'].includes((el.textContent||'').trim()));if(crumb)crumb.textContent=isArabic()?'المهام':'Tasks';}
    const params=new URLSearchParams(location.search),taskId=params.get('task'),leadId=params.get('lead'),sourceType=params.get('sourceType'),sourceId=params.get('sourceId');const expectedSource='/tasks/?embed=1'+(taskId?'&task='+encodeURIComponent(taskId):'')+(leadId?'&lead='+encodeURIComponent(leadId):'')+(sourceType&&sourceId?'&sourceType='+encodeURIComponent(sourceType)+'&sourceId='+encodeURIComponent(sourceId):'');
    let frame=existing;if(!frame){frame=document.createElement('iframe');frame.id='salemax-tasks-workspace';frame.title=isArabic()?'المهام':'Tasks';frame.src=expectedSource;frame.style.cssText='position:fixed;z-index:1100;border:0;background:#f5f7fa;display:block;';document.body.append(frame);}else if(frame.getAttribute('src')!==expectedSource)frame.src=expectedSource;
    bindWorkspaceNavigation(frame);
    frame.style.left=`${left}px`;frame.style.top=`${top}px`;frame.style.width=`${width}px`;frame.style.height=`${height}px`;
  }

  function syncCallCenterWorkspace(){
    const existing=document.getElementById('salemax-call-center-workspace');
    if(!isCallCenterRoute()){existing?.remove();return;}
    const {left,top,width,height,topbar}=workspaceBounds();
    if(topbar){const crumb=[...topbar.querySelectorAll('*')].find(el=>el.childElementCount===0&&['Dashboard','لوحة التحكم'].includes((el.textContent||'').trim()));if(crumb)crumb.textContent=isArabic()?'مركز الاتصال':'Call Center';}
    const leadId=new URLSearchParams(location.search).get('lead'),expectedSource='/call-center/?embed=1'+(leadId?'&lead='+encodeURIComponent(leadId):'');
    let frame=existing;if(!frame){frame=document.createElement('iframe');frame.id='salemax-call-center-workspace';frame.title=isArabic()?'مركز الاتصال':'Call Center';frame.src=expectedSource;frame.style.cssText='position:fixed;z-index:1100;border:0;background:#f5f7fa;display:block;';document.body.append(frame);}else if(frame.getAttribute('src')!==expectedSource)frame.src=expectedSource;
    bindWorkspaceNavigation(frame);
    frame.style.left=`${left}px`;frame.style.top=`${top}px`;frame.style.width=`${width}px`;frame.style.height=`${height}px`;
  }

  function syncCommissionPolicyWorkspace(){
    const existing=document.getElementById('salemax-commission-policy-workspace');
    if(!isCommissionPolicyRoute()){existing?.remove();return;}
    const {left,top,width,height,topbar}=workspaceBounds();
    if(topbar){const crumb=[...topbar.querySelectorAll('*')].find(el=>el.childElementCount===0&&['Dashboard','لوحة التحكم'].includes((el.textContent||'').trim()));if(crumb)crumb.textContent=isArabic()?'سياسة العمولات':'Commission Policy';}
    let frame=existing;if(!frame){frame=document.createElement('iframe');frame.id='salemax-commission-policy-workspace';frame.title=isArabic()?'سياسة العمولات':'Commission Policy';frame.src='/sales-commissions/?embed=1';frame.style.cssText='position:fixed;z-index:1100;border:0;background:#f5f7fa;display:block;';document.body.append(frame);}
    bindWorkspaceNavigation(frame);
    frame.style.left=`${left}px`;frame.style.top=`${top}px`;frame.style.width=`${width}px`;frame.style.height=`${height}px`;
  }

  function syncSalesWorkspace(){
    const existing=document.getElementById('salemax-sales-workspace');
    if(!isSalesWorkspaceRoute()){existing?.remove();return;}
    const {left,top,width,height,topbar}=workspaceBounds();
    const requestedSection=new URLSearchParams(location.search).get('section'),section=['overview','deals','commissions','targets','reports'].includes(requestedSection)?requestedSection:'overview';
    const labels={overview:['نظرة عامة على المبيعات','Sales Overview'],deals:['صفقات المبيعات','Sales Deals'],targets:['الأهداف والأداء','Targets & Performance'],reports:['تقارير المبيعات','Sales Reports'],commissions:['العمولات والمدفوعات','Commissions & Payouts']};
    if(topbar){const crumb=[...topbar.querySelectorAll('*')].find(el=>el.childElementCount===0&&['Dashboard','لوحة التحكم'].includes((el.textContent||'').trim()));if(crumb)crumb.textContent=isArabic()?labels[section][0]:labels[section][1];}
    const expected='/sales-workspace/?embed=1&section='+section;
    let frame=existing;if(!frame){frame=document.createElement('iframe');frame.id='salemax-sales-workspace';frame.title=isArabic()?labels[section][0]:labels[section][1];frame.src=expected;frame.style.cssText='position:fixed;z-index:1100;border:0;background:#f5f7fa;display:block;';document.body.append(frame);}else if(frame.getAttribute('src')!==expected)frame.src=expected;
    bindWorkspaceNavigation(frame);
    frame.style.left=`${left}px`;frame.style.top=`${top}px`;frame.style.width=`${width}px`;frame.style.height=`${height}px`;
  }

  function syncSalesFinanceWorkspace(){
    const existing=document.getElementById('salemax-sales-finance-workspace');
    if(!isSalesFinanceRoute()){existing?.remove();return;}
    const {left,top,width,height,topbar}=workspaceBounds();
    const params=new URLSearchParams(location.search),view=['overview','invoices','reconciliation','reports'].includes(params.get('view'))?params.get('view'):'overview';
    const labels={overview:['نظرة عامة على المالية','Finance Overview'],invoices:['الفواتير والتحصيلات','Invoices & Collections'],reconciliation:['مطابقة المدفوعات','Reconciliation'],reports:['تقارير المالية','Finance Reports']};
    if(topbar){const crumb=[...topbar.querySelectorAll('*')].find(el=>el.childElementCount===0&&['Dashboard','لوحة التحكم'].includes((el.textContent||'').trim()));if(crumb)crumb.textContent=isArabic()?labels[view][0]:labels[view][1];}
    const expected='/sales-finance/?embed=1&view='+view;
    let frame=existing;if(!frame){frame=document.createElement('iframe');frame.id='salemax-sales-finance-workspace';frame.title=isArabic()?labels[view][0]:labels[view][1];frame.src=expected;frame.style.cssText='position:fixed;z-index:1100;border:0;background:#f5f7fa;display:block;';document.body.append(frame);}else if(frame.getAttribute('src')!==expected)frame.src=expected;
    bindWorkspaceNavigation(frame);
    frame.style.left=`${left}px`;frame.style.top=`${top}px`;frame.style.width=`${width}px`;frame.style.height=`${height}px`;
  }

  function syncSalesOrganizationWorkspace(){
    const existing=document.getElementById('salemax-sales-organization-workspace');
    if(!isSalesOrganizationRoute()){existing?.remove();return;}
    const {left,top,width,height,topbar}=workspaceBounds();
    const title=isArabic()?'الهيكل التنظيمي':'Organization';
    if(topbar){const crumb=[...topbar.querySelectorAll('*')].find(el=>el.childElementCount===0&&['Dashboard','لوحة التحكم'].includes((el.textContent||'').trim()));if(crumb)crumb.textContent=title;}
    let frame=existing;if(!frame){frame=document.createElement('iframe');frame.id='salemax-sales-organization-workspace';frame.title=title;frame.src='/sales-organization/?embed=1';frame.style.cssText='position:fixed;z-index:1100;border:0;background:#f5f7fa;display:block;';document.body.append(frame);}
    bindWorkspaceNavigation(frame);
    frame.style.left=`${left}px`;frame.style.top=`${top}px`;frame.style.width=`${width}px`;frame.style.height=`${height}px`;
  }

  function syncSalesAuditWorkspace(){
    const existing=document.getElementById('salemax-sales-audit-workspace');
    if(!isSalesAuditRoute()){existing?.remove();return;}
    const {left,top,width,height,topbar}=workspaceBounds();
    const title=isArabic()?'سجل التدقيق':'Audit Trail';
    if(topbar){const crumb=[...topbar.querySelectorAll('*')].find(el=>el.childElementCount===0&&['Dashboard','لوحة التحكم'].includes((el.textContent||'').trim()));if(crumb)crumb.textContent=title;}
    let frame=existing;if(!frame){frame=document.createElement('iframe');frame.id='salemax-sales-audit-workspace';frame.title=title;frame.src='/sales-audit/?embed=1';frame.style.cssText='position:fixed;z-index:1100;border:0;background:#f5f7fa;display:block;';document.body.append(frame);}
    bindWorkspaceNavigation(frame);
    frame.style.left=`${left}px`;frame.style.top=`${top}px`;frame.style.width=`${width}px`;frame.style.height=`${height}px`;
  }

  function update() {
    addNavigationItem();
    syncBusinessDashboard();
    syncPipelineWorkspace();
    syncTasksWorkspace();
    syncCallCenterWorkspace();
    syncCommissionPolicyWorkspace();
    syncSalesWorkspace();
    syncSalesFinanceWorkspace();
    syncSalesOrganizationWorkspace();
    syncSalesAuditWorkspace();
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; update(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','hidden','dir'] });
  window.addEventListener('resize', update);
  window.addEventListener('transitionend', event=>{if(event.target.closest?.('.MuiDrawer-root,.MuiAppBar-root'))update();});
  window.addEventListener('popstate', update);
  update();
})();
