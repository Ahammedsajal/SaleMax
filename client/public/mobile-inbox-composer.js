/* Keep the existing WhatsApp composer controls compact on phone screens. */
(()=>{
  'use strict';
  if(window.__sxMobileInboxComposer)return;
  window.__sxMobileInboxComposer=true;
  const mobile=window.matchMedia('(max-width: 600px)');
  let queued=false;
  const inbox=()=>/^\/(user|agent)\/?$/.test(location.pathname)&&new URLSearchParams(location.search).get('page')==='inbox';
  function clear(){document.querySelectorAll('[data-sx-mobile-inbox-composer],[data-sx-mobile-inbox-input],[data-sx-mobile-inbox-text]').forEach(node=>{node.removeAttribute('data-sx-mobile-inbox-composer');node.removeAttribute('data-sx-mobile-inbox-input');});}
  function size(input){if(!input?.matches?.('textarea[data-sx-mobile-inbox-text]'))return;input.style.height='42px';input.style.height=Math.min(88,Math.max(42,input.scrollHeight))+'px';}
  function scan(){
    queued=false;
    clear();
    if(!mobile.matches||!inbox())return;
    for(const input of document.querySelectorAll('textarea:not([disabled]):not([readonly])')){
      const hint=[input.placeholder,input.getAttribute('aria-label')||''].join(' ').toLowerCase();
      if(!hint.includes('/')&&!hint.includes('quick repl'))continue;
      let composer=null;
      for(let node=input.parentElement,depth=0;node&&depth<7;node=node.parentElement,depth++){
        const rect=node.getBoundingClientRect();
        if(rect.width<innerWidth*.78||rect.height<44||rect.height>180)continue;
        if(node.querySelectorAll('textarea:not([disabled]):not([readonly])').length!==1||node.querySelectorAll('button').length<3)continue;
        composer=node;break;
      }
      if(!composer)continue;
      composer.setAttribute('data-sx-mobile-inbox-composer','');
      input.setAttribute('data-sx-mobile-inbox-text','');
      let shell=input;
      while(shell.parentElement&&shell.parentElement!==composer)shell=shell.parentElement;
      if(shell!==composer)shell.setAttribute('data-sx-mobile-inbox-input','');
      size(input);
    }
  }
  function queue(){if(queued)return;queued=true;requestAnimationFrame(scan);}
  new MutationObserver(queue).observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('input',event=>{if(event.target.matches?.('textarea[data-sx-mobile-inbox-text]'))size(event.target);},true);
  window.addEventListener('resize',queue,{passive:true});
  window.addEventListener('popstate',queue);
  mobile.addEventListener?.('change',queue);
  queue();
})();
