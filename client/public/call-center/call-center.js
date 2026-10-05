(() => {
  'use strict';
  const isArabic=()=>{const value=(localStorage.getItem('language')||'').toLowerCase();return value==='ar'||value.includes('arab');};
  function applyLanguage(){const ar=isArabic();document.documentElement.lang=ar?'ar':'en';document.documentElement.dir=ar?'rtl':'ltr';document.querySelectorAll('[data-en][data-ar]').forEach(el=>el.textContent=ar?el.dataset.ar:el.dataset.en);}
  const text=(en,ar)=>isArabic()?ar:en;
  const node=id=>document.getElementById(id);
  let browserSipState='disconnected';
  function notice(kind,message){const target=node('notice');target.dataset.kind=kind||'';target.textContent=message;}
  function bearer(){return localStorage.getItem('wacrm_user');}
  async function request(path,method='GET',body){
    const token=bearer(),headers={Accept:'application/json'};let csrfToken='';
    if(token)headers.Authorization='Bearer '+token;
    if(method!=='GET'&&!token){
      const sessionResponse=await fetch('/api/user/business-auth/me',{credentials:'same-origin',headers:{Accept:'application/json'}});let session;
      try{session=await sessionResponse.json();}catch(_){session={};}
      if(!sessionResponse.ok||session.context?.audience!=='tenant'||!session.csrfToken)throw Object.assign(new Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});
      csrfToken=session.csrfToken;headers['X-CSRF-Token']=csrfToken;
    }
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch('/api/user/call-center'+path,{method,credentials:'same-origin',headers,body:body===undefined?undefined:JSON.stringify(body)});
    let result;try{result=await response.json();}catch(_){result={};}
    if(!response.ok||!result.success)throw Object.assign(new Error(result.code||'CALL_CENTER_UNAVAILABLE'),{code:result.code||'CALL_CENTER_UNAVAILABLE',status:response.status});
    return result.data;
  }
  const roleLabel=role=>({owner:text('Owner','المالك'),manager:text('Manager','المدير'),agent:text('Agent','الوكيل')}[role]||role);
  function renderExtensions(items){
    const section=node('extensionsSection'),host=node('extensionList');section.hidden=false;host.replaceChildren();
    if(!items.length){const empty=document.createElement('p');empty.className='extension-state';empty.textContent=text('No active calling team members are available.','لا يوجد أعضاء فريق نشطون متاحون للمكالمات.');host.append(empty);return;}
    for(const item of items){
      const row=document.createElement('div');row.className='extension-row';row.dataset.membershipId=item.membershipId;row.dataset.revision=String(item.revision);
      const person=document.createElement('div');person.className='extension-person';const name=document.createElement('strong');name.textContent=item.displayName;const role=document.createElement('small');role.textContent=roleLabel(item.role);person.append(name,role);
      const label=document.createElement('label');label.className='extension-field';label.textContent=text('Extension','الرقم الداخلي');const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.autocomplete='off';input.maxLength=8;input.pattern='[0-9]{3,8}';input.placeholder=text('e.g. 1201','مثال: 1201');input.value=item.extension||'';input.setAttribute('aria-label',text(`Extension for ${item.displayName}`,`الرقم الداخلي لـ ${item.displayName}`));label.append(input);
      const button=document.createElement('button');button.type='button';button.textContent=text('Save','حفظ');const state=document.createElement('small');state.className='extension-state';state.dataset.state='';state.setAttribute('role','status');row.append(person,label,button,state);
      const credentialActions=document.createElement('div');credentialActions.className='credential-actions';credentialActions.hidden=!item.extension;
      for(const clientType of ['mobile','browser']){const rotate=document.createElement('button');rotate.type='button';rotate.textContent=clientType==='mobile'?text('Reset mobile SIP password','إعادة تعيين كلمة مرور SIP للهاتف'):text('Reset browser SIP password','إعادة تعيين كلمة مرور SIP للمتصفح');rotate.addEventListener('click',async()=>{
        if(!window.confirm(text('This changes the stored SIP credential. The SIP password updates in Asterisk the next time settings are requested; the mobile app will need its password updated too. Continue?','سيغيّر هذا بيانات SIP المحفوظة. ستتحدث كلمة مرور SIP في أستريسك عند طلب الإعدادات مجددًا؛ ويجب تحديثها في تطبيق الهاتف أيضًا. هل تريد المتابعة؟')))return;
        rotate.disabled=true;state.dataset.kind='';state.textContent=text('Rotating endpoint credential…','جارٍ تدوير بيانات نقطة الاتصال…');
        try{const revision=clientType==='mobile'?item.mobileCredentialRevision:item.browserCredentialRevision;const result=await request('/extensions/credentials','PUT',{membershipId:item.membershipId,clientType,expectedCredentialRevision:revision});if(clientType==='mobile')item.mobileCredentialRevision=result.credentialRevision;else item.browserCredentialRevision=result.credentialRevision;state.dataset.kind='success';state.textContent=text('Credential rotated. Request the mobile settings again, then update the password in your SIP app.','تم تدوير بيانات الاعتماد. اطلب إعدادات الهاتف مجددًا ثم حدّث كلمة المرور في تطبيق SIP.');}
        catch(error){state.dataset.kind='error';state.textContent=error.code==='STALE_ENDPOINT_CREDENTIAL'?text('Credential changed elsewhere. Refresh this page and try again.','تغيرت بيانات الاعتماد في مكان آخر. حدّث الصفحة وحاول مجددًا.'):text('Credential could not be rotated. Check Call Center access and migrations.','تعذر تدوير بيانات الاعتماد. تحقق من صلاحية مركز الاتصال والترحيلات.');}
        finally{rotate.disabled=false;}
      });credentialActions.append(rotate);}
      row.append(credentialActions);host.append(row);
      button.addEventListener('click',async()=>{
        button.disabled=true;state.textContent=text('Saving…','جارٍ الحفظ…');state.dataset.kind='';
        try{
          const saved=await request('/extensions','PUT',{membershipId:item.membershipId,expectedRevision:Number(row.dataset.revision),extension:input.value.trim()||null});
          row.dataset.revision=String(saved.revision);state.dataset.kind='success';state.textContent=saved.assigned?text('Assigned in SaleMaX; request your SIP settings to provision the Asterisk endpoint.','تم التعيين في SaleMaX؛ اطلب إعدادات SIP لتهيئة نقطة اتصال أستريسك.'):text('Assignment cleared.','تم إلغاء التعيين.');
          input.value=saved.extension;
          credentialActions.hidden=!saved.assigned;
          if(saved.membershipId===node('ownExtension').dataset.membershipId)node('ownExtension').textContent=saved.assigned?text(`Your extension is ${saved.extension}; request SIP settings to provision it on Asterisk.`,`رقمك الداخلي ${saved.extension}؛ اطلب إعدادات SIP لتهيئته على أستريسك.`):text('Requires an assigned extension and outbound route.','يتطلب رقمًا داخليًا ومسارًا صادرًا.');
        }catch(error){
          state.dataset.kind='error';state.textContent=error.code==='EXTENSION_ALREADY_ASSIGNED'?text('That extension is already assigned to another business member.','هذا الرقم الداخلي معيّن بالفعل لعضو آخر في النشاط.'):error.code==='EXTENSION_QUEUE_MUST_BE_DISABLED'?text('Disable or remove this member from enabled queues before changing their extension.','عطّل قوائم الانتظار أو أزل العضو منها قبل تغيير رقمه الداخلي.'):error.code==='STALE_EXTENSION_ASSIGNMENT'?text('This assignment changed. Refresh the page and try again.','تغير هذا التعيين. حدّث الصفحة ثم حاول مجددًا.'):text('Could not save this extension assignment.','تعذر حفظ تعيين الرقم الداخلي.');
        }finally{button.disabled=false;}
      });
    }
  }
  async function loadExtensions(){
    const host=node('extensionList');host.textContent=text('Loading team extensions…','جارٍ تحميل الأرقام الداخلية للفريق…');
    try{const items=await request('/extensions');renderExtensions(items);return items;}
    catch(error){node('extensionsSection').hidden=false;host.textContent=error.code==='FEATURE_UNAVAILABLE'?text('Call Center is not included in this plan.','مركز الاتصال غير مشمول في هذه الخطة.'):text('Team extension assignments are unavailable. Confirm that the telephony migration is installed.','تعيينات الأرقام الداخلية غير متاحة. تحقق من تثبيت ترحيل قاعدة بيانات الاتصالات.');}
    return [];
  }
  function renderQueues(queues,team){
    const section=node('queuesSection'),host=node('queueList');section.hidden=false;host.replaceChildren();
    const values=[{id:null,revision:0,name:'',strategy:'ringall',ringTimeoutSeconds:20,enabled:false,members:[]},...queues];
    if(queues.length===0){const hint=document.createElement('p');hint.className='extension-state';hint.textContent=text('Create the first queue below. Queue names must use lowercase letters, digits, _ or -.','أنشئ أول قائمة أدناه. استخدم الأحرف الإنجليزية الصغيرة أو الأرقام أو _ أو -.');host.append(hint);}
    for(const queue of values){
      const card=document.createElement('div');card.className='queue-card';card.dataset.id=queue.id||'';card.dataset.revision=String(queue.revision||0);
      const field=(labelText,control)=>{const label=document.createElement('label');label.textContent=labelText;label.append(control);card.append(label);};
      const name=document.createElement('input');name.value=queue.name;name.maxLength=80;name.pattern='[a-z][a-z0-9_-]{1,79}';name.placeholder='sales_support';name.autocomplete='off';field(text('Queue name','اسم القائمة'),name);
      const strategy=document.createElement('select');const ringAll=document.createElement('option');ringAll.value='ringall';ringAll.textContent=text('Ring all assigned agent endpoints','يرن على جميع نقاط اتصال أعضاء القائمة');strategy.append(ringAll);strategy.value=queue.strategy;strategy.disabled=true;field(text('Ring behavior','سلوك الرنين'),strategy);
      const timeout=document.createElement('input');timeout.type='number';timeout.min='5';timeout.max='120';timeout.step='1';timeout.value=String(queue.ringTimeoutSeconds);field(text('Ring timeout (seconds)','مدة الرنين (ثوانٍ)'),timeout);
      const enabledLabel=document.createElement('label');enabledLabel.style.display='flex';enabledLabel.style.alignItems='center';const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=queue.enabled;enabled.style.width='16px';enabledLabel.append(enabled,document.createTextNode(text(' Policy enabled',' تفعيل السياسة')));card.append(enabledLabel);
      const members=document.createElement('div');members.className='queue-members';const chosen=new Set(queue.members.map(member=>member.membershipId));
      for(const person of team.filter(member=>member.extension)){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=person.membershipId;box.checked=chosen.has(person.membershipId);label.append(box,document.createTextNode(`${person.displayName} · ${person.extension}`));members.append(label);}
      const memberTitle=document.createElement('strong');memberTitle.textContent=text('Members with assigned extensions','الأعضاء ذوو الأرقام الداخلية المعيّنة');card.append(memberTitle,members);
      if(!team.some(member=>member.extension)){const empty=document.createElement('p');empty.className='queue-state';empty.textContent=text('Assign a team extension before adding queue members.','عيّن رقمًا داخليًا لعضو في الفريق قبل إضافته إلى قائمة الانتظار.');card.append(empty);}
      const button=document.createElement('button');button.type='button';button.textContent=text('Save queue','حفظ القائمة');const state=document.createElement('small');state.className='queue-state';state.setAttribute('role','status');card.append(button,state);host.append(card);
      button.addEventListener('click',async()=>{button.disabled=true;state.dataset.kind='';state.textContent=text('Saving…','جارٍ الحفظ…');try{const saved=await request('/queues','PUT',{id:queue.id||null,expectedRevision:Number(card.dataset.revision),name:name.value.trim(),strategy:strategy.value,ringTimeoutSeconds:Number(timeout.value),enabled:enabled.checked,membershipIds:[...members.querySelectorAll('input:checked')].map(input=>input.value)});card.dataset.id=saved.id;card.dataset.revision=String(saved.revision);button.textContent=text('Saved','تم الحفظ');state.dataset.kind='success';state.textContent=text('Queue policy saved in SaleMaX for ARI call routing. Dinstar channel routes still require gateway setup.','حُفظت سياسة القائمة في SaleMaX لتوجيه ARI. لا يزال إعداد مسارات قنوات دينستار على البوابة مطلوبًا.');}catch(error){state.dataset.kind='error';state.textContent=error.code==='TELEPHONY_QUEUE_MEMBER_EXTENSION_REQUIRED'?text('Every queue member needs an assigned extension first.','يجب تعيين رقم داخلي لكل عضو في القائمة أولًا.'):error.code==='TELEPHONY_QUEUE_NAME_EXISTS'?text('That queue name is already used in this business.','اسم القائمة مستخدم بالفعل في هذا النشاط.'):error.code==='TELEPHONY_QUEUE_INBOUND_CHANNELS_ACTIVE'?text('Disable the assigned inbound gateway channel in Super Admin before disabling this queue.','عطّل قناة البوابة الواردة من المسؤول الأعلى قبل تعطيل قائمة الانتظار.'):error.code==='STALE_TELEPHONY_QUEUE'?text('This queue changed elsewhere. Refresh and try again.','تغيرت القائمة في مكان آخر. حدّث الصفحة ثم حاول مجددًا.'):text('Queue could not be saved. Check the telephony migration and values.','تعذر حفظ القائمة. تحقق من ترحيل الاتصالات والقيم.');}finally{button.disabled=false;}});
    }
  }
  async function loadQueues(team){
    const host=node('queueList');node('queuesSection').hidden=false;host.textContent=text('Loading queues…','جارٍ تحميل قوائم الانتظار…');
    try{renderQueues(await request('/queues'),team);}catch(_){host.textContent=text('Queue setup is unavailable. Confirm that the latest telephony migration is installed.','إعداد قوائم الانتظار غير متاح. تحقق من تثبيت أحدث ترحيل للاتصالات.');}
  }
  function renderCalls(items){
    const host=node('callList');host.replaceChildren();
    if(!items.length){const empty=document.createElement('p');empty.className='call-empty';empty.textContent=text('No calls are available for this account yet.','لا توجد مكالمات متاحة لهذا الحساب حتى الآن.');host.append(empty);return;}
    for(const call of items){
      const row=document.createElement('article');row.className='call-row';
      const main=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small');
      title.textContent=`${call.direction==='inbound'?text('Incoming','واردة'):text('Outgoing','صادرة')} · ${call.queueName||text('No queue','بلا قائمة')}`;
      const started=call.startedAt?new Date(call.startedAt).toLocaleString(isArabic()?'ar-QA':'en-QA',{timeZone:'Asia/Qatar'}):'';
      meta.textContent=`${started}${started?' · ':''}${text(`Gateway channel ${call.gatewayChannelNo}`,`قناة البوابة ${call.gatewayChannelNo}`)}`;main.append(title,meta);
      const state=document.createElement('span');state.className='call-status';const labels={ringing:text('Ringing','يرن'),connected:text('Connected','متصل'),ended:text('Ended','انتهت'),failed:text('Failed','فشلت')};state.textContent=labels[call.status]||call.status;
      row.append(main,state);host.append(row);
    }
  }
  async function loadCalls(){
    const host=node('callList');
    try{const data=await request('/calls');renderCalls(data.items||[]);}
    catch(error){host.textContent=error.code==='FEATURE_UNAVAILABLE'?text('Call Center is not included in this plan.','مركز الاتصال غير مشمول في هذه الخطة.'):text('Call list is unavailable. Confirm the telephony migration and access permissions.','قائمة المكالمات غير متاحة. تحقق من ترحيل الاتصالات وصلاحيات الوصول.');}
  }
  async function refresh(){
    const button=node('refresh');button.disabled=true;notice('',text('Loading telephony status…','جارٍ تحميل حالة الاتصالات…'));
    try{
      const token=bearer(),response=await fetch('/api/user/call-center/status',{credentials:'same-origin',headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{})}});
      let result;try{result=await response.json();}catch(_){result={};}
      if(!response.ok||!result.success){const code=result.code||'CALL_CENTER_UNAVAILABLE';throw Object.assign(new Error(code),{code,status:response.status});}
      const data=result.data||{};
      node('outgoingSection').hidden=!data.permissions?.controlCalls;
      await loadCalls();
      const health=data.asterisk?.health||'not_configured';
      node('asteriskState').textContent=health==='success'?(data.asterisk.enabled?text('Connected','متصل'):text('Tested · Disabled','تم الاختبار · معطل')):health==='failed'?text('Connection failed','فشل الاتصال'):data.asterisk?.configured?text('Setup saved','تم حفظ الإعداد'):text('Not configured','غير مُعد');
      node('asteriskDetail').textContent=data.asterisk?.configured?text(`Revision ${data.asterisk.revision}${!data.asterisk.enabled?' · Disabled':''}${data.asterisk.version?' · Asterisk '+data.asterisk.version:''}${data.asterisk.lastTestedAt?' · Checked '+new Date(data.asterisk.lastTestedAt).toLocaleString('en-QA',{timeZone:'Asia/Qatar'}):' · Not tested'}`,`الإصدار ${data.asterisk.revision}${!data.asterisk.enabled?' · معطل':''}${data.asterisk.version?' · أستريسك '+data.asterisk.version:''}${data.asterisk.lastTestedAt?' · تم التحقق '+new Date(data.asterisk.lastTestedAt).toLocaleString('ar-QA',{timeZone:'Asia/Qatar'}):' · لم يتم الاختبار'}`):text('Contact your platform administrator.','تواصل مع مسؤول المنصة.');
      const peerState=data.gateway?.endpointStatus||'not_tested',ports=data.gateway?.channelPolicy||{assignedChannels:0,inboundChannels:0,outboundChannels:0},capacity=text('4 channels','٤ قنوات');const channelSuffix=text(`${ports.assignedChannels}/4 assigned to your business · ${ports.inboundChannels} inbound · ${ports.outboundChannels} outbound allowed; routes not ready`,`${ports.assignedChannels}/٤ مخصصة لنشاطك · ${ports.inboundChannels} وارد · ${ports.outboundChannels} صادر مسموح؛ المسارات غير جاهزة`);const peerText=peerState==='online'?text('PJSIP peer online','نظير PJSIP متصل'):peerState==='offline'?text('PJSIP peer offline','نظير PJSIP غير متصل'):peerState==='not_configured'?text('PJSIP peer not configured on Asterisk','نظير PJSIP غير مُعد في أستريسك'):data.gateway?.settingsConfigured?text('SIP settings saved · peer not verified','حُفظت إعدادات SIP · لم يتم التحقق من النظير'):text('SIP peer not configured','لم يتم إعداد نظير SIP');node('gatewayDetail').textContent=`${capacity} · ${peerText} · ${channelSuffix}`;
      node('inboundState').textContent=data.calls?.inboundAvailable?text('Available','متاح'):text('Not ready','غير جاهز');
      node('outboundState').textContent=data.calls?.outboundAvailable?text('Available','متاح'):text('Not ready','غير جاهز');
      node('mobileSipState').textContent=data.clients?.mobileSip?.provisioned?text('Provisioned on Asterisk','تمت التهيئة على أستريسك'):text('Not provisioned','لم تتم التهيئة');
      node('browserCallState').textContent=['registered','in-call','ringing','answering'].includes(browserSipState)?text('Ready','جاهز'):text('Not connected','غير متصل');
      node('ownExtension').textContent=data.member?.extensionAssigned?text(`Your extension is ${data.member.extension}; open SIP settings to provision your PBX endpoint.`,`رقمك الداخلي ${data.member.extension}؛ افتح إعدادات SIP لتهيئة نقطة اتصال المقسم.`):text('Requires an assigned extension and outbound route.','يتطلب رقمًا داخليًا ومسارًا صادرًا.');
      node('ownExtension').dataset.membershipId=data.member?.membershipId||'';
      if(data.permissions?.manageExtensions){const team=await loadExtensions();await loadQueues(team);}else{node('extensionsSection').hidden=true;node('queuesSection').hidden=true;}
      notice(data.calls?.inboundAvailable&&data.calls?.outboundAvailable?'success':'',data.calls?.inboundAvailable&&data.calls?.outboundAvailable?text('Calling is ready.','الاتصال جاهز.'):text('Call setup is in progress. Availability depends on the live PBX, gateway, and agent endpoint configuration.','إعداد الاتصالات قيد التنفيذ. تعتمد الإتاحة على إعداد المقسم والبوابة ونقطة اتصال الوكيل في النظام المباشر.'));
    }catch(error){
      const messages={AUTH_REQUIRED:text('Sign in to your SaleMaX business account to use Call Center.','سجّل الدخول إلى حساب الأعمال في SaleMaX لاستخدام مركز الاتصال.'),PERMISSION_DENIED:text('Your account does not have Call Center access. Contact your business owner.','لا يملك حسابك صلاحية الوصول إلى مركز الاتصال. تواصل مع مالك النشاط.'),FEATURE_UNAVAILABLE:text('Call Center is not included in your active plan. Contact your business owner.','مركز الاتصال غير مشمول في خطتك الحالية. تواصل مع مالك النشاط.'),CATEGORY_UNAVAILABLE:text('Call Center is not available for this business category.','مركز الاتصال غير متاح لفئة هذا النشاط.'),CONNECTION_FAILED:text('Could not contact SaleMaX. Check your connection and retry.','تعذر الاتصال بـ SaleMaX. تحقق من اتصالك وحاول مجددًا.')};
      notice('error',messages[error.code]||text('Telephony status is unavailable. Ask your administrator to finish PBX setup.','حالة الاتصالات غير متاحة. اطلب من المسؤول إكمال إعداد المقسم.'));
    }finally{button.disabled=false;}
  }
  async function placeOutboundCall(event){
    event.preventDefault();const button=node('placeCall'),field=node('destination'),state=node('outgoingState');
    const destination=field.value.trim();if(!/^\+[1-9][0-9]{7,14}$/.test(destination)){field.setCustomValidity(text('Enter a valid international number, such as +97455550000.','أدخل رقمًا دوليًا صحيحًا مثل ‎+97455550000.'));field.reportValidity();return;}field.setCustomValidity('');
    button.disabled=true;state.textContent=text('Requesting call…','جارٍ طلب المكالمة…');
    const clientType=node('callClientType').value;
    if(clientType==='browser'&&!window.SaleMaXSip?.browserSipConnected?.()){state.textContent=text('Connect browser audio before selecting it.','وصّل صوت المتصفح قبل اختياره.');button.disabled=false;return;}
    try{const result=await request('/calls','POST',{destination,clientType});field.value='';state.textContent=clientType==='browser'?text(`Call request accepted (${result.callId}). This browser should connect the call.`,`تم قبول طلب المكالمة (${result.callId}). من المفترض أن يتصل هذا المتصفح بالمكالمة.`):text(`Call request accepted (${result.callId}). Your mobile SIP app should ring.`,`تم قبول طلب المكالمة (${result.callId}). من المفترض أن يرن تطبيق SIP للهاتف.`);await loadCalls();}
    catch(error){const messages={PERMISSION_DENIED:text('Your account cannot place calls.','حسابك غير مخوّل لإجراء المكالمات.'),FEATURE_UNAVAILABLE:text('Call Center is not included in your active plan.','مركز الاتصال غير مشمول في خطتك الحالية.'),OUTBOUND_EXTENSION_NOT_READY:text('Assign and provision your mobile SIP extension first.','عيّن رقم SIP للهاتف وأكمل تهيئته أولًا.'),OUTBOUND_CHANNEL_UNAVAILABLE:text('No outbound GSM channel is available for your business right now.','لا توجد قناة GSM صادرة متاحة لنشاطك حاليًا.'),GATEWAY_ENDPOINT_NOT_READY:text('The GSM gateway is not verified as online. Ask your administrator to check it.','لم يتم التحقق من اتصال بوابة GSM. اطلب من المسؤول التحقق منها.'),ASTERISK_CONTROL_NOT_READY:text('Asterisk call control is not enabled. Ask your administrator to finish PBX setup.','التحكم في مكالمات أستريسك غير مفعّل. اطلب من المسؤول إكمال إعداد المقسم.'),ASTERISK_EVENTS_NOT_READY:text('SaleMaX is disconnected from Asterisk call events. Ask your administrator to restore PBX event control.','انقطع اتصال SaleMaX بأحداث المكالمات في أستريسك. اطلب من المسؤول استعادة التحكم بأحداث المقسم.')};state.textContent=messages[error.code]||text('Call request failed. Check the mobile endpoint and telephony setup, then try again.','فشل طلب المكالمة. تحقق من نقطة اتصال الهاتف وإعداد الاتصالات ثم حاول مجددًا.');await loadCalls();}
    finally{button.disabled=false;}
  }
  node('showMobileSip').addEventListener('click',async()=>{
    const button=node('showMobileSip'),host=node('mobileSipSetup');
    if(!host.hidden){host.hidden=true;host.replaceChildren();button.textContent=text('Show my mobile SIP settings','عرض إعداد SIP لهاتفي');return;}
    button.disabled=true;host.hidden=false;host.textContent=text('Loading your private mobile settings…','جارٍ تحميل إعدادات الهاتف الخاصة بك…');
    try{
      const config=await request('/sip-config','POST',{});host.replaceChildren();
      const title=document.createElement('p');title.className='call-empty';title.textContent=text('Enter these settings in your SIP app. The endpoint profile has been synchronized with Asterisk. Keep the password private.','أدخل هذه الإعدادات في تطبيق SIP. تمت مزامنة ملف نقطة الاتصال مع أستريسك. احتفظ بكلمة المرور بشكل خاص.');host.append(title);
      const values=[['Server',`${config.host}:${config.port}`,'text'],['Transport',config.transport,'text'],['Media encryption',config.mediaEncryption,'text'],['Username',config.username,'text'],['Password',config.password,'password']];
      for(const [name,value,type] of values){const row=document.createElement('label');row.className='sip-credential-row';row.textContent=text(name,({Server:'الخادم',Transport:'النقل','Media encryption':'تشفير الوسائط',Username:'اسم المستخدم',Password:'كلمة المرور'})[name]||name);const input=document.createElement('input');input.type=type;input.readOnly=true;input.autocomplete='off';input.value=value;input.dir='ltr';input.setAttribute('aria-label',name);const copy=document.createElement('button');copy.type='button';copy.textContent=text('Copy','نسخ');copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(input.value);copy.textContent=text('Copied','تم النسخ');setTimeout(()=>copy.textContent=text('Copy','نسخ'),1500);}catch(_){input.focus();input.select();}});row.append(input,copy);host.append(row);}
      const note=document.createElement('small');note.textContent=text('Use TLS and SRTP in your app. Browser refresh or sign-out clears these values from this page.','استخدم TLS وSRTP في التطبيق. يؤدي تحديث المتصفح أو تسجيل الخروج إلى إزالة هذه القيم من الصفحة.');host.append(note);button.textContent=text('Hide mobile SIP settings','إخفاء إعداد SIP للهاتف');
    }catch(_){host.textContent=text('Mobile SIP settings are unavailable. Check PBX setup and ask your administrator.','إعداد SIP للهاتف غير متاح. تحقق من إعداد المقسم وتواصل مع المسؤول.');}
    finally{button.disabled=false;}
  });
  function setBrowserState(state){
    browserSipState=state;
    const labels={disconnected:text('Browser SIP is disconnected.','اتصال SIP بالمتصفح غير متصل.'),'requesting-microphone':text('Allow microphone access…','اسمح باستخدام الميكروفون…'),connected:text('Browser connected; registering…','تم اتصال المتصفح؛ جارٍ التسجيل…'),registered:text('Browser SIP is registered and ready.','تم تسجيل SIP للمتصفح وهو جاهز.'),ringing:text('Calling…','جارٍ الاتصال…'),answering:text('Connecting audio…','جارٍ توصيل الصوت…'),'in-call':text('Browser call is connected.','مكالمة المتصفح متصلة.'),'call-failed':text('Browser call could not connect.','تعذر توصيل مكالمة المتصفح.'),'connection-failed':text('Browser SIP connection failed. Check WSS and endpoint setup.','فشل اتصال SIP بالمتصفح. تحقق من إعداد WSS ونقطة الاتصال.')};
    node('browserSipState').textContent=labels[state]||labels.disconnected;
    const connected=['registered','in-call','ringing','answering'].includes(state);
    node('browserCallOption').disabled=!connected;
    node('browserSipConnect').disabled=connected||state==='connected'||state==='requesting-microphone';
    node('browserSipConnect').textContent=connected?text('Disconnect browser','قطع اتصال المتصفح'):text('Connect browser audio','توصيل صوت المتصفح');
    node('browserSipHangup').hidden=!['in-call','ringing','answering'].includes(state);
    node('browserCallState').textContent=connected?text('Ready','جاهز'):text('Not connected','غير متصل');
  }
  node('browserSipConnect').addEventListener('click',async()=>{
    const button=node('browserSipConnect');
    if(window.SaleMaXSip?.browserSipConnected?.()){
      button.disabled=true;try{await window.SaleMaXSip.disconnectBrowserSip();setBrowserState('disconnected');}catch(_){setBrowserState('connection-failed');}finally{button.disabled=false;}return;
    }
    button.disabled=true;
    try{setBrowserState('requesting-microphone');const config=await request('/webrtc-config','POST',{});await window.SaleMaXSip.connectBrowserSip(config,node('remoteAudio'),event=>setBrowserState(event.state));setBrowserState('registered');}
    catch(_){setBrowserState('connection-failed');}
    finally{button.disabled=false;}
  });
  node('browserSipHangup').addEventListener('click',async()=>{try{await window.SaleMaXSip?.hangupBrowserCall?.();}catch(_){setBrowserState('call-failed');}});
  window.addEventListener('pagehide',()=>{node('mobileSipSetup').replaceChildren();window.SaleMaXSip?.disconnectBrowserSip?.();});
  applyLanguage();node('refresh').addEventListener('click',refresh);node('outgoingForm').addEventListener('submit',placeOutboundCall);refresh();
  window.setInterval(()=>{if(!document.hidden)loadCalls();},10000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadCalls();});
})();
