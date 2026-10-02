(() => {
  'use strict';
  const ar=()=>[...document.querySelectorAll('h5')].some(node=>node.textContent.trim()==='إدارة المستخدمين');
  const t=(en,arabic)=>ar()?arabic:en;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields=[['price','Price','السعر'],['plan_duration_in_days','Duration (days)','المدة (أيام)'],['contact_limit','Contacts','جهات الاتصال'],['qr_account','QR accounts','حسابات QR']];
  const flags=[['allow_tag','Chat tags','وسوم المحادثة'],['allow_note','Chat notes','ملاحظات المحادثة'],['allow_chatbot','Chatbot','روبوت المحادثة'],['allow_api','Cloud API','Cloud API'],['wa_warmer','WhatsApp Warmer','تهيئة واتساب'],['rest_api_qr','QR REST API','QR REST API']];
  let editor,hidden=[],returnFocus,refreshOnClose=false;
  const style=document.createElement('style');style.textContent=`.sx-user-plan-action{border:0;background:#fff2f6;color:#860030;border-radius:6px;padding:5px 8px;font:600 11px Arial,sans-serif;cursor:pointer;white-space:nowrap}.sx-user-plan-link{display:inline-flex;align-items:center;min-height:40px;margin-inline-end:8px;padding:0 13px;border:1px solid #edbfd0;border-radius:8px;background:#fff2f6;color:#860030;font:600 13px Arial,sans-serif;text-decoration:none}.sx-user-plans table{width:100%;border-collapse:collapse;text-align:start}.sx-user-plans th,.sx-user-plans td{padding:10px;border-bottom:1px solid #e4e8ee;text-align:start}.sx-user-plans .sx-plan-field select{min-height:46px}.sx-user-history{overflow:auto;margin-top:24px}.sx-user-plans button:focus-visible,.sx-user-plan-link:focus-visible,.sx-user-category-assignment button:focus-visible,.sx-user-category-assignment select:focus-visible{outline:3px solid #a8003b70;outline-offset:2px}.sx-user-category-assignment{width:100%;box-sizing:border-box;margin:14px 0;padding:14px;border:1px solid #ead4df;border-radius:10px;background:#fff9fb;color:#263243}.sx-user-category-assignment h3{margin:0 0 8px;font-size:15px}.sx-user-category-assignment label{display:block;font-size:13px;font-weight:600}.sx-user-category-assignment select{display:block;width:100%;min-height:40px;margin-top:6px;padding:7px 10px;border:1px solid #d4dbe5;border-radius:7px;background:#fff;color:#263243;font:inherit}.sx-user-category-assignment [role=status],.sx-user-category-assignment [role=alert]{margin:8px 0;font-size:12px;color:#596579}.sx-user-category-assignment .sx-category-flow{margin-top:10px}`;document.head.appendChild(style);
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
  async function openBusiness(userId,active,reload,onComplete){
    const access=window.salemaxPlanContracts?.protectedRequest;if(!access)return;
    let data,version,requestId=null,review=null,busy=false;
    const call=(path,body)=>access(`${encodeURIComponent(userId)}/${path}`,body);
    const errorText=error=>{
      const messages={AUTH_REQUIRED:t('Sign in to the existing platform admin session first.','سجّل الدخول إلى جلسة مسؤول المنصة الحالية أولًا.'),MFA_REQUIRED:t('Verify platform MFA in Manage Plans, then return here.','تحقق من المصادقة الثنائية للمنصة في إدارة الخطط ثم عد إلى هنا.'),PLATFORM_UPGRADE_NOT_ENABLED:t('Training-center setup is not enabled in this environment. No account changes were made. Contact the platform owner to enable it, then retry.','إعداد مركز التدريب غير مفعّل في هذه البيئة. لم يتغير أي حساب. تواصل مع مالك المنصة لتفعيله ثم حاول مجددًا.'),ASSIGNMENT_UNAVAILABLE:t('The setup service is temporarily unavailable. No account changes were confirmed. Retry later.','خدمة الإعداد غير متاحة مؤقتًا. لم يتم تأكيد أي تغيير على الحساب. حاول مجددًا لاحقًا.'),AUDIT_UNAVAILABLE:t('The required audit record could not be saved, so setup was not completed. Retry later.','تعذر حفظ سجل التدقيق المطلوب، لذلك لم يكتمل الإعداد. حاول مجددًا لاحقًا.'),PERMISSION_DENIED:t('Your current staff grant does not allow this business setup or plan assignment.','صلاحيات الموظف الحالية لا تسمح بإعداد هذا النشاط أو تعيين خطته.'),VERIFIED_BUSINESS_LINK_REQUIRED:t('This account has no reviewed business ownership link yet.','لا يوجد ربط ملكية نشاط معتمد لهذا الحساب بعد.'),BUSINESS_IDENTITY_EXISTS:t('This email is already linked to a SaleMaX identity. Review that identity before provisioning.','هذا البريد مرتبط بالفعل بهوية في SaleMaX. راجع الهوية قبل الإعداد.'),BUSINESS_PLAN_REQUIRED:t('Assign an existing catalogue plan to this user first.','عيّن خطة كتالوج موجودة لهذا المستخدم أولاً.'),PUBLISHED_CONTRACT_REQUIRED:t('Publish a training-center contract for the user’s current catalogue plan first.','انشر عقد مركز تدريب لخطة الكتالوج الحالية للمستخدم أولاً.'),CONTRACT_NOT_FOR_CURRENT_PLAN:t('The selected contract no longer matches the user’s catalogue plan. Reload and review again.','العقد المحدد لم يعد مطابقاً لخطة الكتالوج للمستخدم. أعد التحميل والمراجعة.'),STALE_PROVISION:t('The account or contract changed during review. Reload and review again.','تغير الحساب أو العقد أثناء المراجعة. أعد التحميل وراجع مجددًا.'),SEATS_IN_USE:t('The new plan is below the number of team accounts already in use.','الخطة الجديدة أقل من عدد حسابات الفريق المستخدمة حاليًا.'),PLAN_LIMIT_EXCEEDED:t('One or more account limits exceed this published plan.','يتجاوز حد حساب واحد أو أكثر حدود هذه الخطة المنشورة.')};
      return messages[error.code]||t('Could not complete the request. Your selection is preserved.','تعذر إكمال الطلب. تم الاحتفاظ باختيارك.');
    };
    async function provisionBusiness(){
      active.innerHTML=`<p role="status">${t('Loading account and training-center plan details…','جارٍ تحميل تفاصيل الحساب وخطة مركز التدريب…')}</p>`;
      try{
        const options=(await call('provision-options')).data,defaults=options.defaultLimits;
        active.dir=ar()?'rtl':'ltr';
        active.innerHTML=`<h2 tabindex="-1">${t('Set up training-center business','إعداد نشاط مركز تدريب')}</h2><p>${t('This extends the existing Manage Users account. It does not create another login or application. The user keeps the existing business sign-in.','يكمل هذا إعداد حساب إدارة المستخدمين الحالي. لا ينشئ تطبيقًا أو تسجيل دخول آخر. يحتفظ المستخدم بتسجيل الدخول الحالي للنشاط.')}</p><div class="sx-plan-card"><p><strong>${esc(options.user.name)}</strong> · ${esc(options.user.email)}</p><p>${t('Existing catalogue plan','خطة الكتالوج الحالية')}: ${esc(options.contract.commercial.title)} · ${esc(options.contract.commercial.price)} QAR · ${esc(options.contract.commercial.plan_duration_in_days)} ${t('days','يومًا')}</p><form data-provision-form><label class="sx-plan-field">${t('Business display name','اسم النشاط الظاهر')}<input name="businessName" maxlength="200" minlength="2" required value="${esc(options.user.name)}"></label><label class="sx-plan-field">${t('Business category','فئة النشاط')}<input value="${t('Training center','مركز تدريب')}" disabled></label><fieldset class="sx-plan-fields"><legend>${t('Initial account limits','حدود الحسابات الأولية')}</legend>${['owner','accountant','manager','agent'].map(role=>`<label class="sx-plan-field">${esc(t({owner:'Owner accounts',accountant:'Accountant accounts',manager:'Manager accounts',agent:'Agent accounts'}[role],{owner:'حسابات المالك',accountant:'حسابات المحاسب',manager:'حسابات المدير',agent:'حسابات الوكلاء'}[role]))}<input name="${role}" type="number" min="${role==='owner'?1:0}" max="${esc(options.contract.ceiling[role])}" step="1" value="${esc(defaults[role])}" ${role==='owner'?'readonly':''} required></label>`).join('')}</fieldset><p>${t('The contract ceiling is the maximum. The owner uses one seat; staff seats are selected here. No invitation is marked sent.','يمثل العقد الحد الأعلى. يستخدم المالك مقعدًا واحدًا؛ وتحدد هنا مقاعد الموظفين. لا يتم اعتبار أي دعوة مرسلة.')}</p><div class="sx-plan-buttons"><button type="button" data-back>${t('Back','رجوع')}</button><button type="submit">${t('Review setup','مراجعة الإعداد')}</button></div><div data-provision-preview></div><div role="alert" class="sx-plan-message" hidden></div></form></div>`;
        const form=active.querySelector('[data-provision-form]'),alert=form.querySelector('[role=alert]'),reviewBox=form.querySelector('[data-provision-preview]');let review=null,requestId=null,saving=false;
        const setBusy=value=>{saving=value;form.querySelectorAll('button,input').forEach(item=>item.disabled=value||item.name==='owner');};
        form.querySelector('[data-back]').onclick=()=>draw();
        form.onsubmit=async event=>{event.preventDefault();if(saving)return;setBusy(true);alert.hidden=true;reviewBox.innerHTML='';try{
          const roleLimits=Object.fromEntries(['owner','accountant','manager','agent'].map(role=>[role,Number(form.elements[role].value)]));requestId=crypto.randomUUID();
          const result=await call('provision-preview',{businessName:form.elements.businessName.value,planVersionId:options.contract.id,roleLimits,requestId});review=result.data;
          reviewBox.innerHTML=`<h3>${t('Review business setup','مراجعة إعداد النشاط')}</h3><p>${esc(review.user.name)} · ${esc(review.user.email)} → ${esc(review.businessName)}</p><p>${esc(review.category.title[ar()?'ar':'en'])} · ${esc(review.contract.commercial.title)} · ${esc(review.contract.commercial.price)} QAR · ${esc(review.contract.commercial.plan_duration_in_days)} ${t('days from confirmation','يومًا من التأكيد')}</p><p>${Object.entries(review.proposedLimits).map(([role,count])=>`${esc(t({owner:'Owner',accountant:'Accountant',manager:'Manager',agent:'Agent'}[role],{owner:'المالك',accountant:'المحاسب',manager:'المدير',agent:'الوكيل'}[role]))}: ${count} / ${review.contract.ceiling[role]}`).join(' · ')}</p><p>${t('Features enabled','الميزات المفعلة')}: ${review.contract.capabilities.map(esc).join(', ')}</p>${review.blockers.length?`<div role="alert" class="sx-plan-message">${review.blockers.map(esc).join(' · ')}</div>`:`<p role="status">${t('Preview only. No account or plan has changed.','معاينة فقط. لم يتغير الحساب أو الخطة.')}</p><button type="button" data-provision-confirm>${t('Create business and assign plan','إنشاء النشاط وتعيين الخطة')}</button>`}`;
          const confirm=reviewBox.querySelector('[data-provision-confirm]');if(confirm)confirm.onclick=async()=>{if(saving||!review.canProvision)return;setBusy(true);try{await call('provision',{businessName:form.elements.businessName.value,planVersionId:options.contract.id,roleLimits:review.proposedLimits,requestId,expectedState:review.expectedState});refreshOnClose=true;await load();if(onComplete)await onComplete();}catch(error){alert.textContent=errorText(error);alert.hidden=false;}finally{setBusy(false);}};
        }catch(error){alert.textContent=errorText(error);alert.hidden=false;}finally{setBusy(false);}};
      }catch(error){active.innerHTML=`<div role="alert" class="sx-plan-message">${esc(errorText(error))}</div><button type="button" data-return>${t('Back to users','العودة إلى المستخدمين')}</button>`;active.querySelector('[data-return]').onclick=close;}
    }
    const draw=()=>{
      active.dir=ar()?'rtl':'ltr';
      const identity=data?[data.name,data.tenant?.name].filter(value=>typeof value==='string'&&value.trim()).map(esc).join(' · '):'';
      active.innerHTML=`<h2 tabindex="-1">${t('Training-center business contract','عقد نشاط مركز التدريب')}</h2><p>${data?(identity||t('Account details unavailable.','تعذر تحميل تفاصيل الحساب.')):t('Loading reviewed business and published contracts…','جارٍ تحميل النشاط والعقود المنشورة…')}</p>${data?.linked?`<p>${t('Current plan','الخطة الحالية')}: ${esc(data.current.plan?.title||'—')} · ${t('Current access ends','ينتهي الوصول الحالي')}: ${esc(date(data.expiresAt))}</p>${data.permissions?.assign?'':`<div role="status" class="sx-plan-message">${t('Your current platform staff grant allows viewing but not assigning plans.','صلاحية موظف المنصة الحالية تسمح بالعرض ولا تسمح بتعيين الخطط.')}</div>`}<form><label class="sx-plan-field">${t('Published contract','العقد المنشور')}<select name="version" required><option value="">${t('Choose a version','اختر إصدارًا')}</option>${data.versions.map(v=>`<option value="${esc(v.id)}">${esc(v.commercial.title)} · v${esc(v.version)} · ${esc(v.commercial.price)} QAR</option>`).join('')}</select></label><div class="sx-plan-fields">${['owner','accountant','manager','agent'].map(role=>`<label class="sx-plan-field">${esc(t({owner:'Owner accounts',accountant:'Accountant accounts',manager:'Manager accounts',agent:'Agent accounts'}[role],{owner:'حسابات المالك',accountant:'حسابات المحاسب',manager:'حسابات المدير',agent:'حسابات الوكلاء'}[role]))}<input name="${role}" type="number" min="${role==='owner'?1:0}" max="10000" step="1" value="${role==='owner'?1:role==='agent'?7:1}" ${role==='owner'?'readonly':''} required></label>`).join('')}</div><p>${t('Account limits are checked against active team members and pending invitations. Expiry starts only after confirmation. Assignment does not collect a payment.','تُراجع حدود الحسابات مقابل أعضاء الفريق والدعوات المعلقة. تبدأ المدة بعد التأكيد فقط. لا يتضمن التعيين تحصيل دفعة.')}</p><div class="sx-plan-buttons"><button type="button" data-back>${t('Back to user plan','العودة إلى خطة المستخدم')}</button><button type="button" data-reload>${t('Reload account','إعادة تحميل الحساب')}</button><button type="submit" ${data.versions.length&&data.permissions?.assign?'':'disabled'}>${t('Review business assignment','مراجعة تعيين النشاط')}</button></div><div data-impact></div><div role="alert" class="sx-plan-message" hidden></div></form>${data.versions.length?'':`<p role="status">${t('No published training-center contracts are available. Publish one in Manage Plans.','لا توجد عقود منشورة لمراكز التدريب. انشر عقدًا من إدارة الخطط.')}</p>`}`:`<div role="alert" class="sx-plan-message">${esc(data?.error?errorText(data.error):data?t('No reviewed ownership link is available. Contact the platform owner to adopt this account.','لا يوجد ربط ملكية نشاط معتمد لهذا الحساب. تواصل مع مالك المنصة لاعتماد هذا الحساب.'):t('Loading…','جارٍ التحميل…'))}</div><p><a class="sx-user-plan-link" href="/admin?page=manage-plans">${t('Open Manage Plans to verify platform access','افتح إدارة الخطط للتحقق من صلاحية المنصة')}</a></p><button class="sx-user-plan-action" type="button" data-reload>${t('Try again','حاول مجددًا')}</button>`}`;
      const back=active.querySelector('[data-back]');if(back)back.onclick=reload;
      const re=active.querySelector('[data-reload]');if(re)re.onclick=()=>load();
      if(data?.linked===false&&data.permissions?.provision){const button=document.createElement('button');button.type='button';button.className='sx-user-plan-action';button.textContent=t('Set up training-center account','إعداد حساب مركز التدريب');button.onclick=provisionBusiness;active.querySelector('[role=alert]')?.after(button);}
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
          const confirm=impact.querySelector('[data-confirm]');if(confirm)confirm.onclick=async()=>{if(busy||!review)return;setBusy(true);try{await call('assign',{planVersionId:version.id,roleLimits:review.proposedLimits,expectedState:review.expectedState,requestId});refreshOnClose=true;close();if(onComplete)await onComplete();}catch(error){fail(error);}finally{setBusy(false);}};
        }catch(error){fail(error);}finally{setBusy(false);}
      };
    };
    async function load(){data=null;draw();try{data=(await call('context')).data;draw();}catch(error){data={error};draw();const alert=active.querySelector('[role=alert]');if(alert)alert.textContent=errorText(error);}}
    await load();active.querySelector('h2')?.focus();
  }
  function mountEditCategoryControl(){
    if(location.pathname.toLowerCase()!=='/admin'||new URLSearchParams(location.search).get('page')!=='manage-users')return;
    const dialogs=[...document.querySelectorAll('[role="dialog"]')];
    const dialog=dialogs.find(node=>[...node.querySelectorAll('h6,h5,h4')].some(heading=>/^Editing\s*[—-]/.test(heading.textContent.trim())||/^تحرير\s*[—-]/.test(heading.textContent.trim())));
    if(!dialog||dialog.querySelector('[data-sx-category-editor]'))return;
    const row=document.querySelector('.MuiDataGrid-row.Mui-selected[data-id]')||document.querySelector('.MuiDataGrid-row[aria-selected="true"][data-id]');
    const userId=row?.getAttribute('data-id');if(!userId)return;
    const save=[...dialog.querySelectorAll('button')].find(button=>['Update User','تحديث المستخدم'].includes(button.textContent.trim()));
    if(!save?.parentElement)return;
    const access=window.salemaxPlanContracts?.protectedRequest;if(!access)return;
    const card=document.createElement('section');card.className='sx-user-category-assignment';card.dataset.sxCategoryEditor='';card.dir=ar()?'rtl':'ltr';
    card.innerHTML=`<h3>${t('Business category','فئة النشاط')}</h3><div data-category-fields><label>${t('Assign category','تعيين الفئة')}<select aria-label="${t('Business category','فئة النشاط')}"><option value="">${t('No category assigned','لم يتم تعيين فئة')}</option><option value="training_center">${t('Training Center','مركز تدريب')}</option></select></label><p role="status" data-category-status>${t('Checking the current business category…','جارٍ التحقق من فئة النشاط الحالية…')}</p><button type="button" class="sx-user-plan-action" data-category-start disabled>${t('Review Training Center setup','مراجعة إعداد مركز التدريب')}</button></div><div class="sx-category-flow" data-category-flow hidden></div>`;
    save.parentElement.insertBefore(card,save);
    const fields=card.querySelector('[data-category-fields]'),select=card.querySelector('select'),status=card.querySelector('[data-category-status]'),start=card.querySelector('[data-category-start]'),flow=card.querySelector('[data-category-flow]');let current=null,loading=false;
    async function refreshCategory(){
      if(loading)return;loading=true;start.disabled=true;status.textContent=t('Checking the current business category…','جارٍ التحقق من فئة النشاط الحالية…');
      try{
        const result=await access(`${encodeURIComponent(userId)}/context`);current=result.data;
        const linked=current.linked&&current.tenant?.category_key==='training_center';select.value=linked?'training_center':'';select.disabled=!!current.linked;
        status.textContent=linked?t('Training Center is assigned. Module access follows its published contract and active plan.','تم تعيين فئة مركز التدريب. يعتمد الوصول إلى الوحدة على العقد المنشور والخطة النشطة.'):current.linked?t('This account already has a business category. Category changes require an owner-reviewed migration.','هذا الحساب مرتبط بفئة نشاط بالفعل. يتطلب تغيير الفئة مراجعة واعتماد المالك.'):t('No category is assigned yet. Confirming setup links this existing user to Training Center and applies its published contract.','لم يتم تعيين فئة بعد. يؤدي تأكيد الإعداد إلى ربط هذا المستخدم بمركز التدريب وتطبيق عقده المنشور.');
        start.textContent=linked?t('Manage Training Center contract','إدارة عقد مركز التدريب'):t('Review Training Center setup','مراجعة إعداد مركز التدريب');start.disabled=!(linked||(!current.linked&&current.permissions?.provision));
      }catch(error){select.value='';status.textContent=t('Could not verify the category. Refresh and try again.','تعذر التحقق من الفئة. حدّث الصفحة وحاول مجددًا.');start.disabled=true;}
      finally{loading=false;}
    }
    select.onchange=()=>{start.disabled=select.value!=='training_center'||!(current?.linked||current?.permissions?.provision);};
    start.onclick=async()=>{if(start.disabled||select.value!=='training_center')return;fields.hidden=true;flow.hidden=false;flow.innerHTML=`<div role="status">${t('Loading Training Center setup…','جارٍ تحميل إعداد مركز التدريب…')}</div>`;const completed=async()=>{await refreshCategory();flow.hidden=true;fields.hidden=false;};await openBusiness(userId,flow,completed,completed);};
    refreshCategory();
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
    mountEditCategoryControl();
    document.querySelectorAll('.MuiDataGrid-row[data-id]').forEach(row=>{
      const cell=row.querySelector('[data-field="plan"]');if(!cell)return;
      let button=cell.querySelector('.sx-user-plan-action');
      if(!button){button=document.createElement('button');button.type='button';button.className='sx-user-plan-action';button.onclick=event=>{event.stopPropagation();open(row.getAttribute('data-id'));};cell.style.gap='6px';cell.appendChild(button);}
      const label=t('Manage plan','إدارة الخطة');if(button.textContent!==label)button.textContent=label;
    });
  }
  let portfolioRoster=null,portfolioProbe=null,portfolioChecked=false;
  async function mountPortfolioControls() {
    if(location.pathname.toLowerCase()!=='/admin' || new URLSearchParams(location.search).get('page')!=='manage-users' || !localStorage.getItem('wacrm_admin'))return;
    const token=localStorage.getItem('wacrm_admin');
    if(!portfolioChecked){if(!portfolioProbe)portfolioProbe=(async()=>{try{const response=await fetch('/api/admin/platform-access/portfolios',{headers:{Authorization:'Bearer '+token}});if(!response.ok)return null;return (await response.json()).data||null;}catch(_){return null;}})();portfolioRoster=await portfolioProbe;portfolioProbe=null;portfolioChecked=true;if(!portfolioRoster)return;}
    if(!portfolioRoster)return;
    document.querySelectorAll('.MuiDataGrid-row[data-id]').forEach(row=>{
      const cell=row.querySelector('[data-field="plan"]');if(!cell||cell.querySelector('.sx-portfolio-action'))return;
      const button=document.createElement('button');button.type='button';button.className='sx-user-plan-action sx-portfolio-action';button.textContent=t('Assign Admin','تعيين مدير');button.title=t('Assign this customer to an Admin or keep it private to Super Admin','تعيين هذا العميل لمدير أو إبقاؤه خاصًا بالمسؤول الأعلى');
      button.onclick=async event=>{event.stopPropagation();button.disabled=true;let profile;try{const me=await fetch('/api/admin/platform-auth/me',{headers:{Authorization:'Bearer '+token}});profile=await me.json();if(!me.ok||!profile.csrfToken)throw new Error(t('Your verified platform session is required.','يلزم استخدام جلسة المنصة الموثقة.'));}catch(error){button.disabled=false;window.alert(error.message);return;}
        const panel=document.createElement('div');panel.className='sx-portfolio-editor';panel.style.cssText='display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px';panel.innerHTML=`<select aria-label="${t('Assign to Admin','تعيين لمدير')}" style="max-width:220px;min-height:34px"><option value="">${t('Private to Super Admin','خاص بالمسؤول الأعلى')}</option>${portfolioRoster.admins.map(admin=>`<option value="${esc(admin.id)}">${esc(admin.displayName||admin.email)} · ${esc(admin.email)}</option>`).join('')}</select><button type="button" class="sx-user-plan-action">${t('Save','حفظ')}</button><button type="button" class="sx-user-plan-action">${t('Cancel','إلغاء')}</button><span role="status" aria-live="polite"></span>`;
        const [select,save,cancel,status]=[panel.querySelector('select'),...panel.querySelectorAll('button'),panel.querySelector('[role=status]')];
        select.value='';save.onclick=async()=>{save.disabled=true;status.textContent=t('Saving…','جارٍ الحفظ…');try{const response=await fetch('/api/admin/platform-access/portfolios/'+encodeURIComponent(row.getAttribute('data-id')),{method:'PUT',credentials:'same-origin',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-CSRF-Token':profile.csrfToken},body:JSON.stringify({managedByIdentityId:select.value||null})});const result=await response.json();if(!response.ok||!result.success)throw new Error(result.code||t('Assignment failed.','فشل الإسناد.'));status.textContent=select.value?t('Assigned.','تم التعيين.'):t('Kept private.','تم الإبقاء عليه خاصًا.');setTimeout(()=>panel.remove(),1200);}catch(error){status.textContent=error.message;save.disabled=false;}};
        cancel.onclick=()=>panel.remove();cell.appendChild(panel);button.disabled=false;
      };cell.appendChild(button);
    });
  }
  new MutationObserver(mount).observe(document.documentElement,{subtree:true,childList:true});mount();
  const portfolioObserver=new MutationObserver(()=>mountPortfolioControls());portfolioObserver.observe(document.documentElement,{subtree:true,childList:true});mountPortfolioControls();
})();
