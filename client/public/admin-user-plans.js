(() => {
  'use strict';
  const ar=()=>[...document.querySelectorAll('h5')].some(node=>node.textContent.trim()==='إدارة المستخدمين');
  const t=(en,arabic)=>ar()?arabic:en;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields=[['price','Price','السعر'],['plan_duration_in_days','Duration (days)','المدة (أيام)'],['contact_limit','Contacts','جهات الاتصال'],['qr_account','QR accounts','حسابات QR']];
  const flags=[['allow_tag','Chat tags','وسوم المحادثة'],['allow_note','Chat notes','ملاحظات المحادثة'],['allow_chatbot','Chatbot','روبوت المحادثة'],['allow_api','Cloud API','Cloud API'],['wa_warmer','WhatsApp Warmer','تهيئة واتساب'],['rest_api_qr','QR REST API','QR REST API']];
  let editor,hidden=[],returnFocus,refreshOnClose=false;
  const style=document.createElement('style');style.textContent=`.sx-user-plan-action{border:0;background:#fff2f6;color:#860030;border-radius:6px;padding:5px 8px;font:600 11px Arial,sans-serif;cursor:pointer;white-space:nowrap}.sx-user-plans table{width:100%;border-collapse:collapse;text-align:start}.sx-user-plans th,.sx-user-plans td{padding:10px;border-bottom:1px solid #e4e8ee;text-align:start}.sx-user-plans .sx-plan-field select{min-height:46px}.sx-user-history{overflow:auto;margin-top:24px}.sx-user-plans button:focus-visible{outline:3px solid #a8003b70;outline-offset:2px}`;document.head.appendChild(style);
  async function api(path,body) {
    const token=localStorage.getItem('wacrm_admin');if(!token)throw new Error(t('Your session expired. Sign in again.','انتهت الجلسة. يرجى تسجيل الدخول مجددًا.'));
    let response,data;
    try {response=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});data=await response.json();}
    catch(_) {throw new Error(t('Connection failed. Your selection is kept; try again.','تعذر الاتصال. تم الاحتفاظ باختيارك؛ حاول مجددًا.'));}
    if(!response.ok || !data.success) {const error=new Error(data.msg||t('Request failed. Try again.','تعذر تنفيذ الطلب. حاول مجددًا.'));error.code=data.code;throw error;}
    return data;
  }
  function date(value) {
    if(value==null || value==='')return t('None','لا يوجد');
    const timestamp=typeof value==='string' && /^\d+$/.test(value)?Number(value):value;
    const d=new Date(timestamp);return Number.isNaN(d.getTime())?t('Invalid legacy date','تاريخ قديم غير صالح'):d.toLocaleString(ar()?'ar-QA':'en-QA',{timeZone:'Asia/Qatar'});
  }
  function close() {editor?.remove();editor=null;hidden.forEach(([node,display])=>{node.style.display=display;});hidden=[];returnFocus?.focus();if(refreshOnClose){refreshOnClose=false;const header=anchor();[...header?.querySelectorAll('button')||[]].find(button=>['Refresh','تحديث'].includes(button.textContent.trim()))?.click();}}
  function anchor() {
    const heading=[...document.querySelectorAll('h5')].find(node=>['Manage Users','إدارة المستخدمين'].includes(node.textContent.trim()));
    let node=heading?.parentElement;
    while(node && node!==document.body) {if([...node.querySelectorAll('button')].some(button=>['Refresh','تحديث'].includes(button.textContent.trim())))return node.parentElement;node=node.parentElement;}
    return null;
  }
  async function open(userId) {
    const header=anchor();if(!header)return;
    close();returnFocus=document.activeElement;
    editor=document.createElement('section');editor.className='sx-plan-editor sx-user-plans';editor.dir=ar()?'rtl':'ltr';editor.setAttribute('aria-label',t('User plan assignment','تعيين خطة المستخدم'));
    [...header.parentElement.children].forEach(child=>{if(child!==header){hidden.push([child,child.style.display]);child.style.display='none';}});header.after(editor);
    const active=editor;
    async function load(saved=false) {
      active.innerHTML=`<p role="status">${t('Loading current contract and history…','جارٍ تحميل العقد الحالي والسجل…')}</p>`;
      try {
        const [result,catalogue]=await Promise.all([api('/api/admin/user_plan_context?userId='+encodeURIComponent(userId)),api('/api/admin/get_plans')]);
        if(editor!==active)return;
        const context=result.data,plans=catalogue.data;let review=null,requestId=null,saving=false;
        active.innerHTML=`${saved?`<div class="sx-plan-message sx-plan-success" role="status">${t('Plan assigned successfully.','تم تعيين الخطة بنجاح.')}</div>`:''}<h2 tabindex="-1">${t('Manage user plan','إدارة خطة المستخدم')}</h2><p>${esc(context.name||t('User','المستخدم'))} · ${t('Account','الحساب')} #${esc(context.userId)}</p><p>${t('Current plan','الخطة الحالية')}: <strong>${esc(context.current.plan?.title||t('No plan','لا توجد خطة'))}</strong> · ${t('Expires','تنتهي')}: ${esc(date(context.expiresAt))}</p>${!context.current.valid?`<div class="sx-plan-message" role="status">${t('The stored legacy snapshot is invalid. It will be retained in history when a valid plan is assigned.','بيانات الخطة القديمة غير صالحة. ستُحفظ في السجل عند تعيين خطة صالحة.')}</div>`:''}<p>${t('Expiry starts from confirmation. This action assigns access; it does not collect a payment.','تبدأ المدة من وقت التأكيد. هذا الإجراء يمنح صلاحيات الخطة ولا يحصّل دفعة.')}</p><form><label class="sx-plan-field">${t('Choose catalogue plan','اختر خطة من الكتالوج')}<select name="planId" aria-label="${t('Choose catalogue plan','اختر خطة من الكتالوج')}" required><option value="">${t('Choose a plan','اختر خطة')}</option>${plans.map(plan=>`<option value="${esc(plan.id)}">${esc(plan.title)} · #${esc(plan.id)}</option>`).join('')}</select></label>${!plans.length?`<p role="status">${t('No catalogue plans. Create a plan in Manage Plans first.','لا توجد خطط في الكتالوج. أنشئ خطة في إدارة الخطط أولًا.')}</p>`:''}<div class="sx-plan-buttons"><button type="button" data-back>${t('Back to users','العودة إلى المستخدمين')}</button><button type="button" data-refresh>${t('Reload account','إعادة تحميل الحساب')}</button><button type="submit" ${plans.length?'':'disabled'}>${t('Review assignment','مراجعة التعيين')}</button></div><div data-review></div><div class="sx-plan-message" role="alert" hidden></div></form><div class="sx-user-history"><h3>${t('Recent assignment history','سجل التعيينات الأخيرة')}</h3>${context.history.length?`<table><thead><tr><th>${t('Plan','الخطة')}</th><th>${t('Assigned','تم التعيين')}</th><th>${t('Expires','تنتهي')}</th></tr></thead><tbody>${context.history.map(row=>`<tr><td>${esc(row.plan?.title||'—')}</td><td>${esc(date(row.assignedAt))}</td><td>${esc(date(row.expiresAt))}</td></tr>`).join('')}</tbody></table>`:`<p>${t('No recorded assignments yet. Earlier changes are not reconstructed automatically.','لا توجد تعيينات مسجلة بعد. لا تُعاد إنشاء التغييرات السابقة تلقائيًا.')}</p>`}</div>`;
        active.querySelector('h2').focus();
        const form=active.querySelector('form'),select=form.elements.planId,reviewBox=form.querySelector('[data-review]'),notice=form.querySelector('[role=alert]');
        const error=err=>{notice.hidden=false;notice.textContent=ar()?(err.code==='STALE_ASSIGNMENT'||err.code==='STALE_PLAN'?t('Details changed. Reload the account and review again.','تغيرت البيانات. أعد تحميل الحساب وراجع التعيين مجددًا.'):t('Could not complete this action. Check your selection and try again.','تعذر إكمال الإجراء. تحقق من اختيارك وحاول مجددًا.')):err.message;};
        const busy=value=>{saving=value;select.disabled=value;form.querySelectorAll('button').forEach(button=>{button.disabled=value;});};
        form.querySelector('[data-back]').onclick=()=>{if(!saving)close();};form.querySelector('[data-refresh]').onclick=()=>{if(!saving)load();};
        select.onchange=()=>{review=null;requestId=null;reviewBox.innerHTML='';notice.hidden=true;};
        form.onsubmit=async event=>{
          event.preventDefault();if(saving)return;notice.hidden=true;busy(true);
          try {
            const response=await api('/api/admin/preview_user_plan',{uid:context.uid,plan:{id:Number(select.value)},expectedState:context.state});
            if(editor!==active)return;review=response.data;requestId=crypto.randomUUID();
            reviewBox.innerHTML=`<h3>${t('Confirm assignment','تأكيد التعيين')}</h3><table><thead><tr><th>${t('Setting','الإعداد')}</th><th>${t('Current','الحالي')}</th><th>${t('Selected','المحدد')}</th></tr></thead><tbody><tr><td>${t('Plan','الخطة')}</td><td>${esc(review.current.plan?.title||'—')}</td><td>${esc(review.selected.title)}</td></tr>${fields.map(([key,en,arabic])=>`<tr><td>${t(en,arabic)}</td><td>${esc(review.current.plan?.[key]??'—')}</td><td>${esc(review.selected[key]??'—')}</td></tr>`).join('')}${flags.map(([key,en,arabic])=>`<tr><td>${t(en,arabic)}</td><td>${Number(review.current.plan?.[key])===1?t('Enabled','مفعّل'):t('Disabled','معطّل')}</td><td>${Number(review.selected[key])===1?t('Enabled','مفعّل'):t('Disabled','معطّل')}</td></tr>`).join('')}</tbody></table><p>${t('New duration','المدة الجديدة')}: ${review.durationDays} ${t('days from confirmation','يومًا من وقت التأكيد')}</p><div class="sx-plan-buttons"><button type="button" data-confirm>${t('Confirm plan assignment','تأكيد تعيين الخطة')}</button></div>`;
            reviewBox.querySelector('[data-confirm]').onclick=async()=>{
              if(saving || !review)return;notice.hidden=true;busy(true);
              try {await api('/api/admin/update_plan',{uid:context.uid,plan:{id:review.selected.id},requestId,expectedState:review.state,expectedPlanState:review.planState});refreshOnClose=true;await load(true);}
              catch(err){error(err);busy(false);}
            };
          }catch(err){error(err);}
          finally {if(editor===active)busy(false);}
        };
      }catch(err){if(editor!==active)return;active.innerHTML=`<div class="sx-plan-message" role="alert">${esc(err.message)}</div><div class="sx-plan-buttons"><button type="button">${t('Back to users','العودة إلى المستخدمين')}</button></div>`;active.querySelector('button').onclick=close;}
    }
    await load();
  }
  function mount() {
    if(location.pathname.toLowerCase()!=='/admin' || new URLSearchParams(location.search).get('page')!=='manage-users' || !localStorage.getItem('wacrm_admin'))return;
    document.querySelectorAll('.MuiDataGrid-row[data-id]').forEach(row=>{
      const cell=row.querySelector('[data-field="plan"]');if(!cell)return;
      let button=cell.querySelector('.sx-user-plan-action');
      if(!button){button=document.createElement('button');button.type='button';button.className='sx-user-plan-action';button.onclick=event=>{event.stopPropagation();open(row.getAttribute('data-id'));};cell.style.gap='6px';cell.appendChild(button);}
      const label=t('Manage plan','إدارة الخطة');if(button.textContent!==label)button.textContent=label;
    });
  }
  new MutationObserver(mount).observe(document.documentElement,{subtree:true,childList:true});mount();
})();
