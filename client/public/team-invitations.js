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
    agent: ['Agent', 'وكيل']
  };
  const seatTitles = {
    accountant: ['Accountant seats', 'مقاعد المحاسبين'],
    manager: ['Manager seats', 'مقاعد المديرين'],
    agent: ['Agent seats', 'مقاعد الوكلاء']
  };
  let inviteToken = window.__sxTeamInviteToken || sessionStorage.getItem('sx_team_invite_token') || '';
  let currentTeamData = null;
  const permissionModules={tenant:['Business settings','إعدادات النشاط'],channels:['WhatsApp connections','اتصالات واتساب'],automation:['Automation','الأتمتة'],campaigns:['Campaigns','الحملات'],conversations:['Inbox','صندوق الوارد'],leads:['Lead pipeline','مسار العملاء المحتملين'],contacts:['Phonebook','دليل الهاتف'],courses:['Courses','الدورات'],sales:['Enrollments','التسجيلات'],invoices:['Invoices','الفواتير'],payments:['Payments','المدفوعات'],receipts:['Receipts','الإيصالات'],credits:['Credits and refunds','الإشعارات الدائنة والاسترداد'],reports:['Reports','التقارير'],forms:['Lead forms','نماذج العملاء المحتملين'],tasks:['Tasks','المهام'],calls:['Call center','مركز الاتصال'],team:['Team','الفريق'],templates:['Templates','القوالب']};
  const permissionActions={read:['View','عرض'],manage:['Manage','إدارة'],reply:['Reply','الرد'],configure:['Configure','إعداد'],send:['Send','إرسال'],assign:['Assign','تعيين'],request:['Request','طلب'],approve:['Approve','اعتماد'],issue:['Issue','إصدار'],verify:['Verify','تحقق'],prepare:['Prepare','إعداد'],schedule:['Schedule','جدولة'],capture:['Capture','إدخال']};
  try { delete window.__sxTeamInviteToken; sessionStorage.removeItem('sx_team_invite_token'); } catch (_) {}
  if (!inviteToken && route()) inviteToken = new URLSearchParams(location.hash.slice(1)).get('team-invite') || '';
  if (inviteToken) history.replaceState(null, '', location.pathname + location.search);

  const css = document.createElement('style');
  css.textContent = `#sx-team-screen{position:fixed;z-index:1200;inset:64px 0 0 250px;background:#f5f7fa;overflow:auto;padding:24px;box-sizing:border-box;font:14px/1.5 Roboto,Arial,sans-serif;color:#17212f}#sx-team-screen[dir=rtl]{inset-inline:250px 0}#sx-team-screen[data-accept="1"]{z-index:2147483000;inset:0!important;padding:24px!important}#sx-team-screen .wrap{max-width:1100px;margin:auto}#sx-team-screen h1{font-size:24px;margin:0 0 6px}#sx-team-screen h2{font-size:18px;margin:0 0 12px}#sx-team-screen p{color:#667085}#sx-team-screen .card{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:18px;margin:16px 0;box-shadow:0 3px 12px #1018280a}#sx-team-screen form{display:grid;grid-template-columns:2fr 1fr auto;gap:10px;align-items:end}#sx-team-screen label{display:grid;gap:6px;font-weight:600}#sx-team-screen input,#sx-team-screen select{min-height:42px;border:1px solid #cfd5dd;border-radius:8px;padding:8px 10px;font:inherit;background:white;color:inherit}#sx-team-screen button{min-height:40px;padding:8px 13px;border:1px solid #d0d5dd;border-radius:8px;background:white;cursor:pointer;color:inherit;font:inherit}#sx-team-screen button.primary{background:#a8003b;border-color:#a8003b;color:white}#sx-team-screen button:disabled{opacity:.55;cursor:not-allowed}#sx-team-screen .row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid #eaecf0;padding:13px 0}#sx-team-screen .actions{display:flex;gap:8px;flex-wrap:wrap}#sx-team-screen .notice{padding:12px;border-radius:8px;background:#ecfdf3;overflow-wrap:anywhere}#sx-team-screen .error{background:#fff1f0;color:#b42318;padding:12px;border-radius:8px}#sx-team-screen .muted{font-size:12px;color:#667085}#sx-team-screen .seat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}#sx-team-screen .seat-card{border:1px solid #e4e7ec;border-radius:10px;padding:14px}#sx-team-screen .seat-card strong{display:block;margin-bottom:8px}#sx-team-screen .seat-metrics{display:flex;flex-wrap:wrap;gap:6px 14px;color:#475467;font-size:12px}#sx-team-screen .member-card{border:1px solid #e4e7ec;border-radius:10px;padding:16px;margin:12px 0}#sx-team-screen .member-head{display:flex;justify-content:space-between;gap:12px;align-items:center}#sx-team-screen .nav-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px 0}#sx-team-screen .nav-option{display:flex;align-items:flex-start;gap:9px;padding:9px;border:1px solid #eaecf0;border-radius:8px;font-weight:400}#sx-team-screen .nav-option input{min-height:18px;width:18px;margin:2px 0 0;accent-color:#a8003b}#sx-team-screen .nav-group{grid-column:1/-1;margin:8px 0 0;color:#667085;font-size:12px;font-weight:700}#sx-team-screen code{overflow-wrap:anywhere}#sx-team-screen .accept-meta{padding:12px;background:#f8f9fc;border-radius:8px;margin:12px 0}#sx-team-screen .accept-form{grid-template-columns:1fr!important;max-width:560px}#sx-team-screen :focus-visible{outline:3px solid #7b2cbf;outline-offset:2px}@media(max-width:1000px){#sx-team-screen .nav-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){#sx-team-screen,#sx-team-screen[dir=rtl]{inset-inline:0;top:56px;padding:16px}#sx-team-screen[data-accept="1"]{inset:0!important;padding:16px!important}#sx-team-screen form{grid-template-columns:1fr}#sx-team-screen .row{align-items:flex-start;flex-direction:column}#sx-team-screen .seat-grid{grid-template-columns:1fr}#sx-team-screen .nav-grid{grid-template-columns:1fr}#sx-team-screen .member-head{align-items:flex-start;flex-direction:column}}`;
  css.textContent += `#sx-team-screen .role-form{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}#sx-team-screen .role-description,#sx-team-screen .permission-fieldset{grid-column:1/-1}#sx-team-screen .permission-fieldset{min-width:0;border:1px solid #e4e7ec;border-radius:10px;padding:12px}#sx-team-screen .permission-fieldset legend{padding:0 6px;font-weight:700}#sx-team-screen .permission-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}#sx-team-screen .permission-group{grid-column:1/-1;margin-top:8px;color:#667085;font-weight:700}#sx-team-screen .permission-option{display:flex;align-items:center;gap:8px;border:1px solid #eaecf0;border-radius:8px;padding:8px;font-weight:400}#sx-team-screen .permission-option input{min-height:18px;width:18px;margin:0;accent-color:#a8003b}#sx-team-screen .role-row{display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid #eaecf0;padding:12px 0}#sx-team-screen .role-actions{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:1000px){#sx-team-screen .permission-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){#sx-team-screen .role-form,#sx-team-screen .permission-grid{grid-template-columns:1fr}#sx-team-screen .role-row{align-items:flex-start;flex-direction:column}}`;
  document.head.append(css);

  const getToken = () => localStorage.getItem('wacrm_user');
  async function api(url, options = {}) {
    const headers = {'Content-Type':'application/json'};
    if (!options.public) {
      const token = getToken();
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
      INVALID_NAVIGATION: label('The sidebar selection is invalid. Reload and try again.','اختيار القائمة غير صالح. أعد التحميل وحاول مرة أخرى.'),
      NAVIGATION_NOT_AVAILABLE: label('One or more sections are unavailable for this role or plan. Reload the team list and try again.','قسم واحد أو أكثر غير متاح لهذا الدور أو الباقة. أعد تحميل قائمة الفريق وحاول مرة أخرى.'),
      MEMBER_NOT_FOUND: label('This team member is no longer active. Reload the list.','عضو الفريق هذا لم يعد نشطاً. أعد تحميل القائمة.'),
      INVITE_INVALID: label('This link is invalid, expired or already used. Ask the owner to create a new invitation.','الرابط غير صالح أو منتهي أو مستخدم. اطلب من المالك إنشاء دعوة جديدة.'),
      ORIGIN_DENIED: label('Request origin could not be verified. Reload the page and retry.','تعذر التحقق من مصدر الطلب. أعد تحميل الصفحة وحاول مرة أخرى.'),
      MEMBERSHIP_EXISTS: label('This email already has an account. Ask the business owner to manage access.','هذا البريد لديه حساب بالفعل. اطلب من مالك النشاط إدارة الوصول.'),
      INVALID_MOBILE: label('Enter a phone number in international format, such as +97450123456.','أدخل رقم الهاتف بالصيغة الدولية، مثل ‎+97450123456.')
    })[code] || label('Could not complete the request. Please retry.','تعذر إكمال الطلب. يرجى المحاولة مجدداً.');
  }

  async function load() {
    const node = screen();
    node.innerHTML = `<div class="wrap"><h1>${label('Team access','إدارة وصول الفريق')}</h1><p>${label('Create roles with the access your team needs, then invite staff and agents into those roles. Plan seat limits still apply.','أنشئ أدواراً بالصلاحيات المطلوبة ثم ادعُ الموظفين والوكلاء إليها. تظل حدود مقاعد الباقة سارية.')}</p><div id="sx-team-msg" role="status" aria-live="polite"></div><div class="card"><h2>${label('Roles & permissions','الأدوار والصلاحيات')}</h2><p class="muted">${label('Each role starts from an accountant, manager or agent seat. You can remove access from that role, but cannot grant more than its seat type allows. Permissions also restrict API access.','يبدأ كل دور من مقعد محاسب أو مدير أو وكيل. يمكنك تقليل الصلاحيات ولا يمكنك تجاوز صلاحيات نوع المقعد. وتُطبق الصلاحيات على واجهات النظام أيضاً.')}</p><form id="sx-role-form" class="role-form"><input type="hidden" name="id"><label>${label('Role name','اسم الدور')}<input name="name" required maxlength="80"></label><label>${label('Seat type','نوع المقعد')}<select name="seatRole" required>${Object.entries(roles).map(([key,value])=>`<option value="${key}">${label(value[0],value[1])}</option>`).join('')}</select></label><label class="role-description">${label('Description (optional)','الوصف (اختياري)')}<input name="description" maxlength="300"></label><fieldset class="permission-fieldset"><legend>${label('Module permissions','صلاحيات الوحدات')}</legend><div id="sx-role-permissions"></div></fieldset><button type="submit" class="primary">${label('Create role','إنشاء الدور')}</button><button type="button" id="sx-role-reset">${label('Clear','مسح')}</button></form><div id="sx-role-list">${label('Loading roles…','جارٍ تحميل الأدوار…')}</div></div><div class="card"><h2>${label('Plan seat usage','استخدام مقاعد الباقة')}</h2><div id="sx-team-seat-usage">${label('Loading seat usage…','جارٍ تحميل المقاعد…')}</div></div><div class="card"><h2>${label('Team members','أعضاء الفريق')}</h2><p class="muted">${label('Sidebar access can further restrict each member. Role permissions are enforced separately by the server.','يمكن تقييد قائمة كل عضو أكثر. وتُطبق صلاحيات الدور بشكل مستقل على الخادم.')}</p><div id="sx-team-members">${label('Loading team members…','جارٍ تحميل أعضاء الفريق…')}</div></div><div class="card"><h2>${label('Add staff or agent','إضافة موظف أو وكيل')}</h2><form id="sx-team-form"><label>${label('Email address','البريد الإلكتروني')}<input name="email" type="email" required maxlength="254" autocomplete="email"></label><label>${label('Assign role','تعيين الدور')}<select name="assignment" required aria-label="${label('Assign role','تعيين الدور')}"></select></label><button type="submit" class="primary" disabled>${label('Create invitation','إنشاء دعوة')}</button></form><p class="muted">${label('The one-time link is shown once. Copy and send it using your approved channel. Automatic email and WhatsApp delivery are not available yet.','يظهر الرابط لمرة واحدة. انسخه وأرسله عبر القناة المعتمدة. الإرسال التلقائي بالبريد وواتساب غير متاح حالياً.')}</p></div><div class="card"><h2>${label('Invitations','الدعوات')}</h2><div id="sx-team-list">${label('Loading…','جارٍ التحميل…')}</div></div></div>`;
    const form = node.querySelector('#sx-team-form');
    form.onsubmit = async event => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      const data = new FormData(form);
      try {
        const assignment=String(data.get('assignment')||'');
        const inviteBody={email:data.get('email'),requestKey:crypto.randomUUID()};
        if(assignment.startsWith('profile:'))inviteBody.roleProfileId=assignment.slice(8);else inviteBody.role=assignment.slice(7);
        const invite = await api('/api/user/team-invitations/', {method:'POST', body:inviteBody});
        showLink(node, invite.token, label('Copy this one-time invitation link now','انسخ رابط الدعوة لمرة واحدة الآن'));
        form.reset();
        await list(node);
      } catch (error) {
        node.querySelector('#sx-team-msg').innerHTML = `<div class="error" role="alert">${esc(errorText(error.message))}</div>`;
        await list(node);
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
  function renderRolePermissions(data,selected){
    const target=document.getElementById('sx-role-permissions'),seatRole=document.querySelector('#sx-role-form [name="seatRole"]')?.value;
    if(!target||!seatRole)return;
    const permissions=data?.permissionCatalog?.[seatRole]||[];
    const chosen=new Set(selected||permissions),groups=new Map();
    for(const key of permissions){const group=permissionGroup(key);const heading=label(group[0],group[1]);if(!groups.has(heading))groups.set(heading,[]);groups.get(heading).push(key);}
    target.innerHTML=`<div class="permission-grid">${[...groups].map(([group,keys])=>`<div class="permission-group">${esc(group)}</div>${keys.map(key=>`<label class="permission-option"><input type="checkbox" name="permission" value="${esc(key)}" ${chosen.has(key)?'checked':''}><span>${esc(permissionTitle(key))}</span></label>`).join('')}`).join('')}</div><p class="muted">${label('These are the maximum permissions available to this seat type. Plan and category access still apply.','هذه هي الحدود القصوى لصلاحيات هذا النوع من المقاعد. تظل صلاحيات الباقة والفئة مطبقة.')}</p>`;
  }
  function resetRoleForm(node){
    const form=node.querySelector('#sx-role-form');form.reset();form.elements.id.value='';
    form.elements.seatRole.disabled=false;form.querySelector('button[type="submit"]').textContent=label('Create role','إنشاء الدور');
    renderRolePermissions(currentTeamData);
  }
  async function saveRole(event){
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),id=form.elements.id.value;
    const body={name:form.elements.name.value,description:form.elements.description.value,permissions:[...form.querySelectorAll('[name="permission"]:checked')].map(input=>input.value)};
    if(!id)body.seatRole=form.elements.seatRole.value;
    button.disabled=true;
    try{await api('/api/user/team-invitations/roles'+(id?'/'+encodeURIComponent(id):''),{method:id?'PUT':'POST',body});nodeMessage(document.getElementById('sx-team-msg'),label(id?'Role updated.':'Role created.','تم تحديث الدور.'),false);resetRoleForm(document.getElementById('sx-team-screen'));await list(document.getElementById('sx-team-screen'));}
    catch(error){nodeMessage(document.getElementById('sx-team-msg'),errorText(error.message),true);}
    finally{button.disabled=false;}
  }
  function renderRoles(element,data){
    if(!element)return;
    const rolesList=data.roles||[];
    if(!rolesList.length){element.innerHTML=`<div class="muted">${label('No custom roles yet. Create one above.','لا توجد أدوار مخصصة بعد. أنشئ دوراً أعلاه.')}</div>`;return;}
    element.innerHTML=rolesList.map(item=>`<div class="role-row" data-role-id="${esc(item.id)}"><div><strong>${esc(item.name)}</strong><div class="muted">${esc(roleLabel(item.seatRole))} · ${esc(item.status)} · ${esc((item.permissions||[]).length)} ${label('permissions','صلاحيات')}</div>${item.description?`<div class="muted">${esc(item.description)}</div>`:''}</div><div class="role-actions">${item.status==='active'?`<button type="button" data-edit-role>${label('Edit','تعديل')}</button><button type="button" data-archive-role>${label('Archive','أرشفة')}</button>`:''}</div></div>`).join('');
    element.querySelectorAll('[data-edit-role]').forEach(button=>button.onclick=()=>{
      const item=rolesList.find(role=>role.id===button.closest('[data-role-id]').dataset.roleId);if(!item)return;
      const form=document.getElementById('sx-role-form');form.elements.id.value=item.id;form.elements.name.value=item.name;form.elements.description.value=item.description||'';form.elements.seatRole.value=item.seatRole;form.elements.seatRole.disabled=true;
      form.querySelector('button[type="submit"]').textContent=label('Save role','حفظ الدور');renderRolePermissions(data,item.permissions||[]);form.scrollIntoView({behavior:'smooth',block:'center'});
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
    const available = new Set(data.availableRoles || []);
    const select = document.querySelector('#sx-team-form select[name="assignment"]');
    if (select) {
      select.replaceChildren();
      for (const key of Object.keys(roles)) {
        const option = document.createElement('option'); option.value = 'system:'+key;
        option.textContent = roleLabel(key) + (available.has(key) ? '' : ' · ' + label('No seats','لا توجد مقاعد'));
        option.disabled = !available.has(key); select.append(option);
      }
      for(const profile of data.roles||[]){if(profile.status!=='active')continue;const option=document.createElement('option');option.value='profile:'+profile.id;const hasSeats=available.has(profile.seatRole);option.textContent=profile.name+' · '+roleLabel(profile.seatRole)+(hasSeats?'':' · '+label('No seats','لا توجد مقاعد'));option.disabled=!hasSeats;select.append(option);}
      const first = [...select.options].find(option => !option.disabled);
      if (first) select.value = first.value;
    }
    for (const key of Object.keys(roles)) {
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
  async function list(node) {
    const element = node.querySelector('#sx-team-list');
    if (!element) return;
    try {
      const data = await api('/api/user/team-invitations/');
      currentTeamData=data;
      renderSeats(node.querySelector('#sx-team-seat-usage'), data);
      renderRoles(node.querySelector('#sx-role-list'),data);
      if(!node.querySelector('#sx-role-form [name="id"]').value)renderRolePermissions(data);
      renderMembers(node.querySelector('#sx-team-members'),data);
      element.innerHTML = data.invitations.length ? data.invitations.map(invite => `<div class="row"><div><strong>${esc(invite.email)}</strong><div class="muted">${esc(invite.roleName||roleLabel(invite.role))} · ${esc(invite.status)} · ${esc(invite.expiresAt || '')}</div></div><div class="actions">${['pending','expired'].includes(invite.status) ? `<button data-rotate="${esc(invite.id)}">${label('Create new link','إنشاء رابط جديد')}</button>${invite.status === 'pending' ? `<button data-cancel="${esc(invite.id)}">${label('Cancel','إلغاء')}</button>` : ''}` : ''}</div></div>`).join('') : `<div class="muted">${label('No invitations yet.','لا توجد دعوات بعد.')}</div>`;
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
  function renderMembers(element,data){
    if(!element)return;
    if(!data.members?.length){element.innerHTML=`<div class="muted">${label('No active team members yet. Members will appear here after they accept an invitation.','لا يوجد أعضاء فريق نشطون بعد. سيظهر الأعضاء هنا بعد قبول الدعوة.')}</div>`;return;}
    element.innerHTML=data.members.map(member=>{
      const options=(member.roleProfileId?data.navigationByRoleProfile?.[member.roleProfileId]:data.navigationByRole?.[member.role])||[],selected=new Set(member.assignedNavigation===null?options.map(item=>item.key):member.assignedNavigation);
      const groups=new Map();for(const option of options){const name=label(option.group.en,option.group.ar);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(option);}
      const choices=[...groups].map(([group,items])=>`<div class="nav-group">${esc(group)}</div>${items.map(item=>`<label class="nav-option"><input type="checkbox" data-nav-key="${esc(item.key)}" ${selected.has(item.key)?'checked':''}><span>${esc(label(item.label.en,item.label.ar))}</span></label>`).join('')}`).join('');
      return `<section class="member-card" data-member="${esc(member.id)}"><div class="member-head"><div><strong>${esc(member.displayName||member.email)}</strong><div class="muted">${esc(member.email)} · ${esc(member.roleName||roleLabel(member.role))}</div></div><button type="button" class="primary" data-save-navigation>${label('Save sidebar access','حفظ صلاحيات القائمة')}</button></div><div class="nav-grid">${choices}</div></section>`;
    }).join('');
    element.querySelectorAll('[data-save-navigation]').forEach(button=>button.onclick=async()=>{
      const card=button.closest('[data-member]'),navigation=[...card.querySelectorAll('[data-nav-key]:checked')].map(input=>input.dataset.navKey);
      button.disabled=true;
      try{await api('/api/user/team-invitations/members/'+encodeURIComponent(card.dataset.member)+'/navigation',{method:'PUT',body:{navigation}});nodeMessage(element,label('Sidebar access saved.','تم حفظ صلاحيات القائمة.'),false);}
      catch(error){nodeMessage(element,errorText(error.message),true);}
      finally{button.disabled=false;}
    });
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
    addNav();
    if (route()) { if (inviteToken) accept(); else if (!document.getElementById('sx-team-screen')) load(); }
    else if (!inviteToken) document.getElementById('sx-team-screen')?.remove();
  }
  // The legacy sidebar is inserted after this deferred script starts. Keep
  // looking for its Agent Login row on every route so owners see Team access
  // from the regular dashboard without first visiting that page.
  const observer = new MutationObserver(addNav);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',update);
  if (inviteToken) accept(); else update();
})();
