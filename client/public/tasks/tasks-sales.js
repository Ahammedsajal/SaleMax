(()=>{'use strict';
  const dialog=document.getElementById('taskDialog'),form=document.getElementById('taskForm'),type=form?.elements.taskType,lead=form?.elements.leadId,due=form?.elements.dueAt;
  if(!dialog||!form||!type||!lead||!due)return;
  const salesType=()=>type.value==='sales_call';
  function update(){const active=salesType();lead.required=active;due.required=active;}
  type.addEventListener('change',update);
  form.addEventListener('submit',event=>{update();if(salesType()&&(!lead.value||!due.value)){event.preventDefault();event.stopImmediatePropagation();const error=document.getElementById('formError');if(error)error.textContent=lead.value?'Select a call date and time.':'Link a lead before scheduling a sales call.';}} ,true);
  const observer=new MutationObserver(()=>{
    if(!dialog.open)return;
    const requested=new URLSearchParams(location.search).get('taskType');
    if(requested==='sales_call'&&type.querySelector('option[value="sales_call"]')){type.value='sales_call';const title=form.elements.title;if(title&&!title.value.startsWith('Call:'))title.value='Call: '+title.value.replace(/^(Follow up: |متابعة: )/,'');}
    update();
    const label=dialog.querySelector('#detail .detail-head small');if(label&&label.textContent.startsWith('sales_call '))label.textContent=label.textContent.replace(/^sales_call /,'Scheduled sales call · ');
    if(label&&label.textContent.startsWith('sales_call · '))label.textContent=label.textContent.replace(/^sales_call · /,'Scheduled sales call · ');
  });
  observer.observe(dialog,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
})();
