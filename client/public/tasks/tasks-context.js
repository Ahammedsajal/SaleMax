(()=>{'use strict';
  const language=(localStorage.getItem('language')||'').toLowerCase();
  const arabic=language==='ar'||language.startsWith('ar-')||language.includes('arab');
  const token=localStorage.getItem('wacrm_user');
  const copy=[
    ['small[data-en="7NETWORK · TRAINING CENTER"]','7NETWORK SALES','7Network · المبيعات'],
    ['main.app > header p','Shared work queue for leads, calls, deals and team actions.','قائمة عمل مشتركة للعملاء والمكالمات والصفقات وإجراءات الفريق.'],
    ['#taskDialog header small','SALES WORKSPACE','مساحة عمل المبيعات']
  ];
  fetch('/api/user/team-invitations/sidebar-access',{credentials:'same-origin',headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}})
    .then(response=>response.ok?response.json():null)
    .then(result=>{
      if(result?.data?.categoryKey!=='7network_sales')return;
      for(const [selector,en,ar] of copy){
        const element=document.querySelector(selector);
        if(!element)continue;
        element.dataset.en=en;
        element.dataset.ar=ar;
        element.textContent=arabic?ar:en;
      }
      const type=document.querySelector('#taskForm [name="taskType"]');
      if(type&&!type.querySelector('option[value="sales_call"]')){
        const option=document.createElement('option');option.value='sales_call';option.dataset.en='Scheduled sales call';option.dataset.ar='مكالمة مبيعات مجدولة';option.textContent=arabic?option.dataset.ar:option.dataset.en;type.append(option);
      }
    }).catch(()=>{});
})();
