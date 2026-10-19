(() => {
  'use strict';
  if (window.__sxTeamInvites) return;
  window.__sxTeamInvites = true;

  const isArabic = () => (localStorage.getItem('language') || localStorage.getItem('salemax-language') || '').toLowerCase().startsWith('ar');
  const label = (en, ar) => isArabic() ? ar : en;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const route = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'team-invitations';
  const roles = {
    accountant: ['Accountant', 'محاسب'],
    manager: ['Manager', 'مدير'],
    team_leader: ['Team Leader', 'قائد فريق'],
    agent: ['Agent', 'وكيل']
  };
  const seatTitles = {
    accountant: ['Accountant seats', 'مقاعد المحاسبين'],
    manager: ['Manager seats', 'مقاعد المديرين'],
    team_leader: ['Team Leader seats', 'مقاعد قادة الفرق'],
    agent: ['Agent seats', 'مقاعد الوكلاء']
  };
  let inviteToken = window.__sxTeamInviteToken || sessionStorage.getItem('sx_team_invite_token') || '';
  let ownerSetupToken = window.__sxBusinessOwnerSetupToken || sessionStorage.getItem('sx_business_owner_setup_token') || '';
  let currentTeamData = null;
  const permissionModules={products:['Products & services','المنتجات والخدمات'],deals:['Sales deals','صفقات المبيعات'],commissions:['Commissions','العمولات'],targets:['Targets','الأهداف'],tenant:['Business settings','إعدادات النشاط'],channels:['WhatsApp connections','اتصالات واتساب'],automation:['Automation','الأتمتة'],campaigns:['Campaigns','الحملات'],conversations:['Inbox','صندوق الوارد'],leads:['Lead pipeline','مسار العملاء المحتملين'],contacts:['Phonebook','دليل الهاتف'],courses:['Courses','الدورات'],sales:['Enrollments','التسجيلات'],invoices:['Invoices','الفواتير'],payments:['Payments','المدفوعات'],receipts:['Receipts','الإيصالات'],credits:['Credits and refunds','الإشعارات الدائنة والاسترداد'],reports:['Reports','التقارير'],forms:['Lead forms','نماذج العملاء المحتملين'],tasks:['Tasks','المهام'],calls:['Call center','مركز الاتصال'],team:['Team','الفريق'],templates:['Templates','القوالب']};
  const permissionActions={read:['View','عرض'],manage:['Manage','إدارة'],reply:['Reply','الرد'],configure:['Configure','إعداد'],send:['Send','إرسال'],assign:['Assign','تعيين'],request:['Request','طلب'],approve:['Approve','اعتماد'],issue:['Issue','إصدار'],verify:['Verify','تحقق'],prepare:['Prepare','إعداد'],schedule:['Schedule','جدولة'],capture:['Capture','إدخال']};
  try { delete window.__sxTeamInviteToken; sessionStorage.removeItem('sx_team_invite_token'); } catch (_) {}
  try { delete window.__sxBusinessOwnerSetupToken; } catch (_) {}
  if (!inviteToken && route()) inviteToken = new URLSearchParams(location.hash.slice(1)).get('team-invite') || '';
  if (inviteToken) history.replaceState(null, '', location.pathname + location.search);
  if (ownerSetupToken) history.replaceState(null, '', location.pathname + location.search);

  const css = document.createElement('style');
  css.textContent = `#sx-team-screen{position:fixed;z-index:1200;inset:64px 0 0 250px;background:#f5f7fa;overflow:auto;padding:24px;box-sizing:border-box;font:14px/1.5 Roboto,Arial,sans-serif;color:#17212f}#sx-team-screen[dir=rtl]{inset-inline:250px 0}#sx-team-screen[data-accept="1"]{z-index:2147483000;inset:0!important;padding:24px!important}#sx-team-screen .wrap{max-width:1100px;margin:auto}#sx-team-screen h1{font-size:24px;margin:0 0 6px}#sx-team-screen h2{font-size:18px;margin:0 0 12px}#sx-team-screen p{color:#667085}#sx-team-screen .card{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:18px;margin:16px 0;box-shadow:0 3px 12px #1018280a}#sx-team-screen form{display:grid;grid-template-columns:2fr 1fr auto;gap:10px;align-items:end}#sx-team-screen label{display:grid;gap:6px;font-weight:600}#sx-team-screen input,#sx-team-screen select{min-height:42px;border:1px solid #cfd5dd;border-radius:8px;padding:8px 10px;font:inherit;background:white;color:inherit}#sx-team-screen button{min-height:40px;padding:8px 13px;border:1px solid #d0d5dd;border-radius:8px;background:white;cursor:pointer;color:inherit;font:inherit}#sx-team-screen button.primary{background:#a8003b;border-color:#a8003b;color:white}#sx-team-screen button:disabled{opacity:.55;cursor:not-allowed}#sx-team-screen .row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid #eaecf0;padding:13px 0}#sx-team-screen .actions{display:flex;gap:8px;flex-wrap:wrap}#sx-team-screen .notice{padding:12px;border-radius:8px;background:#ecfdf3;overflow-wrap:anywhere}#sx-team-screen .error{background:#fff1f0;color:#b42318;padding:12px;border-radius:8px}#sx-team-screen .muted{font-size:12px;color:#667085}#sx-team-screen .seat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}#sx-team-screen .seat-card{border:1px solid #e4e7ec;border-radius:10px;padding:14px}#sx-team-screen .seat-card strong{display:block;margin-bottom:8px}#sx-team-screen .seat-metrics{display:flex;flex-wrap:wrap;gap:6px 14px;color:#475467;font-size:12px}#sx-team-screen .member-card{border:1px solid #e4e7ec;border-radius:10px;padding:16px;margin:12px 0}#sx-team-screen .member-head{display:flex;justify-content:space-between;gap:12px;align-items:center}#sx-team-screen .nav-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px 0}#sx-team-screen .nav-option{display:flex;align-items:flex-start;gap:9px;padding:9px;border:1px solid #eaecf0;border-radius:8px;font-weight:400}#sx-team-screen .nav-option input{min-height:18px;width:18px;margin:2px 0 0;accent-color:#a8003b}#sx-team-screen .nav-group{grid-column:1/-1;margin:8px 0 0;color:#667085;font-size:12px;font-weight:700}#sx-team-screen code{overflow-wrap:anywhere}#sx-team-screen .accept-meta{padding:12px;background:#f8f9fc;border-radius:8px;margin:12px 0}#sx-team-screen .accept-form{grid-template-columns:1fr!important;max-width:560px}#sx-team-screen :focus-visible{outline:3px solid #7b2cbf;outline-offset:2px}@media(max-width:1000px){#sx-team-screen .nav-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){#sx-team-screen,#sx-team-screen[dir=rtl]{inset-inline:0;top:56px;padding:16px}#sx-team-screen[data-accept="1"]{inset:0!important;padding:16px!important}#sx-team-screen form{grid-template-columns:1fr}#sx-team-screen .row{align-items:flex-start;flex-direction:column}#sx-team-screen .seat-grid{grid-template-columns:1fr}#sx-team-screen .nav-grid{grid-template-columns:1fr}#sx-team-screen .member-head{align-items:flex-start;flex-direction:column}}`;
  css.textContent += `#sx-team-screen .role-form{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}#sx-team-screen .role-description,#sx-team-screen .permission-fieldset{grid-column:1/-1}#sx-team-screen .permission-fieldset{min-width:0;border:1px solid #e4e7ec;border-radius:10px;padding:12px}#sx-team-screen .permission-fieldset legend{padding:0 6px;font-weight:700}#sx-team-screen .permission-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}#sx-team-screen .permission-group{grid-column:1/-1;margin-top:8px;color:#667085;font-weight:700}#sx-team-screen .permission-option{display:flex;align-items:center;gap:8px;border:1px solid #eaecf0;border-radius:8px;padding:8px;font-weight:400}#sx-team-screen .permission-option input{min-height:18px;width:18px;margin:0;accent-color:#a8003b}#sx-team-screen .role-row{display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid #eaecf0;padding:12px 0}#sx-team-screen .role-actions{display:flex;gap:8px;flex-wrap:wrap}#sx-team-screen .member-role-assignment{display:flex;align-items:end;gap:8px;flex-wrap:wrap}#sx-team-screen .member-role-assignment label{min-width:220px}#sx-team-screen .member-role-assignment select{min-width:220px}@media(max-width:1000px){#sx-team-screen .permission-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){#sx-team-screen .role-form,#sx-team-screen .permission-grid{grid-template-columns:1fr}#sx-team-screen .role-row{align-items:flex-start;flex-direction:column}}`;
  css.textContent += `#sx-team-screen[data-sales-category="salemax_sales"] :focus-visible{outline-color:#a8003b}`;
  css.textContent += `#sx-team-screen form.qr-channel-form{grid-template-columns:minmax(0,1fr)}#sx-team-screen form.qr-channel-form .member-head,#sx-team-screen form.qr-channel-form .nav-grid{grid-column:1}`;
  css.textContent += `#sx-sales-org-content .org-row{display:grid;grid-template-columns:minmax(180px,1fr) minmax(250px,1.2fr) auto;gap:12px;align-items:center;border-top:1px solid #eaecf0;padding:14px 0}#sx-sales-org-content .org-role{display:block;color:#667085;font-size:12px}#sx-sales-org-content .org-assignment{display:grid;grid-template-columns:repeat(2,minmax(150px,1fr));gap:8px}#sx-sales-org-content .org-assignment label{font-size:12px}#sx-sales-org-content .org-assignment input,#sx-sales-org-content .org-assignment select{min-height:36px;font-size:13px}#sx-sales-org-content .org-readonly{grid-column:1/-1;color:#667085;font-size:13px}#sx-sales-org-content .org-reason{grid-column:1/-1}#sx-sales-org-content .org-row button{white-space:nowrap}@media(max-width:760px){#sx-sales-org-content .org-row,#sx-sales-org-content .org-assignment{grid-template-columns:1fr}}`;
  document.head.append(css);

  const getToken = () => localStorage.getItem('wacrm_user');
  async function api(url, options = {}) {
    const headers = {'Content-Type':'application/json'};
    if (!options.public) {
      const token = options.token || getToken();
      if (!token) throw new Error('AUTH_REQUIRED');
      headers.Authorization = 'Bearer ' + token;
    }
    const response = await fetch(url, {method:options.method || 'GET', credentials:'same-origin', headers, body:options.body ? JSON.stringify(options.body) : undefined});
    let result;
    try { result = await response.json(); } catch (_) { throw new Error('SERVER_ERROR'); }
    if (!response.ok || result.success === false) throw new Error(result.code || 'REQUEST_FAILED');
    return result.data;
  }
  function screen() {
    let node = document.getElementById('sx-team-screen');
    if (!node) { node = document.createElement('section'); node.id = 'sx-team-screen'; node.setAttribute('aria-live','polite'); document.body.append(node); }
    node.dir = label('ltr','rtl');
    return node;
  }
  const accountKey='sx_owner_account_return';
  async function clearInboxCache(){
    for(const key of ['chatList','conversationArr','labelData','phonebookData','agentData','chatBots','chatInfo','chatNote','cdTimer','currentChat','loadingChats','hasMoreChats','loadingConversation','hasMoreMessages','chatFilters','conversationFilters'])localStorage.removeItem(key);
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open('whatscrm_db',1);
      request.onerror=()=>reject(new Error('CACHE_CLEAR_FAILED'));
      request.onsuccess=()=>{
        const db=request.result;if(!db.objectStoreNames.contains('cache')){db.close();resolve();return;}
        const transaction=db.transaction('cache','readwrite');transaction.objectStore('cache').clear();
        transaction.oncomplete=()=>{db.close();resolve();};transaction.onerror=transaction.onabort=()=>{db.close();reject(new Error('CACHE_CLEAR_FAILED'));};
      };
    });
  }
  let checkingChatAccess=false;
  async function checkOpenChatAccess(){
    const agent=location.pathname.startsWith('/agent');
    const token=agent?localStorage.getItem('wacrm_agent'):getToken();
    const page=new URLSearchParams(location.search).get('page');
    const inbox=agent?(page===null||page==='chat'):page==='inbox';
    if(checkingChatAccess||!inbox||!token)return;
    let chat;try{chat=JSON.parse(localStorage.getItem('currentChat')||'null');}catch{return;}
    if(!chat?.chat_id)return;
    checkingChatAccess=true;
    try{
      const result=await api((agent?'/api/agent/invitations':'/api/user/team-invitations')+'/conversation-access?chatId='+encodeURIComponent(chat.chat_id),{token});
      const current=JSON.parse(localStorage.getItem('currentChat')||'null');
      if(result.assignedOnly&&!result.allowed&&current?.chat_id===chat.chat_id){
        await clearInboxCache();
        location.replace(agent?'/agent?page=chat':'/user?page=inbox');
      }
    }catch{/* Network errors do not erase a conversation; server authorization remains authoritative. */}
    finally{checkingChatAccess=false;}
  }
  window.setInterval(checkOpenChatAccess,3000);
  async function loginAs(member,button){
    button.disabled=true;
    try{
      const ownerToken=getToken();
      await clearInboxCache();
      const result=await api('/api/user/team-invitations/members/'+encodeURIComponent(member.id)+'/login-as',{method:'POST',body:{}});
      sessionStorage.setItem(accountKey,JSON.stringify({ownerToken,staffToken:result.token,sessionId:result.sessionId,name:member.displayName||member.email}));
      localStorage.setItem('wacrm_user',result.token);
      location.assign('/user?page='+(member.role==='manager'?'inbox':'dashboard'));
    }catch(error){nodeMessage(document.getElementById('sx-team-list'),errorText(error.message),true);button.disabled=false;}
  }
  function accountBanner(){
    let saved;try{saved=JSON.parse(sessionStorage.getItem(accountKey)||'null');}catch{sessionStorage.removeItem(accountKey);}
    if(!saved||saved.staffToken!==getToken()||document.getElementById('sx-account-return'))return;
    const banner=document.createElement('aside');banner.id='sx-account-return';banner.setAttribute('role','status');
    banner.style.cssText='position:fixed;bottom:18px;right:18px;z-index:1600;background:#fff;border:2px solid #a8003b;border-radius:12px;padding:12px;box-shadow:0 4px 20px #0002;max-width:calc(100vw - 36px)';
    const text=document.createElement('span');text.textContent=label('Logged in as ','تم تسجيل الدخول باسم ')+saved.name+' · ';
    const button=document.createElement('button');button.type='button';button.textContent=label('Return to owner','العودة إلى المالك');
    button.onclick=async()=>{
      button.disabled=true;
      try{
        await api('/api/user/team-invitations/return-owner',{method:'POST',token:saved.ownerToken,body:{sessionId:saved.sessionId}});
        await clearInboxCache();
        localStorage.setItem('wacrm_user',saved.ownerToken);sessionStorage.removeItem(accountKey);location.assign('/user?page=team-invitations');
      }catch(error){text.textContent=label('Could not restore owner session. Please sign in again. ','تعذر استعادة جلسة المالك. يرجى تسجيل الدخول مجدداً. ');button.disabled=false;}
    };
    banner.append(text,button);document.body.append(banner);
  }
  function roleLabel(role) { const pair = roles[role] || [role, role]; return label(pair[0], pair[1]); }
  function permissionGroup(key){const prefix=key.split('.')[0];return permissionModules[prefix]||[prefix,prefix];}
  function permissionTitle(key){const action=key.split('.').at(-1);return label(permissionActions[action]?.[0]||action.replaceAll('_',' '),permissionActions[action]?.[1]||action.replaceAll('_',' '));}
  function errorText(code) {
    return ({
      AUTH_REQUIRED: label('Sign in as the business owner to manage invitations.','سجّل دخولك بصفتك مالك النشاط لإدارة الدعوات.'),
      SEAT_LIMIT_EXCEEDED: label('No seats are available for this role on the assigned plan.','لا توجد مقاعد متاحة لهذا الدور في الباقة المعينة.'),
      TEAM_FEATURE_UNAVAILABLE: label('Team invitations are not enabled on the current plan.','دعوات الفريق غير مفعلة في الباقة الحالية.'),
      FEATURE_UNAVAILABLE: label('Team invitations are not enabled on the current plan.','دعوات الفريق غير مفعلة في الباقة الحالية.'),
      INVALID_ROLE: label('Choose an available team role.','اختر دوراً متاحاً للفريق.'),
      INVALID_ROLE_NAME: label('Enter a role name up to 80 characters.','أدخل اسماً للدور لا يتجاوز 80 حرفاً.'),
      INVALID_ROLE_DESCRIPTION: label('Role description is too long.','وصف الدور طويل جداً.'),
      INVALID_ROLE_PERMISSIONS: label('One or more permissions are unavailable for this seat type. Reload and try again.','إحدى الصلاحيات غير متاحة لهذا النوع من المقاعد. أعد تحميل الصفحة وحاول مرة أخرى.'),
      ROLE_NAME_EXISTS: label('A role with this name already exists.','يوجد دور بهذا الاسم بالفعل.'),
      ROLE_NOT_FOUND: label('This role is no longer available. Reload the page.','هذا الدور لم يعد متاحاً. أعد تحميل الصفحة.'),
      ROLE_ARCHIVED: label('This role is archived. Create or select an active role.','هذا الدور مؤرشف. أنشئ دوراً نشطاً أو اختره.'),
      ROLE_IN_USE: label('This role has a pending invitation. Cancel or let it expire before archiving.','هذا الدور مرتبط بدعوة معلقة. ألغها أو انتظر انتهاء صلاحيتها قبل الأرشفة.'),
      TEAM_ROLE_ROUTE_UNMAPPED: label('This legacy action has no role-permission mapping yet, so it was blocked. Contact the business owner.','لم يتم ربط هذا الإجراء القديم بصلاحية دور، لذلك تم منعه. تواصل مع مالك النشاط.'),
      TEAM_ROLE_PERMISSION_DENIED: label('Your role does not allow this action.','دورك لا يسمح بهذا الإجراء.'),
      TEAM_ROLE_ACCESS_UNAVAILABLE: label('Role access could not be checked. Try again shortly.','تعذر التحقق من صلاحيات الدور. حاول مرة أخرى بعد قليل.'),
      INVALID_ROLE_NAME: label('Enter a role name up to 80 characters.','أدخل اسماً للدور لا يتجاوز 80 حرفاً.'),
      INVALID_ROLE_DESCRIPTION: label('Role description is too long.','وصف الدور طويل جداً.'),
      INVALID_ROLE_PERMISSIONS: label('One or more permissions are unavailable for this seat type. Reload and try again.','إحدى الصلاحيات غير متاحة لهذا النوع من المقاعد. أعد تحميل الصفحة وحاول مرة أخرى.'),
      ROLE_NAME_EXISTS: label('A role with this name already exists.','يوجد دور بهذا الاسم بالفعل.'),
      ROLE_NOT_FOUND: label('This role is no longer available. Reload the page.','هذا الدور لم يعد متاحاً. أعد تحميل الصفحة.'),
      ROLE_ARCHIVED: label('This role is archived. Create or select an active role.','هذا الدور مؤرشف. أنشئ دوراً نشطاً أو اختره.'),
      ROLE_IN_USE: label('This role is assigned to a team member or pending invitation. Reassign them before archiving it.','هذا الدور مرتبط بعضو فريق أو دعوة معلقة. أعد التعيين قبل أرشفته.'),
      INVALID_ROLE_NAVIGATION: label('Select available sidebar screens and their View action.','اختر شاشات متاحة للقائمة وإجراء العرض الخاص بها.'),
      INVALID_NAVIGATION: label('The sidebar selection is invalid. Reload and try again.','اختيار القائمة غير صالح. أعد التحميل وحاول مرة أخرى.'),
      NAVIGATION_NOT_AVAILABLE: label('One or more sections are unavailable for this role or plan. Reload the team list and try again.','قسم واحد أو أكثر غير متاح لهذا الدور أو الباقة. أعد تحميل قائمة الفريق وحاول مرة أخرى.'),
      MEMBER_NOT_FOUND: label('This team member is no longer active. Reload the list.','عضو الفريق هذا لم يعد نشطاً. أعد تحميل القائمة.'),
      INVITE_INVALID: label('This link is invalid, expired or already used. Ask the owner to create a new invitation.','الرابط غير صالح أو منتهي أو مستخدم. اطلب من المالك إنشاء دعوة جديدة.'),
      ORIGIN_DENIED: label('Request origin could not be verified. Reload the page and retry.','تعذر التحقق من مصدر الطلب. أعد تحميل الصفحة وحاول مرة أخرى.'),
      MEMBERSHIP_EXISTS: label('This email already has an account. Ask the business owner to manage access.','هذا البريد لديه حساب بالفعل. اطلب من مالك النشاط إدارة الوصول.'),
      INVALID_PASSWORD: label('Use at least 12 characters and no more than 72 UTF-8 bytes for the password.','استخدم 12 حرفاً على الأقل ولا تتجاوز 72 بايت لكلمة المرور.'),
      INVALID_DISPLAY_NAME: label('Enter the full name for the new account.','أدخل الاسم الكامل للحساب الجديد.'),
      INVALID_MOBILE: label('Enter a phone number in international format, such as +97450123456.','أدخل رقم الهاتف بالصيغة الدولية، مثل ‎+97450123456.'),
      INVALID_MANAGER: label('Select an active Sales Manager.','اختر مدير مبيعات نشطاً.'),
      INVALID_TEAM_LEADER: label('Select an active Team Leader.','اختر قائد فريق نشطاً.'),
      TEAM_LEADER_OUTSIDE_MANAGER: label('The Team Leader does not report to that manager.','قائد الفريق لا يتبع هذا المدير.'),
      TEAM_LEADER_ASSIGNMENT_INVALID: label('The organisation assignment is not valid for this role.','تعيين الهيكل غير صالح لهذا الدور.'),
      FEATURE_UNAVAILABLE: label('This workspace feature is not enabled for the account.','هذه الميزة غير مفعلة للحساب.'),
      INVALID_REASON: label('Enter a reason with at least three characters.','أدخل سبباً لا يقل عن ثلاثة أحرف.')
    })[code] || label('Could not complete the request. Please retry.','تعذر إكمال الطلب. يرجى المحاولة مجدداً.');
  }

  async function load() {
    const node = screen();
    node.innerHTML = `<div class="wrap sx-team-workspace">
      <header class="team-hero"><div><div class="eyebrow">${label('Business settings · Team','إعدادات النشاط · الفريق')}</div><h1>${label('Team access','إدارة وصول الفريق')}</h1><p>${label('Manage your team, roles and WhatsApp access.','إدارة الفريق والأدوار وصلاحيات واتساب.')}</p></div><button type="button" class="primary" id="sx-open-invite">${label('＋ Add team member','＋ إضافة عضو للفريق')}</button></header>
      <div id="sx-team-msg" role="status" aria-live="polite"></div><div id="sx-team-stats" class="team-stats" aria-label="${label('Team summary','ملخص الفريق')}"></div>
      <nav class="team-tabs" role="tablist" aria-label="${label('Team access sections','أقسام إدارة الفريق')}">
        <button type="button" role="tab" aria-selected="true" data-team-tab="members">${label('Team members','أعضاء الفريق')}</button><button type="button" role="tab" aria-selected="false" data-team-tab="roles">${label('Roles & permissions','الأدوار والصلاحيات')}</button><button type="button" role="tab" aria-selected="false" data-team-tab="whatsapp">${label('WhatsApp access','صلاحية واتساب')}</button>
      </nav>
      <section class="team-panel active" role="tabpanel" data-team-panel="members"><div class="team-content-grid"><main>
        <div class="card section-card"><div class="section-heading"><div><h2>${label('Team members','أعضاء الفريق')}</h2><p class="muted">${label('View and manage your team members, their roles and access.','عرض أعضاء الفريق وإدارة أدوارهم وصلاحياتهم.')}</p></div></div>
          <div class="member-toolbar"><label class="search-box"><span aria-hidden="true">⌕</span><input id="sx-member-search" type="search" placeholder="${label('Search team members…','ابحث عن أعضاء الفريق…')}" aria-label="${label('Search team members','ابحث عن أعضاء الفريق')}"></label><label><span class="sr-only">${label('Filter by role','تصفية حسب الدور')}</span><select id="sx-role-filter"><option value="">${label('All roles','كل الأدوار')}</option>${Object.entries(roles).map(([key,value])=>`<option value="${key}">${label(value[0],value[1])}</option>`).join('')}</select></label></div>
          <div id="sx-team-members">${label('Loading team members…','جارٍ تحميل أعضاء الفريق…')}</div>
        </div>
        <div class="card section-card whatsapp-summary" id="sx-whatsapp-summary"><div class="section-heading"><div><h2>${label('WhatsApp access','صلاحية واتساب')}</h2><p class="muted">${label('Connected WhatsApp channels and team access.','قنوات واتساب المتصلة وصلاحيات وصول الفريق.')}</p></div><button type="button" class="primary" id="sx-manage-whatsapp">${label('Manage access','إدارة الصلاحيات')}</button></div><div id="sx-whatsapp-summary-content" class="whatsapp-summary-content">${label('Loading WhatsApp connections…','جارٍ تحميل اتصالات واتساب…')}</div></div>
        <div class="card section-card" id="sx-sales-org-card" hidden><h2>${label('Organisation','الهيكل التنظيمي')}</h2><p class="muted">${label('Managers own teams; Team Leaders and Agents keep an auditable reporting path.','يدير مديرو المبيعات فرقهم، مع حفظ مسار إسناد قادة الفرق والوكلاء.')}</p><div id="sx-sales-org-content">${label('Loading organisation…','جارٍ تحميل الهيكل التنظيمي…')}</div></div>
        <div class="card section-card"><h2>${label('Plan seat usage','استخدام مقاعد الباقة')}</h2><p class="muted">${label('Active and pending team seats on your current plan.','المقاعد النشطة والمعلقة ضمن باقتك الحالية.')}</p><div id="sx-team-seat-usage" class="seat-grid">${label('Loading seat usage…','جارٍ تحميل المقاعد…')}</div></div>
        <div class="card section-card"><h2>${label('Invitations','الدعوات')}</h2><div id="sx-team-list">${label('Loading…','جارٍ التحميل…')}</div></div>
      </main><aside class="card hierarchy-card"><h2>${label('Organisation hierarchy','الهيكل التنظيمي')}</h2><p class="muted">${label('Your team structure and reporting lines.','هيكل الفريق وخطوط الإشراف.')}</p><div class="hierarchy-node admin-node"><strong>${label('Admin','المسؤول')}</strong><span>${label('Full account access','صلاحية كاملة للحساب')}</span></div><div class="hierarchy-connector"></div><div class="hierarchy-node manager-node"><strong>${label('Manager','المدير')}</strong><span>${label('Manages the team and WhatsApp access','يدير الفريق وصلاحيات واتساب')}</span></div><div class="hierarchy-branches"><div class="hierarchy-node role-node"><strong>${label('Accountant','محاسب')}</strong><span>${label('Finance and accounting','المالية والمحاسبة')}</span></div><div class="hierarchy-node role-node"><strong>${label('Agents','الوكلاء')}</strong><span>${label('Sales, leads and conversations','المبيعات والعملاء والمحادثات')}</span></div></div><div class="hierarchy-note">ⓘ ${label('Managers can share assigned QR numbers with team members below them.','يمكن للمدير مشاركة أرقام QR المسندة إليه مع أعضاء الفريق التابعين له.')}</div></aside></div></section>
      <section class="team-panel" role="tabpanel" data-team-panel="roles" hidden><div class="card section-card"><div class="section-heading"><div><h2>${label('Roles & permissions','الأدوار والصلاحيات')}</h2><p class="muted">${label('Create roles from available seat types. Permissions are enforced by the server.','أنشئ أدواراً من أنواع المقاعد المتاحة. يفرض الخادم الصلاحيات المحددة.')}</p></div><button type="button" class="primary" id="sx-open-role">${label('＋ Create role','＋ إنشاء دور')}</button></div><div id="sx-role-list">${label('Loading roles…','جارٍ تحميل الأدوار…')}</div></div></section>
      <section class="team-panel" role="tabpanel" data-team-panel="whatsapp" hidden><div class="card section-card" id="sx-qr-access-card"><div class="section-heading"><div><h2>${label('WhatsApp access','صلاحية واتساب')}</h2><p class="muted">${label('Connected WhatsApp channels and team access.','قنوات واتساب المتصلة وصلاحيات وصول الفريق.')}</p></div></div><div id="sx-qr-channels">${label('Loading WhatsApp connections…','جارٍ تحميل اتصالات واتساب…')}</div></div></section>
      <dialog id="sx-invite-dialog" class="team-dialog"><div class="dialog-heading"><div><h2>${label('Add team member','إضافة عضو للفريق')}</h2><p class="muted">${label('Create an active account now, or prepare an invitation link.','أنشئ حساباً نشطاً الآن، أو جهّز رابط دعوة.')}</p></div><button type="button" class="icon-button" data-close-dialog="sx-invite-dialog" aria-label="${label('Close','إغلاق')}">×</button></div><form id="sx-team-form"><label class="creation-mode">${label('How to add this member','طريقة إضافة العضو')}<select name="creationMode"><option value="account">${label('Create account now','إنشاء حساب الآن')}</option><option value="invitation">${label('Create invitation link','إنشاء رابط دعوة')}</option></select></label><div id="sx-create-error" class="creation-error" role="alert" aria-live="assertive" tabindex="-1" hidden></div><label>${label('Email address','البريد الإلكتروني')}<input name="email" type="email" required maxlength="254" autocomplete="email"></label><label>${label('Assign role','تعيين الدور')}<select name="assignment" required aria-label="${label('Assign role','تعيين الدور')}"></select></label><label>${label('Initial password (at least 12 characters)','كلمة المرور الأولية (12 حرفاً على الأقل)')}<input name="temporaryPassword" type="password" required minlength="12" maxlength="72" autocomplete="new-password" aria-describedby="sx-password-help"></label><label>${label('Full name','الاسم الكامل')}<input name="displayName" maxlength="200" autocomplete="name"></label><label>${label('Mobile (required for agents)','الجوال (مطلوب للوكلاء)')}<input name="mobile" type="tel" autocomplete="tel" placeholder="+97450123456"></label><p id="sx-password-help" class="muted">${label('Leave password blank to send a setup invitation. Enter at least 12 characters to create an active account now.','اترك كلمة المرور فارغة لإرسال دعوة إعداد. أدخل 12 حرفاً على الأقل لإنشاء حساب نشط الآن.')}</p><div class="dialog-actions"><button type="button" data-close-dialog="sx-invite-dialog">${label('Cancel','إلغاء')}</button><button type="submit" class="primary" disabled>${label('Create invitation','إنشاء دعوة')}</button></div></form><p id="sx-invitation-note" class="muted" hidden>${label('The one-time invitation link is shown once. Send it using your approved channel.','يظهر رابط الدعوة لمرة واحدة. أرسله عبر القناة المعتمدة.')}</p></dialog>
      <dialog id="sx-role-dialog" class="team-dialog role-dialog"><div class="dialog-heading"><div><h2>${label('Create role','إنشاء دور')}</h2><p class="muted">${label('Choose screens and actions for this role. Agents can use additional features when explicitly granted.','حدد الشاشات والإجراءات لهذا الدور. يمكن منح الوكلاء ميزات إضافية بشكل صريح.')}</p></div><button type="button" class="icon-button" data-close-dialog="sx-role-dialog" aria-label="${label('Close','إغلاق')}">×</button></div><div id="sx-role-error" role="alert" hidden></div><form id="sx-role-form" class="role-form"><input type="hidden" name="id"><label>${label('Role name','اسم الدور')}<input name="name" required maxlength="80"></label><label>${label('Seat type','نوع المقعد')}<select name="seatRole" required>${Object.entries(roles).map(([key,value])=>`<option value="${key}">${label(value[0],value[1])}</option>`).join('')}</select></label><label class="role-description">${label('Description (optional)','الوصف (اختياري)')}<input name="description" maxlength="300"></label><fieldset class="permission-fieldset"><legend>${label('Sidebar screens and actions','شاشات القائمة الجانبية والإجراءات')}</legend><div id="sx-role-permissions"></div></fieldset><div class="dialog-actions"><button type="button" id="sx-role-reset">${label('Clear','مسح')}</button><button type="submit" class="primary">${label('Create role','إنشاء الدور')}</button></div></form></dialog>
      </div>`;
    node.querySelectorAll('[data-team-tab]').forEach(button=>{
      button.onclick=()=>activateTeamTab(node,button.dataset.teamTab);
      button.onkeydown=event=>{const tabs=[...node.querySelectorAll('[data-team-tab]')],index=tabs.indexOf(button),direction=node.dir==='rtl'?-1:1;let next=null;if(event.key==='ArrowRight')next=(index+direction+tabs.length)%tabs.length;else if(event.key==='ArrowLeft')next=(index-direction+tabs.length)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;if(next!==null){event.preventDefault();tabs[next].focus();activateTeamTab(node,tabs[next].dataset.teamTab);}};
    });
    node.querySelector('#sx-open-invite').onclick=()=>node.querySelector('#sx-invite-dialog').showModal();
    node.querySelector('#sx-manage-whatsapp').onclick=()=>activateTeamTab(node,'whatsapp');
    node.querySelector('#sx-open-role').onclick=()=>{resetRoleForm(node);node.querySelector('#sx-role-dialog').showModal();};
    node.querySelectorAll('[data-close-dialog]').forEach(button=>button.onclick=()=>node.querySelector('#'+button.dataset.closeDialog).close());
    node.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{const rect=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))dialog.close();}));
    node.querySelector('#sx-member-search').oninput=()=>filterMembers(node);
    node.querySelector('#sx-role-filter').onchange=()=>filterMembers(node);
    const form = node.querySelector('#sx-team-form');
    node.querySelector('#sx-role-dialog').addEventListener('close',()=>{if(!node.querySelector('#sx-role-form [name="id"]').value)resetRoleForm(node);});
    const passwordField=form.elements.temporaryPassword;
    const updateCreationMode=()=>{
      const direct=form.elements.creationMode.value==='account';
      passwordField.required=direct;
      for(const input of [passwordField,form.elements.displayName,form.elements.mobile]){input.disabled=!direct;input.closest('label').hidden=!direct;}
      node.querySelector('#sx-invitation-note').hidden=direct;
      node.querySelector('#sx-password-help').textContent=direct?label('The account will be active immediately. Share the email and initial password privately.','سيكون الحساب نشطاً فوراً. شارك البريد وكلمة المرور الأولية بشكل خاص.'):label('Create a one-time setup link for your teammate to choose their own password. Copy and share it after creation.','أنشئ رابط إعداد لمرة واحدة ليختار زميلك كلمة مروره. انسخ الرابط وشاركه بعد إنشائه.');
      form.elements.displayName.required=direct;
      const assignment=form.elements.assignment.value;
      const selectedRole=assignment.startsWith('profile:')?currentTeamData?.roles?.find(item=>item.id===assignment.slice(8))?.seatRole:assignment.slice(7);
      form.elements.mobile.required=direct&&selectedRole==='agent';
      form.querySelector('button[type="submit"]').textContent=direct?label('Create account','إنشاء حساب'):label('Create invitation','إنشاء دعوة');
    };
    form.elements.creationMode.onchange=()=>{passwordField.value='';node.querySelector('#sx-create-error').hidden=true;updateCreationMode();};
    updateCreationMode();
    form.elements.assignment.onchange=updateCreationMode;
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const errorBox=node.querySelector('#sx-create-error');errorBox.hidden=true;
      button.disabled = true;
      const data = new FormData(form);
      try {
        const assignment=String(data.get('assignment')||'');
        const inviteBody={email:data.get('email'),requestKey:crypto.randomUUID()};
        if(assignment.startsWith('profile:'))inviteBody.roleProfileId=assignment.slice(8);else inviteBody.role=assignment.slice(7);
        if(data.get('temporaryPassword'))Object.assign(inviteBody,{temporaryPassword:data.get('temporaryPassword'),displayName:data.get('displayName'),mobile:String(data.get('mobile')||'').trim().replace(/[\s().-]/g,'')});
        const invite = await api('/api/user/team-invitations/', {method:'POST', body:inviteBody});
        if(invite.delivery==='password')node.querySelector('#sx-team-msg').innerHTML=`<div class="notice" role="status">${label('Account created. Share the email and initial password privately. Sign in at:','تم إنشاء الحساب. شارك البريد وكلمة المرور الأولية بشكل خاص. تسجيل الدخول:')} <a href="${esc(invite.loginPath)}">${esc(location.origin+invite.loginPath)}</a></div>`;
        else if(invite.token)showLink(node, invite.token, label('Copy this one-time invitation link now','انسخ رابط الدعوة لمرة واحدة الآن'));
        else nodeMessage(node.querySelector('#sx-team-msg'),label('Invitation already exists. Use Create new link below.','الدعوة موجودة بالفعل. استخدم إنشاء رابط جديد أدناه.'),false);
        form.reset();
        node.querySelector('#sx-invite-dialog').close();
        updateCreationMode();
        await list(node);
      } catch (error) {
        errorBox.className='error creation-error';errorBox.textContent=errorText(error.message);errorBox.hidden=false;errorBox.focus();
      } finally {
        button.disabled=false;
      }
    };
    node.querySelector('#sx-role-form').onsubmit=saveRole;
    node.querySelector('#sx-role-form [name="seatRole"]').onchange=()=>renderRolePermissions(currentTeamData);
    node.querySelector('#sx-role-reset').onclick=()=>resetRoleForm(node);
    await list(node);
  }
  function showLink(node, token, heading) {
    const href = location.origin + '/user?page=team-invitations#team-invite=' + encodeURIComponent(token);
    const target = node.querySelector('#sx-team-msg');
    target.innerHTML = `<div class="notice" role="status"><strong>${heading}</strong><br><code>${esc(href)}</code><p><button type="button" id="sx-copy-link">${label('Copy link','نسخ الرابط')}</button></p></div>`;
    target.querySelector('#sx-copy-link').onclick = async event => {
      try { await navigator.clipboard.writeText(href); event.currentTarget.textContent = label('Copied','تم النسخ'); }
      catch (_) { target.querySelector('code').focus?.(); event.currentTarget.textContent = label('Select and copy the link above','حدد الرابط أعلاه وانسخه'); }
    };
  }
  function renderRolePermissions(data,selected,sidebarSelection=null){
    const target=document.getElementById('sx-role-permissions'),seatRole=document.querySelector('#sx-role-form [name="seatRole"]')?.value;
    if(!target||!seatRole)return;
    const permissions=data?.permissionCatalog?.[seatRole]||[],chosen=new Set(selected||data?.permissionDefaults?.[seatRole]||[]);
    const unavailableScreens=[['chat-widget','Chat Widget','ودجت المحادثة'],['rest-api','REST API','واجهة REST API'],['conversational-api','Conversational API','واجهة برمجة المحادثات'],['template-api','Template API','واجهة برمجة القوالب'],['api-dashboard','API Dashboard','لوحة تحكم API'],['manage-webhooks','Manage Webhooks','إدارة الـ Webhooks'],['webhook-automation','Webhook Automation','أتمتة Webhook'],['webhook-logs','Webhook Logs','سجلات Webhook'],['whatsapp-warmer','WhatsApp Warmer','مسخن حسابات واتساب']].map(([key,en,ar])=>({key,label:{en,ar},available:false,actions:[]}));
    const catalog=[...(data?.screenCatalog||[]),...unavailableScreens].map(item=>({...item,required:item.requiredPermissions||[item.permission]}));
    const enabled=item=>item.available!==false&&item.required.every(key=>permissions.includes(key));
    const selectedScreens=new Set(sidebarSelection===null?catalog.filter(item=>!item.optIn&&enabled(item)&&item.required.every(key=>chosen.has(key))).map(item=>item.key):sidebarSelection);
    const covered=new Set(catalog.flatMap(item=>item.actions||[item.permission]));
    const extra=permissions.filter(key=>!covered.has(key));
    const actionOption=key=>`<label class="permission-option"><input type="checkbox" name="permission" value="${esc(key)}" ${chosen.has(key)?'checked':''}><span>${esc(permissionTitle(key))}</span></label>`;
    target.innerHTML=`<div class="permission-toolbar"><label>${label('Find a sidebar screen','ابحث عن شاشة في القائمة')}<input type="search" data-permission-search placeholder="${label('Search by the sidebar name…','ابحث باسم القائمة الجانبية…')}"></label><div class="permission-summary" role="status" data-permission-summary></div><div class="actions"><button type="button" data-permission-select="all">${label('Select all available','تحديد كل المتاح')}</button><button type="button" data-permission-select="none">${label('Clear all','إلغاء الكل')}</button></div></div><p class="muted">${label('Use the same names as the sidebar. Choose which screens appear, then choose the actions allowed inside each screen. Unavailable screens are shown disabled.','الأسماء مطابقة للقائمة الجانبية. اختر الشاشات الظاهرة ثم الإجراءات المسموحة داخل كل شاشة. تظهر الشاشات غير المتاحة معطلة.')}</p><div class="permission-workspace"><div class="permission-grid">${catalog.map(item=>{
      const available=enabled(item),title=label(item.label.en,item.label.ar),actions=(item.actions||[item.permission]).filter(key=>permissions.includes(key));
      return `<section class="permission-category sidebar-screen-card" data-permission-group="${esc(title.toLowerCase())}" data-screen-card="${esc(item.key)}"><label class="sidebar-screen-choice"><input type="checkbox" name="sidebarScreen" value="${esc(item.key)}" ${available&&selectedScreens.has(item.key)?'checked':''} ${available?'':'disabled'}><span><strong>${esc(title)}</strong><small>${available?label('Show in sidebar','إظهار في القائمة الجانبية'):label('Unavailable for this plan, category or seat','غير متاح لهذه الباقة أو الفئة أو المقعد')}</small></span></label>${available?`<details class="screen-actions"><summary>${label('Allowed actions','الإجراءات المسموحة')} <span data-permission-count></span></summary><div class="permission-group-tools"><button type="button" data-group-select="all">${label('All actions','كل الإجراءات')}</button><button type="button" data-group-select="none">${label('No actions','بلا إجراءات')}</button></div>${actions.map(actionOption).join('')}</details>`:''}</section>`;
    }).join('')}${extra.length?`<details class="permission-category" data-permission-group="${label('Additional actions','إجراءات إضافية')}"><summary>${label('Additional actions','إجراءات إضافية')} <span data-permission-count></span></summary>${extra.map(actionOption).join('')}</details>`:''}</div><aside class="role-screen-preview"><h3>${label('Sidebar preview','معاينة القائمة الجانبية')}</h3><p class="muted">${label('Only selected screens appear. Member screen restrictions can narrow this list further.','تظهر الشاشات المحددة فقط. قد تقلل قيود شاشات العضو هذه القائمة.')}</p><div data-role-screen-preview></div></aside></div>`;
    const setPermission=(key,value)=>target.querySelectorAll('[name=permission]').forEach(input=>{if(input.value===key)input.checked=value;});
    const sync=()=>{
      const checked=new Set([...target.querySelectorAll('[name=permission]:checked')].map(el=>el.value));
      target.querySelectorAll('[name=sidebarScreen]').forEach(input=>{const item=catalog.find(row=>row.key===input.value);if(!item.required.every(key=>checked.has(key)))input.checked=false;});
      const screens=new Set([...target.querySelectorAll('[name=sidebarScreen]:checked')].map(input=>input.value));
      target.querySelector('[data-permission-summary]').textContent=screens.size+' '+label('screens','شاشات')+' · '+checked.size+' '+label('actions','إجراءات');
      target.querySelectorAll('.permission-category').forEach(detail=>{const counter=detail.querySelector('[data-permission-count]'),inputs=[...detail.querySelectorAll('[name=permission]')];if(counter)counter.textContent=inputs.filter(el=>el.checked).length+'/'+inputs.length;});
      target.querySelector('[data-role-screen-preview]').innerHTML=catalog.filter(item=>screens.has(item.key)).map(item=>`<div class="role-preview-row">✓ ${esc(label(item.label.en,item.label.ar))}</div>`).join('')||`<p class="muted">${label('No sidebar screens selected.','لم تُحدد شاشات للقائمة.')}</p>`;
    };
    target.onchange=event=>{
      if(event.target.name==='permission')setPermission(event.target.value,event.target.checked);
      if(event.target.name==='sidebarScreen'&&event.target.checked){const item=catalog.find(row=>row.key===event.target.value);item.required.forEach(key=>setPermission(key,true));}
      sync();
    };
    target.querySelector('[data-permission-search]').oninput=event=>{const query=event.target.value.trim().toLowerCase();target.querySelectorAll('[data-permission-group]').forEach(group=>group.hidden=!group.dataset.permissionGroup.includes(query));};
    target.onclick=event=>{const all=event.target.closest('[data-permission-select]'),group=event.target.closest('[data-group-select]');if(!all&&!group)return;const root=group?group.closest('.permission-category'):target,value=(group?.dataset.groupSelect||all?.dataset.permissionSelect)==='all';root.querySelectorAll('[name=permission]').forEach(input=>setPermission(input.value,value));if(all)target.querySelectorAll('[name=sidebarScreen]:not(:disabled)').forEach(input=>input.checked=value);sync();};
    sync();
  }

  function resetRoleForm(node){
    const form=node.querySelector('#sx-role-form');node.querySelector('#sx-role-error').hidden=true;form.reset();form.elements.id.value='';
    form.elements.seatRole.disabled=false;form.querySelector('button[type="submit"]').textContent=label('Create role','إنشاء الدور');
    node.querySelector('#sx-role-dialog .dialog-heading h2').textContent=label('Create role','إنشاء دور');
    renderRolePermissions(currentTeamData);
  }
  async function saveRole(event){
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),id=form.elements.id.value;
    const body={name:form.elements.name.value,description:form.elements.description.value,permissions:[...new Set([...form.querySelectorAll('[name="permission"]:checked')].map(input=>input.value))],sidebarNavigation:[...form.querySelectorAll('[name="sidebarScreen"]:checked')].map(input=>input.value)};
    if(!id)body.seatRole=form.elements.seatRole.value;
    button.disabled=true;
    try{await api('/api/user/team-invitations/roles'+(id?'/'+encodeURIComponent(id):''),{method:id?'PUT':'POST',body});nodeMessage(document.getElementById('sx-team-msg'),label(id?'Role updated.':'Role created.','تم تحديث الدور.'),false);document.getElementById('sx-role-dialog').close();resetRoleForm(document.getElementById('sx-team-screen'));await list(document.getElementById('sx-team-screen'));}
    catch(error){const box=document.getElementById('sx-role-error');box.hidden=false;box.className='error';box.textContent=errorText(error.message);}
    finally{button.disabled=false;}
  }
  function renderRoles(element,data){
    if(!element)return;
    const rolesList=data.roles||[];
    if(!rolesList.length){element.innerHTML=`<div class="muted">${label('No custom roles yet. Create one above.','لا توجد أدوار مخصصة بعد. أنشئ دوراً أعلاه.')}</div>`;return;}
    element.innerHTML=rolesList.map(item=>`<div class="role-row" data-role-id="${esc(item.id)}"><div><strong>${esc(item.name)}</strong><div class="muted">${esc(roleLabel(item.seatRole))} · ${esc(item.status)} · ${esc((item.permissions||[]).length)} ${label('permissions','صلاحيات')}</div>${item.description?`<div class="muted">${esc(item.description)}</div>`:''}</div><div class="role-actions">${item.status==='active'?`<button type="button" data-edit-role>${label('Edit','تعديل')}</button><button type="button" data-archive-role>${label('Archive','أرشفة')}</button>`:''}</div></div>`).join('');
    element.querySelectorAll('[data-edit-role]').forEach(button=>button.onclick=()=>{
      const item=rolesList.find(role=>role.id===button.closest('[data-role-id]').dataset.roleId);if(!item)return;
      const form=document.getElementById('sx-role-form');document.getElementById('sx-role-error').hidden=true;form.elements.id.value=item.id;form.elements.name.value=item.name;form.elements.description.value=item.description||'';form.elements.seatRole.value=item.seatRole;form.elements.seatRole.disabled=true;
      form.querySelector('button[type="submit"]').textContent=label('Save role','حفظ الدور');const dialog=document.getElementById('sx-role-dialog');dialog.querySelector('.dialog-heading h2').textContent=label('Edit role','تعديل الدور');renderRolePermissions(data,item.permissions||[],item.sidebarNavigation??null);dialog.showModal();
    });
    element.querySelectorAll('[data-archive-role]').forEach(button=>button.onclick=async()=>{
      if(!confirm(label('Archive this role?','هل تريد أرشفة هذا الدور؟')))return;button.disabled=true;
      try{await api('/api/user/team-invitations/roles/'+encodeURIComponent(button.closest('[data-role-id]').dataset.roleId)+'/archive',{method:'POST',body:{}});await list(document.getElementById('sx-team-screen'));}
      catch(error){nodeMessage(document.getElementById('sx-team-msg'),errorText(error.message),true);}
      finally{button.disabled=false;}
    });
  }
  function renderSeats(element, data) {
    element.replaceChildren();
    const values = data.seatUsage || {};
    const supportedRoles=new Set(Object.keys(values));
    const seatRoleSelect=document.querySelector('#sx-role-form [name="seatRole"]');
    if(seatRoleSelect)for(const option of [...seatRoleSelect.options])if(!supportedRoles.has(option.value))option.remove();
    const available = new Set(data.availableRoles || []);
    const select = document.querySelector('#sx-team-form select[name="assignment"]');
    if (select) {
      select.replaceChildren();
      for (const key of Object.keys(values)) {
        const option = document.createElement('option'); option.value = 'system:'+key;
        option.textContent = roleLabel(key) + (available.has(key) ? '' : ' · ' + label('No seats','لا توجد مقاعد'));
        option.disabled = !available.has(key); select.append(option);
      }
      for(const profile of data.roles||[]){if(profile.status!=='active')continue;const option=document.createElement('option');option.value='profile:'+profile.id;const hasSeats=available.has(profile.seatRole);option.textContent=profile.name+' · '+roleLabel(profile.seatRole)+(hasSeats?'':' · '+label('No seats','لا توجد مقاعد'));option.disabled=!hasSeats;select.append(option);}
      const first = [...select.options].find(option => !option.disabled);
      if (first) select.value = first.value;
    }
    for (const key of Object.keys(values)) {
      const usage = values[key];
      const card = document.createElement('div'); card.className = 'seat-card';
      const title = document.createElement('strong'); title.textContent = label(seatTitles[key][0],seatTitles[key][1]); card.append(title);
      const metrics = document.createElement('div'); metrics.className = 'seat-metrics';
      const fields = [['Active','نشط','active'],['Pending','معلق','pending'],['Limit','الحد','limit'],['Available','متاح','available']];
      if (usage) for (const [en, ar, property] of fields) { const item = document.createElement('span'); item.textContent = label(en,ar) + ': ' + (usage[property] == null ? label('Not assigned','غير محدد') : String(usage[property])); metrics.append(item); }
      else metrics.textContent = label('Plan usage unavailable','تعذر تحميل استخدام الباقة');
      card.append(metrics); element.append(card);
    }
    const button = document.querySelector('#sx-team-form button[type="submit"]');
    if (button) button.disabled = !select||![...select.options].some(option=>!option.disabled);
  }
  function renderSalesOrganisation(node,data){
    const card=node.querySelector('#sx-sales-org-card'),target=node.querySelector('#sx-sales-org-content');
    if(!card||!target)return;
    card.hidden=false;
    node.dataset.salesCategory='salemax_sales';
    node.querySelector('h1').textContent=label('SaleMaX Organisation','الهيكل التنظيمي لـ SaleMaX');
    node.querySelector('.wrap>p').textContent=label('Review reporting lines and move agents between their manager and Team Leader. Every move records who changed it and why.','راجع خطوط الإشراف وانقل الوكلاء بين المدير وقائد الفريق. يُحفظ منفذ كل تغيير وسببه.');
    const owner=data.role==='owner';
    if(!owner){for(const selector of ['#sx-role-form','#sx-team-seat-usage','#sx-team-members','#sx-team-form','#sx-team-list'])node.querySelector(selector)?.closest('.card')?.setAttribute('hidden','');}
    const members=data.members||[],managers=members.filter(member=>member.role==='manager'),leaders=members.filter(member=>member.role==='team_leader');
    if(!members.length){target.innerHTML=`<p class="muted">${label('No active members are available in your reporting scope yet.','لا يوجد أعضاء نشطون في نطاق إشرافك حتى الآن.')}</p>`;return;}
    const roleNames={owner:label('Business Admin','مسؤول النشاط'),accountant:label('Accountant','محاسب'),manager:label('Sales Manager','مدير مبيعات'),team_leader:label('Team Leader','قائد فريق'),agent:label('Sales Agent','وكيل مبيعات')};
    const managerOptions=current=>`<option value="">${label('Select manager','اختر المدير')}</option>${managers.map(manager=>`<option value="${esc(manager.membershipId)}" ${current===manager.membershipId?'selected':''}>${esc(manager.displayName||manager.email)}</option>`).join('')}`;
    target.innerHTML=members.map(member=>{
      const editable=data.canReassign&&['team_leader','agent'].includes(member.role);
      if(!editable)return `<div class="org-row"><div><strong>${esc(member.displayName||member.email)}</strong><span class="org-role">${esc(roleNames[member.role]||member.role)} · ${esc(member.email)}</span></div><div class="org-readonly">${member.role==='accountant'?label('Finance access; outside the sales reporting line.','صلاحيات مالية؛ خارج خط الإشراف على المبيعات.'):member.role==='manager'?label('Manager owns the teams assigned below.','المدير مسؤول عن الفرق المسندة إليه أدناه.'):label('Top of organisation','أعلى الهيكل التنظيمي')}</div><span></span></div>`;
      const managerId=member.managerMembershipId||'';
      const leaderOptions=leaders.filter(leader=>!managerId||leader.managerMembershipId===managerId);
      const leaderSelect=`<label>${label('Team Leader','قائد الفريق')}<select data-leader><option value="">${label('Select Team Leader','اختر قائد الفريق')}</option>${leaderOptions.map(leader=>`<option value="${esc(leader.membershipId)}" ${member.teamLeaderMembershipId===leader.membershipId?'selected':''}>${esc(leader.displayName||leader.email)}</option>`).join('')}</select></label>`;
      return `<form class="org-row" data-org-member="${esc(member.membershipId)}"><div><strong>${esc(member.displayName||member.email)}</strong><span class="org-role">${esc(roleNames[member.role]||member.role)} · ${esc(member.email)}</span>${member.assignedAt?`<span class="org-role">${label('Assigned','تم الإسناد')}: ${esc(member.assignedAt)}</span>`:''}</div><div class="org-assignment"><label>${label('Sales Manager','مدير المبيعات')}<select name="managerMembershipId" required>${managerOptions(managerId)}</select></label>${member.role==='agent'?leaderSelect:''}<label class="org-reason">${label('Reason for change','سبب التغيير')}<input name="reason" required minlength="3" maxlength="1000" placeholder="${label('e.g. team capacity','مثال: سعة الفريق')}"></label></div><button class="primary" type="submit">${label('Save assignment','حفظ الإسناد')}</button></form>`;
    }).join('');
    target.querySelectorAll('form[data-org-member]').forEach(form=>{
      const managerSelect=form.elements.managerMembershipId,leaderSelect=form.querySelector('[data-leader]');
      if(leaderSelect)managerSelect.addEventListener('change',()=>{
        const managerId=managerSelect.value,previous=leaderSelect.value;
        const choices=leaders.filter(leader=>leader.managerMembershipId===managerId);
        leaderSelect.innerHTML=`<option value="">${label('Select Team Leader','اختر قائد الفريق')}</option>${choices.map(leader=>`<option value="${esc(leader.membershipId)}" ${previous===leader.membershipId?'selected':''}>${esc(leader.displayName||leader.email)}</option>`).join('')}`;
      });
      form.onsubmit=async event=>{
        event.preventDefault();const button=form.querySelector('button');button.disabled=true;
        try{
          const body={managerMembershipId:managerSelect.value,reason:form.elements.reason.value};
          if(leaderSelect)body.teamLeaderMembershipId=leaderSelect.value;
          await api('/api/user/team-invitations/sales-organization/members/'+encodeURIComponent(form.dataset.orgMember)+'/reassign',{method:'POST',body});
          nodeMessage(node.querySelector('#sx-team-msg'),label('Organisation assignment saved.','تم حفظ إسناد الهيكل التنظيمي.'),false);
          await list(node);
        }catch(error){nodeMessage(node.querySelector('#sx-team-msg'),errorText(error.message),true);}
        finally{button.disabled=false;}
      };
    });
  }
  async function list(node) {
    const element = node.querySelector('#sx-team-list');
    if (!element) return;
    const selectedTab=node.querySelector('[data-team-tab][aria-selected="true"]')?.dataset.teamTab||'members';
    try {
      const organisation=await api('/api/user/team-invitations/sales-organization');
      if(organisation.categoryKey==='salemax_sales'){
        if(organisation.role!=='owner'){location.replace('/user?page=sales-organization');return;}
        const heading=node.querySelector('.wrap > h1');
        if(heading)heading.textContent=label('People & Roles','الأشخاص والأدوار');
        renderSalesOrganisation(node,organisation);
      }else node.querySelector('#sx-sales-org-card')?.setAttribute('hidden','');
      const data = await api('/api/user/team-invitations/');
      currentTeamData=data;
      renderTeamStats(node,data);
      renderSeats(node.querySelector('#sx-team-seat-usage'), data);
      node.querySelector('#sx-team-form [name="assignment"]').dispatchEvent(new Event('change'));
      renderRoles(node.querySelector('#sx-role-list'),data);
      if(!node.querySelector('#sx-role-form [name="id"]').value)renderRolePermissions(data);
      renderMembers(node.querySelector('#sx-team-members'),data);
      filterMembers(node);
      await renderQrChannels(node.querySelector('#sx-qr-channels'),data);
      element.innerHTML = data.invitations.length ? data.invitations.map(invite => `<div class="row"><div><strong>${esc(invite.email)}</strong><div class="muted">${esc(invite.roleName||roleLabel(invite.role))} · ${esc(invite.status)} · ${esc(invite.expiresAt || '')}</div></div><div class="actions">${['pending','expired'].includes(invite.status) ? `<button data-rotate="${esc(invite.id)}">${label('Create new link','إنشاء رابط جديد')}</button>${invite.status === 'pending' ? `<button data-cancel="${esc(invite.id)}">${label('Cancel','إلغاء')}</button>` : ''}` : ''}</div></div>`).join('') : `<div class="muted">${label('No invitations yet.','لا توجد دعوات بعد.')}</div>`;
      activateTeamTab(node,selectedTab);
      element.querySelectorAll('.row').forEach((row,index)=>{
        const invite=data.invitations[index];
        const member=(data.members||[]).find(item=>item.email.toLowerCase()===invite.email.toLowerCase());
        if(invite.status!=='accepted'||!member||!['manager','accountant'].includes(member.role))return;
        const button=document.createElement('button');button.type='button';button.textContent=label('Login as','الدخول باسم');
        button.setAttribute('aria-label',label('Login as ','الدخول باسم ')+(member.displayName||member.email));
        button.title=label('Switch this browser to the staff account for 30 minutes. Use Return to owner to switch back.','تبديل هذا المتصفح إلى حساب الموظف لمدة 30 دقيقة. استخدم العودة إلى المالك للرجوع.');
        button.onclick=()=>loginAs(member,button);row.querySelector('.actions').append(button);
      });
      element.querySelectorAll('[data-rotate]').forEach(button => button.onclick = async () => {
        button.disabled = true;
        try { const rotated = await api('/api/user/team-invitations/' + encodeURIComponent(button.dataset.rotate) + '/rotate',{method:'POST',body:{}}); showLink(node,rotated.token,label('New link (the previous link is now invalid)','الرابط الجديد (الرابط السابق لم يعد صالحاً)')); await list(node); }
        catch (error) { node.querySelector('#sx-team-msg').innerHTML = `<div class="error" role="alert">${esc(errorText(error.message))}</div>`; }
        finally { button.disabled = false; }
      });
      element.querySelectorAll('[data-cancel]').forEach(button => button.onclick = async () => {
        if (!confirm(label('Cancel this invitation?','هل تريد إلغاء هذه الدعوة؟'))) return;
        button.disabled = true;
        try { await api('/api/user/team-invitations/' + encodeURIComponent(button.dataset.cancel) + '/cancel',{method:'POST',body:{}}); await list(node); }
        catch (error) { node.querySelector('#sx-team-msg').innerHTML = `<div class="error" role="alert">${esc(errorText(error.message))}</div>`; }
        finally { button.disabled = false; }
      });
    } catch (error) {
      const button = node.querySelector('#sx-team-form button[type="submit"]'); if (button) button.disabled = true;
      const usage = node.querySelector('#sx-team-seat-usage'); usage.className = 'error'; usage.textContent = errorText(error.message);
      element.innerHTML = `<div class="error" role="alert">${esc(errorText(error.message))}</div><button id="sx-list-retry">${label('Try again','حاول مرة أخرى')}</button>`;
      element.querySelector('#sx-list-retry').onclick = () => list(node);
    }
  }
  async function renderQrChannels(element,teamData){
    if(!element)return;
    try{
      const data=await api('/api/user/team-invitations/whatsapp-channels');
      const managingAgents=data.actorRole==='manager',managers=(teamData.members||[]).filter(member=>member.role==='manager'),recipients=data.recipients||data.agents||[];
      const summary=document.getElementById('sx-whatsapp-summary-content');
      if(!data.channels?.length){const empty=label('No connected WhatsApp numbers yet. Connect one from WhatsApp in the existing workspace.','لا توجد أرقام واتساب متصلة حالياً. اربط رقماً من واتساب في مساحة العمل الحالية.');element.innerHTML=`<p class="muted">${empty}</p>`;if(summary)summary.innerHTML=`<p class="muted">${empty}</p>`;return;}
      if(summary){const channel=data.channels[0],number=channel.number?`${String(channel.number).slice(0,3)}••••${String(channel.number).slice(-4)}`:label('Number unavailable','الرقم غير متاح'),count=managingAgents?(channel.recipientMembershipIds||channel.agentMembershipIds||[]).length:(channel.managerMembershipIds||[]).length;summary.innerHTML=`<div class="whatsapp-symbol" aria-hidden="true">◉</div><div class="whatsapp-summary-name"><strong>${esc(channel.title||'WhatsApp')}</strong><span>${esc(number)}</span></div><span class="status-badge"><i></i>${esc(channel.status==='ACTIVE'?label('Connected','متصل'):channel.status==='RECONNECTING'?label('Reconnecting','جارٍ إعادة الاتصال'):label('Disconnected','غير متصل'))}</span><span class="whatsapp-summary-count">${count} ${label('team members with access','عضو فريق لديه صلاحية')}</span><span class="whatsapp-summary-arrow" aria-hidden="true">›</span>${data.channels.length>1?`<small class="muted">+${data.channels.length-1} ${label('more connected numbers','أرقام متصلة أخرى')}</small>`:''}`;}
      element.innerHTML=data.channels.map(channel=>{
        const selected=new Set(managingAgents?channel.recipientMembershipIds||channel.agentMembershipIds||[]:channel.managerMembershipIds||[]);
        const inherited=new Set(channel.inheritedAgentMembershipIds||[]);
        const choicesList=managingAgents?recipients:managers,field=managingAgents?'recipient':'manager';
        const choices=choicesList.length?choicesList.map(member=>`<label class="nav-option"><input type="checkbox" data-qr-${field}="${esc(member.membershipId||member.id)}" ${selected.has(member.membershipId||member.id)?'checked':''} ${managingAgents&&inherited.has(member.membershipId)?'disabled':''}><span>${esc(member.displayName||member.email)} · ${esc(member.email)}${managingAgents?` · ${label(member.role==='accountant'?'Accountant':'Agent',member.role==='accountant'?'محاسب':'وكيل')}`:''}${managingAgents&&inherited.has(member.membershipId)?` · ${label('Assigned by owner','مُسند من المالك')}`:''}</span></label>`).join(''):`<p class="muted">${managingAgents?label('No active accountants or agents are below your manager role.','لا يوجد محاسبون أو وكلاء نشطون ضمن الأدوار التابعة لك.'):label('Add a Manager account first.','أضف حساب مدير أولاً.')}</p>`;
        const phone=channel.number?`${String(channel.number).slice(0,3)}••••${String(channel.number).slice(-4)}`:label('Number unavailable','الرقم غير متاح');
        return `<form class="member-card qr-channel-form" data-qr-channel="${esc(channel.id)}"><div class="member-head"><div><strong>${esc(channel.title)}</strong><div class="muted">${esc(phone)} · ${esc(channel.status==='ACTIVE'?label('Connected','متصل'):channel.status==='RECONNECTING'?label('Reconnecting','جارٍ إعادة الاتصال'):label('Disconnected','غير متصل'))} · ${Number(channel.conversationCount)||0} ${label('chats','محادثة')}</div><div class="muted">${managingAgents?label('Share this QR number with active accountants and agents under your manager role. They can only access conversations from this number.','شارك رقم QR هذا مع المحاسبين والوكلاء النشطين ضمن دورك كمدير. يقتصر وصولهم على محادثات هذا الرقم.'):label('Choose which Managers and their teams can use this QR number.','اختر المديرين وفرقهم الذين يمكنهم استخدام رقم QR هذا.')}</div></div><button type="submit" class="primary" ${choicesList.length?'':'disabled'}>${label('Save access','حفظ الصلاحية')}</button></div><div class="nav-grid">${choices}</div></form>`;
      }).join('');
      element.querySelectorAll('form[data-qr-channel]').forEach(form=>form.onsubmit=async event=>{
        event.preventDefault();const button=form.querySelector('button');button.disabled=true;
        try{
          const assignments=[...form.querySelectorAll(managingAgents?'[data-qr-recipient]:checked':'[data-qr-manager]:checked')].map(input=>input.dataset[managingAgents?'qrRecipient':'qrManager']);
          const body=managingAgents?{recipientMembershipIds:assignments}:{managerMembershipIds:assignments};
          await api('/api/user/team-invitations/whatsapp-channels/'+encodeURIComponent(form.dataset.qrChannel)+'/access',{method:'PUT',body});
          nodeMessage(element,managingAgents?label('WhatsApp access saved for the selected team members. Their access is limited to this number.','تم حفظ صلاحية واتساب لأعضاء الفريق المحددين. يقتصر وصولهم على هذا الرقم.'):label('WhatsApp access saved. The selected Managers can now use this number.','تم حفظ صلاحية واتساب. يمكن للمديرين المحددين الآن استخدام هذا الرقم.'),false);
          await list(document.getElementById('sx-team-screen'));
        }catch(error){nodeMessage(card,errorText(error.message),true);button.disabled=false;}
      });
    }catch(error){element.innerHTML=`<div class="error" role="alert">${esc(errorText(error.message))}</div>`;}
  }
  function renderMembers(element,data){
    if(!element)return;
    if(!data.members?.length){element.innerHTML=`<div class="empty-state"><span class="empty-icon">♙</span><strong>${label('No team members yet','لا يوجد أعضاء في الفريق بعد')}</strong><p class="muted">${label('Invite your first teammate to get started.','ادعُ أول زميل لك للبدء.')}</p></div>`;return;}
    const rank={owner:0,manager:1,accountant:2,team_leader:2,agent:3};
    const members=[...data.members].sort((a,b)=>(rank[a.role]??4)-(rank[b.role]??4)||String(a.displayName||a.email).localeCompare(String(b.displayName||b.email)));
    element.innerHTML=`<div class="member-table-wrap"><table class="member-table"><thead><tr><th>${label('Name','الاسم')}</th><th>${label('Role','الدور')}</th><th>${label('Status','الحالة')}</th><th>${label('Access','الصلاحيات')}</th><th>${label('Actions','الإجراءات')}</th></tr></thead><tbody>${members.map(member=>{
      const options=(member.roleProfileId?data.navigationByRoleProfile?.[member.roleProfileId]:data.navigationByRole?.[member.role])||[],selected=new Set(member.assignedNavigation===null?options.map(item=>item.key):member.assignedNavigation);
      const profiles=(data.roles||[]).filter(profile=>profile.status==='active'&&profile.seatRole===member.role);
      const roleOptions=`<option value="">${label('Standard access','الصلاحيات الأساسية')}</option>${profiles.map(profile=>`<option value="${esc(profile.id)}" ${member.roleProfileId===profile.id?'selected':''}>${esc(profile.name)}</option>`).join('')}`;
      const groups=new Map();for(const option of options){const name=label(option.group.en,option.group.ar);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(option);}
      const choices=[...groups].map(([group,items])=>`<details class="nav-category"><summary>${esc(group)} <span data-nav-count>${items.filter(item=>selected.has(item.key)).length}/${items.length}</span></summary>${items.map(item=>`<label class="nav-option"><input type="checkbox" data-nav-key="${esc(item.key)}" ${selected.has(item.key)?'checked':''}><span>${esc(label(item.label.en,item.label.ar))}</span></label>`).join('')}</details>`).join('');
       const name=member.displayName||member.email||label('Team member','عضو فريق'), initials=String(name).trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase();
       const count=selected.size, badge=['manager','accountant','agent','team_leader'].includes(member.role)?member.role:'member';
       const status=member.status||'active';
       return `<tr class="member-row ${rank[member.role]>=2?'subordinate':''}" data-member-row data-member-role-key="${esc(member.role)}" data-member-search="${esc((name+' '+member.email+' '+member.role).toLowerCase())}"><td><div class="member-identity"><span class="avatar avatar-${esc(badge)}">${esc(initials)}</span><span><strong>${esc(name)}</strong><small>${esc(member.email||'')}</small></span></div></td><td><span class="role-badge role-${esc(badge)}">${esc(roleLabel(member.role))}</span>${member.roleName?`<small class="member-custom-role">${esc(member.roleName)}</small>`:''}</td><td><span class="status-badge"><i></i>${label('Active','نشط')}</span></td><td>${count} ${label('modules','وحدات')}</td><td><button type="button" class="edit-member" data-edit-member aria-expanded="false">${label('Edit','تعديل')}</button></td></tr><tr class="member-detail-row" data-member-detail hidden><td colspan="5"><div class="member-detail-panel" data-member="${esc(member.id)}"><div class="member-role-assignment"><label>${label('Access role','دور الوصول')}<select data-member-role>${roleOptions}</select></label><button type="button" data-save-role>${label('Save role','حفظ الدور')}</button><button type="button" class="primary" data-save-navigation>${label('Save sidebar access','حفظ صلاحيات القائمة')}</button></div><div class="nav-grid">${choices}</div></div></td></tr>`;
    }).join('')}</tbody></table></div>`;
    document.getElementById('sx-member-access-dialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='sx-member-access-dialog';dialog.className='team-dialog member-access-dialog';
    dialog.innerHTML=`<div class="dialog-heading"><div><h2>${label('Member access','صلاحيات العضو')}</h2><p class="muted" data-member-title></p></div><button type="button" class="icon-button" data-member-close aria-label="${label('Close','إغلاق')}">×</button></div><p class="muted">${label('Assign a role for available actions, then choose which permitted screens appear in this member’s sidebar. Edit the role to unlock more features.','حدد دوراً للإجراءات المتاحة، ثم اختر الشاشات المسموح بها التي تظهر في قائمة العضو. عدّل الدور لإتاحة ميزات إضافية.')}</p><div data-member-access-content></div>`;
    document.getElementById('sx-team-screen').append(dialog);dialog.querySelector('[data-member-close]').onclick=()=>dialog.close();
    dialog.onchange=event=>{const detail=event.target.closest('.nav-category');if(detail){const inputs=[...detail.querySelectorAll('[data-nav-key]')];detail.querySelector('[data-nav-count]').textContent=inputs.filter(input=>input.checked).length+'/'+inputs.length;}};
    let currentDetail=null;dialog.onclose=()=>{if(currentDetail?.isConnected){currentDetail.firstElementChild.append(dialog.querySelector('[data-member]').parentNode.removeChild(dialog.querySelector('[data-member]')));}currentDetail=null;};
    element.querySelectorAll('[data-edit-member]').forEach(button=>button.onclick=()=>{const row=button.closest('[data-member-row]'),detail=row.nextElementSibling;currentDetail=detail;dialog.querySelector('[data-member-title]').textContent=row.querySelector('.member-identity').innerText;const panel=detail.querySelector('[data-member]');dialog.querySelector('[data-member-access-content]').replaceChildren(panel);panel.querySelectorAll('details').forEach(el=>el.open=true);dialog.showModal();});
    element.querySelectorAll('[data-save-role]').forEach(button=>button.onclick=async()=>{
      const card=button.closest('[data-member]'),roleProfileId=card.querySelector('[data-member-role]').value||null;button.disabled=true;
      try{await api('/api/user/team-invitations/members/'+encodeURIComponent(card.dataset.member)+'/role',{method:'PUT',body:{roleProfileId}});document.getElementById('sx-member-access-dialog')?.close();nodeMessage(element,label('Access role saved.','تم حفظ دور الوصول.'),false);await list(document.getElementById('sx-team-screen'));}
      catch(error){nodeMessage(element,errorText(error.message),true);button.disabled=false;}
    });
    element.querySelectorAll('[data-save-navigation]').forEach(button=>button.onclick=async()=>{
      const card=button.closest('[data-member]'),navigation=[...card.querySelectorAll('[data-nav-key]:checked')].map(input=>input.dataset.navKey);
      button.disabled=true;
      try{await api('/api/user/team-invitations/members/'+encodeURIComponent(card.dataset.member)+'/navigation',{method:'PUT',body:{navigation}});nodeMessage(card,label('Sidebar access saved.','تم حفظ صلاحيات القائمة.'),false);}
      catch(error){nodeMessage(card,errorText(error.message),true);}
      finally{button.disabled=false;}
    });
    element.onchange=event=>{const detail=event.target.closest('.nav-category');if(detail){const inputs=[...detail.querySelectorAll('[data-nav-key]')];detail.querySelector('[data-nav-count]').textContent=inputs.filter(input=>input.checked).length+'/'+inputs.length;}};
  }
  function activateTeamTab(node,key){
    node.querySelectorAll('[data-team-tab]').forEach(button=>{const active=button.dataset.teamTab===key;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
    node.querySelectorAll('[data-team-panel]').forEach(panel=>{const active=panel.dataset.teamPanel===key;panel.hidden=!active;panel.classList.toggle('active',active);});
  }
  function renderTeamStats(node,data){
    const target=node.querySelector('#sx-team-stats');if(!target)return;
    const members=data.members||[],usage=data.seatUsage||{},pending=(data.invitations||[]).filter(item=>item.status==='pending').length;
    const cards=[
      {key:'manager',icon:'♧',tone:'rose',label:['Managers','المديرون'],value:members.filter(item=>item.role==='manager').length},
      {key:'accountant',icon:'▦',tone:'blue',label:['Accountants','المحاسبون'],value:usage.accountant?`${usage.accountant.active||0} / ${usage.accountant.limit??'—'}`:members.filter(item=>item.role==='accountant').length},
      {key:'agent',icon:'♙',tone:'green',label:['Agents','الوكلاء'],value:usage.agent?`${usage.agent.active||0} / ${usage.agent.limit??'—'}`:members.filter(item=>item.role==='agent').length},
      {key:'pending',icon:'◷',tone:'orange',label:['Pending invites','الدعوات المعلقة'],value:pending}
    ];
    target.innerHTML=cards.map(card=>`<button type="button" class="stat-card tone-${card.tone}" data-stat-role="${card.key}" aria-label="${label(...card.label)}: ${card.value}"><span class="stat-icon" aria-hidden="true">${card.icon}</span><span class="stat-copy"><small>${label(...card.label)}</small><strong>${card.value}</strong></span><span class="stat-chevron" aria-hidden="true">›</span></button>`).join('');
    target.querySelectorAll('[data-stat-role]').forEach(card=>card.onclick=()=>{
      const role=card.dataset.statRole;if(role==='pending'){activateTeamTab(node,'members');node.querySelector('#sx-team-list').scrollIntoView({behavior:'smooth',block:'center'});return;}
      activateTeamTab(node,'members');node.querySelector('#sx-role-filter').value=role;filterMembers(node);
    });
  }
  function filterMembers(node){
    const search=(node.querySelector('#sx-member-search')?.value||'').trim().toLowerCase(),role=node.querySelector('#sx-role-filter')?.value||'';
    node.querySelectorAll('[data-member-row]').forEach(row=>{const match=(!search||row.dataset.memberSearch.includes(search))&&(!role||row.dataset.memberRoleKey===role);row.hidden=!match;const detail=row.nextElementSibling;if(detail)detail.hidden=!match||detail.dataset.expanded!=='true';});
    node.querySelectorAll('[data-edit-member]').forEach(button=>{const detail=button.closest('[data-member-row]')?.nextElementSibling;if(detail&&detail.dataset.expanded!=='true')button.setAttribute('aria-expanded','false');});
  }
  function nodeMessage(element,message,isError){
    let status=element.querySelector('[data-navigation-status]');if(!status){status=document.createElement('div');status.dataset.navigationStatus='1';status.setAttribute(isError?'role':'role',isError?'alert':'status');element.prepend(status);}status.className=isError?'error':'notice';status.textContent=message;
  }
  async function accept() {
    if (!inviteToken) return;
    const node = screen(); node.dataset.accept = '1';
    node.innerHTML = `<div class="wrap"><div class="card"><h1>${label('Join your training-center team','انضم إلى فريق مركز التدريب')}</h1><div id="sx-invite-preview">${label('Checking invitation…','جارٍ التحقق من الدعوة…')}</div><div id="sx-accept-msg" role="alert" aria-live="assertive"></div><form id="sx-accept-form" class="accept-form" hidden><label>${label('Full name','الاسم الكامل')}<input name="displayName" required maxlength="200" autocomplete="name"></label><label id="sx-mobile-label">${label('Mobile number in international format','رقم الهاتف بالصيغة الدولية')}<input name="mobile" type="tel" placeholder="+97450123456" pattern="\\+[1-9][0-9]{7,14}" autocomplete="tel"></label><label>${label('Password (at least 12 characters)','كلمة المرور (12 حرفاً على الأقل)')}<input name="password" type="password" required minlength="12" maxlength="72" autocomplete="new-password"></label><button class="primary" type="submit">${label('Activate account','تفعيل الحساب')}</button></form></div></div>`;
    const preview = node.querySelector('#sx-invite-preview');
    try {
      const invitation = await api('/api/agent/invitations/preview/' + encodeURIComponent(inviteToken),{public:true});
      preview.innerHTML = `<p>${label('You are invited to join','تمت دعوتك للانضمام إلى')} <strong>${esc(invitation.businessName)}</strong>.</p><div class="accept-meta"><div>${label('Email','البريد الإلكتروني')}: <strong>${esc(invitation.email)}</strong></div><div>${label('Role','الدور')}: <strong>${esc(invitation.roleName||roleLabel(invitation.role))}</strong></div></div>`;
      const form = node.querySelector('#sx-accept-form'), mobile = form.elements.mobile;
      mobile.required = invitation.role === 'agent';
      if (!mobile.required) node.querySelector('#sx-mobile-label').classList.add('muted');
      form.hidden = false;
      form.onsubmit = async event => {
        event.preventDefault(); const button = event.submitter; button.disabled = true;
        const values = new FormData(form);
        try {
          await api('/api/agent/invitations/accept',{public:true,method:'POST',body:{token:inviteToken,displayName:values.get('displayName'),mobile:values.get('mobile'),password:values.get('password')}});
          inviteToken = '';
          node.querySelector('#sx-accept-msg').innerHTML = `<div class="notice" role="status">${label('Your account is active. Continue to sign in.','تم تفعيل حسابك. تابع إلى تسجيل الدخول.')}</div>`;
          form.remove();
          const link = document.createElement('a');
          if (invitation.role === 'agent') { link.href = '/agent/login'; link.textContent = label('Go to Agent Login','الانتقال إلى تسجيل دخول الوكيل'); }
          else { link.href = '/user/login?workspace=' + encodeURIComponent(invitation.tenantSlug); link.textContent = label('Go to business sign in','الانتقال إلى تسجيل دخول المؤسسة'); }
          node.querySelector('.card').append(link);
        } catch (error) { node.querySelector('#sx-accept-msg').innerHTML = `<div class="error" role="alert">${esc(errorText(error.message))}</div>`; }
        finally { if (button.isConnected) button.disabled = false; }
      };
    } catch (error) {
      preview.innerHTML = `<div class="error" role="alert">${esc(errorText(error.message))}</div>`;
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = label('Check link again','التحقق من الرابط مجدداً'); retry.onclick = () => accept(); preview.append(retry);
    }
  }
  async function activateBusinessOwner(){
    if(!ownerSetupToken)return;
    const node=screen();node.dataset.accept='1';
    node.innerHTML=`<div class="wrap"><div class="card"><h1>${label('Activate your SaleMaX Sales Business Admin account','تفعيل حساب مسؤول مبيعات SaleMaX')}</h1><p>${label('Set your name and a private password to activate the Business Admin account. This one-time link expires after 72 hours.','أدخل اسمك وكلمة مرور خاصة لتفعيل حساب مسؤول النشاط. تنتهي صلاحية هذا الرابط لمرة واحدة بعد 72 ساعة.')}</p><div id="sx-owner-setup-msg" role="status" aria-live="polite"></div><form id="sx-owner-setup-form" class="accept-form"><label>${label('Full name','الاسم الكامل')}<input name="name" required minlength="2" maxlength="200" autocomplete="name"></label><label>${label('Create password (12 characters minimum)','إنشاء كلمة مرور (12 حرفاً على الأقل)')}<input name="password" type="password" required minlength="12" maxlength="72" autocomplete="new-password"></label><label>${label('Confirm password','تأكيد كلمة المرور')}<input name="confirm" type="password" required minlength="12" maxlength="72" autocomplete="new-password"></label><p class="muted">${label('Use at least 12 characters and no more than 72 UTF-8 bytes.','استخدم 12 حرفاً على الأقل ولا تتجاوز 72 بايت UTF-8.')}</p><button class="primary" type="submit">${label('Activate Business Admin account','تفعيل حساب مسؤول النشاط')}</button></form></div></div>`;
    const form=node.querySelector('#sx-owner-setup-form'),message=node.querySelector('#sx-owner-setup-msg');
    form.onsubmit=async event=>{event.preventDefault();const button=event.submitter,values=new FormData(form),password=values.get('password');if(password!==values.get('confirm')){message.innerHTML=`<div class="error" role="alert">${label('Passwords do not match.','كلمتا المرور غير متطابقتين.')}</div>`;return;}button.disabled=true;
      try{await api('/api/admin/staff-invitations/business-owner/accept',{public:true,method:'POST',body:{token:ownerSetupToken,name:values.get('name'),password}});ownerSetupToken='';sessionStorage.removeItem('sx_business_owner_setup_token');message.innerHTML=`<div class="notice" role="status">${label('Your owner account is active. Continue to the existing business sign-in.','تم تفعيل حساب المالك. تابع إلى تسجيل دخول النشاط الحالي.')}</div>`;form.remove();const link=document.createElement('a');link.href='/user/login';link.textContent=label('Continue to business sign-in','المتابعة إلى تسجيل دخول النشاط');node.querySelector('.card').append(link);}
      catch(error){if(error.message==='INVITE_INVALID'){ownerSetupToken='';sessionStorage.removeItem('sx_business_owner_setup_token');}message.innerHTML=`<div class="error" role="alert">${esc(errorText(error.message))}</div>`;}
      finally{if(button.isConnected)button.disabled=false;}
    };
  }
  function addNav() {
    if (location.pathname.replace(/\/$/,'') !== '/user') return;
    const item = [...document.querySelectorAll('[role="button"],button,a')].find(node => ['Agent Login','تسجيل دخول الوكيل','دخول الوكيل'].includes((node.innerText || '').trim()));
    if (!item) return;
    const row = item.closest('li') || item.parentElement;
    if (!row?.parentElement || row.parentElement.querySelector('[data-sx-team-nav]')) return;
    const copy = row.cloneNode(true); copy.dataset.sxTeamNav = '1';
    copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    copy.querySelectorAll('span').forEach(span => { if (['Agent Login','تسجيل دخول الوكيل','دخول الوكيل'].includes(span.textContent.trim())) span.textContent = label('Team access','إدارة وصول الفريق'); });
    copy.setAttribute('aria-label',label('Team access','إدارة وصول الفريق'));
    const button = copy.querySelector('[role="button"],button,a') || copy;
    button.onclick = event => { event.preventDefault(); location.href = '/user?page=team-invitations'; };
    row.parentElement.insertBefore(copy,row.nextSibling);
  }
  function update() {
    accountBanner();
    addNav();
    if(ownerSetupToken){activateBusinessOwner();return;}
    if (route()) { if (inviteToken) accept(); else if (!document.getElementById('sx-team-screen')) load(); }
    else if (!inviteToken) document.getElementById('sx-team-screen')?.remove();
  }
  // The legacy sidebar is inserted after this deferred script starts. Keep
  // looking for its Agent Login row on every route so owners see Team access
  // from the regular dashboard without first visiting that page.
  const observer = new MutationObserver(addNav);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  // Keep injected screens in sync with the application's SPA query routes. The
  // legacy React shell changes routes with history.pushState, which does not
  // emit popstate; without this, Team access can remain fixed over Inbox.
  if (!window.__sxTeamRouteHistoryHook) {
    window.__sxTeamRouteHistoryHook = true;
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        queueMicrotask(update);
        return result;
      };
    }
  }
  window.addEventListener('popstate',update);
  window.addEventListener('hashchange',update);
  window.addEventListener('pageshow',update);
  if(ownerSetupToken)activateBusinessOwner();else if (inviteToken) accept(); else update();
})();
