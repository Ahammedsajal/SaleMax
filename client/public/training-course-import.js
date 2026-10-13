(() => {
  'use strict';
  if (window.__sxProcatalystCourseImport) return;
  window.__sxProcatalystCourseImport = true;
  const ar=()=>window.SaleMaxLocale?.isArabic() ?? /^(ar(?:[-_]|$)|arabic)/i.test(localStorage.getItem('language') || document.documentElement.lang || 'en');
  const tr=(en,arabic)=>ar()?arabic:en;
  const style=document.createElement('style');style.textContent='#sx-import-courses{white-space:nowrap}#sx-import-status{flex-basis:100%;font-size:13px;color:#475467}#sx-import-status[data-error="1"]{color:#b42318}@media(max-width:760px){#sx-import-courses{width:100%}}';document.head.append(style);
  async function request(){
    const endpoint='/api/user/training/courses/import-procatalyst', token=localStorage.getItem('wacrm_user');
    async function send(headers){const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...headers},body:'{}'});let data;try{data=await response.json()}catch{throw Error('SERVER_ERROR')}return {response,data};}
    if(token){const first=await send({Authorization:'Bearer '+token});if(first.response.ok&&first.data.success===true)return first.data.data;if(!['AUTH_REQUIRED','VERIFIED_BUSINESS_OWNER_REQUIRED','BUSINESS_LINK_INVALID','PERMISSION_DENIED'].includes(first.data.code))throw Error(first.data.code||'REQUEST_FAILED');}
    const me=await fetch('/api/user/business-auth/me',{credentials:'same-origin'});let session;try{session=await me.json()}catch{throw Error('AUTH_REQUIRED')}if(!me.ok||session.context?.audience!=='tenant')throw Error('AUTH_REQUIRED');
    const result=await send({'X-CSRF-Token':session.csrfToken});if(!result.response.ok||result.data.success!==true)throw Error(result.data.code||'REQUEST_FAILED');return result.data.data;
  }

  function install(){if(!location.pathname.replace(/\/$/,'').endsWith('/user')||new URLSearchParams(location.search).get('page')!=='courses')return;const toolbar=document.querySelector('#sx-course-content .catalogue-head .toolbar');if(!toolbar||toolbar.querySelector('#sx-import-courses'))return;const button=document.createElement('button');button.type='button';button.id='sx-import-courses';button.textContent=tr('Import ProCatalyst courses','استيراد دورات بروكاتاليست');button.setAttribute('aria-label',button.textContent);const status=document.createElement('span');status.id='sx-import-status';status.setAttribute('role','status');toolbar.append(button,status);button.addEventListener('click',async()=>{button.disabled=true;status.removeAttribute('data-error');status.textContent=tr('Importing course drafts…','جارٍ استيراد مسودات الدورات…');try{const result=await request();status.textContent=tr(`${result.created.length} drafts added; ${result.skipped.length} already existed. Prices and durations are blank.`,`تمت إضافة ${result.created.length} مسودات؛ ${result.skipped.length} موجودة مسبقًا. الأسعار والمدد غير محددة.`);document.querySelector('#sx-course-reload')?.click();}catch(error){status.dataset.error='1';status.textContent=tr('Import failed (${error.message}). Please refresh and try again.','تعذر الاستيراد (${error.message}). حدّث الصفحة وحاول مجددًا.');}finally{button.disabled=false;}});}
  new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',install);setInterval(install,900);install();
})();
