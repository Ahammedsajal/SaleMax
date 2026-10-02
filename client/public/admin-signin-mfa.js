(() => {
  'use strict';
  if (window.__salemaxAdminMfaInstalled) return;
  window.__salemaxAdminMfaInstalled = true;
  const q = (selector, root = document) => root.querySelector(selector);
  let busy = false;
  let activeCsrf = '';
  const english = () => {
    const language = String(localStorage.getItem('language') || document.documentElement.lang || 'en').toLowerCase();
    return !language.startsWith('ar') && language !== 'arabic' && document.documentElement.dir !== 'rtl';
  };
  const tr = (en, ar) => english() ? en : ar;
  const token = () => localStorage.getItem('wacrm_admin') || '';
  const parse = async response => {
    let data;
    try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) throw Object.assign(new Error(data.msg || data.code || 'Request failed'), { code: data.code || 'REQUEST_FAILED' });
    return data;
  };
  async function platformApi(path, legacyToken, csrf, body) {
    const response = await fetch('/api/admin/platform-auth/' + path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: { Authorization: 'Bearer ' + legacyToken, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return parse(response);
  }
  function makeOverlay() {
    q('#salemax-admin-mfa')?.remove();
    const style = document.createElement('style');
    style.textContent = '#salemax-admin-mfa{position:fixed;inset:0;z-index:2147483000;background:rgba(18,24,38,.58);display:grid;place-items:center;padding:18px;font:15px Roboto,Arial,sans-serif;color:#202938}#salemax-admin-mfa *{box-sizing:border-box}#salemax-admin-mfa .sx-card{width:min(100%,520px);max-height:calc(100vh - 36px);overflow:auto;background:#fff;border-radius:18px;padding:28px;box-shadow:0 18px 70px #10182855}#salemax-admin-mfa h2{margin:0 0 10px;font-size:23px}#salemax-admin-mfa p{line-height:1.55;color:#586477}#salemax-admin-mfa label{display:block;margin:18px 0 8px;font-weight:600}#salemax-admin-mfa input[type=text]{display:block;width:100%;height:48px;margin-top:7px;border:1px solid #ccd4e0;border-radius:9px;padding:10px 12px;font:inherit}#salemax-admin-mfa button{min-height:46px;border:0;border-radius:9px;padding:10px 16px;background:#a8003b;color:#fff;font-weight:700;cursor:pointer}#salemax-admin-mfa button:disabled{opacity:.55;cursor:wait}#salemax-admin-mfa .sx-actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}#salemax-admin-mfa .sx-error{color:#a20b20;background:#fff0f0;padding:10px;border-radius:8px;margin-top:12px}#salemax-admin-mfa img{display:block;width:200px;height:200px;margin:16px auto}#salemax-admin-mfa code,#salemax-admin-mfa pre{display:block;overflow-wrap:anywhere;background:#f2f5fa;padding:12px;border-radius:8px;user-select:all}#salemax-admin-mfa [dir=rtl]{text-align:right}';
    document.head.appendChild(style);
    const overlay = document.createElement('div'); overlay.id = 'salemax-admin-mfa'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    const card = document.createElement('section'); card.className = 'sx-card'; card.dir = english() ? 'ltr' : 'rtl'; overlay.appendChild(card); document.body.appendChild(overlay);
    return { overlay, card, style };
  }
  function message(card, text) { let node = q('.sx-error', card); if (!node) { node = document.createElement('p'); node.className = 'sx-error'; node.setAttribute('role', 'alert'); card.appendChild(node); } node.textContent = text; }
  function title(card, heading, description) { card.replaceChildren(); const h = document.createElement('h2'); h.textContent = heading; card.append(h); const p = document.createElement('p'); p.textContent = description; card.append(p); }
  function complete(tokenValue, ui) { localStorage.setItem('wacrm_admin', tokenValue); ui.overlay.remove(); ui.style.remove(); location.assign('/admin'); }
  async function revokePlatformSession(legacyToken, csrf) {
    try {
      const proof = csrf || (await platformApi('me',legacyToken)).csrfToken;
      await fetch('/api/admin/platform-auth/logout',{method:'POST',credentials:'same-origin',keepalive:true,headers:{Authorization:'Bearer '+legacyToken,'Content-Type':'application/json','X-CSRF-Token':proof},body:'{}'});
    } catch (_) { /* The eight-hour server expiry remains the final boundary. */ }
  }
  function recoveryScreen(result, legacyToken, ui) {
    title(ui.card, tr('Save your recovery codes','احفظ رموز الاسترداد'), tr('Keep these one-time codes somewhere private. You will need them if you lose access to your authenticator.','احتفظ بهذه الرموز لمرة واحدة في مكان خاص. ستحتاج إليها إذا فقدت الوصول إلى تطبيق المصادقة.'));
    const pre = document.createElement('pre'); pre.textContent = result.recoveryCodes.join('\n'); ui.card.append(pre);
    const download = document.createElement('button'); download.type = 'button'; download.textContent = tr('Download recovery codes','تنزيل رموز الاسترداد');
    download.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([result.recoveryCodes.join('\n') + '\n'], {type:'text/plain'})); a.download = 'salemax-recovery-codes.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
    const row = document.createElement('label'); const check = document.createElement('input'); check.type = 'checkbox'; row.append(check, document.createTextNode(' ' + tr('I saved these codes securely','حفظت هذه الرموز في مكان آمن')));
    const next = document.createElement('button'); next.type = 'button'; next.disabled = true; next.textContent = tr('Continue to Super Admin','المتابعة إلى المشرف العام'); check.onchange = () => next.disabled = !check.checked; next.onclick = () => complete(legacyToken, ui);
    const actions = document.createElement('div'); actions.className = 'sx-actions'; actions.append(download, next); ui.card.append(row, actions);
  }
  async function factor(legacyToken, password, ui) {
    const auth = await platformApi('login', legacyToken, '', { email: q('input[type=email]')?.value?.trim(), password, audience: 'platform' });
    activeCsrf = auth.csrfToken;
    let enrollment = null;
    try { enrollment = await platformApi('mfa/enroll', legacyToken, auth.csrfToken, {}); }
    catch (error) { if (error.code !== 'MFA_ALREADY_ENROLLED') throw error; }
    title(ui.card, enrollment ? tr('Set up your authenticator','إعداد تطبيق المصادقة') : tr('Verify your sign-in','تحقق من تسجيل الدخول'), enrollment ? tr('Scan this QR code in Microsoft Authenticator or another TOTP app. Enter the current six-digit code to finish setup.','امسح رمز QR باستخدام Microsoft Authenticator أو تطبيق TOTP آخر، ثم أدخل الرمز الحالي المكوّن من ستة أرقام لإكمال الإعداد.') : tr('Enter the current six-digit code from your authenticator app.','أدخل الرمز الحالي المكوّن من ستة أرقام من تطبيق المصادقة.'));
    if (enrollment?.qrDataUrl) { const image = document.createElement('img'); image.alt = tr('Authenticator setup QR code','رمز إعداد تطبيق المصادقة'); image.src = enrollment.qrDataUrl; ui.card.append(image); const key = document.createElement('code'); key.textContent = enrollment.secret; ui.card.append(key); }
    const form = document.createElement('form'); let recovery=false; const label = document.createElement('label'); label.textContent = tr('Authenticator code','رمز المصادقة'); const code = document.createElement('input'); code.name = 'code'; code.type = 'text'; code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.pattern = '[0-9]{6}'; code.maxLength = 6; code.required = true; label.append(code); form.append(label);
    if (!enrollment) { const switchMethod=document.createElement('button');switchMethod.type='button';switchMethod.textContent=tr('Use a recovery code','استخدام رمز استرداد');switchMethod.onclick=()=>{recovery=!recovery;code.value='';code.inputMode=recovery?'text':'numeric';code.autocomplete=recovery?'off':'one-time-code';code.pattern=recovery?'[A-Za-z0-9_-]{22}':'[0-9]{6}';code.maxLength=recovery?22:6;label.firstChild.textContent=tr(recovery?'Recovery code':'Authenticator code',recovery?'رمز الاسترداد':'رمز المصادقة');switchMethod.textContent=tr(recovery?'Use authenticator code':'Use a recovery code',recovery?'استخدام رمز المصادقة':'استخدام رمز استرداد');code.focus();};form.append(switchMethod); }
    const actions = document.createElement('div'); actions.className = 'sx-actions'; const verify = document.createElement('button'); verify.type = 'submit'; verify.textContent = tr('Verify and continue','تحقق ومتابعة'); actions.append(verify); form.append(actions); ui.card.append(form);
    form.onsubmit = async event => { event.preventDefault(); if (busy) return; busy = true; verify.disabled = true;
      try { const result = await platformApi('mfa/verify', legacyToken, auth.csrfToken, recovery?{recoveryCode:code.value.trim()}:{code:code.value}); if (result.recoveryCodes) { recoveryScreen(result, legacyToken, ui); return; } complete(legacyToken, ui); }
      catch (error) { message(ui.card, error.code === 'MFA_INVALID' ? tr('That code was not accepted. Check that your phone time is automatic, then enter a fresh code.','لم يتم قبول الرمز. اضبط وقت الهاتف تلقائيًا ثم أدخل رمزًا جديدًا.') : error.code === 'REAUTH_REQUIRED' ? tr('Sign-in expired. Close this dialog and sign in again to get a fresh setup code.','انتهت صلاحية تسجيل الدخول. أغلق النافذة وسجّل الدخول مجددًا للحصول على رمز إعداد جديد.') : tr('MFA could not be verified. Please try again.','تعذر التحقق من المصادقة الثنائية. حاول مرة أخرى.')); }
      finally { busy = false; verify.disabled = false; }
    };
    code.focus();
  }
  async function begin(event) {
    if (location.pathname !== '/admin/login' || busy) return;
    const button = event.target?.closest?.('button');
    if (!button || !/sign\s*in|log\s*in|تسجيل الدخول|دخول/i.test(button.textContent || '')) return;
    const email = q('input[type=email]'), password = q('input[type=password]');
    if (!email || !password || !email.value.trim() || !password.value) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); busy = true;
    const ui = makeOverlay(); title(ui.card, tr('Checking your account','جارٍ التحقق من حسابك'), tr('Please wait while we verify your administrator sign-in.','يرجى الانتظار حتى نتحقق من تسجيل دخول المسؤول.'));
    try {
      const legacy = await parse(await fetch('/api/admin/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.value.trim(),password:password.value})}));
      if (!legacy.success || typeof legacy.token !== 'string') throw Object.assign(new Error('AUTH_INVALID'),{code:'AUTH_INVALID'});
      const policy = await platformApi('login-policy',legacy.token);
      if (!policy.mfaRequired) { complete(legacy.token,ui); return; }
      await factor(legacy.token,password.value,ui);
      busy = false;
    } catch(error) {
      busy = false;
      const text = error.code === 'AUTH_INVALID' ? tr('Check your email and password.','تحقق من البريد الإلكتروني وكلمة المرور.') : error.code === 'MFA_ALREADY_ENROLLED' ? tr('An authenticator is already enrolled. Sign in again to receive a fresh verification prompt.','تم تسجيل تطبيق مصادقة بالفعل. سجّل الدخول مجددًا لعرض طلب تحقق جديد.') : tr('We could not complete secure sign-in. Please try again or contact the platform owner.','تعذر إكمال تسجيل الدخول الآمن. حاول مرة أخرى أو تواصل مع مالك المنصة.');
      message(ui.card,text);
      const retry=document.createElement('button'); retry.type='button'; retry.textContent=tr('Back to sign in','العودة لتسجيل الدخول'); retry.onclick=()=>{ui.overlay.remove();ui.style.remove();busy=false;}; const actions=document.createElement('div');actions.className='sx-actions';actions.append(retry);ui.card.append(actions);
    }
  }
  document.addEventListener('click',begin,true);
  const storageRemove=Storage.prototype.removeItem;
  Storage.prototype.removeItem=function(key){
    const current=key==='wacrm_admin'&&this===localStorage?this.getItem(key):null;
    const result=storageRemove.call(this,key);
    if(current){const csrf=activeCsrf;activeCsrf='';void revokePlatformSession(current,csrf);}
    return result;
  };
  // A previously saved legacy administrator token must not keep a Super Admin
  // signed in after the canonical MFA session expires or is revoked.
  if (location.pathname === '/admin' && token()) {
    const legacyToken = token();
    platformApi('login-policy',legacyToken).then(async policy=>{
      if (!policy.mfaRequired) return;
      try { const me=await platformApi('me',legacyToken); if (me.mfaRequired) throw new Error('MFA_REQUIRED'); activeCsrf=me.csrfToken; }
      catch (_) { localStorage.removeItem('wacrm_admin'); location.replace('/admin/login'); }
    }).catch(()=>{});
  }
})();
