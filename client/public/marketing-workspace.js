/* Extend the existing compiled marketing screens; retain their data and actions. */
(() => {
  'use strict';
  if(window.__sxMarketingWorkspace)return;window.__sxMarketingWorkspace=true;
  const pages={
    'campaign-dashboard':{key:'campaign-dashboard',titles:['Campaign Dashboard','لوحة الحملات']},
    'send-campaign':{key:'campaigns',titles:['Send Campaign','إرسال حملة']},
    'create-meta-template':{key:'templates',titles:['Create Meta Template','إنشاء قالب ميتا']}
  };
  const entries=[
    {page:'campaign-dashboard',key:'campaign-dashboard',label:['Campaign results','نتائج الحملات'],icon:'M4 19V9m8 10V4m8 15v-7'},
    {page:'send-campaign',key:'campaigns',label:['Prepare campaign','إعداد حملة'],icon:'m3 4 18 8-18 8 4-8-4-8Zm4 8h14'},
    {page:'create-meta-template',key:'templates',label:['Create template','إنشاء قالب'],icon:'M5 3h9l5 5v13H5V3Zm9 0v6h5M9 13h6m-6 4h6'}
  ];
  const current=()=>/^\/(user|agent)\/?$/.test(location.pathname)?new URLSearchParams(location.search).get('page'):null;
  const syncTheme=()=>{const saved=localStorage.getItem('theme_mode'),dark=saved==='dark'||(saved!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches),mode=dark?'dark':'light';if(document.documentElement.dataset.sxTheme!==mode)document.documentElement.dataset.sxTheme=mode;};
  const arabic=()=>/^(ar(?:[-_]|$)|arabic)/i.test(localStorage.getItem('language')||document.documentElement.lang||'');
  const tr=pair=>pair[arabic()?1:0];
  const href=page=>'/user?page='+page+(window.SaleMaxActor==='agent'?'&actor=agent':'');
  let access=null,accessKey='',checkedAt=0,loading=false,scheduled=false;
  const allowed=key=>Array.isArray(access?.roleNavigation)&&access.roleNavigation.includes(key)&&(!Array.isArray(access.assignedNavigation)||access.assignedNavigation.includes(key));
  const link=(page,label,className)=>{const a=document.createElement('a');a.href=href(page);a.textContent=label;a.className=className||'';return a;};
  function remove(){document.getElementById('sx-marketing-nav')?.remove();document.querySelectorAll('[data-sx-marketing-action],[data-sx-marketing-empty]').forEach(node=>node.remove());}
  async function checkAccess(){
    const actor=window.SaleMaxActor==='agent'?'agent':'user',key=actor+':'+(localStorage.getItem(actor==='agent'?'wacrm_agent':'wacrm_user')||'cookie');
    if(key!==accessKey){access=null;checkedAt=0;accessKey=key;remove();}
    if(loading||Date.now()-checkedAt<5000||!window.SaleMaxWorkspace)return;
    loading=true;const requestedKey=key;
    try{const value=await window.SaleMaxWorkspace.session();if(accessKey===requestedKey)access=value;}
    catch{if(accessKey===requestedKey){access=null;remove();}}
    finally{if(accessKey===requestedKey)checkedAt=Date.now();loading=false;schedule();}
  }
  function heroFor(page){
    const candidates=[...document.querySelectorAll('h1,h2,h3,h4,h5')].filter(node=>!node.closest('.MuiDrawer-root,dialog')&&pages[page].titles.includes(node.textContent.trim()));
    for(const heading of candidates){
      let hero=heading.parentElement;
      for(let depth=0;hero&&depth<7;depth++,hero=hero.parentElement){
        const box=hero.getBoundingClientRect();
        if(box.height<300&&parseFloat(getComputedStyle(hero).borderTopWidth)>0&&!hero.querySelector('form,.MuiStepper-root,table'))return hero;
      }
    }
    return null;
  }
  function enhance(){
    syncTheme();
    const page=current();if(!pages[page]){remove();return;}
    checkAccess();if(!access||!allowed(pages[page].key)){remove();return;}
    const hero=heroFor(page);if(!hero)return;hero.dataset.sxMarketingHero='1';
    if(page==='create-meta-template')document.querySelectorAll('input[placeholder*="order_confirmation"]').forEach(input=>{
      if(input.dataset.sxMarketingFieldLabel||(!input.labels?.length&&!input.hasAttribute('aria-label')&&!input.hasAttribute('aria-labelledby'))){input.dataset.sxMarketingFieldLabel='template-name';input.setAttribute('aria-label',tr(['Template Name','اسم القالب']));}
    });
    const available=entries.filter(entry=>allowed(entry.key));
    let nav=document.getElementById('sx-marketing-nav');if(!nav){nav=document.createElement('nav');nav.id='sx-marketing-nav';}
    const signature=[page,arabic(),available.map(entry=>entry.key).join(','),window.SaleMaxActor].join('|');
    if(nav.dataset.signature!==signature){
      nav.dataset.signature=signature;nav.setAttribute('aria-label',tr(['Campaign workspace','مساحة الحملات']));nav.dir=arabic()?'rtl':'ltr';
      const caption=document.createElement('span');caption.className='sx-marketing-caption';caption.textContent=tr(['WHATSAPP MARKETING','التسويق عبر واتساب']);
      const group=document.createElement('div');group.className='sx-marketing-links';
      for(const entry of available){
        const a=link(entry.page,tr(entry.label),'sx-marketing-link');
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
        const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',entry.icon);svg.append(path);a.prepend(svg);
        if(entry.page===page)a.setAttribute('aria-current','page');group.append(a);
      }
      nav.replaceChildren(caption,group);
    }
    if(hero.nextElementSibling!==nav)hero.after(nav);
    hero.querySelectorAll('[data-sx-marketing-action]').forEach(node=>{if(page!=='campaign-dashboard'||!allowed('campaigns'))node.remove();});
    if(page==='campaign-dashboard'&&allowed('campaigns')){
      let action=hero.querySelector('[data-sx-marketing-action]');
      if(!action){action=link('send-campaign','','sx-marketing-create');action.dataset.sxMarketingAction='1';hero.append(action);}
      const text=tr(['＋ Create campaign','＋ إنشاء حملة']);if(action.textContent!==text)action.textContent=text;
    }
    if(page==='campaign-dashboard')document.querySelectorAll('h3.MuiTypography-h3').forEach(node=>{
      const card=node.closest('.MuiPaper-root');if(card&&card.getBoundingClientRect().height<260)card.dataset.sxMarketingMetric='1';
    });
    if(page==='send-campaign'){
      document.querySelectorAll('.MuiAlert-message').forEach(alert=>{
        if(!/No templates found|لا توجد قوالب|لم يتم العثور على قوالب/.test(alert.textContent))return;
        const actions=[allowed('templates')?['create-meta-template',tr(['Create a template','إنشاء قالب'])]:null,allowed('whatsapp-meta')?['wa-meta-manual',tr(['Connect Meta WhatsApp','ربط واتساب ميتا'])]:null].filter(Boolean);
        let empty=alert.querySelector('[data-sx-marketing-empty]');
        const key=JSON.stringify(actions);if(!actions.length){empty?.remove();return;}
        if(!empty){empty=document.createElement('div');empty.dataset.sxMarketingEmpty='';alert.append(empty);}
        if(empty.dataset.signature!==key){empty.dataset.signature=key;empty.replaceChildren(...actions.map(([page,title])=>link(page,title,'sx-marketing-empty-link')));}
      });
    }
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;enhance();});}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',schedule);window.addEventListener('storage',schedule);setInterval(schedule,5000);schedule();
})();
