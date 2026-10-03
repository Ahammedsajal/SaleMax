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
  try { delete window.__sxTeamInviteToken; sessionStorage.removeItem('sx_team_invite_token'); } catch (_) {}
  if (!inviteToken && route()) inviteToken = new URLSearchParams(location.hash.slice(1)).get('team-invite') || '';
  if (inviteToken) history.replaceState(null, '', location.pathname + location.search);

  const css = document.createElement('style');
  css.textContent = `#sx-team-screen{position:fixed;z-index:1200;inset:64px 0 0 250px;background:#f5f7fa;overflow:auto;padding:24px;box-sizing:border-box;font:14px/1.5 Roboto,Arial,sans-serif;color:#17212f}#sx-team-screen[dir=rtl]{inset-inline:250px 0}#sx-team-screen[data-accept="1"]{z-index:2147483000;inset:0!important;padding:24px!important}#sx-team-screen .wrap{max-width:1100px;margin:auto}#sx-team-screen h1{font-size:24px;margin:0 0 6px}#sx-team-screen h2{font-size:18px;margin:0 0 12px}#sx-team-screen p{color:#667085}#sx-team-screen .card{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:18px;margin:16px 0;box-shadow:0 3px 12px #1018280a}#sx-team-screen form{display:grid;grid-template-columns:2fr 1fr auto;gap:10px;align-items:end}#sx-team-screen label{display:grid;gap:6px;font-weight:600}#sx-team-screen input,#sx-team-screen select{min-height:42px;border:1px solid #cfd5dd;border-radius:8px;padding:8px 10px;font:inherit;background:white;color:inherit}#sx-team-screen button{min-height:40px;padding:8px 13px;border:1px solid #d0d5dd;border-radius:8px;background:white;cursor:pointer;color:inherit;font:inherit}#sx-team-screen button.primary{background:#a8003b;border-color:#a8003b;color:white}#sx-team-screen button:disabled{opacity:.55;cursor:not-allowed}#sx-team-screen .row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid #eaecf0;padding:13px 0}#sx-team-screen .actions{display:flex;gap:8px;flex-wrap:wrap}#sx-team-screen .notice{padding:12px;border-radius:8px;background:#ecfdf3;overflow-wrap:anywhere}#sx-team-screen .error{background:#fff1f0;color:#b42318;padding:12px;border-radius:8px}#sx-team-screen .muted{font-size:12px;color:#667085}#sx-team-screen .seat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}#sx-team-screen .seat-card{border:1px solid #e4e7ec;border-radius:10px;padding:14px}#sx-team-screen .seat-card strong{display:block;margin-bottom:8px}#sx-team-screen .seat-metrics{display:flex;flex-wrap:wrap;gap:6px 14px;color:#475467;font-size:12px}#sx-team-screen code{overflow-wrap:anywhere}#sx-team-screen .accept-meta{padding:12px;background:#f8f9fc;border-radius:8px;margin:12px 0}#sx-team-screen .accept-form{grid-template-columns:1fr!important;max-width:560px}#sx-team-screen :focus-visible{outline:3px solid #7b2cbf;outline-offset:2px}@media(max-width:760px){#sx-team-screen,#sx-team-screen[dir=rtl]{inset-inline:0;top:56px;padding:16px}#sx-team-screen[data-accept="1"]{inset:0!important;padding:16px!important}#sx-team-screen form{grid-template-columns:1fr}#sx-team-screen .row{align-items:flex-start;flex-direction:column}#sx-team-screen .seat-grid{grid-template-columns:1fr}}`;
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
  function errorText(code) {
    return ({
      AUTH_REQUIRED: label('Sign in as the business owner to manage invitations.','سجّل دخولك بصفتك مالك النشاط لإدارة الدعوات.'),
      SEAT_LIMIT_EXCEEDED: label('No seats are available for this role on the assigned plan.','لا توجد مقاعد متاحة لهذا الدور في الباقة المعينة.'),
      TEAM_FEATURE_UNAVAILABLE: label('Team invitations are not enabled on the current plan.','دعوات الفريق غير مفعلة في الباقة الحالية.'),
      FEATURE_UNAVAILABLE: label('Team invitations are not enabled on the current plan.','دعوات الفريق غير مفعلة في الباقة الحالية.'),
      INVALID_ROLE: label('Choose an available team role.','اختر دوراً متاحاً للفريق.'),
      INVITE_INVALID: label('This link is invalid, expired or already used. Ask the owner to create a new invitation.','الرابط غير صالح أو منتهي أو مستخدم. اطلب من المالك إنشاء دعوة جديدة.'),
      ORIGIN_DENIED: label('Request origin could not be verified. Reload the page and retry.','تعذر التحقق من مصدر الطلب. أعد تحميل الصفحة وحاول مرة أخرى.'),
      MEMBERSHIP_EXISTS: label('This email already has an account. Ask the business owner to manage access.','هذا البريد لديه حساب بالفعل. اطلب من مالك النشاط إدارة الوصول.'),
      INVALID_MOBILE: label('Enter a phone number in international format, such as +97450123456.','أدخل رقم الهاتف بالصيغة الدولية، مثل ‎+97450123456.')
    })[code] || label('Could not complete the request. Please retry.','تعذر إكمال الطلب. يرجى المحاولة مجدداً.');
  }

  async function load() {
    const node = screen();
    node.innerHTML = `<div class="wrap"><h1>${label('Team access','إدارة وصول الفريق')}</h1><p>${label('Invite accountants, managers and agents. Each role uses its own seat limit from the assigned plan.','ادعُ المحاسبين والمديرين والوكلاء. لكل دور حد مقاعد مستقل وفق الباقة المعينة.')}</p><div id="sx-team-msg" role="status" aria-live="polite"></div><div class="card"><h2>${label('Plan seat usage','استخدام مقاعد الباقة')}</h2><div id="sx-team-seat-usage">${label('Loading seat usage…','جارٍ تحميل المقاعد…')}</div></div><div class="card"><h2>${label('Invite a team member','دعوة عضو للفريق')}</h2><form id="sx-team-form"><label>${label('Email address','البريد الإلكتروني')}<input name="email" type="email" required maxlength="254" autocomplete="email"></label><label>${label('Role','الدور')}<select name="role" required aria-label="${label('Role','الدور')}"></select></label><button type="submit" class="primary" disabled>${label('Create invitation','إنشاء دعوة')}</button></form><p class="muted">${label('The one-time link is shown once. Copy and send it using your approved channel. Automatic email and WhatsApp delivery are not available yet.','يظهر الرابط لمرة واحدة. انسخه وأرسله عبر القناة المعتمدة. الإرسال التلقائي بالبريد وواتساب غير متاح حالياً.')}</p></div><div class="card"><h2>${label('Invitations','الدعوات')}</h2><div id="sx-team-list">${label('Loading…','جارٍ التحميل…')}</div></div></div>`;
    const form = node.querySelector('#sx-team-form');
    form.onsubmit = async event => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      const data = new FormData(form);
      try {
        const invite = await api('/api/user/team-invitations/', {method:'POST', body:{email:data.get('email'),role:data.get('role'),requestKey:crypto.randomUUID()}});
        showLink(node, invite.token, label('Copy this one-time invitation link now','انسخ رابط الدعوة لمرة واحدة الآن'));
        form.reset();
        await list(node);
      } catch (error) {
        node.querySelector('#sx-team-msg').innerHTML = `<div class="error" role="alert">${esc(errorText(error.message))}</div>`;
        await list(node);
      }
    };
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
  function renderSeats(element, data) {
    element.replaceChildren();
    const values = data.seatUsage || {};
    const available = new Set(data.availableRoles || []);
    const select = document.querySelector('#sx-team-form select[name="role"]');
    if (select) {
      select.replaceChildren();
      for (const key of Object.keys(roles)) {
        const option = document.createElement('option'); option.value = key;
        option.textContent = roleLabel(key) + (available.has(key) ? '' : ' · ' + label('No seats','لا توجد مقاعد'));
        option.disabled = !available.has(key); select.append(option);
      }
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
    if (button) button.disabled = available.size === 0;
  }
  async function list(node) {
    const element = node.querySelector('#sx-team-list');
    if (!element) return;
    try {
      const data = await api('/api/user/team-invitations/');
      renderSeats(node.querySelector('#sx-team-seat-usage'), data);
      element.innerHTML = data.invitations.length ? data.invitations.map(invite => `<div class="row"><div><strong>${esc(invite.email)}</strong><div class="muted">${esc(roleLabel(invite.role))} · ${esc(invite.status)} · ${esc(invite.expiresAt || '')}</div></div><div class="actions">${['pending','expired'].includes(invite.status) ? `<button data-rotate="${esc(invite.id)}">${label('Create new link','إنشاء رابط جديد')}</button>${invite.status === 'pending' ? `<button data-cancel="${esc(invite.id)}">${label('Cancel','إلغاء')}</button>` : ''}` : ''}</div></div>`).join('') : `<div class="muted">${label('No invitations yet.','لا توجد دعوات بعد.')}</div>`;
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
  async function accept() {
    if (!inviteToken) return;
    const node = screen(); node.dataset.accept = '1';
    node.innerHTML = `<div class="wrap"><div class="card"><h1>${label('Join your training-center team','انضم إلى فريق مركز التدريب')}</h1><div id="sx-invite-preview">${label('Checking invitation…','جارٍ التحقق من الدعوة…')}</div><div id="sx-accept-msg" role="alert" aria-live="assertive"></div><form id="sx-accept-form" class="accept-form" hidden><label>${label('Full name','الاسم الكامل')}<input name="displayName" required maxlength="200" autocomplete="name"></label><label id="sx-mobile-label">${label('Mobile number in international format','رقم الهاتف بالصيغة الدولية')}<input name="mobile" type="tel" placeholder="+97450123456" pattern="\\+[1-9][0-9]{7,14}" autocomplete="tel"></label><label>${label('Password (at least 12 characters)','كلمة المرور (12 حرفاً على الأقل)')}<input name="password" type="password" required minlength="12" maxlength="72" autocomplete="new-password"></label><button class="primary" type="submit">${label('Activate account','تفعيل الحساب')}</button></form></div></div>`;
    const preview = node.querySelector('#sx-invite-preview');
    try {
      const invitation = await api('/api/agent/invitations/preview/' + encodeURIComponent(inviteToken),{public:true});
      preview.innerHTML = `<p>${label('You are invited to join','تمت دعوتك للانضمام إلى')} <strong>${esc(invitation.businessName)}</strong>.</p><div class="accept-meta"><div>${label('Email','البريد الإلكتروني')}: <strong>${esc(invitation.email)}</strong></div><div>${label('Role','الدور')}: <strong>${esc(roleLabel(invitation.role))}</strong></div></div>`;
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
    const item = [...document.querySelectorAll('[role="button"],button,a')].find(node => ['Agent Login','تسجيل دخول الوكيل'].includes((node.innerText || '').trim()));
    if (!item) return;
    const row = item.closest('li') || item.parentElement;
    if (!row?.parentElement || row.parentElement.querySelector('[data-sx-team-nav]')) return;
    const copy = row.cloneNode(true); copy.dataset.sxTeamNav = '1';
    copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    copy.querySelectorAll('span').forEach(span => { if (['Agent Login','تسجيل دخول الوكيل'].includes(span.textContent.trim())) span.textContent = label('Team access','إدارة وصول الفريق'); });
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
  const observer = new MutationObserver(() => { if (route()) addNav(); });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',update);
  if (inviteToken) accept(); else update();
})();
