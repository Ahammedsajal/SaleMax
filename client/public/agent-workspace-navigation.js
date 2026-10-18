/* Extend the existing Agent Panel with the shared role/navigation contract. */
(()=>{'use strict';
  if(window.__sxAgentWorkspaceNavigation)return;window.__sxAgentWorkspaceNavigation=true;
  const active=()=>location.pathname.replace(/\/$/,'')==='/agent';
  if(!active())return;
  const ar=()=>/^(ar(?:-|$))/.test(localStorage.getItem('language')||'')||(localStorage.getItem('language')||'').toLowerCase().includes('arab');
  const items=[
    ['dashboard','dashboard','Overview','نظرة عامة','◈'],
    ['leads','lead-pipeline','Lead Pipeline','مسار العملاء المحتملين','▤'],
    ['contacts','phonebook','Phonebook','دفتر الهاتف','▣'],
    ['courses','courses','Courses','الدورات','▱'],
    ['enrollments','students','Enrollments','التسجيلات','♙'],
    ['reports','lead-reports','Reports','التقارير','▥'],
    ['forms','forms','Candidate Applications','طلبات المتقدمين','▧']
  ];
  let allowed=new Set(),loaded=false,scheduled=false;
  window.SaleMaxAgentNavigation={allowed:key=>loaded&&allowed.has(key)};
  function render(){
    if(!active())return;
    const label=[...document.querySelectorAll('.MuiTypography-root')].find(node=>['My Tasks','مهامي','المهام الخاصة بي'].includes(node.textContent.trim())&&!node.closest('[data-sx-agent-links]'));
    const taskRow=label?.parentElement,list=taskRow?.parentElement;
    if(!list)return;
    const sidebar=list.parentElement?.parentElement;
    if(sidebar?.parentElement)sidebar.parentElement.setAttribute('data-sx-agent-sidebar','');
    let nav=list.querySelector('[data-sx-agent-links]');
    if(!nav){nav=document.createElement('nav');nav.setAttribute('data-sx-agent-links','');nav.setAttribute('aria-label',ar()?'مساحة العمل':'Workspace');taskRow.after(nav);}
    const page=new URLSearchParams(location.search).get('page')||'chat';
    const permitted=items.filter(([key])=>allowed.has(key));
    const signature=JSON.stringify([page,ar(),[...allowed]]);
    const current=items.find(item=>item[1]===page);
    if(current){const heading=[...document.querySelectorAll('h6,h5,h4')].find(node=>!node.closest('[data-sx-agent-sidebar]')&&node.getBoundingClientRect().top<100&&['Chats','الدردشات','المحادثات',...items.flatMap(item=>[item[2],item[3]])].includes(node.textContent.trim()));if(heading&&heading.textContent!==(ar()?current[3]:current[2]))heading.textContent=ar()?current[3]:current[2];}
    if(nav.dataset.signature===signature)return;
    nav.dataset.signature=signature;nav.replaceChildren();
    for(const [,route,en,arabic,icon] of permitted){
      const link=document.createElement('a');link.href='/agent?page='+route;
      const glyph=document.createElement('span');glyph.className='sx-agent-nav-icon';glyph.textContent=icon;glyph.setAttribute('aria-hidden','true');
      const text=document.createElement('span');text.textContent=ar()?arabic:en;
      link.append(glyph,text);if(route===page)link.setAttribute('aria-current','page');nav.append(link);
    }
    const inboxLabel=[...list.querySelectorAll('.MuiTypography-root')].find(node=>['Chats','المحادثات','الدردشات'].includes(node.textContent.trim()));
    if(loaded){taskRow.hidden=!allowed.has('tasks');if(inboxLabel)inboxLabel.parentElement.hidden=!allowed.has('inbox');}
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;render();});}
  async function refresh(){
    try{const session=await window.SaleMaxWorkspace.session();
      const assigned=session.assignedNavigation;allowed=new Set((session.roleNavigation||[]).filter(key=>assigned==null||assigned.includes(key)));loaded=true;
    }catch{allowed=new Set();loaded=false;}
    schedule();window.dispatchEvent(new Event('salemax:agent-navigation'));
  }
  const style=document.createElement('style');style.textContent=`[data-sx-agent-links]{display:grid;gap:4px;margin:4px 0}[data-sx-agent-links] a{display:flex;align-items:center;gap:10px;min-height:44px;padding:8px 12px;border:1px solid transparent;border-radius:12px;text-decoration:none;color:#667085;font:500 13px/1.4 Roboto,Arial,sans-serif}[data-sx-agent-links] a:hover,[data-sx-agent-links] a[aria-current=page]{background:#f8eaf0;border-color:#ebc6d4;color:#a8003b}[data-sx-agent-links] a:focus-visible{outline:3px solid #a8003b55;outline-offset:2px}.sx-agent-nav-icon{display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:10px;background:#f5eef1;color:#a8003b;font-size:19px}[data-sx-agent-sidebar]{min-width:0!important;overflow:hidden}[data-sx-agent-sidebar]>:nth-child(2){min-height:0;overflow-y:auto!important}`;document.head.append(style);
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',schedule);window.addEventListener('storage',refresh);
  setInterval(refresh,30000);refresh();
})();
