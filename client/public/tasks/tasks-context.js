(()=>{'use strict';
  const language=(localStorage.getItem('language')||'').toLowerCase();
  const arabic=language==='ar'||language.startsWith('ar-')||language.includes('arab');
  const token=localStorage.getItem('wacrm_user');
  const copy=[
    ['small[data-en="7NETWORK · TRAINING CENTER"]','7NETWORK SALES','7Network · المبيعات'],
    ['main.app > header p','Shared work queue for leads, calls, deals and team actions.','قائمة عمل مشتركة للعملاء والمكالمات والصفقات وإجراءات الفريق.'],
    ['#taskDialog header small','SALES WORKSPACE','مساحة عمل المبيعات']
  ];
  function applyTaskTypeSettings(data){
    const select=document.querySelector('#taskForm [name="taskType"]');
    if(!select||!Array.isArray(data?.taskTypes))return;
    const options=new Map(data.taskTypes.map(item=>[item.key,item]));
    for(const item of data.taskTypes){
      let option=select.querySelector(`option[value="${CSS.escape(item.key)}"]`);
      if(!option){option=document.createElement('option');option.value=item.key;option.dataset.en=item.label.en;option.dataset.ar=item.label.ar;select.append(option);}
    }
    for(const option of select.options){
      const item=options.get(option.value);
      if(!item){option.hidden=true;option.disabled=true;continue;}
      const enabled=Boolean(item.enabled);
      option.hidden=!enabled;
      option.disabled=!enabled;
      option.textContent=arabic?item.label.ar:item.label.en;
      if(!item.planAvailable)option.textContent+=arabic?' · غير متاح في الباقة':' · Not included in your plan';
      else if(!enabled)option.textContent+=arabic?' · غير مفعّل من المالك':' · Not enabled by the owner';
    }
    select.dataset.taskTypesReady='true';
    select.dataset.hasEnabledTaskTypes=String([...options.values()].some(item=>item.enabled));
    const selected=select.selectedOptions[0];
    if(selected?.disabled){const first=[...select.options].find(option=>!option.disabled&&!option.hidden);if(first)select.value=first.value;}
  }
  const taskTypesReady=window.SaleMaxWorkspace?.request('tasks').then(result=>{applyTaskTypeSettings(result.data);return document.querySelector('#taskForm [name="taskType"]')?.dataset.hasEnabledTaskTypes==='true';}).catch(()=>false);
  const newTask=document.querySelector('#newTask');
  newTask?.addEventListener('click',event=>{
    const select=document.querySelector('#taskForm [name="taskType"]');
    if(select?.dataset.taskTypesReady==='true'){
      if(select.dataset.hasEnabledTaskTypes!=='true'){
        event.preventDefault();event.stopImmediatePropagation();
        const notice=document.querySelector('#notice');if(notice)notice.textContent=arabic?'لا توجد أنواع مهام متاحة لهذه الفئة والباقة.':'No task types are available for this category and plan.';
        return;
      }
      setTimeout(()=>{const first=[...select.options].find(option=>!option.disabled&&!option.hidden);if(first)select.value=first.value;},0);
      return;
    }
    event.preventDefault();event.stopImmediatePropagation();
    Promise.resolve(taskTypesReady).then(available=>{if(available)newTask.click();});
  },true);
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
