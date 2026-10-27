/* Compact the existing WhatsApp message composer on phone-sized screens. */
(()=>{
  'use strict';
  if(window.__sxMobileInboxComposer)return;
  window.__sxMobileInboxComposer=true;
  const mobile=window.matchMedia('(max-width: 600px)');
  let queued=false;
  function scan(){
    queued=false;
    if(!mobile.matches||!/^\/(user|agent)\/?$/.test(location.pathname)||new URLSearchParams(location.search).get('page')!=='inbox'){
      document.querySelectorAll('[data-sx-mobile-inbox-composer]').forEach(node=>node.removeAttribute('data-sx-mobile-inbox-composer'));
      return;
    }
    document.querySelectorAll('[data-sx-mobile-inbox-composer]').forEach(node=>node.removeAttribute('data-sx-mobile-inbox-composer'));
    for(const input of document.querySelectorAll('textarea:not([disabled]):not([readonly])')){
      const hint=[input.placeholder,input.getAttribute('aria-label')||''].join(' ').toLowerCase();
      if(!hint.includes('/')&&!hint.includes('quick repl'))continue;
      for(let node=input.parentElement,depth=0;node&&depth<7;node=node.parentElement,depth++){
        const rect=node.getBoundingClientRect();
        if(rect.width<innerWidth*.78||rect.height<44||rect.height>150)continue;
        if(node.querySelectorAll('textarea:not([disabled]):not([readonly])').length!==1)continue;
        if(node.querySelectorAll('button').length<3)continue;
        node.setAttribute('data-sx-mobile-inbox-composer','');
        break;
      }
    }
  }
  function queue(){if(queued)return;queued=true;requestAnimationFrame(scan);}
  new MutationObserver(queue).observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('input',event=>{if(event.target.matches?.('textarea'))queue();},true);
  window.addEventListener('resize',queue,{passive:true});
  mobile.addEventListener?.('change',queue);
  queue();
})();
