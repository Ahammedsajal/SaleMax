(()=>{'use strict';
  const language=(localStorage.getItem('language')||'').toLowerCase();
  const arabic=language==='ar'||language.startsWith('ar-')||language.includes('arab');
  const token=localStorage.getItem('wacrm_user');
  const copy=[
    ['small[data-en="SALEMAX · TRAINING CENTER"]','SALEMAX · SALES','سليماكس · المبيعات'],
    ['main.app > header p','Shared work queue for leads, calls, deals and team actions.','قائمة عمل مشتركة للعملاء والمكالمات والصفقات وإجراءات الفريق.'],
    ['#taskDialog header small','SALES WORKSPACE','مساحة عمل المبيعات']
  ];
  fetch('/api/user/team-invitations/sidebar-access',{credentials:'same-origin',headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}})
    .then(response=>response.ok?response.json():null)
    .then(result=>{
      if(result?.data?.categoryKey!=='salemax_sales')return;
      for(const [selector,en,ar] of copy){
        const element=document.querySelector(selector);
        if(!element)continue;
        element.dataset.en=en;
        element.dataset.ar=ar;
        element.textContent=arabic?ar:en;
      }
    }).catch(()=>{});
})();
