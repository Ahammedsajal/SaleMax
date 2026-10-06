(() => {
  'use strict';

  const root = document.getElementById('public-form');
  const parts = location.pathname.split('/').filter(Boolean);
  const tenantSlug = parts[1];
  const formSlug = parts[3];
  const query = new URLSearchParams(location.search);
  const staffCapture = query.get('mode') === 'staff';
  const storageKey = `sx-form-token:${tenantSlug}:${formSlug}:${staffCapture ? 'staff' : 'public'}`;
  let data = null;
  let challengeToken = '';
  let turnstileWidgetId = null;
  let turnstileReady = null;
  let language = (query.get('lang') || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';

  const fields = {
    contact_name: ['Full name', 'الاسم الكامل', 'text', 'name'],
    learner_name: ['Learner name', 'اسم المتعلم', 'text', 'name'],
    phone: ['WhatsApp number', 'رقم واتساب', 'tel', 'tel'],
    email: ['Email address', 'البريد الإلكتروني', 'email', 'email'],
    nationality: ['Nationality', 'الجنسية', 'text', 'country-name'],
    course_id: ['Course of interest', 'الدورة المطلوبة', 'select', ''],
    preferred_date: ['Preferred start date', 'تاريخ البدء المفضل', 'date', ''],
  };
  const tr = (en, ar) => language === 'ar' ? ar : en;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const actorToken = () => localStorage.getItem('wacrm_agent') || localStorage.getItem('wacrm_user');

  function renderMessage(title, detail, actionHref, actionLabel) {
    root.innerHTML = `<section class="form-card"><h1 tabindex="-1">${esc(title)}</h1><p class="description">${esc(detail)}</p>${actionHref ? `<a class="form-action" href="${esc(actionHref)}">${esc(actionLabel)}</a>` : ''}</section>`;
    root.querySelector('h1')?.focus();
  }

  function render() {
    const prior = {};
    root.querySelectorAll('#enquiry-form [name]').forEach(control => {
      prior[control.name] = control.type === 'checkbox' ? control.checked : control.value;
    });
    if (turnstileWidgetId && window.turnstile?.remove) {
      try { window.turnstile.remove(turnstileWidgetId); } catch {}
      turnstileWidgetId = null;
    }
    challengeToken = '';
    const schema = data.form.schema;
    const isRegistration = schema.templateKey === 'procatalyst-registration-v1';
    const isArabic = language === 'ar';
    document.documentElement.lang = language;
    document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
    root.dir = isArabic ? 'rtl' : 'ltr';
    document.title = isRegistration ? tr('Student Registration Form', 'استمارة تسجيل الطالب') : (isArabic ? data.form.nameAr : data.form.nameEn);
    root.innerHTML = `<header class="form-header">${data.tenant.logoUrl?`<img class="brand-logo" src="${esc(new URL(data.tenant.logoUrl,location.origin).href)}" alt="${esc(isArabic?data.tenant.centerNameAr||data.tenant.name:data.tenant.centerNameEn||data.tenant.name)}">`:``}<div class="brand-mark">${esc(isArabic?data.tenant.centerNameAr||data.tenant.name:data.tenant.centerNameEn||data.tenant.name)}</div><button type="button" id="language-toggle" aria-label="${tr('Switch to Arabic', 'التبديل إلى الإنجليزية')}">${tr('العربية', 'English')}</button></header>
      ${staffCapture ? `<div class="capture-banner" role="status">${isRegistration ? tr('Staff capture · details clear after each registration', 'تسجيل الموظف · تُمسح البيانات بعد كل طلب تسجيل') : tr('Staff capture · details clear after each enquiry', 'تسجيل الموظف · تُمسح البيانات بعد كل استفسار')}</div>` : ''}
      <section class="form-card">${schema.templateKey==='procatalyst-registration-v1'?'':`<p class="eyebrow">${staffCapture ? tr('STAFF ENQUIRY CAPTURE', 'تسجيل استفسار بواسطة الموظف') : tr('TRAINING CENTER ENQUIRY', 'استفسار مركز التدريب')}</p><h1>${esc(isArabic ? schema.titleAr : schema.titleEn)}</h1>${(isArabic ? schema.descriptionAr : schema.descriptionEn) ? `<p class="description">${esc(isArabic ? schema.descriptionAr : schema.descriptionEn)}</p>` : ''}`}
      <div id="form-message" role="status" aria-live="polite"></div><form id="enquiry-form" novalidate autocomplete="off">
      <label class="honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      ${schema.templateKey === 'procatalyst-registration-v1' ? window.SXTrainingRegistration.capture(schema, language, staffCapture) : schema.fields.filter(field => field.key !== 'consent').map(field => {
        const [labelEn, labelAr, type, autocomplete] = fields[field.key];
        const label = isArabic ? field.labelAr || labelAr : field.labelEn || labelEn;
        if (field.key === 'course_id') return `<label class="form-field">${esc(label)}${field.required ? ' *' : ''}<select name="course_id" ${field.required ? 'required' : ''}><option value="">${tr('Choose a course', 'اختر دورة')}</option>${data.courses.map(course => `<option value="${esc(course.id)}">${esc(isArabic ? course.nameAr : course.nameEn)}</option>`).join('')}</select></label>`;
        return `<label class="form-field">${esc(label)}${field.required ? ' *' : ''}<input name="${field.key}" type="${type}" autocomplete="${staffCapture ? 'off' : autocomplete || 'off'}" ${staffCapture ? 'autocapitalize="off" spellcheck="false"' : ''} ${field.key === 'phone' ? 'inputmode="tel" placeholder="+974 …"' : ''} maxlength="${field.key === 'email' ? 254 : field.key === 'phone' ? 40 : 255}" ${field.required ? 'required' : ''}></label>`;
      }).join('')}
      ${isRegistration ? '' : `<label class="consent"><input type="checkbox" name="consent" required><span>${esc(isArabic ? schema.consentTextAr : schema.consentTextEn)}</span></label>`}
      ${!staffCapture && data.botChallenge ? `<div class="bot-challenge"><p>${tr('Complete the security check to send this enquiry.', 'أكمل التحقق الأمني لإرسال هذا الاستفسار.')}</p><div id="turnstile-widget"></div><div id="turnstile-status" role="status" aria-live="polite">${tr('Loading security check…', 'جارٍ تحميل التحقق الأمني…')}</div></div>` : ''}
      <button id="submit-button" class="submit-button" type="submit">${isRegistration ? tr('Submit registration', 'إرسال طلب التسجيل') : tr(staffCapture ? 'Save enquiry' : 'Send enquiry', staffCapture ? 'حفظ الاستفسار' : 'إرسال الاستفسار')}</button>
      <p class="privacy-note">${isRegistration ? tr('Submitting this form records your application. It does not issue an invoice or payment receipt or confirm a course seat.', 'إرسال هذا النموذج يسجل طلبك. ولا يصدر فاتورة أو إيصال دفع ولا يؤكد حجز مقعد في الدورة.') : tr('Your details will be used to respond to this enquiry. This does not register you or reserve a seat.', 'ستُستخدم بياناتك للرد على هذا الاستفسار. لا يُعد هذا تسجيلًا أو حجزًا لمقعد.')}</p></form></section><footer>${tr('Powered by SaleMaX', 'مدعوم من SaleMaX')}</footer>`;

    for (const [name, value] of Object.entries(prior)) {
      const control = root.querySelector(`#enquiry-form [name="${name}"]`);
      if (control) control.type === 'checkbox' ? control.checked = Boolean(value) : control.value = value;
    }
    root.querySelector('#language-toggle').onclick = () => {
      language = language === 'ar' ? 'en' : 'ar';
      render();
      root.querySelector('h1')?.focus();
    };
    root.querySelector('#enquiry-form').onsubmit = submit;
    if (!staffCapture && data.botChallenge) mountTurnstile();
  }

  function mountTurnstile() {
    const target = root.querySelector('#turnstile-widget');
    const status = root.querySelector('#turnstile-status');
    if (!target || !status) return;
    const displayError = () => {
      if (root.contains(status)) {
        status.textContent = tr('Security check unavailable. Refresh this page and try again.', 'تعذر إكمال التحقق الأمني. حدّث الصفحة وحاول مرة أخرى.');
        status.className = 'error-message';
      }
    };
    const ready = () => {
      if (!root.contains(target) || !window.turnstile) return;
      try {
        status.textContent = tr('Complete the security check to continue.', 'أكمل التحقق الأمني للمتابعة.');
        turnstileWidgetId = window.turnstile.render(target, {
          sitekey: data.botChallenge.siteKey,
          action: data.botChallenge.action,
          callback: value => {
            challengeToken = value;
            if (root.contains(status)) {
              status.textContent = tr('Security check complete.', 'اكتمل التحقق الأمني.');
              status.className = 'challenge-success';
            }
          },
          'expired-callback': () => {
            challengeToken = '';
            if (root.contains(status)) status.textContent = tr('Security check expired. Complete it again.', 'انتهت صلاحية التحقق الأمني. أكمله مجددًا.');
          },
          'error-callback': () => { challengeToken = ''; displayError(); },
        });
      } catch { displayError(); }
    };
    if (window.turnstile) return ready();
    if (!turnstileReady) {
      turnstileReady = new Promise((resolve, reject) => {
        let script = document.getElementById('sx-turnstile-script');
        if (!script) {
          script = document.createElement('script');
          script.id = 'sx-turnstile-script';
          script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          script.async = true;
          script.defer = true;
          document.head.append(script);
        }
        script.addEventListener('load', resolve, { once: true });
        script.addEventListener('error', reject, { once: true });
      });
    }
    turnstileReady.then(ready).catch(displayError);
  }

  function getSubmissionToken() {
    let token = sessionStorage.getItem(storageKey);
    if (!token) {
      token = crypto.randomUUID();
      sessionStorage.setItem(storageKey, token);
    }
    return token;
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = root.querySelector('#submit-button');
    const message = root.querySelector('#form-message');
    message.textContent = '';
    if (!form.reportValidity()) return;
    if (!staffCapture && data.botChallenge && !challengeToken) {
      message.innerHTML = `<p class="error-message" role="alert" tabindex="-1">${tr('Complete the security check before sending.', 'أكمل التحقق الأمني قبل الإرسال.')}</p>`;
      message.querySelector('[role="alert"]')?.focus();
      return;
    }
    const values = {};
    if(data.form.schema.templateKey==='procatalyst-registration-v1')Object.assign(values,window.SXTrainingRegistration.valuesFromForm(form,data.form.schema));
    else for (const field of data.form.schema.fields) {
      if (field.key === 'consent') { values.consent = form.elements.consent.checked; continue; }
      const control = form.elements[field.key];
      if (control?.value) values[field.key] = control.value.trim();
    }
    const payload = { submissionToken: getSubmissionToken(), values };
    if (!staffCapture) payload.website = form.elements.website.value;
    if (!staffCapture && data.botChallenge) payload.challengeToken = challengeToken;
    button.disabled = true;
      button.textContent = data.form.schema.templateKey === 'procatalyst-registration-v1' ? tr('Submitting…', 'جارٍ الإرسال…') : tr('Sending…', 'جارٍ الإرسال…');
    try {
      const token = actorToken();
      if (staffCapture && !token) throw Error('AUTH_REQUIRED');
      const response = await fetch(staffCapture
        ? `/api/pipeline/training-forms/${encodeURIComponent(formSlug)}/submissions`
        : `/api/public/training/forms/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(formSlug)}/submissions`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(staffCapture ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      let body;
      try { body = await response.json(); } catch { throw Error('SERVER_ERROR'); }
      if (!response.ok || body.success !== true) throw Error(body.code || 'SUBMISSION_FAILED');
      sessionStorage.removeItem(storageKey);
      const reference = esc(body.data.referenceCode);
      const isRegistration = data.form.schema.templateKey === 'procatalyst-registration-v1';
      const successHeading = isRegistration ? tr('Registration application received', 'تم استلام طلب التسجيل') : staffCapture ? tr('Enquiry saved', 'تم حفظ الاستفسار') : tr('Thank you, we’ll be in touch.', 'شكرًا لك، سنتواصل معك.');
      const successDetail = isRegistration
        ? tr('Your application was recorded. The training center will follow up about the invoice, payment, and course start.', 'تم تسجيل طلبك. سيتواصل معك مركز التدريب بخصوص الفاتورة والدفع وبدء الدورة.')
        : staffCapture
        ? tr('The lead was added to your workspace and attributed to your signed-in account.', 'أُضيف العميل المحتمل إلى مساحة العمل ونُسب إلى حسابك المسجّل.')
        : tr('This confirms receipt of your enquiry only. It is not an invoice, payment receipt or confirmed course seat.', 'هذا تأكيد لاستلام الاستفسار فقط، وليس فاتورة أو إيصال دفع أو مقعدًا مؤكدًا في الدورة.');
      root.querySelector('.form-card').innerHTML = `<div class="success-mark" aria-hidden="true">✓</div><p class="eyebrow">${isRegistration ? tr('APPLICATION RECEIVED', 'تم استلام الطلب') : staffCapture ? tr('STAFF CAPTURE COMPLETE', 'اكتمل تسجيل الموظف') : tr('ENQUIRY RECEIVED', 'تم استلام الاستفسار')}</p><h1 tabindex="-1">${successHeading}</h1><p class="description">${tr(isRegistration ? 'Application reference' : 'Enquiry reference', isRegistration ? 'رقم مرجع الطلب' : 'رقم مرجع الاستفسار')}: <strong>${reference}</strong></p><p class="privacy-note">${successDetail}</p>${staffCapture ? `<button id="new-enquiry" class="secondary-button" type="button">${tr(isRegistration ? 'Capture next registration' : 'Capture next enquiry', isRegistration ? 'تسجيل الطلب التالي' : 'تسجيل الاستفسار التالي')}</button>` : ''}`;
      root.querySelector('.form-card h1')?.focus();
      root.querySelector('#new-enquiry')?.addEventListener('click', () => {
        sessionStorage.removeItem(storageKey);
        render();
        root.querySelector('#enquiry-form [name="contact_name"]')?.focus();
      });
    } catch (error) {
      const challengeError = String(error.message || '').startsWith('BOT_CHALLENGE');
      const text = error.message === 'AUTH_REQUIRED' ? tr('Sign in with your staff account, then reopen this capture link.', 'سجّل الدخول بحساب الموظف ثم افتح رابط التسجيل مجددًا.')
        : error.message === 'FORM_RATE_LIMITED' ? tr('Please wait a little before trying again.', 'يرجى الانتظار قليلًا قبل المحاولة مجددًا.')
          : challengeError ? tr('The security check expired or could not be verified. Complete it again and retry.', 'انتهت صلاحية التحقق الأمني أو تعذر التحقق منه. أكمله مجددًا ثم أعد المحاولة.')
            : tr('We could not save this enquiry. Check your connection and try again.', 'تعذر حفظ الاستفسار. تحقق من الاتصال وحاول مجددًا.');
      if (challengeError && turnstileWidgetId && window.turnstile) {
        challengeToken = '';
        try { window.turnstile.reset(turnstileWidgetId); } catch {}
      }
      message.innerHTML = `<p class="error-message" role="alert" tabindex="-1">${esc(text)}</p>`;
      button.disabled = false;
      button.textContent = tr('Try again', 'حاول مرة أخرى');
      message.querySelector('[role="alert"]')?.focus();
    }
  }

  async function start() {
    if (parts.length !== 4 || parts[0] !== 'p' || parts[2] !== 'forms') {
      renderMessage(tr('Form not found.', 'النموذج غير موجود.'), '', null, '');
      return;
    }
    if (staffCapture && !actorToken()) {
      root.innerHTML = `<section class="form-card"><h1 tabindex="-1">${tr('Staff sign-in required', 'يلزم تسجيل دخول الموظف')}</h1><p class="description">${tr('Sign in with your workspace or agent account, then open this staff capture link again.', 'سجّل الدخول بحساب مساحة العمل أو الوكيل، ثم افتح رابط تسجيل الموظف مرة أخرى.')}</p><div class="login-actions"><a class="form-action" href="/user/login">${tr('Workspace sign in', 'تسجيل دخول مساحة العمل')}</a><a class="form-action" href="/agent/login">${tr('Agent sign in', 'تسجيل دخول الوكيل')}</a></div></section>`;
      root.querySelector('h1')?.focus();
      return;
    }
    try {
      const token = actorToken();
      const response = await fetch(staffCapture
        ? `/api/pipeline/training-forms/${encodeURIComponent(formSlug)}`
        : `/api/public/training/forms/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(formSlug)}`, {
        cache: 'no-store', credentials: 'same-origin',
        headers: staffCapture ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await response.json();
      if (!response.ok || body.success !== true) {
        if (staffCapture && response.status === 401) {
          const loginPath = localStorage.getItem('wacrm_agent') ? '/agent/login' : '/user/login';
          renderMessage(tr('Your staff session has expired', 'انتهت جلسة الموظف'), tr('Sign in again, then reopen this staff capture link.', 'سجّل الدخول مرة أخرى، ثم افتح رابط تسجيل الموظف.'), loginPath, tr('Open sign in', 'فتح تسجيل الدخول'));
          return;
        }
        throw Error(body.code || 'FORM_NOT_FOUND');
      }
      data = body.data;
      if (data.form.schema.fields.some(field => field.key === 'course_id' && field.required) && !data.courses.length) {
        renderMessage(tr('Registration is temporarily unavailable.', 'التسجيل غير متاح مؤقتًا.'), tr('Contact the training center before collecting this enquiry.', 'تواصل مع مركز التدريب قبل تسجيل هذا الاستفسار.'), null, '');
        return;
      }
      render();
    } catch {
      renderMessage(tr('This enquiry form is unavailable.', 'نموذج الاستفسار غير متاح.'), tr('Check the link or contact the training center directly.', 'تحقق من الرابط أو تواصل مباشرة مع مركز التدريب.'), null, '');
    }
  }

  start();
})();
