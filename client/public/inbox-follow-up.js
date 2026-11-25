(() => {
  'use strict';
  const copy = () => document.documentElement.lang?.toLowerCase().startsWith('ar') || (localStorage.getItem('language') || '').toLowerCase().startsWith('ar')
    ? { button:'إنشاء مهمة متابعة', title:'إنشاء مهمة متابعة', details:'تفاصيل المتابعة', date:'موعد المتابعة', create:'إنشاء المهمة', cancel:'إلغاء', close:'إغلاق', success:'تم إنشاء المهمة وأُضيفت إشعارات QR WhatsApp إلى قائمة الإرسال. انقر هنا لعرض التفاصيل.', duplicate:'توجد مهمة متابعة مماثلة بالفعل. انقر هنا لعرضها.', failed:'تعذر إنشاء المهمة. تحقق من صلاحية المحادثة والموظف المعيّن.', required:'اختر موعد المتابعة.', owner:'لا يوجد موظف معيّن لهذه المحادثة.', notFound:'لم يتم العثور على المحادثة. أعد فتحها وحاول مرة أخرى.', ambiguous:'توجد عدة محادثات لهذا الرقم. افتح المحادثة المطلوبة وحاول مرة أخرى.', denied:'ليس لديك صلاحية إنشاء مهمة لهذه المحادثة.', auth:'انتهت الجلسة. سجّل الدخول مجدداً.' }
    : { button:'Create follow-up task', title:'Create follow-up task', details:'Follow-up details', date:'Follow-up date and time', create:'Create task', cancel:'Cancel', close:'Close', success:'Task created and QR WhatsApp notices queued. Click here to view its details.', duplicate:'A matching follow-up task already exists. Click here to view it.', failed:'Could not create the task. Check chat access and its assigned agent.', required:'Choose a follow-up date and time.', owner:'Assign this chat to an agent first.', notFound:'Conversation not found. Reopen it and try again.', ambiguous:'More than one conversation matches this number. Open the intended chat and try again.', denied:'You do not have permission to create a task for this conversation.', auth:'Your session expired. Sign in again.' };
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = el => el && el.getClientRects().length > 0;
  function timeInput(timezone='Asia/Qatar'){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(Date.now()+60*60*1000)).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;}
  function dueInstant(value,timezone){const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);if(!match)throw Error('INVALID_DATE');const [year,month,day,hour,minute]=match.slice(1).map(Number),target=Date.UTC(year,month-1,day,hour,minute);let candidate=target;for(let i=0;i<4;i++){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(candidate)).map(part=>[part.type,part.value]));const actual=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second),delta=target-actual;if(!delta)return new Date(candidate).toISOString();candidate+=delta;}throw Error('INVALID_DATE');}
  function chatInfo() {
    const nodes = [...document.querySelectorAll('aside,[role="complementary"],section,div')].filter(visible);
    const panel = nodes.filter(el => {
      const text=clean(el.innerText).toLowerCase();
      return text.length<2600 && /contact info|معلومات الاتصال/.test(text) && /assigned agent|الموظف المعيّن|الموظف المعين/.test(text);
    }).sort((a,b)=>clean(a.innerText).length-clean(b.innerText).length)[0];
    if(!panel)return null;
    const rows=[...panel.querySelectorAll('*')].filter(el=>el.children.length===0&&visible(el));
    const phoneLabel=rows.find(el=>/^(mobile number|phone|رقم الهاتف|رقم الجوال)$/i.test(clean(el.textContent)));
    const phone=phoneLabel?clean(phoneLabel.parentElement?.innerText).match(/\+?[0-9][0-9\s().-]{7,20}/)?.[0]:null;
    if(!phone)return null;
    const nameLabel=rows.find(el=>/^name$|^الاسم$/i.test(clean(el.textContent)));
    const name=nameLabel?clean(nameLabel.parentElement?.innerText).replace(/^name|^الاسم/i,'').trim().slice(0,180):'';
    const digits=phone.replace(/\D/g,'');
    if(digits.length<8||digits.length>15)return null;
    const assignmentHeading=rows.find(el=>/^(assigned agent|الموظف المعيّن|الموظف المعين)$/i.test(clean(el.textContent)));
    if(!assignmentHeading)return null;
    const section=assignmentHeading.closest('section')||assignmentHeading.parentElement?.parentElement||assignmentHeading.parentElement;
    let currentChat=null;try{currentChat=JSON.parse(localStorage.getItem('currentChat')||'null');}catch{}
    const chatId=window.SaleMaxInboxFollowUpChatId?.chatIdFromCurrentChat(currentChat,phone);
    return {panel,section,phone,name,chatId:chatId||digits};
  }
  function addStyles(){if(document.getElementById('sx-followup-style'))return;const style=document.createElement('style');style.id='sx-followup-style';style.textContent=`.sx-followup-action{box-sizing:border-box;width:100%;padding:8px 12px;border-bottom:1px solid #edf0f5}.sx-followup-button{display:block;box-sizing:border-box;width:100%;min-height:40px;margin:0;padding:9px 12px;border:0;border-radius:8px;background:#1768d4;color:#fff;font:inherit;font-size:14px;font-weight:600;line-height:1.25;white-space:normal;cursor:pointer}.sx-followup-button:hover{filter:brightness(.94)}.sx-followup-dialog{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(460px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);overflow:auto;border:1px solid #e2e7ef;border-radius:14px;padding:22px;background:#fff;box-shadow:0 18px 60px #091a3340;color:#17202b}.sx-followup-dialog::backdrop{background:rgba(8,22,48,.48)}.sx-followup-dialog form{margin:0}.sx-followup-dialog h2{margin:0 0 18px;padding:0 0 12px;border-bottom:1px solid #edf0f5;font-size:18px;line-height:1.35;cursor:grab;touch-action:none;user-select:none}.sx-followup-dialog h2:active{cursor:grabbing}.sx-followup-dialog label{display:block;margin:14px 0 6px;color:#344054;font-size:13px;font-weight:600}.sx-followup-dialog input,.sx-followup-dialog textarea{box-sizing:border-box;width:100%;min-height:42px;padding:10px 12px;border:1px solid #c8d0dc;border-radius:8px;background:#fff;color:#17202b;font:inherit}.sx-followup-dialog input:focus,.sx-followup-dialog textarea:focus{outline:2px solid #1768d433;border-color:#1768d4}.sx-followup-dialog textarea{min-height:96px;resize:vertical}.sx-followup-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.sx-followup-dialog button{min-height:40px;border:1px solid #c8d0dc;border-radius:8px;padding:9px 14px;background:#fff;color:#17202b;font:inherit;cursor:pointer}.sx-followup-dialog button[type=submit]{background:#1768d4;color:#fff;border-color:#1768d4}.sx-followup-dialog button:disabled{opacity:.65;cursor:wait}.sx-followup-state{min-height:20px;margin:10px 0 0;font-size:13px}@media(max-width:480px){.sx-followup-dialog{width:calc(100vw - 24px);max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);padding:18px;border-radius:12px}.sx-followup-dialog h2{font-size:17px}.sx-followup-dialog footer{position:sticky;bottom:-18px;margin:14px -18px -18px;padding:12px 18px 18px;background:#fff;border-top:1px solid #edf0f5}.sx-followup-dialog footer button{flex:1}}`;document.head.append(style);}
  function enableDragging(d){const handle=d.querySelector('h2');let drag=null;handle.addEventListener('pointerdown',event=>{if(event.button!==0&&event.pointerType==='mouse')return;const rect=d.getBoundingClientRect();drag={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};handle.setPointerCapture(event.pointerId);event.preventDefault();});handle.addEventListener('pointermove',event=>{if(!drag)return;const rect=d.getBoundingClientRect(),left=Math.max(8,Math.min(window.innerWidth-rect.width-8,drag.left+event.clientX-drag.x)),top=Math.max(8,Math.min(window.innerHeight-rect.height-8,drag.top+event.clientY-drag.y));d.style.margin='0';d.style.inset='auto';d.style.left=`${left}px`;d.style.top=`${top}px`;});const stop=()=>{drag=null;};handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);window.addEventListener('resize',()=>{if(!d.open||!d.style.left)return;const rect=d.getBoundingClientRect();d.style.left=`${Math.max(8,Math.min(window.innerWidth-rect.width-8,rect.left))}px`;d.style.top=`${Math.max(8,Math.min(window.innerHeight-rect.height-8,rect.top))}px`;});}
  function dialog(){let d=document.getElementById('sxFollowUpDialog');if(d)return d;const c=copy();d=document.createElement('dialog');d.id='sxFollowUpDialog';d.className='sx-followup-dialog';d.innerHTML=`<form id="sxFollowUpForm"><h2>${c.title}</h2><label for="sxFollowUpDate">${c.date}</label><input id="sxFollowUpDate" name="dueAt" type="datetime-local" required><label for="sxFollowUpDetails">${c.details}</label><textarea id="sxFollowUpDetails" name="details" maxlength="1000"></textarea><p class="sx-followup-state" role="status" aria-live="polite"></p><footer><button type="button" data-cancel>${c.cancel}</button><button type="submit">${c.create}</button></footer></form>`;document.body.append(d);d.querySelector('[data-cancel]').onclick=()=>d.close();d.querySelector('form').onsubmit=submit;enableDragging(d);return d;}
  async function submit(event){event.preventDefault();const d=event.currentTarget.closest('dialog'),c=copy(),info=chatInfo(),form=event.currentTarget;if(!info){d.querySelector('[role=status]').textContent=c.failed;return;}const submitButton=form.querySelector('[type=submit]');submitButton.disabled=true;d.querySelector('[role=status]').textContent='…';let saved=false;try{const [headers,session]=await Promise.all([window.SaleMaxWorkspace?.headers?.(),window.SaleMaxWorkspace?.session?.()]);if(!headers)throw new Error('AUTH');const dueAt=dueInstant(form.elements.dueAt.value,session?.timezone||session?.tenant?.timezone||'Asia/Qatar');const requestHeaders=new Headers(headers);requestHeaders.set('Content-Type','application/json');const response=await fetch('/api/workspace/tasks/inbox-follow-up',{method:'POST',credentials:'same-origin',headers:requestHeaders,body:JSON.stringify({chatId:info.chatId,dueAt,details:form.elements.details.value})});const body=await response.json().catch(()=>({}));if(!response.ok||!body.success)throw new Error(body.code||'CREATE_FAILED');const task=body.data||{};if(!task.id)throw new Error('CREATE_FAILED');const link=document.createElement('a'),status=d.querySelector('[role=status]');link.href=`/user?page=tasks&task=${encodeURIComponent(task.id)}`;link.target='_top';link.textContent=task.duplicate?c.duplicate:c.success;link.style.cssText='color:#075bcc;font-weight:600;text-decoration:underline;text-underline-offset:2px';status.replaceChildren(link);form.elements.dueAt.disabled=true;form.elements.details.disabled=true;form.querySelector('[data-cancel]').textContent=c.close;saved=true;}catch(error){const code=error.message;d.querySelector('[role=status]').textContent=code==='CHAT_AGENT_REQUIRED'?c.owner:code==='INVALID_DATE'?c.required:code==='CHAT_ID_AMBIGUOUS'?c.ambiguous:code==='CHAT_NOT_FOUND'?c.notFound:code==='PERMISSION_DENIED'||code==='TEAM_ROLE_PERMISSION_DENIED'?c.denied:code==='AUTH'||code==='AUTH_REQUIRED'?c.auth:c.failed;}finally{submitButton.disabled=saved?true:false;}}
  async function openDialog(){const d=dialog();let timezone='Asia/Qatar';try{const session=await window.SaleMaxWorkspace?.session?.();timezone=session?.timezone||session?.tenant?.timezone||timezone;}catch{}const form=d.querySelector('form');form.elements.dueAt.disabled=false;form.elements.details.disabled=false;form.querySelector('[type=submit]').disabled=false;form.querySelector('[data-cancel]').textContent=copy().cancel;d.querySelector('input[name=dueAt]').value=timeInput(timezone);d.querySelector('textarea[name=details]').value='';d.querySelector('[role=status]').textContent='';d.showModal();}
  async function openRegistration() {
    const info=chatInfo();
    if(!info)return;
    const ar=(document.documentElement.lang||localStorage.getItem('language')||'').toLowerCase().startsWith('ar');
    const d=document.createElement('dialog');
    d.className='sx-followup-dialog';
    const heading=document.createElement('h2');
    heading.textContent=ar?'تسجيل متدرب':'Register a learner';
    const status=document.createElement('p');
    status.setAttribute('role','status');
    status.textContent=ar?'جارٍ تحميل النماذج…':'Loading forms…';
    const close=document.createElement('button');
    close.type='button';
    close.textContent=ar?'إغلاق':'Close';
    close.addEventListener('click',()=>d.close());
    d.addEventListener('close',()=>d.remove());
    d.append(heading,status,close);
    document.body.append(d);
    d.showModal();
    try {
      const result=await window.SaleMaxWorkspace.request('pipeline','/training-form-chat/'+encodeURIComponent(info.chatId));
      const data=result.data;
      status.textContent=data.items.length?'':(ar?'لا توجد نماذج منشورة.':'No published forms are available.');
      for(const form of data.items){
        const url=new URL('/p/'+encodeURIComponent(data.tenantSlug)+'/forms/'+encodeURIComponent(form.slug),location.origin);
        url.searchParams.set('mode','staff');
        url.searchParams.set('leadId',data.leadId);
        url.searchParams.set('lang',ar?'ar':'en');
        const link=document.createElement('a');
        link.href=url.href;
        link.target='_blank';
        link.rel='noopener';
        link.textContent=ar?(form.nameAr||form.nameEn):(form.nameEn||form.nameAr);
        link.style.cssText='display:block;padding:12px 0';
        status.append(link);
      }
    } catch(error) {
      status.textContent=error.message==='CHAT_LEAD_AMBIGUOUS'
        ? (ar?'توجد عدة سجلات مرتبطة بالمحادثة. افتح العميل الصحيح من مسار العملاء.':'Several leads are linked to this conversation. Open the correct lead in Pipeline.')
        : (ar?'تعذر فتح التسجيل. تحقق من تعيين العميل وصلاحياتك.':'Registration is unavailable. Check the lead assignment and your access.');
    }
  }
  function mount(){const info=chatInfo();if(!info||info.panel?.querySelector('.sx-followup-action'))return;addStyles();const action=document.createElement('div');action.className='sx-followup-action';const button=document.createElement('button');button.type='button';button.className='sx-followup-button';button.textContent=copy().button;button.addEventListener('click',openDialog);action.append(button);(info.section?.nextElementSibling||info.section)?.after(action);
    window.SaleMaxWorkspace?.session?.().then(session=>{
      const category=session?.categoryKey||session?.tenant?.categoryKey;
      if(category!=='training_center'||!action.isConnected)return;
      const register=document.createElement('button');
      register.type='button';register.className='sx-followup-button';register.style.marginTop='8px';
      register.textContent=(document.documentElement.lang||localStorage.getItem('language')||'').toLowerCase().startsWith('ar')?'تسجيل متدرب':'Register learner';
      register.addEventListener('click',openRegistration);action.append(register);
    }).catch(()=>{});
}

  function inboxSearch() {
    for (const input of document.querySelectorAll('input[type="text"]')) {
      if (!/search|بحث/i.test(input.getAttribute('placeholder') || '') || !visible(input)) continue;
      let parent=input.parentElement;
      for (let depth=0;parent&&depth<9;depth++,parent=parent.parentElement) {
        const children=Array.from(parent.children || []);
        const position=children.findIndex(child=>child.contains(input));
        if(position>0&&position+1<children.length&&children[0].querySelector('h6,[role="heading"]'))return input;
      }
    }
    return null;
  }
  function todayLocal(value, timezone) {
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return false;
    const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
    return formatter.format(date)<=formatter.format(new Date());
  }
  async function showToday(session) {
    const ar=(document.documentElement.lang||localStorage.getItem('language')||'').toLowerCase().startsWith('ar');
    const tr=(en,arabic)=>ar?arabic:en;
    const appHome=session.role==='agent'?'/agent':'/user';
    addStyles();
    const dialog=document.createElement('dialog');
    dialog.className='sx-followup-dialog';
    const heading=document.createElement('h2');
    heading.textContent=tr('Today','اليوم');
    const status=document.createElement('div');
    status.setAttribute('role','status');
    status.textContent=tr('Loading your work…','جارٍ تحميل مهامك…');
    const close=document.createElement('button');
    close.type='button';close.textContent=tr('Close','إغلاق');
    close.addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>dialog.remove());
    dialog.append(heading,status,close);document.body.append(dialog);dialog.showModal();
    const results=await Promise.allSettled([
      window.SaleMaxWorkspace.request('tasks','?status=active&scope=mine&limit=100'),
      window.SaleMaxWorkspace.request('pipeline','/reports/follow-up-brief?includeItems=true')
    ]);
    if(!dialog.isConnected)return;
    status.replaceChildren();
    function section(title) {
      const wrapper=document.createElement('section');
      const label=document.createElement('h3');label.textContent=title;
      wrapper.append(label);status.append(wrapper);return wrapper;
    }
    function row(wrapper,title,detail,url) {
      const article=document.createElement('article');
      article.style.cssText='padding:10px 0;border-bottom:1px solid currentColor;overflow-wrap:anywhere';
      const link=document.createElement('a');link.href=url;link.target='_top';link.textContent=title;
      const text=document.createElement('p');text.textContent=detail;text.style.margin='6px 0';
      article.append(link,text);wrapper.append(article);
    }
    const taskSection=section(tr('Callbacks due','المتابعات المستحقة'));
    if(results[0].status==='fulfilled'){
      const result=results[0].value.data;
      const due=(result.items||[]).filter(item=>['lead_follow_up','chatbot_handoff'].includes(item.task_type)&&item.due_at&&todayLocal(item.due_at,session.timezone||'Asia/Qatar'));
      for(const item of due)row(taskSection,item.title,item.description||tr('Open the task for details.','افتح المهمة للاطلاع على التفاصيل.'),appHome+'?page=tasks&task='+encodeURIComponent(item.id));
      if(!due.length)taskSection.append(document.createTextNode(tr('No callbacks due in the loaded tasks.','لا توجد متابعات مستحقة في المهام المحمّلة.')));
      if(result.hasMore)taskSection.append(document.createTextNode(tr(' More tasks are available in Tasks.',' توجد مهام أخرى في صفحة المهام.')));
    } else taskSection.append(document.createTextNode(tr('Could not load tasks.','تعذر تحميل المهام.')));
    const chatSection=section(tr('Learners awaiting a reply','متدربون بانتظار الرد'));
    if(results[1].status==='fulfilled'){
      const result=results[1].value.data;
      const items=[...(result.items||[]),...(result.reviewItems||[])];
      for(const item of items.slice(0,30)){
        const detail=[item.latestCustomerMessage,item.ownerName,item.suggestedNextStep].filter(Boolean).join(' · ');
        row(chatSection,item.customerName,detail,appHome+'?page=inbox&chatId='+encodeURIComponent(item.chatId));
      }
      if(!items.length)chatSection.append(document.createTextNode(tr('No linked conversations are waiting.','لا توجد محادثات مرتبطة بانتظار الرد.')));
      if(items.length>30||result.allHasMore)chatSection.append(document.createTextNode(tr(' More are available in Lead Reports.',' توجد محادثات أخرى في تقارير العملاء.')));
    } else chatSection.append(document.createTextNode(tr('Could not load conversations.','تعذر تحميل المحادثات.')));
  }
  let mountingToday=false;
  async function mountToday() {
    if(mountingToday||new URLSearchParams(location.search).get('page')!=='inbox')return;
    const input=inboxSearch();
    const searchBox=input?.closest('.MuiFormControl-root')||input?.parentElement;
    if(!searchBox||searchBox.previousElementSibling?.hasAttribute('data-sx-today'))return;
    mountingToday=true;
    try {
      const session=await window.SaleMaxWorkspace?.session?.();
      if(session?.categoryKey!=='training_center'||!input.isConnected||searchBox.previousElementSibling?.hasAttribute('data-sx-today'))return;
      const button=document.createElement('button');
      button.type='button';button.dataset.sxToday='1';button.className='sx-followup-button';
      button.textContent=(document.documentElement.lang||'').toLowerCase().startsWith('ar')?'اليوم':'Today';
      button.addEventListener('click',async()=>{
        try {
          const current=await window.SaleMaxWorkspace.session();
          if(current?.categoryKey==='training_center')await showToday(current);
        } catch {}
      });
      searchBox.before(button);
    } catch {} finally { mountingToday=false; }
  }
  let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;mount();mountToday();});});observer.observe(document.documentElement,{childList:true,subtree:true});mount();mountToday();
})();
