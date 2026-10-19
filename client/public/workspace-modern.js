(() => {
  'use strict';
  const path=location.pathname.replace(/\/$/,'');
  if(!/^\/(user|agent|admin)(\/|$)/.test(path)&&!/^\/(business-dashboard|sales-workspace|sales-commissions|sales-finance|sales-audit|sales-organization|tasks|pipeline|call-center)(\/|$)/.test(path))return;
  document.documentElement.dataset.sxModern=/^\/(user|agent|admin)(\/|$)/.test(path)?'shell':'module';
  if(document.documentElement.dataset.sxModern==='module'){
    try{
      const arabic=/^(ar(?:[-_]|$)|arabic)/i.test(localStorage.getItem('language')||'');
      document.documentElement.lang=arabic?'ar':'en';document.documentElement.dir=arabic?'rtl':'ltr';
      document.addEventListener('DOMContentLoaded',()=>document.querySelectorAll('[data-en][data-ar]').forEach(node=>{node.textContent=node.dataset[arabic?'ar':'en'];}),{once:true});
    }catch{}
  }
  const install=doc=>{
    if(!doc?.head||doc.querySelector('[data-sx-modern-sheet]'))return;
    const link=doc.createElement('link');link.rel='stylesheet';link.href='/workspace-modern.css?v=20261019-uplift1';link.dataset.sxModernSheet='1';doc.head.append(link);
  };
  install(document);
  const frames=new WeakSet();
  const activeTabs=new WeakMap();
  function alignTabs(){
    document.querySelectorAll('.tabs [aria-selected="true"]').forEach(button=>{
      const bar=button.parentElement;if(!bar||activeTabs.get(bar)===button)return;activeTabs.set(bar,button);
      if(bar.scrollWidth>bar.clientWidth)button.scrollIntoView({block:'nearest',inline:'nearest'});
    });
  }
  function updateFrames(){
    document.querySelectorAll('iframe').forEach(frame=>{
      if(frames.has(frame))return;frames.add(frame);
      const apply=()=>{try{const doc=frame.contentDocument;if(!doc||frame.contentWindow.location.origin!==location.origin)return;doc.documentElement.dataset.sxModern='module';install(doc);}catch{}};
      frame.addEventListener('load',apply);apply();
    });
  }
  new MutationObserver(()=>{updateFrames();alignTabs();}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-selected']});updateFrames();alignTabs();
})();
