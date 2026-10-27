/* Keep the installed 7Network PWA launch mark visible until the app shell renders. */
(()=>{
  'use strict';
  const splash=document.getElementById('sx-pwa-launch-splash');
  if(!splash)return;
  const standalone=matchMedia('(display-mode: standalone)').matches||matchMedia('(display-mode: minimal-ui)').matches||navigator.standalone===true;
  if(!standalone){splash.remove();return;}
  try{if(/^ar/i.test(document.documentElement.lang||localStorage.getItem('language')||''))splash.querySelector('.sx-pwa-splash-status').textContent='جارٍ تجهيز مساحة عملك…';}catch{}
  let done=false,queued=false;
  const finish=()=>{if(done)return;done=true;splash.dataset.ready='true';setTimeout(()=>splash.remove(),420);observer.disconnect();};
  const inspect=()=>{
    queued=false;
    const root=document.getElementById('root');
    const main=root?.querySelector('main,[role="main"]');
    const content=(main?.innerText||root?.innerText||'').trim();
    const spinner=root?.querySelector('[role="progressbar"],.MuiCircularProgress-root,[aria-busy="true"]');
    if(content.length>70&&!spinner)finish();
  };
  const observer=new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(inspect);});
  const root=document.getElementById('root');
  if(root)observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-busy','class']});
  inspect();
  setTimeout(finish,14500);
})();
