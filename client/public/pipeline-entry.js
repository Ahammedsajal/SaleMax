(() => {
  if (window.__salemaxPipelineEntry) return;
  window.__salemaxPipelineEntry = true;

  const isArabic = () => { const language = (localStorage.getItem('language') || '').toLowerCase(); return language === 'ar' || language.includes('arabic'); };
  const isLeadReportsRoute = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'lead-reports';
  const isTasksRoute = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'tasks';
  const isCallCenterRoute = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'call-center';
  const isPipelineRoute = () => location.pathname.replace(/\/$/, '') === '/user' && ['lead-pipeline','lead-reports'].includes(new URLSearchParams(location.search).get('page'));
  const pipelineLabel = () => isArabic() ? (isLeadReportsRoute()?'تقارير العملاء المحتملين':'مسار العملاء المحتملين') : (isLeadReportsRoute()?'Lead Reports':'Lead Pipeline');
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

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

    const drawer = [...document.querySelectorAll('.MuiDrawer-paper')].find(visible);
    const topbar = [...document.querySelectorAll('.MuiBox-root')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return visible(el) && r.y <= 5 && r.height >= 30 && r.height < 100 && r.width > window.innerWidth * 0.5;
      })
      .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
    const drawerRect = drawer?.getBoundingClientRect();
    const topRect = topbar?.getBoundingClientRect();
    if (isPipelineRoute() && topbar) {
      const breadcrumb = [...topbar.querySelectorAll('*')].find((el) =>
        el.childElementCount === 0 && ['Dashboard', 'لوحة التحكم'].includes((el.textContent || '').trim()));
      if (breadcrumb) breadcrumb.textContent = pipelineLabel();
    }
    const left = Math.max(0, drawerRect?.right || 260);
    const top = Math.max(0, topRect?.bottom || 60);

    let workspace = existing;
    if (!workspace) {
      workspace = document.createElement('iframe');
      workspace.id = 'salemax-pipeline-workspace';
      workspace.title = pipelineLabel();
      workspace.src = '/pipeline/?embed=1'+(isLeadReportsRoute()?'&view=reports':'')+(new URLSearchParams(location.search).get('lead')?'&lead='+encodeURIComponent(new URLSearchParams(location.search).get('lead')):'');
      workspace.style.cssText = 'position:fixed;z-index:1100;border:0;background:#f5f7fa;display:block;';
      document.body.appendChild(workspace);
    }
    const expectedSrc='/pipeline/?embed=1'+(isLeadReportsRoute()?'&view=reports':'')+(new URLSearchParams(location.search).get('lead')?'&lead='+encodeURIComponent(new URLSearchParams(location.search).get('lead')):'');
    if(workspace.getAttribute('src')!==expectedSrc)workspace.src=expectedSrc;
    workspace.style.left = `${left}px`;
    workspace.style.top = `${top}px`;
    workspace.style.width = `${Math.max(0, window.innerWidth - left)}px`;
    workspace.style.height = `${Math.max(0, window.innerHeight - top)}px`;
  }

  function syncTasksWorkspace(){
    const existing=document.getElementById('salemax-tasks-workspace');
    if(!isTasksRoute()){existing?.remove();return;}
    const drawer=[...document.querySelectorAll('.MuiDrawer-paper')].find(visible);
    const topbar=[...document.querySelectorAll('.MuiBox-root')].filter(el=>{const r=el.getBoundingClientRect();return visible(el)&&r.y<=5&&r.height>=30&&r.height<100&&r.width>window.innerWidth*.5;}).sort((a,b)=>a.getBoundingClientRect().height-b.getBoundingClientRect().height)[0];
    const drawerRect=drawer?.getBoundingClientRect(),topRect=topbar?.getBoundingClientRect(),left=Math.max(0,drawerRect?.right||0),top=Math.max(0,topRect?.bottom||60);
    if(topbar){const crumb=[...topbar.querySelectorAll('*')].find(el=>el.childElementCount===0&&['Dashboard','لوحة التحكم'].includes((el.textContent||'').trim()));if(crumb)crumb.textContent=isArabic()?'المهام':'Tasks';}
    const params=new URLSearchParams(location.search),taskId=params.get('task'),leadId=params.get('lead'),sourceType=params.get('sourceType'),sourceId=params.get('sourceId');const expectedSource='/tasks/?embed=1'+(taskId?'&task='+encodeURIComponent(taskId):'')+(leadId?'&lead='+encodeURIComponent(leadId):'')+(sourceType&&sourceId?'&sourceType='+encodeURIComponent(sourceType)+'&sourceId='+encodeURIComponent(sourceId):'');
    let frame=existing;if(!frame){frame=document.createElement('iframe');frame.id='salemax-tasks-workspace';frame.title=isArabic()?'المهام':'Tasks';frame.src=expectedSource;frame.style.cssText='position:fixed;z-index:1100;border:0;background:#f5f7fa;display:block;';document.body.append(frame);}else if(frame.getAttribute('src')!==expectedSource)frame.src=expectedSource;
    frame.style.left=`${left}px`;frame.style.top=`${top}px`;frame.style.width=`${Math.max(0,window.innerWidth-left)}px`;frame.style.height=`${Math.max(0,window.innerHeight-top)}px`;
  }

  function syncCallCenterWorkspace(){
    const existing=document.getElementById('salemax-call-center-workspace');
    if(!isCallCenterRoute()){existing?.remove();return;}
    const drawer=[...document.querySelectorAll('.MuiDrawer-paper')].find(visible);
    const topbar=[...document.querySelectorAll('.MuiBox-root')].filter(el=>{const r=el.getBoundingClientRect();return visible(el)&&r.y<=5&&r.height>=30&&r.height<100&&r.width>window.innerWidth*.5;}).sort((a,b)=>a.getBoundingClientRect().height-b.getBoundingClientRect().height)[0];
    const drawerRect=drawer?.getBoundingClientRect(),topRect=topbar?.getBoundingClientRect(),left=Math.max(0,drawerRect?.right||260),top=Math.max(0,topRect?.bottom||60);
    if(topbar){const crumb=[...topbar.querySelectorAll('*')].find(el=>el.childElementCount===0&&['Dashboard','لوحة التحكم'].includes((el.textContent||'').trim()));if(crumb)crumb.textContent=isArabic()?'مركز الاتصال':'Call Center';}
    let frame=existing;if(!frame){frame=document.createElement('iframe');frame.id='salemax-call-center-workspace';frame.title=isArabic()?'مركز الاتصال':'Call Center';frame.src='/call-center/?embed=1';frame.style.cssText='position:fixed;z-index:1100;border:0;background:#f5f7fa;display:block;';document.body.append(frame);}
    frame.style.left=`${left}px`;frame.style.top=`${top}px`;frame.style.width=`${Math.max(0,window.innerWidth-left)}px`;frame.style.height=`${Math.max(0,window.innerHeight-top)}px`;
  }

  function update() {
    addNavigationItem();
    syncPipelineWorkspace();
    syncTasksWorkspace();
    syncCallCenterWorkspace();
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; update(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', update);
  window.addEventListener('popstate', update);
  update();
})();
