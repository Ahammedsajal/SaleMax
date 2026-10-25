(() => {
  'use strict';

  const root = document.getElementById('public-form');
  const parts = location.pathname.split('/').filter(Boolean);
  const tenantSlug = parts[1];
  const formSlug = parts[3];
  const query = new URLSearchParams(location.search);
  const staffCapture = query.get('mode') === 'staff' || (formSlug === 'student-registration' && Boolean(localStorage.getItem('wacrm_agent') || localStorage.getItem('wacrm_user')));
  const storageKey = `sx-form-token:${tenantSlug}:${formSlug}:${staffCapture ? 'staff' : 'public'}`;
  let data = null;
  let selectedLead = null;
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
    certificate_name: ['Name for certificate', 'الاسم على الشهادة', 'text', 'name'],
    qid: ['Qatar ID number', 'رقم البطاقة الشخصية القطرية', 'text', 'off'],
    phone_res: ['Home phone number', 'رقم هاتف المنزل', 'tel', 'tel'],
    address: ['Address', 'العنوان', 'text', 'street-address'],
    city: ['City', 'المدينة', 'select', 'address-level2'],
    social_contact: ['Social media contact', 'حساب التواصل الاجتماعي', 'text', 'off'],
    emergency_phone: ['Emergency contact number', 'رقم الاتصال في حالات الطوارئ', 'tel', 'tel'],
    local_address: ['Local address', 'العنوان المحلي', 'text', 'street-address'],
    city_state: ['City or state', 'المدينة أو الولاية', 'text', 'address-level1'],
    birth_date: ['Date of birth', 'تاريخ الميلاد', 'date', 'bday'],
    gender: ['Gender', 'الجنس', 'select', 'off'],
    graduated: ['Have you graduated from high school?', 'هل تخرجت من المدرسة الثانوية؟', 'select', 'off'],
    source: ['How did you hear about us?', 'كيف سمعت عنا؟', 'select', 'off'],
    referral_name: ['Referrer name', 'اسم الشخص الذي أحالك', 'text', 'name'],
    level: ['Course level', 'مستوى الدورة', 'select', 'off'],
    class_day: ['Preferred study days', 'أيام الدراسة المفضلة', 'select', 'off'],
    class_time: ['Preferred study time', 'وقت الدراسة المفضل', 'select', 'off'],
    enrollment_terms: ['Additional details', 'تفاصيل إضافية', 'text', 'off'],
    course_id: ['Course of interest', 'الدورة المطلوبة', 'select', ''],
    preferred_date: ['Preferred start date', 'تاريخ البدء المفضل', 'date', ''],
  };
  const tr = (en, ar) => language === 'ar' ? ar : en;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const actorToken = () => localStorage.getItem('wacrm_agent') || localStorage.getItem('wacrm_user');
  function campaignAttribution() {
    const fields = { utmSource: ['utm_source', 120], utmMedium: ['utm_medium', 120], utmCampaign: ['utm_campaign', 180], utmContent: ['utm_content', 180], utmTerm: ['utm_term', 180] };
    const attribution = {};
    for (const [key, [parameter, limit]] of Object.entries(fields)) {
      const value = query.get(parameter)?.trim().slice(0, limit);
      if (value) attribution[key] = value;
    }
    attribution.landingPage = `${location.origin}${location.pathname}`.slice(0, 500);
    if (document.referrer) {
      try {
        const referrer = new URL(document.referrer);
        if (['http:', 'https:'].includes(referrer.protocol)) attribution.referrer = `${referrer.origin}${referrer.pathname}`.slice(0, 500);
      } catch {}
    }
    return Object.keys(attribution).length ? attribution : null;
  }

  function renderMessage(title, detail, actionHref, actionLabel) {
    root.innerHTML = `<section class="form-card"><h1 tabindex="-1">${esc(title)}</h1><p class="description">${esc(detail)}</p>${actionHref ? `<a class="form-action" href="${esc(actionHref)}">${esc(actionLabel)}</a>` : ''}</section>`;
    root.querySelector('h1')?.focus();
  }

  function wireCoursePicker(form) {
    const picker = form.querySelector('[data-course-picker]');
    if (!picker) return;
    const details = picker.querySelector('details');
    const search = picker.querySelector('[data-course-search]');
    const options = [...picker.querySelectorAll('[data-course-option]')];
    const count = picker.querySelector('[data-course-count]');
    const selectedSummary = picker.querySelector('[data-course-selected]');
    const empty = picker.querySelector('[data-course-empty]');
    const error = picker.querySelector('[data-course-required-message]');
    const positionPanel = () => {
      if (!details.open) {
        details.removeAttribute('data-opens-upward');
        return;
      }
      const bounds = details.getBoundingClientRect();
      const panelHeight = details.querySelector('.course-picker-panel').getBoundingClientRect().height;
      const spaceBelow = window.innerHeight - bounds.bottom - 12;
      const spaceAbove = bounds.top - 12;
      details.toggleAttribute('data-opens-upward', panelHeight > spaceBelow && spaceAbove > spaceBelow);
    };
    details.addEventListener('toggle', () => {
      if (details.open) requestAnimationFrame(positionPanel);
      else details.removeAttribute('data-opens-upward');
    });
    const update = () => {
      const selected = options.filter(option => option.querySelector('input').checked);
      count.textContent = selected.length
        ? tr(`${selected.length} course${selected.length === 1 ? '' : 's'} selected`, `تم اختيار ${selected.length} دورات`)
        : tr('Choose courses', 'اختر الدورات');
      const names = selected.map(option => option.querySelector('span').textContent.trim());
      selectedSummary.textContent = names.length > 2
        ? `${names.slice(0, 2).join(', ')} ${tr(`+ ${names.length - 2} more`, `و ${names.length - 2} أخرى`)}`
        : names.join(', ');
      if (selected.length) {
        error.hidden = true;
        error.textContent = '';
      }
    };
    const filter = () => {
      const term = search.value.trim().toLocaleLowerCase(language);
      let visible = 0;
      for (const option of options) {
        const matches = !term || option.dataset.courseSearchText.toLocaleLowerCase(language).includes(term);
        option.hidden = !matches;
        if (matches) visible += 1;
      }
      empty.hidden = visible > 0;
    };
    search.oninput = filter;
    options.forEach(option => option.querySelector('input').addEventListener('change', update));
    update();
    filter();
  }

  function leadFieldMarkup(schema) {
    const definitions=schema.leadFields?.fields||[];
    if(!definitions.length)return '';
    return `<fieldset class="form-field" data-business-fields><legend>${tr('Business-specific details','بيانات خاصة بالنشاط')}</legend>${definitions.map(field=>{
      const name='custom_'+field.key,label=esc(field.label[language]),required=field.required?'required':'';
      const control=field.type==='boolean'?`<select name="${esc(name)}" ${required}><option value="">—</option><option value="true">${tr('Yes','نعم')}</option><option value="false">${tr('No','لا')}</option></select>`:`<input name="${esc(name)}" type="${field.type==='integer'?'number':field.type==='date'?'date':'text'}" ${field.type==='integer'?'step="1" min="-1000000000000" max="1000000000000"':field.type==='text'?'maxlength="1000"':''} ${required}>`;
      return `<label class="form-field">${label}${field.required?' *':''}${control}</label>`;
    }).join('')}</fieldset>`;
  }

  function render() {
    let priorCourses=root.querySelector('[data-course-row]')?window.__sxRegistrationControls?.selections():undefined;
    const prior = {};
    root.querySelectorAll('#enquiry-form [name]').forEach(control => {
      if (control.name === 'course_ids') {
        prior.course_ids ||= [];
        if (control.checked) prior.course_ids.push(control.value);
        return;
      }
      prior[control.name] = control.multiple?Array.from(control.selectedOptions,o=>o.value):control.type === 'checkbox' ? control.checked : control.value;
    });
    const requestedCourseId=query.get('course_id');
    if(!staffCapture&&requestedCourseId&&data.courses?.some(course=>course.id===requestedCourseId)){
      if(!prior.course_ids?.length)prior.course_ids=[requestedCourseId];
      if(data.form.schema.templateKey==='procatalyst-registration-v1'&&!priorCourses?.length)priorCourses=[{course_id:requestedCourseId}];
    }
    if (turnstileWidgetId && window.turnstile?.remove) {
      try { window.turnstile.remove(turnstileWidgetId); } catch {}
      turnstileWidgetId = null;
    }
    challengeToken = '';
    const schema = data.form.schema;
    const isRegistration = schema.templateKey === 'procatalyst-registration-v1';
    const isArabic = language === 'ar';
    const outerBrand = isRegistration ? '' : `${data.tenant.logoUrl?`<img class="brand-logo" src="${esc(new URL(data.tenant.logoUrl,location.origin).href)}" alt="${esc(isArabic?data.tenant.centerNameAr||data.tenant.name:data.tenant.centerNameEn||data.tenant.name)}">`:``}<div class="brand-mark">${esc(isArabic?data.tenant.centerNameAr||data.tenant.name:data.tenant.centerNameEn||data.tenant.name)}</div>`;
    document.documentElement.lang = language;
    document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
    root.dir = isArabic ? 'rtl' : 'ltr';
    document.title = isRegistration ? tr('Student Registration Form', 'استمارة تسجيل الطالب') : (isArabic ? data.form.nameAr : data.form.nameEn);
    root.innerHTML = `<header class="form-header ${isRegistration?'form-header-registration':''}">${outerBrand}<button type="button" id="language-toggle" aria-label="${tr('Switch to Arabic', 'التبديل إلى الإنجليزية')}">${tr('العربية', 'English')}</button></header>
      ${staffCapture ? `<div class="capture-banner" role="status">${isRegistration ? tr('Staff capture · details clear after each registration', 'تسجيل الموظف · تُمسح البيانات بعد كل طلب تسجيل') : tr('Staff capture · details clear after each enquiry', 'تسجيل الموظف · تُمسح البيانات بعد كل استفسار')}</div>` : ''}
      <section class="form-card">${schema.templateKey==='procatalyst-registration-v1'?'':`<p class="eyebrow">${staffCapture ? tr('STAFF ENQUIRY CAPTURE', 'تسجيل استفسار بواسطة الموظف') : tr('TRAINING CENTER ENQUIRY', 'استفسار مركز التدريب')}</p><h1>${esc(isArabic ? schema.titleAr : schema.titleEn)}</h1>${(isArabic ? schema.descriptionAr : schema.descriptionEn) ? `<p class="description">${esc(isArabic ? schema.descriptionAr : schema.descriptionEn)}</p>` : ''}`}
      <div id="form-message" role="status" aria-live="polite"></div><form id="enquiry-form" novalidate autocomplete="off">
      ${staffCapture ? `<section class="lead-prefill" aria-label="${tr('Find an existing lead','البحث عن عميل محتمل موجود')}"><label for="lead-search">${tr('Find existing lead by name, phone or email','ابحث عن عميل محتمل بالاسم أو الهاتف أو البريد الإلكتروني')}</label><input id="lead-search" type="search" autocomplete="off" placeholder="${tr('Type at least 2 characters','اكتب حرفين على الأقل')}"/><div id="lead-search-results" role="listbox" aria-live="polite"></div><p id="lead-selected" class="lead-selected" role="status"></p></section>` : ''}
      <label class="honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      ${schema.templateKey === 'procatalyst-registration-v1' ? window.SXTrainingRegistration.capture(schema, language, staffCapture, data.tenant, data) : schema.fields.filter(field => field.key !== 'consent').map(field => {
        const [labelEn, labelAr, type, autocomplete] = fields[field.key] || [field.key.replace(/_/g, ' ').replace(/^./, char => char.toUpperCase()), field.key.replace(/_/g, ' '), field.key.endsWith('_date') ? 'date' : 'text', 'off'];
        const label = isArabic ? field.labelAr || labelAr : field.labelEn || labelEn;
        if (field.key === 'course_id') return `<fieldset class="form-field course-choice" data-course-picker data-course-required="${field.required ? 'true' : 'false'}"><legend>${esc(label)}${field.required ? ' *' : ''}</legend><details class="course-picker"><summary><span data-course-count>${tr('Choose courses','اختر الدورات')}</span><span aria-hidden="true">⌄</span></summary><div class="course-picker-panel"><label class="course-picker-search">${tr('Search courses','ابحث عن دورة')}<input type="search" data-course-search autocomplete="off" placeholder="${tr('Type a course name','اكتب اسم الدورة')}" /></label><div class="course-option-list" role="group" aria-label="${tr('Available courses','الدورات المتاحة')}">${data.courses.map(course => { const name = isArabic ? course.nameAr : course.nameEn; return `<label class="course-option" data-course-option data-course-search-text="${esc(`${course.nameEn} ${course.nameAr}`)}"><input type="checkbox" name="course_ids" value="${esc(course.id)}"><span>${esc(name)}</span></label>`; }).join('')}<p class="course-picker-empty" data-course-empty hidden>${tr('No courses match that search.','لا توجد دورات تطابق البحث.')}</p></div></div></details><p class="course-selected-summary" data-course-selected aria-live="polite"></p><p class="course-picker-error" data-course-required-message role="alert" hidden></p><small>${tr('Choose one or more courses you’d like to hear about.','اختر دورة واحدة أو أكثر لمعرفة المزيد عنها.')}</small></fieldset>`;
        const choices = window.SXTrainingRegistration?.optionsForField?.(field.key, language);
         if (choices && field.key === 'nationality') return `<div class="form-field nationality-picker" data-nationality-control><label for="public-nationality-search">${tr('Search countries','ابحث عن دولة')}</label><input id="public-nationality-search" type="search" data-nationality-search aria-label="${tr('Search countries','ابحث عن دولة')}" autocomplete="off" placeholder="${tr('Type a country name','اكتب اسم الدولة')}"><label for="public-nationality-select">${esc(label)}${field.required ? ' *' : ''}</label><select id="public-nationality-select" name="${esc(field.key)}" ${field.required ? 'required' : ''}><option value="">${tr('Choose an option…','اختر خيارًا…')}</option>${choices.map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join('')}</select><small data-nationality-search-status aria-live="polite"></small></div>`;
         if (choices) return `<label class="form-field">${esc(label)}${field.required ? ' *' : ''}<select name="${esc(field.key)}" ${field.required ? 'required' : ''}><option value="">${tr('Choose an option…','اختر خيارًا…')}</option>${choices.map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join('')}</select></label>`;
        return `<label class="form-field">${esc(label)}${field.required ? ' *' : ''}<input name="${field.key}" type="${type}" autocomplete="${staffCapture ? 'off' : autocomplete || 'off'}" ${staffCapture ? 'autocapitalize="off" spellcheck="false"' : ''} ${field.key === 'phone' ? 'inputmode="tel" placeholder="+974 …"' : ''} maxlength="${field.key === 'email' ? 254 : field.key === 'phone' ? 40 : 255}" ${field.required ? 'required' : ''}></label>`;
      }).join('')}
      ${leadFieldMarkup(schema)}
      ${isRegistration ? '' : `<label class="consent"><input type="checkbox" name="consent" required><span>${esc(isArabic ? schema.consentTextAr : schema.consentTextEn)}</span></label>`}
      ${!staffCapture && data.botChallenge ? `<div class="bot-challenge"><p>${tr('Complete the security check to send this enquiry.', 'أكمل التحقق الأمني لإرسال هذا الاستفسار.')}</p><div id="turnstile-widget"></div><div id="turnstile-status" role="status" aria-live="polite">${tr('Loading security check…', 'جارٍ تحميل التحقق الأمني…')}</div></div>` : ''}
      <button id="submit-button" class="submit-button" type="submit">${isRegistration ? tr('Submit registration', 'إرسال طلب التسجيل') : tr(staffCapture ? 'Save enquiry' : 'Send enquiry', staffCapture ? 'حفظ الاستفسار' : 'إرسال الاستفسار')}</button>
      <p class="privacy-note">${isRegistration ? tr('Submitting creates a student pending approval and a provisional invoice. A course seat is confirmed after approval.', 'ينشئ الإرسال طالبًا بانتظار الموافقة وفاتورة مبدئية. يتم تأكيد المقعد بعد الموافقة.') : tr('Your details will be used to respond to this enquiry. This does not register you or reserve a seat.', 'ستُستخدم بياناتك للرد على هذا الاستفسار. لا يُعد هذا تسجيلًا أو حجزًا لمقعد.')}</p></form></section><footer>${tr('Powered by 7Network', 'مدعوم من 7Network')}</footer>`;
    window.SXTrainingRegistration?.wireNationalitySearch?.(root, language);

    for (const [name, value] of Object.entries(prior)) {
      if (name === 'course_ids') {
        root.querySelectorAll('#enquiry-form [name="course_ids"]').forEach(control => { control.checked = value.includes(control.value); });
        continue;
      }
      const control = root.querySelector(`#enquiry-form [name="${name}"]`);
      if (control){if(control.multiple){for(const option of control.options)option.selected=value.includes(option.value);}else control.type === 'checkbox' ? control.checked = Boolean(value) : control.value = value;}
    }
    root.querySelector('#language-toggle').onclick = () => {
      language = language === 'ar' ? 'en' : 'ar';
      render();
      root.querySelector('h1')?.focus();
    };
    root.querySelector('#enquiry-form').onsubmit = submit;
    wireCoursePicker(root.querySelector('#enquiry-form'));
    if(isRegistration)window.__sxRegistrationControls=window.SXTrainingRegistration.wire(root.querySelector('#enquiry-form'),data,language,priorCourses);
    if(staffCapture) wireLeadSearch();
    if(isRegistration){const source=root.querySelector('[name="source"]'),heading=root.querySelector('.registration-capture > .reg-two-col');let lookup=root.querySelector('.lead-prefill');if(!lookup){lookup=document.createElement('section');lookup.className='lead-prefill';lookup.innerHTML='<p>'+tr('Sign in as staff to search and import an existing lead.','سجّل الدخول كموظف للبحث واستيراد عميل محتمل موجود.')+'</p><a class="form-action" href="'+location.pathname+'?mode=staff">'+tr('Open staff capture','فتح تسجيل الموظف')+'</a>';}heading.insertAdjacentElement('afterend',lookup);const original=source.onchange;const toggle=focus=>{lookup.hidden=source.value!=='Lead';if(focus&&!lookup.hidden)lookup.querySelector('input')?.focus();if(lookup.hidden){selectedLead=null;const selected=lookup.querySelector('#lead-selected');if(selected)selected.textContent='';}};source.onchange=()=>{original?.();toggle(true);};toggle(false);}
    if (!staffCapture && data.botChallenge) mountTurnstile();
  }

  function wireLeadSearch(){
    const input=root.querySelector('#lead-search'),results=root.querySelector('#lead-search-results'),selected=root.querySelector('#lead-selected');
    if(!input||!results)return;
    if(selectedLead)selected.textContent=tr(`Selected lead: ${selectedLead.contactName||selectedLead.learnerName||selectedLead.phone||selectedLead.email}` ,`تم اختيار العميل المحتمل: ${selectedLead.contactName||selectedLead.learnerName||selectedLead.phone||selectedLead.email}`);
    let timer;
    input.addEventListener('input',()=>{
      clearTimeout(timer);selectedLead=null;selected.textContent='';
      const term=input.value.trim();if(term.length<2){results.innerHTML='';return;}
      results.innerHTML=`<p>${tr('Searching…','جارٍ البحث…')}</p>`;
      timer=setTimeout(async()=>{
        try{
          const response=await fetch(`/api/pipeline/training-forms/${encodeURIComponent(formSlug)}/leads?search=${encodeURIComponent(term)}`,{cache:'no-store',credentials:'same-origin',headers:{Authorization:`Bearer ${actorToken()}`}});
          const body=await response.json();if(!response.ok||!body.success)throw Error(body.code||'LOOKUP_FAILED');
          if(input.value.trim()!==term)return;if(!body.data.length){results.innerHTML=`<p>${tr('No matching leads found.','لم يتم العثور على عملاء محتملين مطابقين.')}</p>`;return;}
          results.innerHTML=body.data.map(lead=>`<button type="button" class="lead-result" role="option" data-lead-id="${esc(lead.id)}"><strong>${esc(lead.contactName||lead.learnerName||tr('Unnamed lead','عميل محتمل بلا اسم'))}</strong><span>${[lead.phone,lead.email].filter(Boolean).map(esc).join(' · ')}</span></button>`).join('');
          results.querySelectorAll('[data-lead-id]').forEach(button=>button.addEventListener('click',()=>{
            selectedLead=body.data.find(lead=>lead.id===button.dataset.leadId)||null;if(!selectedLead)return;
            const form=root.querySelector('#enquiry-form');const fill=(name,value)=>{const control=form.elements[name];if(control)control.value=value??'';};
            fill('contact_name',selectedLead.contactName);fill('learner_name',selectedLead.learnerName||selectedLead.contactName);fill('phone',selectedLead.phone);fill('email',selectedLead.email);for(const key of ['certificate_name','qid','nationality','phone_res','address','city','social_contact','emergency_phone','local_address','city_state','birth_date','gender','graduated','referral_name']){const value=selectedLead.qualificationData?.[key]||'';const c=form.elements[key];if(c?.tagName==='SELECT'&&value&&!Array.from(c.options).some(o=>o.value===value))c.add(new Option(value,value));fill(key,value);}for(const field of data.form.schema.leadFields?.fields||[])fill('custom_'+field.key,selectedLead.qualificationData?.customFields?.[field.key]?.value??'');fill('source','Lead');window.__sxRegistrationControls?.refresh();
            selected.textContent=tr(`Selected lead: ${selectedLead.contactName||selectedLead.learnerName||selectedLead.phone||selectedLead.email}. You can edit the form details.` ,`تم اختيار العميل المحتمل: ${selectedLead.contactName||selectedLead.learnerName||selectedLead.phone||selectedLead.email}. يمكنك تعديل بيانات النموذج.`);
            results.innerHTML='';input.value='';
          }));
        }catch{results.innerHTML=`<p class="error-message">${tr('Lead search is unavailable.','البحث عن العميل المحتمل غير متاح.')}</p>`;}
      },250);
    });
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
    const requiredCoursePicker = form.querySelector('[data-course-picker][data-course-required="true"]');
    if (requiredCoursePicker && !requiredCoursePicker.querySelector('[name="course_ids"]:checked')) {
      const details = requiredCoursePicker.querySelector('details');
      const error = requiredCoursePicker.querySelector('[data-course-required-message]');
      error.textContent = tr('Choose at least one course so we can send the right information.','اختر دورة واحدة على الأقل لنتمكن من إرسال المعلومات المناسبة.');
      error.hidden = false;
      details.open = true;
      requiredCoursePicker.querySelector('[data-course-search]').focus();
      return;
    }
    if (!form.reportValidity()) return;
    if(data.form.schema.templateKey==='procatalyst-registration-v1'&&!form.elements.student_signature.value){message.textContent=tr('Please draw the student signature.','يرجى رسم توقيع الطالب.');form.querySelector('#reg-signature').focus();return;}
    if (!staffCapture && data.botChallenge && !challengeToken) {
      message.innerHTML = `<p class="error-message" role="alert" tabindex="-1">${tr('Complete the security check before sending.', 'أكمل التحقق الأمني قبل الإرسال.')}</p>`;
      message.querySelector('[role="alert"]')?.focus();
      return;
    }
    const values = {};
    if(data.form.schema.templateKey==='procatalyst-registration-v1')Object.assign(values,window.SXTrainingRegistration.valuesFromForm(form,data.form.schema));
    else for (const field of data.form.schema.fields) {
      if (field.key === 'consent') { values.consent = form.elements.consent.checked; continue; }
      if(field.key==='course_id'){const selected=Array.from(form.querySelectorAll('[name="course_ids"]:checked'),control=>control.value);if(selected.length)values.course_ids=selected;continue;}
      const control = form.elements[field.key];
      if (control?.value) values[field.key] = control.value.trim();
    }
    if(data.form.schema.leadFields){values.customFields={};for(const field of data.form.schema.leadFields.fields){const raw=form.elements['custom_'+field.key]?.value;if(raw!==undefined&&raw!=='')values.customFields[field.key]=field.type==='boolean'?raw==='true':field.type==='integer'?Number(raw):raw;}}
    const attribution = staffCapture ? null : campaignAttribution();
    const payload = { submissionToken: getSubmissionToken(), expectedFormVersion:Number(data.form.version), values, ...(staffCapture&&selectedLead?{selectedLeadId:selectedLead.id}:{}), ...(attribution?{campaignAttribution:attribution}:{}) };
    if (!staffCapture) payload.website = form.elements.website.value;
    if (!staffCapture && data.botChallenge) payload.challengeToken = challengeToken;
    button.disabled = true;
      button.textContent = data.form.schema.templateKey === 'procatalyst-registration-v1' ? tr('Submitting…', 'جارٍ الإرسال…') : tr('Sending…', 'جارٍ الإرسال…');
    try {
      const token = actorToken();
      if (staffCapture && !token) throw Error('AUTH_REQUIRED');
      const response = await window.SXTrainingFormRequest.post(fetch, staffCapture
        ? `/api/pipeline/training-forms/${encodeURIComponent(formSlug)}/submissions`
        : `/api/public/training/forms/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(formSlug)}/submissions`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(staffCapture ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      }, { retrySafe: !data.botChallenge, onRetry: () => { button.textContent = tr('Retrying…', 'جارٍ إعادة المحاولة…'); } });
      let body;
      try { body = await response.json(); } catch { throw Error('SERVER_ERROR'); }
      if (!response.ok || body.success !== true) throw Error(body.code || 'SUBMISSION_FAILED');
      sessionStorage.removeItem(storageKey);
      selectedLead=null;
      const reference = esc(body.data.referenceCode);const registrationResult=body.data.studentNumber?'<p>'+tr('Total','الإجمالي')+': QAR '+(Number(body.data.totalMinor)/100).toFixed(2)+'</p>'+ (body.data.registrations||[body.data]).map(r=>'<p><strong>'+esc(language==='ar'?r.courseNameAr:r.courseNameEn)+'</strong><br>'+tr('Student ID','رقم الطالب')+': '+esc(r.studentNumber)+'<br>'+tr('Provisional invoice','فاتورة مبدئية')+': '+esc(r.provisionalInvoiceNumber)+' · QAR '+(Number(r.totalMinor)/100).toFixed(2)+'</p>').join(''):'';
      const isRegistration = data.form.schema.templateKey === 'procatalyst-registration-v1';
      const successHeading = isRegistration ? tr('Registration application received', 'تم استلام طلب التسجيل') : staffCapture ? tr('Enquiry saved', 'تم حفظ الاستفسار') : tr('Thank you, we’ll be in touch.', 'شكرًا لك، سنتواصل معك.');
      const successDetail = isRegistration
        ? tr('Your student registration is pending approval. A provisional invoice and notification requests were created.', 'تسجيلك بانتظار الموافقة. تم إنشاء فاتورة مبدئية وطلبات إشعار.')
        : staffCapture
        ? tr('The lead was added to your workspace and attributed to your signed-in account.', 'أُضيف العميل المحتمل إلى مساحة العمل ونُسب إلى حسابك المسجّل.')
        : tr('This confirms receipt of your enquiry only. It is not an invoice, payment receipt or confirmed course seat.', 'هذا تأكيد لاستلام الاستفسار فقط، وليس فاتورة أو إيصال دفع أو مقعدًا مؤكدًا في الدورة.');
      root.querySelector('.form-card').innerHTML = `<div class="success-mark" aria-hidden="true">✓</div><p class="eyebrow">${isRegistration ? tr('APPLICATION RECEIVED', 'تم استلام الطلب') : staffCapture ? tr('STAFF CAPTURE COMPLETE', 'اكتمل تسجيل الموظف') : tr('ENQUIRY RECEIVED', 'تم استلام الاستفسار')}</p><h1 tabindex="-1">${successHeading}</h1><p class="description">${tr(isRegistration ? 'Application reference' : 'Enquiry reference', isRegistration ? 'رقم مرجع الطلب' : 'رقم مرجع الاستفسار')}: <strong>${reference}</strong></p><p class="privacy-note">${successDetail}</p>${registrationResult}${body.data.studentNumber?'<button type="button" id="reg-success-invoice" class="secondary-button">'+tr('Print provisional invoice','طباعة الفاتورة المبدئية')+'</button>':''}${staffCapture ? `<button id="new-enquiry" class="secondary-button" type="button">${tr(isRegistration ? 'Capture next registration' : 'Capture next enquiry', isRegistration ? 'تسجيل الطلب التالي' : 'تسجيل الاستفسار التالي')}</button>` : ''}`;
      root.querySelector('.form-card h1')?.focus();root.querySelector('#reg-success-invoice')?.addEventListener('click',()=>window.SXTrainingRegistration.printInvoice(body.data,values,{nameEn:data.tenant.centerNameEn||data.tenant.name}));
      root.querySelector('#new-enquiry')?.addEventListener('click', () => {
        sessionStorage.removeItem(storageKey);
        render();
        root.querySelector('#enquiry-form [name="contact_name"]')?.focus();
      });
    } catch (error) {
      const challengeError = String(error.message || '').startsWith('BOT_CHALLENGE');
      const text = ['INVALID_COURSE','INVALID_COURSE_SELECTIONS','DUPLICATE_REGISTRATION_COURSE','INVALID_BATCH','INVALID_SIGNATURE','REGISTRATION_DETAILS_REQUIRED','REFERRAL_NAME_REQUIRED','INVALID_QID','INVALID_STAFF_ATTENDED','INVALID_PAYMENT_PLAN','INVALID_REGISTRATION_SOURCE'].includes(error.message)?tr('Check the course, payment plan, QID, referral and signature details.','تحقق من الدورة وخطة الدفع والبطاقة والإحالة والتوقيع.') : error.message === 'AUTH_REQUIRED' ? tr('Sign in with your staff account, then reopen this capture link.', 'سجّل الدخول بحساب الموظف ثم افتح رابط التسجيل مجددًا.')
        : error.message==='FORM_VERSION_CHANGED'?tr('This form changed while you were filling it in. Reload and review the current questions and consent before sending. Your answers have not been submitted.','تغيّر النموذج أثناء تعبئته. أعد تحميله وراجع الأسئلة والموافقة الحالية قبل الإرسال. لم يتم تقديم إجاباتك.')
        : ['REQUIRED_LEAD_FIELD','INVALID_LEAD_FIELD_VALUE','UNKNOWN_LEAD_FIELD'].includes(error.message) ? tr('Check the business-specific fields and try again.','تحقق من بيانات النشاط الخاصة وحاول مجددًا.')
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
      if(error.message==='FORM_VERSION_CHANGED'){button.disabled=true;const reload=document.createElement('button');reload.type='button';reload.className='form-action';reload.textContent=tr('Reload and review form','إعادة تحميل النموذج ومراجعته');reload.onclick=()=>location.reload();message.append(reload);}
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
