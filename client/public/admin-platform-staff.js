(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ar=()=>document.documentElement.dir==='rtl'||[...document.querySelectorAll('h5')].some(node=>node.textContent.trim()==='إدارة المستخدمين');
  const t=(en,arabic)=>ar()?arabic:en;
  const permissions={
    'tenants.read':['View businesses','عرض الأنشطة'],'tenants.create':['Create businesses','إنشاء الأنشطة'],'tenants.manage':['Manage business accounts','إدارة حسابات الأنشطة'],
    'plans.read':['View plans','عرض الخطط'],'plans.draft':['Edit plan drafts','تعديل مسودات الخطط'],'plans.assign':['Assign plans','تعيين الخطط'],'plans.publish':['Publish plans','نشر الخطط'],
    'support.request':['Manage support requests','إدارة طلبات الدعم'],'incidents.read':['View incidents','عرض الحوادث']
  };
  const css=document.createElement('style');css.textContent=`
    .sx-platform-staff-trigger{margin-inline-start:8px!important;border:1px solid #edbfd0!important;background:#fff2f6!important;color:#860030!important}
    .sx-platform-staff{font:14px/1.5 Roboto,Arial,sans-serif;color:#17212f;padding:24px;max-width:1150px;margin:0 auto}
    .sx-platform-staff h2{font-size:22px;margin:0 0 6px}.sx-platform-staff h3{font-size:17px;margin:0 0 12px}.sx-platform-staff p{color:#596579}
    .sx-platform-staff button{font:600 14px Roboto,Arial,sans-serif;min-height:42px;padding:9px 14px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;color:#344054;cursor:pointer}
    .sx-platform-staff button.primary{background:#a8003b;border-color:#a8003b;color:#fff}.sx-platform-staff button:disabled{opacity:.55;cursor:wait}
    .sx-platform-staff button:focus-visible,.sx-staff-invite-overlay button:focus-visible,.sx-staff-invite-overlay input:focus-visible{outline:3px solid #a8003b70;outline-offset:2px}
    .sx-staff-stack{display:grid;gap:18px}.sx-staff-card{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:18px;box-shadow:0 3px 12px #1018280a}
    .sx-staff-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.sx-staff-fields label,.sx-staff-invite-overlay label{display:grid;gap:6px;font-weight:600;color:#344054}
    .sx-platform-staff input[type=email],.sx-platform-staff input[type=password],.sx-platform-staff input[type=text]{box-sizing:border-box;width:100%;min-height:42px;border:1px solid #cfd5dd;border-radius:8px;padding:9px 11px;font:14px Roboto,Arial,sans-serif}
    .sx-staff-permissions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px;margin:14px 0}.sx-staff-permissions label{display:flex;align-items:center;gap:8px;font-weight:400}
    .sx-staff-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.sx-staff-alert{padding:12px;border-radius:8px;background:#fff1f0;color:#b42318;margin:12px 0}.sx-staff-success{padding:12px;border-radius:8px;background:#ecfdf3;color:#027a48;margin:12px 0;overflow-wrap:anywhere}
    .sx-staff-record{border-top:1px solid #eaecf0;padding:14px 0}.sx-staff-record:first-of-type{border-top:0}.sx-staff-record-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.sx-staff-status{font-size:12px;color:#475467;border-radius:999px;background:#f2f4f7;padding:4px 9px}
    .sx-staff-table-wrap{overflow:auto}.sx-staff-table{width:100%;border-collapse:collapse;text-align:start}.sx-staff-table td,.sx-staff-table th{padding:10px;border-bottom:1px solid #eaecf0;text-align:start;vertical-align:top}
    .sx-staff-empty{padding:18px;text-align:center;color:#667085;background:#f9fafb;border-radius:8px}.sx-staff-muted{font-size:12px;color:#667085}
    .sx-staff-invite-overlay{position:fixed;z-index:2147483100;inset:0;background:#101828a8;display:grid;place-items:center;padding:18px;overflow:auto}
    .sx-staff-invite-card{width:min(480px,100%);background:#fff;border-radius:16px;padding:24px;box-shadow:0 20px 70px #10182855;box-sizing:border-box;font:14px/1.5 Roboto,Arial,sans-serif;color:#17212f}
    .sx-staff-invite-card button{font:600 14px Roboto,Arial,sans-serif;min-height:42px;padding:9px 14px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;color:#344054;cursor:pointer}
    .sx-staff-invite-card button.primary{background:#a8003b;border-color:#a8003b;color:#fff}
    .sx-staff-invite-card h1{font-size:22px;margin:0 0 6px}.sx-staff-invite-card form{display:grid;gap:14px}.sx-staff-invite-card input{box-sizing:border-box;width:100%;min-height:44px;padding:10px;border:1px solid #cfd5dd;border-radius:8px;font:14px Roboto,Arial,sans-serif}
    .sx-staff-invite-card .sx-staff-actions{justify-content:flex-start}.sx-staff-invite-card .sx-staff-lang{float:inline-end;font-size:12px}
    @media(max-width:700px){.sx-platform-staff{padding:16px}.sx-staff-fields{grid-template-columns:1fr}.sx-staff-permissions{grid-template-columns:repeat(2,minmax(0,1fr))}.sx-staff-record-head{align-items:flex-start;flex-direction:column}.sx-staff-invite-card{padding:20px}}
    @media(max-width:380px){.sx-staff-permissions{grid-template-columns:1fr}}
  `;document.head.appendChild(css);
  let editor,hidden=[],returnFocus;
  const token=()=>localStorage.getItem('wacrm_admin');
  function anchor(){
    const heading=[...document.querySelectorAll('h5')].find(node=>['Manage Users','إدارة المستخدمين'].includes(node.textContent.trim()));let node=heading?.parentElement;
    while(node&&node!==document.body){if([...node.querySelectorAll('button')].some(button=>['Refresh','تحديث'].includes(button.textContent.trim())))return node.parentElement;node=node.parentElement;}return null;
  }
  function close(){editor?.remove();editor=null;hidden.forEach(([node,display])=>node.style.display=display);hidden=[];returnFocus?.focus();}
  async function api(path,{body,method='GET',csrf='',publicCall=false}={}){
    let response,data;const headers={'Content-Type':'application/json'};
    if(!publicCall){const bearer=token();if(!bearer)throw Object.assign(new Error(),{code:'AUTH_REQUIRED'});headers.Authorization='Bearer '+bearer;}
    if(body)headers['Content-Type']='application/json';if(csrf)headers['X-CSRF-Token']=csrf;
    try{response=await fetch(path,{method,headers,credentials:'same-origin',body:body?JSON.stringify(body):undefined});data=await response.json();}
    catch(_){throw Object.assign(new Error(),{code:'CONNECTION_FAILED'});}
    if(!response.ok||data.success===false||data.logout)throw Object.assign(new Error(data.msg||data.code||'Request failed'),{code:data.code||'REQUEST_FAILED',status:response.status});return data;
  }
  function translateError(error){
    const messages={
      PLATFORM_UPGRADE_NOT_ENABLED:t('Platform staff access is not enabled on this installation yet.','لم يتم تفعيل وصول موظفي المنصة في هذا النظام بعد.'),
      AUTH_REQUIRED:t('Verify your platform account to continue.','تحقق من حساب المنصة للمتابعة.'),MFA_REQUIRED:t('Complete the authenticator check to continue.','أكمل التحقق بتطبيق المصادقة للمتابعة.'),REAUTH_REQUIRED:t('Your recent sign-in expired. Verify your password again; then use the newly displayed QR code and its current six-digit code.','انتهت صلاحية تسجيل الدخول الحديث. تحقّق من كلمة المرور مجددًا، ثم استخدم رمز QR الجديد والرمز الحالي المكوّن من ستة أرقام.'),MFA_INVALID:t('That code was not accepted. Check that your phone time is automatic and enter a fresh code before it changes.','لم يتم قبول الرمز. تحقق من ضبط وقت الهاتف تلقائيًا وأدخل رمزًا جديدًا قبل تغيّره.'),
      PERMISSION_DENIED:t('Only the Super Admin can manage platform staff.','يمكن للمسؤول الأعلى فقط إدارة موظفي المنصة.'),VERIFIED_ADMIN_LINK_REQUIRED:t('This administrator has not been linked to a verified platform identity.','لم يتم ربط هذا المسؤول بهوية منصة معتمدة.'),
      INVALID_EMAIL:t('Enter a valid email address.','أدخل بريدًا إلكترونيًا صحيحًا.'),INVALID_STAFF_PERMISSIONS:t('Choose only the listed staff permissions.','اختر صلاحيات الموظفين المدرجة فقط.'),
      IDENTITY_EXISTS:t('This email already belongs to a canonical account.','هذا البريد مرتبط بالفعل بحساب موحد.'),LEGACY_ADMIN_EXISTS:t('An administrator account already uses this email.','يوجد حساب مسؤول يستخدم هذا البريد بالفعل.'),
      INVITE_NOT_PENDING:t('This invitation is no longer active. Create a new invitation.','لم تعد هذه الدعوة فعالة. أنشئ دعوة جديدة.'),STAFF_NOT_FOUND:t('This staff account is no longer available. Reload the list.','لم يعد حساب الموظف متاحًا. أعد تحميل القائمة.'),
      STAFF_IDENTITY_INACTIVE:t('This identity is inactive and cannot be enabled from this screen.','هذه الهوية غير نشطة ولا يمكن تفعيلها من هذه الشاشة.'),INVITE_INVALID:t('This setup link is invalid, expired, cancelled or already used. Ask the inviter for a new link.','رابط الإعداد غير صالح أو منتهي أو ملغى أو مستخدم. اطلب رابطًا جديدًا.'),
      INVALID_PASSWORD:t('Use a password with at least 12 characters and no more than 72 UTF-8 bytes.','استخدم كلمة مرور من 12 حرفًا على الأقل وبحد أقصى 72 بايت UTF-8.'),INVALID_DISPLAY_NAME:t('Enter a name between 1 and 200 characters.','أدخل اسمًا من 1 إلى 200 حرف.'),
      ORIGIN_DENIED:t('This request did not come from the SaleMaX site. Reload and try again.','لم يأت هذا الطلب من موقع SaleMaX. أعد التحميل وحاول مجددًا.')
    };
    return messages[error.code]||t('The request could not be completed. Your current settings are preserved. Try again.','تعذر إكمال الطلب. تم الحفاظ على الإعدادات الحالية. حاول مرة أخرى.');
  }
  async function currentContext(){
    const data=await api('/api/admin/platform-auth/me');
    if(data.context?.audience!=='platform')throw Object.assign(new Error(),{code:'AUTH_REQUIRED'});
    if(data.mfaRequired)throw Object.assign(new Error(),{code:'MFA_REQUIRED'});
    return data;
  }
  function inviteLogin(){
    let storedToken=location.hash.startsWith('#staff-invite=')?decodeURIComponent(location.hash.slice('#staff-invite='.length)):'';
    if(!storedToken)return;
    history.replaceState(history.state,'',location.pathname+location.search);
    let arabic=document.documentElement.dir==='rtl',overlay,accepted=false;
    const tr=(en,ar)=>arabic?ar:en;
    const draw=(message='',success=false)=>{
      if(!overlay){overlay=document.createElement('div');overlay.className='sx-staff-invite-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');document.body.appendChild(overlay);document.getElementById('root')?.setAttribute('aria-hidden','true');}
      overlay.dir=arabic?'rtl':'ltr';
      overlay.innerHTML=`<section class="sx-staff-invite-card" aria-labelledby="sx-invite-title"><button type="button" class="sx-staff-lang" data-lang>${tr('العربية','English')}</button><h1 id="sx-invite-title">${tr('Join SaleMaX administration','انضم إلى إدارة SaleMaX')}</h1><p>${tr('Set your name and password to activate the staff access approved for you. This link can be used once.','أدخل اسمك وكلمة مرورك لتفعيل صلاحية الموظف المعتمدة لك. يمكن استخدام هذا الرابط مرة واحدة.')}</p>${message?`<div class="${success?'sx-staff-success':'sx-staff-alert'}" role="${success?'status':'alert'}">${esc(message)}</div>`:''}${accepted?`<p>${tr('Your staff login is ready. Sign in through the existing administrator page, then verify your platform access and set up MFA.','أصبح تسجيل دخول الموظف جاهزًا. سجّل الدخول من صفحة المسؤول الحالية، ثم تحقق من صلاحية المنصة وأعد المصادقة الثنائية.')}</p><div class="sx-staff-actions"><button class="primary" type="button" data-login>${tr('Continue to administrator sign-in','المتابعة إلى تسجيل دخول المسؤول')}</button></div>`:`<form><label>${tr('Display name','الاسم الظاهر')}<input name="name" type="text" minlength="1" maxlength="200" autocomplete="name" required></label><label>${tr('Create password','إنشاء كلمة مرور')}<input name="password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required></label><label>${tr('Confirm password','تأكيد كلمة المرور')}<input name="confirm" type="password" minlength="12" maxlength="72" autocomplete="new-password" required></label><p class="sx-staff-muted">${tr('At least 12 characters. Your permissions are set by the SaleMaX owner.','12 حرفًا على الأقل. يحدد مالك SaleMaX صلاحياتك.')}</p><div class="sx-staff-actions"><button class="primary" type="submit">${tr('Activate staff access','تفعيل وصول الموظف')}</button></div></form>`}</section>`;
      overlay.querySelector('[data-lang]').onclick=()=>{arabic=!arabic;draw(message,success);};
      overlay.querySelector('[data-login]')?.addEventListener('click',()=>location.assign('/admin/login'));
      const form=overlay.querySelector('form');if(form)form.onsubmit=async event=>{
        event.preventDefault();if(form.dataset.busy)return;form.dataset.busy='1';const button=form.querySelector('[type=submit]');button.disabled=true;
        const values=new FormData(form),password=String(values.get('password')||''),confirm=String(values.get('confirm')||'');
        if(password!==confirm){draw(tr('The passwords do not match.','كلمتا المرور غير متطابقتين.'));form.querySelector('[name=password]')?.focus();return;}
        try{await api('/api/admin/staff-invitations/accept',{method:'POST',publicCall:true,body:{token:storedToken,displayName:values.get('name'),password}});storedToken='';accepted=true;draw(tr('Staff access activated. You can now use the existing administrator login.','تم تفعيل وصول الموظف. يمكنك الآن استخدام تسجيل دخول المسؤول الحالي.'),true);}
        catch(error){draw(translateError(error));}
        finally{if(form.isConnected){form.dataset.busy='';const submit=form.querySelector('[type=submit]');if(submit)submit.disabled=false;}}
      };
      overlay.querySelector('input')?.focus();
    };
    draw();
  }
  async function authenticate(active){
    active.dir=ar()?'rtl':'ltr';active.innerHTML=`<h2>${t('Verify platform access','التحقق من صلاحية المنصة')}</h2><p>${t('Use your existing SaleMaX administrator identity. Staff access requires MFA.','استخدم هوية مسؤول SaleMaX الحالية. يتطلب وصول الموظفين المصادقة الثنائية.')}</p><form class="sx-staff-card sx-staff-fields"><label>${t('Platform email','بريد المنصة')}<input name="email" type="email" autocomplete="username" required></label><label>${t('Password','كلمة المرور')}<input name="password" type="password" autocomplete="current-password" required></label><div class="sx-staff-actions"><button type="button" data-back>${t('Back to users','العودة إلى المستخدمين')}</button><button class="primary" type="submit">${t('Verify and continue','التحقق والمتابعة')}</button></div><div data-error role="alert" class="sx-staff-alert" hidden></div></form>`;
    active.querySelector('[data-back]').onclick=close;
    active.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]'),error=form.querySelector('[data-error]');if(form.dataset.busy)return;form.dataset.busy='1';button.disabled=true;error.hidden=true;
      try{const values=new FormData(form);await api('/api/admin/platform-auth/login',{method:'POST',body:{email:values.get('email'),password:values.get('password'),audience:'platform'}});await load(active);}
      catch(err){error.textContent=translateError(err);error.hidden=false;}
      finally{if(form.isConnected){form.dataset.busy='';button.disabled=false;}}
    };
  }
  async function verifyMfa(active,csrf){
    let enrollment=null;try{enrollment=await api('/api/admin/platform-auth/mfa/enroll',{method:'POST',csrf,body:{}});}catch(error){if(error.code!=='MFA_ALREADY_ENROLLED')throw error;}
    const setup=!!enrollment,qr=enrollment?.qrDataUrl||'';
    active.innerHTML=`<h2>${setup?t('Set up your authenticator','إعداد تطبيق المصادقة'):t('Authenticator verification','التحقق بتطبيق المصادقة')}</h2>${setup?`<p>${t('Scan this local QR code or enter the setup key in your authenticator app. Complete verification within five minutes of signing in. If that time passes, sign in again and scan the newly displayed QR code.','امسح رمز QR المحلي أو أدخل مفتاح الإعداد في تطبيق المصادقة. أكمل التحقق خلال خمس دقائق من تسجيل الدخول. إذا انتهت المدة، سجّل الدخول مجددًا وامسح رمز QR الجديد.')}</p>${qr?`<img alt="${t('Authenticator setup QR','رمز إعداد المصادقة')}" src="${qr}" style="max-width:220px;width:100%;height:auto">`:''}<p><code>${esc(enrollment.secret)}</code></p>`:`<p>${t('Enter the current six-digit authenticator code. You may use one saved recovery code instead.','أدخل رمز المصادقة الحالي المكون من ستة أرقام. يمكنك استخدام رمز استرداد محفوظ بدلًا منه.')}</p>`}<form class="sx-staff-card"><label>${t('Authenticator code','رمز المصادقة')}<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" ${setup?'required':''}></label><label>${t('Recovery code (optional)','رمز الاسترداد (اختياري)')}<input name="recoveryCode" autocomplete="off"></label><div class="sx-staff-actions"><button type="button" data-back>${t('Cancel','إلغاء')}</button><button class="primary" type="submit">${t('Verify MFA','التحقق من المصادقة')}</button></div><div data-error role="alert" class="sx-staff-alert" hidden></div></form>`;
    active.querySelector('[data-back]').onclick=()=>authenticate(active);
    active.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]'),error=form.querySelector('[data-error]');if(form.dataset.busy)return;form.dataset.busy='1';button.disabled=true;error.hidden=true;
      try{const values=new FormData(form),recoveryCode=String(values.get('recoveryCode')||'').trim(),result=await api('/api/admin/platform-auth/mfa/verify',{method:'POST',csrf,body:recoveryCode?{recoveryCode}:{code:values.get('code')}});if(result.recoveryCodes){showRecovery(active,result.recoveryCodes);return;}await load(active);}
      catch(err){error.textContent=translateError(err);error.hidden=false;}
      finally{if(form.isConnected){form.dataset.busy='';button.disabled=false;}}
    };
  }
  function showRecovery(active,codes){
    let saved=false;const download=()=>{const blob=new Blob([codes.join('\n')+'\n'],{type:'text/plain'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='salemax-platform-recovery-codes.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    active.innerHTML=`<h2>${t('Save your recovery codes','احفظ رموز الاسترداد')}</h2><p>${t('These codes are shown once. Store them privately before continuing. Each code works once.','تظهر هذه الرموز مرة واحدة. احفظها في مكان آمن قبل المتابعة. يعمل كل رمز مرة واحدة.')}</p><pre class="sx-staff-card">${esc(codes.join('\n'))}</pre><div class="sx-staff-actions"><button type="button" data-download>${t('Download codes','تنزيل الرموز')}</button><label><input type="checkbox" data-saved> ${t('I saved my recovery codes','حفظت رموز الاسترداد')}</label><button class="primary" type="button" data-continue disabled>${t('Continue','متابعة')}</button></div>`;
    active.querySelector('[data-download]').onclick=download;active.querySelector('[data-saved]').onchange=event=>{saved=event.target.checked;active.querySelector('[data-continue]').disabled=!saved;};active.querySelector('[data-continue]').onclick=()=>{if(saved){codes=[];load(active);}};
  }
  function linkText(invitation){return location.origin+'/admin/login#staff-invite='+encodeURIComponent(invitation.token);}
  async function copyLink(invitation,message){const link=linkText(invitation);try{await navigator.clipboard.writeText(link);}catch(_){const input=document.createElement('textarea');input.value=link;input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();document.execCommand('copy');input.remove();}message.textContent=t('One-time setup link copied. Share it with the invited staff member using your approved channel; it expires in 72 hours.','تم نسخ رابط الإعداد لمرة واحدة. شاركه مع الموظف المدعو عبر القناة المعتمدة؛ تنتهي صلاحيته خلال 72 ساعة.');message.hidden=false;}
  function permissionOptions(selected=[],all=[]){return all.map(key=>`<label><input type="checkbox" name="permissions" value="${esc(key)}" ${selected.includes(key)?'checked':''}>${esc(t(permissions[key]?.[0]||key,permissions[key]?.[1]||key))}</label>`).join('');}
  function render(active,data){
    const available=data.availablePermissions||Object.keys(permissions);
    active.innerHTML=`<h2 tabindex="-1">${t('Platform staff access','صلاحيات موظفي المنصة')}</h2><p>${t('Invite staff with specific SaleMaX administration permissions. Only the Super Admin can grant or change access. Invitations do not receive owner-only powers.','ادعُ الموظفين بصلاحيات محددة لإدارة SaleMaX. يمكن للمسؤول الأعلى فقط منح الصلاحيات أو تغييرها. لا يحصل المدعوون على صلاحيات المالك.')}</p><div data-message class="sx-staff-success" role="status" hidden></div><div data-error class="sx-staff-alert" role="alert" hidden></div><div class="sx-staff-stack"><section class="sx-staff-card"><h3>${t('Invite a staff member','دعوة موظف')}</h3><form data-invite><div class="sx-staff-fields"><label>${t('Work email','بريد العمل')}<input name="email" type="email" autocomplete="email" required maxlength="254"></label></div><p class="sx-staff-muted">${t('A private setup link will be created for you to copy. No email is sent by this screen.','سيُنشأ رابط إعداد خاص لنسخه. لا ترسل هذه الشاشة بريدًا إلكترونيًا.')}</p><fieldset><legend>${t('Allowed platform permissions','صلاحيات المنصة المسموحة')}</legend><div class="sx-staff-permissions">${permissionOptions([],available)}</div></fieldset><div class="sx-staff-actions"><button type="submit" class="primary">${t('Create staff invitation','إنشاء دعوة موظف')}</button></div></form><div data-link class="sx-staff-success" role="status" hidden><p>${t('The one-time setup link is ready. Copy it now; it cannot be retrieved later.','رابط الإعداد لمرة واحدة جاهز. انسخه الآن؛ لا يمكن استرجاعه لاحقًا.')}</p><button type="button" data-copy>${t('Copy setup link','نسخ رابط الإعداد')}</button><code data-link-value></code></div></section><section class="sx-staff-card"><h3>${t('Current staff','الموظفون الحاليون')}</h3><div data-staff></div></section><section class="sx-staff-card"><h3>${t('Pending invitations','الدعوات المعلقة')}</h3><div data-invitations></div></section><div class="sx-staff-actions"><button type="button" data-reload>${t('Reload staff','إعادة تحميل الموظفين')}</button><button type="button" data-back>${t('Back to Manage Users','العودة إلى إدارة المستخدمين')}</button></div></div>`;
    const message=active.querySelector('[data-message]'),errorBox=active.querySelector('[data-error]');let freshInvite=null;
    const showError=error=>{errorBox.textContent=translateError(error);errorBox.hidden=false;message.hidden=true;};
    const showMessage=text=>{message.textContent=text;message.hidden=false;errorBox.hidden=true;};
    const updateStaff=async(identityId,form)=>{const button=form.querySelector('[type=submit]');button.disabled=true;try{await api('/api/admin/platform-access/staff/'+encodeURIComponent(identityId),{method:'PATCH',csrf:await csrf(),body:{active:form.elements.active.checked,permissions:[...form.querySelectorAll('input[name=permissions]:checked')].map(node=>node.value)}});showMessage(t('Staff access updated. Existing platform sessions were revoked.','تم تحديث صلاحيات الموظف وإلغاء جلسات المنصة الحالية.'));await load(active);}catch(err){showError(err);button.disabled=false;}};
    const renderStaff=()=>{const host=active.querySelector('[data-staff]');host.innerHTML=data.staff.length?data.staff.map(person=>`<article class="sx-staff-record"><div class="sx-staff-record-head"><strong>${esc(person.displayName||person.email)}</strong><span>${esc(person.email)} · <span class="sx-staff-status">${esc(person.accessStatus==='active'?t('Active','نشط'):t('Inactive','غير نشط'))}</span></span></div><form class="sx-staff-card" data-person="${esc(person.id)}"><label><input name="active" type="checkbox" ${person.accessStatus==='active'?'checked':''}> ${t('Allow platform sign-in','السماح بتسجيل دخول المنصة')}</label><div class="sx-staff-permissions">${permissionOptions(person.permissions,available)}</div><button class="primary" type="submit">${t('Save staff access','حفظ صلاحيات الموظف')}</button></form></article>`).join(''):`<div class="sx-staff-empty">${t('No staff accounts yet. Invite your first staff member above.','لا توجد حسابات موظفين بعد. ادعُ أول موظف من الأعلى.')}</div>`;
      host.querySelectorAll('form[data-person]').forEach(form=>form.onsubmit=event=>{event.preventDefault();if(!form.dataset.busy){form.dataset.busy='1';updateStaff(form.dataset.person,form).finally(()=>{if(form.isConnected)form.dataset.busy='';});}});
    };
    const renderInvites=()=>{const host=active.querySelector('[data-invitations]');host.innerHTML=data.invitations.length?`<div class="sx-staff-table-wrap"><table class="sx-staff-table"><thead><tr><th>${t('Email','البريد')}</th><th>${t('Permissions','الصلاحيات')}</th><th>${t('Status / expiry','الحالة / الانتهاء')}</th><th>${t('Actions','الإجراءات')}</th></tr></thead><tbody>${data.invitations.map(invite=>{const expired=new Date(invite.expiresAt).getTime()<=Date.now(),status=expired?t('Expired','منتهية'):t('Pending','معلقة');return `<tr><td>${esc(invite.email)}</td><td>${invite.permissions.map(key=>esc(t(permissions[key]?.[0]||key,permissions[key]?.[1]||key))).join('<br>')||'—'}</td><td>${status}<br>${esc(new Date(invite.expiresAt).toLocaleString(ar()?'ar-QA':'en-QA',{timeZone:'Asia/Qatar'}))}</td><td><button type="button" data-resend="${esc(invite.id)}">${t('Create new link','إنشاء رابط جديد')}</button> <button type="button" data-cancel="${esc(invite.id)}">${t('Cancel','إلغاء')}</button></td></tr>`;}).join('')}</tbody></table></div>`:`<div class="sx-staff-empty">${t('There are no pending staff invitations.','لا توجد دعوات موظفين معلقة.')}</div>`;
      host.querySelectorAll('[data-resend]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{freshInvite=(await api('/api/admin/platform-access/staff/invitations/'+button.dataset.resend+'/resend',{method:'POST',csrf:await csrf()})).data;const box=active.querySelector('[data-link]');box.hidden=false;box.querySelector('[data-link-value]').textContent=linkText(freshInvite);box.querySelector('[data-copy]').onclick=()=>copyLink(freshInvite,box);await load(active);}catch(err){showError(err);button.disabled=false;}});
      host.querySelectorAll('[data-cancel]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api('/api/admin/platform-access/staff/invitations/'+button.dataset.cancel+'/cancel',{method:'POST',csrf:await csrf()});showMessage(t('Invitation cancelled. Its setup link can no longer be used.','تم إلغاء الدعوة. لم يعد بالإمكان استخدام رابط الإعداد.'));await load(active);}catch(err){showError(err);button.disabled=false;}});
    };
    renderStaff();renderInvites();
    const inviteForm=active.querySelector('[data-invite]');inviteForm.onsubmit=async event=>{event.preventDefault();if(inviteForm.dataset.busy)return;inviteForm.dataset.busy='1';const button=inviteForm.querySelector('[type=submit]');button.disabled=true;errorBox.hidden=true;message.hidden=true;
      try{freshInvite=(await api('/api/admin/platform-access/staff/invitations',{method:'POST',csrf:await csrf(),body:{email:inviteForm.elements.email.value,permissions:[...inviteForm.querySelectorAll('input[name=permissions]:checked')].map(node=>node.value)}})).data;const box=active.querySelector('[data-link]');box.hidden=false;box.querySelector('[data-link-value]').textContent=linkText(freshInvite);box.querySelector('[data-copy]').onclick=()=>copyLink(freshInvite,box);inviteForm.reset();showMessage(t('Invitation created. Share the one-time link with the staff member.','تم إنشاء الدعوة. شارك الرابط لمرة واحدة مع الموظف.'));await load(active);}
      catch(err){showError(err);}
      finally{if(inviteForm.isConnected){inviteForm.dataset.busy='';button.disabled=false;}}
    };
    active.querySelector('[data-reload]').onclick=()=>load(active);active.querySelector('[data-back]').onclick=close;active.querySelector('h2').focus();
  }
  async function csrf(){const data=await api('/api/admin/platform-auth/me');if(data.mfaRequired)throw Object.assign(new Error(),{code:'MFA_REQUIRED'});return data.csrfToken;}
  async function load(active){
    if(editor!==active||!active.isConnected)return;
    active.dir=ar()?'rtl':'ltr';active.innerHTML=`<h2>${t('Platform staff access','صلاحيات موظفي المنصة')}</h2><div class="sx-staff-empty" role="status">${t('Loading staff and permissions…','جارٍ تحميل الموظفين والصلاحيات…')}</div>`;
    try{const context=await currentContext();if(editor!==active)return;if(context.context?.membership?.role!=='super_admin'){active.innerHTML=`<h2>${t('Platform staff access','صلاحيات موظفي المنصة')}</h2><div class="sx-staff-alert" role="alert">${t('Only the Super Admin can manage staff.','يمكن للمسؤول الأعلى فقط إدارة الموظفين.')}</div><button type="button" data-back>${t('Back to users','العودة إلى المستخدمين')}</button>`;active.querySelector('[data-back]').onclick=close;return;}
      const result=await api('/api/admin/platform-access/staff');if(editor===active)render(active,result.data);
    }catch(error){if(editor!==active)return;if(error.code==='AUTH_REQUIRED'||error.code==='MFA_REQUIRED'){if(error.code==='AUTH_REQUIRED'){authenticate(active);return;}try{const context=await api('/api/admin/platform-auth/me');await verifyMfa(active,context.csrfToken);}catch(err){if(err.code==='MFA_ALREADY_ENROLLED'){const ctx=await api('/api/admin/platform-auth/me');await verifyMfa(active,ctx.csrfToken);}else if(err.code==='MFA_REQUIRED'){const ctx=await api('/api/admin/platform-auth/me');await verifyMfa(active,ctx.csrfToken);}else renderError(active,err);}return;}renderError(active,error);}
  }
  function renderError(active,error){active.innerHTML=`<h2>${t('Platform staff access','صلاحيات موظفي المنصة')}</h2><div class="sx-staff-alert" role="alert">${esc(translateError(error))}</div><div class="sx-staff-actions"><button type="button" data-retry>${t('Try again','حاول مرة أخرى')}</button><button type="button" data-back>${t('Back to users','العودة إلى المستخدمين')}</button></div>`;active.querySelector('[data-retry]').onclick=()=>load(active);active.querySelector('[data-back]').onclick=close;}
  function open(){
    const header=anchor();if(!header)return;close();returnFocus=document.activeElement;editor=document.createElement('section');editor.className='sx-platform-staff';editor.setAttribute('aria-label',t('Platform staff access','صلاحيات موظفي المنصة'));
    [...header.parentElement.children].forEach(child=>{if(child!==header){hidden.push([child,child.style.display]);child.style.display='none';}});header.after(editor);load(editor);
  }
  function mount(){
    if(location.pathname.toUpperCase()!=='/ADMIN'||new URLSearchParams(location.search).get('page')!=='manage-users'||!token())return;
    const header=anchor();if(!header)return;let button=header.querySelector('.sx-platform-staff-trigger');if(!button){button=document.createElement('button');button.type='button';button.className='sx-platform-staff-trigger';button.onclick=open;const refresh=[...header.querySelectorAll('button')].find(item=>['Refresh','تحديث'].includes(item.textContent.trim()));(refresh?.parentElement||header).appendChild(button);}
    const label=t('Platform staff','موظفو المنصة');if(button.textContent!==label)button.textContent=label;
  }
  inviteLogin();new MutationObserver(mount).observe(document.documentElement,{subtree:true,childList:true});mount();
})();
