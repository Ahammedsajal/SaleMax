(() => {
  'use strict';
  const ar=()=>[...document.querySelectorAll('h5')].some(node=>node.textContent.trim()==='إدارة المستخدمين');
  const t=(en,arabic)=>ar()?arabic:en;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields=[['price','Price','السعر'],['plan_duration_in_days','Duration (days)','المدة (أيام)'],['contact_limit','Contacts','جهات الاتصال'],['qr_account','QR accounts','حسابات QR']];
  const flags=[['allow_tag','Chat tags','وسوم المحادثة'],['allow_note','Chat notes','ملاحظات المحادثة'],['allow_chatbot','Chatbot','روبوت المحادثة'],['allow_api','Cloud API','Cloud API'],['wa_warmer','WhatsApp Warmer','تهيئة واتساب'],['rest_api_qr','QR REST API','QR REST API']];
  let editor,hidden=[],returnFocus,refreshOnClose=false;
  const style=document.createElement('style');style.textContent=`.sx-user-plan-action{border:0;background:#fff2f6;color:#860030;border-radius:6px;padding:5px 8px;font:600 11px Arial,sans-serif;cursor:pointer;white-space:nowrap}.sx-user-plan-link{display:inline-flex;align-items:center;min-height:40px;margin-inline-end:8px;padding:0 13px;border:1px solid #edbfd0;border-radius:8px;background:#fff2f6;color:#860030;font:600 13px Arial,sans-serif;text-decoration:none}.sx-user-plans table{width:100%;border-collapse:collapse;text-align:start}.sx-user-plans th,.sx-user-plans td{padding:10px;border-bottom:1px solid #e4e8ee;text-align:start}.sx-user-plans .sx-plan-field select{min-height:46px}.sx-user-history{overflow:auto;margin-top:24px}.sx-user-plans button:focus-visible,.sx-user-plan-link:focus-visible{outline:3px solid #a8003b70;outline-offset:2px}`;document.head.appendChild(style);
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
  async function openBusiness(userId,active,reload){
    const access=window.salemaxPlanContracts?.protectedRequest;if(!access)return;
    let data,version,requestId=null,review=null,busy=false;
    const call=(path,body)=>access(`${encodeURIComponent(userId)}/${path}`,body);
    const errorText=error=>{
      const messages={AUTH_REQUIRED:t('Sign in to the existing platform admin session first.','سجّل الدخول إلى جلسة مسؤول المنصة الحالية أولًا.'),MFA_REQUIRED:t('Verify platform MFA in Manage Plans, then return here.','تحقق من المصادقة الثنائية للمنصة في إدارة الخطط ثم عد إلى هنا.'),PERMISSION_DENIED:t('Your current staff grant does not allow business plan assignment.','صلاحيات الموظف الحالية لا تسمح بتعيين خطة النشاط.'),VERIFIED_BUSINESS_LINK_REQUIRED:t('This account has no reviewed business ownership link yet.','لا يوجد ربط ملكية نشاط معتمد لهذا الحساب بعد.'),STALE_ASSIGNMENT:t('The account, team or plan changed. Reload and review again.','تغير الحساب أو الفريق أو الخطة. أعد التحميل والمراجعة مجددًا.'),SEATS_IN_USE:t('The new plan is below the number of team accounts already in use.','الخطة الجديدة أقل من عدد حسابات الفريق المستخدمة حاليًا.')};
      return messages[error.code]||t('Could not complete the request. Your selection is preserved.','تعذر إكمال الطلب. تم الاحتفاظ باختيارك.');
    };
    const draw=()=>{
      active.dir=ar()?'rtl':'ltr';
      const identity=data?[data.name,data.tenant?.name].filter(value=>typeof value==='string'&&value.trim()).map(esc).join(' · '):'';
      active.innerHTML=`<h2 tabindex="-1">${t('Training-center business contract','عقد نشاط مركز التدريب')}</h2><p>${data?(identity||t('Account details unavailable.','تعذر تحميل تفاصيل الحساب.')):t('Loading reviewed business and published contracts…','جارٍ تحميل النشاط والعقود المنشورة…')}</p>${data?.linked?`<p>${t('Current plan','الخطة الحالية')}: ${esc(data.current.plan?.title||'—')} · ${t('Current access ends','ينتهي الوصول الحالي')}: ${esc(date(data.expiresAt))}</p>${data.permissions?.assign?'':`<div role="status" class="sx-plan-message">${t('Your current platform staff grant allows viewing but not assigning plans.','صلاحية موظف المنصة الحالية تسمح بالعرض ولا تسمح بتعيين الخطط.')}</div>`}<form><label class="sx-plan-field">${t('Published contract','العقد المنشور')}<select name="version" required><option value="">${t('Choose a version','اختر إصدارًا')}</option>${data.versions.map(v=>`<option value="${esc(v.id)}">${esc(v.commercial.title)} · v${esc(v.version)} · ${esc(v.commercial.price)} QAR</option>`).join('')}</select></label><div class="sx-plan-fields">${['owner','accountant','manager','agent'].map(role=>`<label class="sx-plan-field">${esc(t({owner:'Owner accounts',accountant:'Accountant accounts',manager:'Manager accounts',agent:'Agent accounts'}[role],{owner:'حسابات المالك',accountant:'حسابات المحاسب',manager:'حسابات المدير',agent:'حسابات الوكلاء'}[role]))}<input name="${role}" type="number" min="${role==='owner'?1:0}" max="10000" step="1" value="${role==='owner'?1:role==='agent'?7:1}" ${role==='owner'?'readonly':''} required></label>`).join('')}</div><p>${t('Account limits are checked against active team members and pending invitations. Expiry starts only after confirmation. Assignment does not collect a payment.','تُراجع حدود الحسابات مقابل أعضاء الفريق والدعوات المعلقة. تبدأ المدة بعد التأكيد فقط. لا يتضمن التعيين تحصيل دفعة.')}</p><div class="sx-plan-buttons"><button type="button" data-back>${t('Back to user plan','العودة إلى خطة المستخدم')}</button><button type="button" data-reload>${t('Reload account','إعادة تحميل الحساب')}</button><button type="submit" ${data.versions.length&&data.permissions?.assign?'':'disabled'}>${t('Review business assignment','مراجعة تعيين النشاط')}</button></div><div data-impact></div><div role="alert" class="sx-plan-message" hidden></div></form>${data.versions.length?'':`<p role="status">${t('No published training-center contracts are available. Publish one in Manage Plans.','لا توجد عقود منشورة لمراكز التدريب. انشر عقدًا من إدارة الخطط.')}</p>`}`:`<div role="alert" class="sx-plan-message">${esc(data?.error?errorText(data.error):data?t('No reviewed ownership link is available. Contact the platform owner to adopt this account.','لا يوجد ربط ملكية نشاط معتمد لهذا الحساب. تواصل مع مالك المنصة لاعتماد هذا الحساب.'):t('Loading…','جارٍ التحميل…'))}</div><p><a class="sx-user-plan-link" href="/admin?page=manage-plans">${t('Open Manage Plans to verify platform access','افتح إدارة الخطط للتحقق من صلاحية المنصة')}</a></p><button class="sx-user-plan-action" type="button" data-reload>${t('Try again','حاول مجددًا')}</button>`}`;
      const back=active.querySelector('[data-back]');if(back)back.onclick=reload;
      const re=active.querySelector('[data-reload]');if(re)re.onclick=()=>load();
      const form=active.querySelector('form');if(!form)return;
      const alert=active.querySelector('[role=alert]'),impact=active.querySelector('[data-impact]'),select=form.elements.version;
      const setBusy=value=>{busy=value;form.querySelectorAll('button,input,select').forEach(node=>node.disabled=value||node.name==='owner');};
      const fail=error=>{alert.textContent=errorText(error);alert.hidden=false;};
      select.onchange=()=>{version=data.versions.find(item=>item.id===select.value);review=null;requestId=null;impact.innerHTML='';alert.hidden=true;if(!version)return;for(const role of ['owner','accountant','manager','agent'])form.elements[role].value=version.roleLimits[role];};
      form.onsubmit=async event=>{
        event.preventDefault();if(busy||!version)return;setBusy(true);alert.hidden=true;
        try{
          const roleLimits=Object.fromEntries(['owner','accountant','manager','agent'].map(role=>[role,Number(form.elements[role].value)]));
          const result=await call('preview',{planVersionId:version.id,roleLimits});review=result.data;requestId=crypto.randomUUID();
          impact.innerHTML=`<h3>${t('Review before assigning','راجع قبل التعيين')}</h3><p>${esc(review.commercial.title)} · ${esc(review.commercial.price)} QAR · ${review.durationDays} ${t('days','يومًا')}</p><p>${['owner','accountant','manager','agent'].map(role=>`${esc(t(role,{owner:'المالك',accountant:'المحاسب',manager:'المدير',agent:'الوكيل'}))}: ${review.proposedLimits[role]} / ${review.ceiling[role]} (${t('in use','مستخدم')}: ${review.used[role]})`).join(' · ')}</p><p>${t('Features added','ميزات مضافة')}: ${esc(review.addedCapabilities.join(', ')||'—')}<br>${t('Features removed','ميزات محذوفة')}: ${esc(review.removedCapabilities.join(', ')||'—')}</p>${review.blockers.length?`<div role="alert" class="sx-plan-message">${review.blockers.map(esc).join(' · ')}</div>`:`<p role="status">${t('Preview only. No account has changed.','معاينة فقط. لم يتغير أي حساب.')}</p><button type="button" data-confirm>${t('Confirm contract assignment','تأكيد تعيين العقد')}</button>`}`;
          const confirm=impact.querySelector('[data-confirm]');if(confirm)confirm.onclick=async()=>{if(busy||!review)return;setBusy(true);try{await call('assign',{planVersionId:version.id,roleLimits:review.proposedLimits,expectedState:review.expectedState,requestId});refreshOnClose=true;close();}catch(error){fail(error);}finally{setBusy(false);}};
        }catch(error){fail(error);}finally{setBusy(false);}
      };
    };
    async function load(){data=null;draw();try{data=(await call('context')).data;draw();}catch(error){data={error};draw();const alert=active.querySelector('[role=alert]');if(alert)alert.textContent=errorText(error);}}
    await load();active.querySelector('h2')?.focus();
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
        const businessButton=document.createElement('button');businessButton.type='button';businessButton.className='sx-user-plan-action';businessButton.textContent=t('Training-center contract','عقد مركز التدريب');businessButton.style.marginTop='12px';businessButton.onclick=()=>openBusiness(userId,active,()=>load());active.querySelector('h2').after(businessButton);
        active.querySelector('h2').focus();
        const form=active.querySelector('form'),select=form.elements.planId,reviewBox=form.querySelector('[data-review]'),notice=form.querySelector('[role=alert]');
        const error=err=>{
          notice.hidden=false;
          notice.querySelector('[data-canonical-action]')?.remove();
          const canonicalRequired=['CANONICAL_ASSIGNMENT_REQUIRED','MAPPED_TENANT_REQUIRES_CONTRACT_ASSIGNMENT'].includes(err.code);
          notice.textContent=canonicalRequired?t('This business uses a reviewed training-center contract. Continue in the business-contract flow below.','يستخدم هذا النشاط عقدًا معتمدًا لمركز تدريب. تابع عبر مسار عقد النشاط أدناه.'):ar()?(err.code==='STALE_ASSIGNMENT'||err.code==='STALE_PLAN'?t('Details changed. Reload the account and review again.','تغيرت البيانات. أعد تحميل الحساب وراجع التعيين مجددًا.'):t('Could not complete this action. Check your selection and try again.','تعذر إكمال الإجراء. تحقق من اختيارك وحاول مجددًا.')):err.message;
          if(canonicalRequired){const action=document.createElement('button');action.type='button';action.dataset.canonicalAction='';action.className='sx-user-plan-action';action.textContent=t('Open training-center contract','فتح عقد مركز التدريب');action.onclick=()=>openBusiness(userId,active,()=>load());notice.append(' ',action);}
        };
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
