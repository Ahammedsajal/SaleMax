(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const arabic = () => document.documentElement.lang?.startsWith('ar') || document.documentElement.dir === 'rtl' || document.querySelector('[dir="rtl"]') !== null || [...document.querySelectorAll('h5')].some(node => node.textContent.trim() === 'إدارة الخطط');
  const text = (en, ar) => arabic() ? ar : en;
  const flags = [['allow_tag','Chat tags','وسوم المحادثة'],['allow_note','Chat notes','ملاحظات المحادثة'],['allow_chatbot','WhatsApp chatbot','روبوت محادثة واتساب'],['allow_api','Cloud API','واجهة Cloud API'],['wa_warmer','WhatsApp Warmer','تهيئة واتساب'],['rest_api_qr','QR REST API','واجهة QR REST API']];
  let editor, hidden = [], previousFocus, requestClose = () => true;
  const css = document.createElement('style');
  css.textContent = `.sx-plan-editor{background:var(--salemax-surface,#fff);color:#243444;border:1px solid #e3e7ed;border-radius:12px;padding:24px;margin-top:24px;font:14px/1.5 Roboto,Arial,sans-serif}.sx-plan-editor h2{margin:0;font-size:22px}.sx-plan-editor p{color:#657384}.sx-plan-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.sx-plan-field{display:flex;flex-direction:column;gap:6px}.sx-plan-wide{grid-column:1/-1}.sx-plan-field input,.sx-plan-field textarea,.sx-plan-field select{font:inherit;padding:12px;border:1px solid #bcc7d4;border-radius:8px;width:100%;box-sizing:border-box;background:#fff;color:#243444}.sx-plan-field textarea{min-height:84px;resize:vertical}.sx-plan-field [aria-invalid=true]{border-color:#b42318}.sx-plan-field small{color:#b42318;min-height:20px}.sx-plan-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;border:0;padding:0;margin:16px 0}.sx-plan-options legend{font-weight:600;margin-bottom:12px}.sx-plan-options label{display:flex;gap:10px;align-items:center}.sx-plan-options input{accent-color:#a8003b}.sx-plan-buttons{display:flex;gap:12px;justify-content:flex-end;margin-top:20px}.sx-plan-buttons button{font:600 14px Roboto,Arial,sans-serif;padding:12px 20px;border-radius:8px;border:1px solid #cbd3dd;background:#fff;cursor:pointer}.sx-plan-buttons button[type=submit]{background:#a8003b;color:white;border-color:#a8003b}.sx-plan-buttons button:disabled{opacity:.6;cursor:wait}.sx-plan-message{padding:12px;border-radius:8px;background:#fff1f0;color:#b42318}.sx-plan-success{background:#edf8f1;color:#17683a}.sx-plan-editor :focus-visible{outline:3px solid #a8003b70;outline-offset:3px}@media(max-width:650px){.sx-plan-editor{padding:16px}.sx-plan-fields,.sx-plan-options{grid-template-columns:1fr}.sx-plan-wide{grid-column:auto}.sx-plan-buttons{flex-wrap:wrap}}`;
  document.head.appendChild(css);
  async function api(path, body) {
    const token = localStorage.getItem('wacrm_admin');
    if (!token) throw new Error(text('Your session expired. Please sign in again.','انتهت الجلسة. يرجى تسجيل الدخول مجددًا.'));
    let response;
    try { response = await fetch(path, {method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}); }
    catch { throw new Error(text('Connection failed. Your changes are still here; try again.','تعذر الاتصال. ما زالت التغييرات محفوظة هنا؛ حاول مجددًا.')); }
    let data;
    try { data = await response.json(); } catch { throw new Error(text('Unexpected server response. Please try again.','استجابة غير متوقعة من الخادم. حاول مجددًا.')); }
    if (!response.ok || !data.success) { const error = new Error(data.msg || text('Could not save the plan.','تعذر حفظ الخطة.')); error.fields = data.errors; throw error; }
    return data;
  }
  function close() {
    if (editor && !requestClose()) return false;
    editor?.remove(); editor = null;
    for (const [element, display] of hidden) element.style.display = display;
    hidden = []; previousFocus?.focus(); requestClose = () => true; return true;
  }
  function anchor() {
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(node => /^(Manage Plans|إدارة الخطط|ادارة الخطط)$/.test(node.textContent.trim()));
    if (!heading) return null;
    let element = heading.parentElement;
    while (element && element !== document.body) {
      const button = [...element.querySelectorAll('button')].find(node => /add new plan|add plan|إضافة.*خطة|اضافة.*خطة/i.test(node.textContent));
      if (button) return {header:element.parentElement,button};
      element = element.parentElement;
    }
    return null;
  }
  async function open(title) {
    const location = anchor();
    if (!location) return;
    if (!close()) return;
    previousFocus = document.activeElement;
    editor = document.createElement('section'); editor.className = 'sx-plan-editor'; editor.dir = arabic() ? 'rtl' : 'ltr';
    editor.setAttribute('aria-label',text('Plan editor','محرر الخطة'));
    for (const child of [...location.header.parentElement.children]) if (child !== location.header) { hidden.push([child,child.style.display]); child.style.display='none'; }
    location.header.after(editor);
    editor.innerHTML = `<p role="status">${text('Loading plan details…','جارٍ تحميل تفاصيل الخطة…')}</p>`;
    const active = editor;
    try {
      let plan = {};
      if (title != null) {
        const plans = (await api('/api/admin/get_plans')).data;
        const matches = plans.filter(item => String(item.title) === String(title));
        if (matches.length !== 1) throw new Error(text('This title does not identify one plan. Resolve duplicate titles before editing.','هذا العنوان لا يحدد خطة واحدة. يرجى معالجة العناوين المكررة قبل التعديل.'));
        plan = matches[0];
      }
      if (editor !== active) return;
      const field = (name,en,ar,type='text',value='',required=false,wide=false) => `<label class="sx-plan-field ${wide?'sx-plan-wide':''}">${text(en,ar)}${required?' *':''}<input name="${name}" type="${type}" value="${escape(value)}" ${required?'required':''} ${type==='number'?`min="${name==='plan_duration_in_days'?1:0}" step="${name==='price_strike'?'0.01':1}"`:''} ${name==='title'?'maxlength="999"':''}><small data-error="${name}"></small></label>`;
      active.innerHTML = `<h2 tabindex="-1">${plan.id?text('Edit plan','تعديل الخطة'):text('Create plan','إنشاء خطة')}</h2><p>${text('Set catalogue pricing, duration and messaging access. Existing assigned contracts are preserved.','حدد أسعار الكتالوج والمدة وصلاحيات المراسلة. تبقى العقود المعينة الحالية محفوظة.')}</p><form><div class="sx-plan-fields">${field('title','Plan title','عنوان الخطة','text',plan.title,true,true)}<label class="sx-plan-field sx-plan-wide">${text('Description','الوصف')} *<textarea name="short_description" maxlength="10000" required>${escape(plan.short_description)}</textarea><small data-error="short_description"></small></label>${field('price','Price','السعر','number',plan.price??0)}${field('price_strike','Previous price (optional)','السعر السابق (اختياري)','number',plan.price_strike??'')}${field('plan_duration_in_days','Duration in days','المدة بالأيام','number',plan.plan_duration_in_days??30,true)}${field('contact_limit','Contact limit','حد جهات الاتصال','number',plan.contact_limit??0)}${field('qr_account','QR accounts','حسابات QR','number',plan.qr_account??0)}<label class="sx-plan-field">${text('Plan type','نوع الخطة')}<select name="is_trial"><option value="0">${text('Paid','مدفوعة')}</option><option value="1" ${Number(plan.is_trial)===1?'selected':''}>${text('Trial — free','تجريبية — مجانية')}</option></select><small data-error="is_trial"></small></label></div><fieldset class="sx-plan-options"><legend>${text('Messaging features','ميزات المراسلة')}</legend>${flags.map(([name,en,ar])=>`<label><input type="checkbox" name="${name}" ${Number(plan[name])===1?'checked':''}>${text(en,ar)}</label>`).join('')}</fieldset><div class="sx-plan-message" role="alert" hidden></div><div class="sx-plan-buttons"><button type="button" data-cancel>${text('Back to plans','العودة إلى الخطط')}</button><button type="submit">${text('Save plan','حفظ الخطة')}</button></div></form>`;
      active.querySelector('h2').focus();
      window.salemaxPlanContracts?.mount(active,plan);
      let dirty = false, saving = false;
      requestClose = () => {
        if (saving) return false;
        if (!dirty && !window.salemaxPlanContracts?.isDirty(active)) return true;
        let confirmation = active.querySelector('.sx-plan-discard');
        if (!confirmation) {
          confirmation = document.createElement('div');
          confirmation.className = 'sx-plan-discard sx-plan-message';
          confirmation.setAttribute('role','alert');
          confirmation.innerHTML = `<p>${text('You have unsaved changes. Discard them?','لديك تغييرات غير محفوظة. هل تريد تجاهلها؟')}</p><div class="sx-plan-buttons"><button type="button" data-keep>${text('Keep editing','متابعة التعديل')}</button><button type="button" data-discard>${text('Discard changes','تجاهل التغييرات')}</button></div>`;
          active.querySelector('form').appendChild(confirmation);
          confirmation.querySelector('[data-keep]').onclick = () => {confirmation.remove();active.querySelector('[data-cancel]').focus();};
          confirmation.querySelector('[data-discard]').onclick = () => {dirty=false;window.salemaxPlanContracts?.clearDirty(active);close();};
        }
        confirmation.querySelector('[data-keep]').focus();
        return false;
      };
      active.querySelector('[data-cancel]').onclick = close;
      const form = active.querySelector('form'), type = form.elements.is_trial, price = form.elements.price;
      const updatePrice = () => { price.disabled = type.value === '1'; };
      updatePrice(); type.addEventListener('change',updatePrice);
      form.addEventListener('input',()=>{dirty=true;}); form.addEventListener('change',()=>{dirty=true;});
      form.addEventListener('submit', async event => {
        event.preventDefault(); if(saving) return;
        if(window.salemaxPlanContracts?.isDirty(active)){const warning=form.querySelector('[role=alert]');warning.hidden=false;warning.textContent=text('Create the contract draft or discard its changes before saving catalogue changes.','أنشئ مسودة العقد أو تجاهل تغييراتها قبل حفظ تغييرات الكتالوج.');const discard=document.createElement('button');discard.type='button';discard.textContent=text('Discard contract changes','تجاهل تغييرات العقد');discard.onclick=()=>{window.salemaxPlanContracts.clearDirty(active);warning.hidden=true;};warning.appendChild(discard);return;}
        active.querySelector('.sx-plan-discard')?.remove();
        const data = new FormData(form), body = Object.fromEntries(data);
        if(plan.id) body.id = plan.id;
        body.is_trial = type.value === '1'; if(body.is_trial) body.price = 0;
        flags.forEach(([name])=>{body[name]=data.has(name);});
        const notice = form.querySelector('[role=alert]'); notice.hidden=true;
        form.querySelectorAll('[data-error]').forEach(node=>{node.textContent='';});
        form.querySelectorAll('[aria-invalid]').forEach(node=>node.removeAttribute('aria-invalid'));
        saving = true; form.querySelectorAll('button').forEach(button=>{button.disabled=true;});
        const submit = form.querySelector('[type=submit]'); submit.textContent=text('Saving…','جارٍ الحفظ…');
        try {
          await api(plan.id?'/api/admin/edit_plan':'/api/admin/add_plan',body);
          dirty=false; window.location.reload();
        } catch(error) {
          notice.hidden=false; notice.textContent=arabic()?text('Please check the fields and try again. Your changes have been kept.','يرجى التحقق من الحقول والمحاولة مجددًا. تم الاحتفاظ بالتغييرات.'):error.message;
          for(const [name,message] of Object.entries(error.fields||{})) {
            const input=form.elements.namedItem(name), label=form.querySelector(`[data-error="${name}"]`);
            if(input && label) {input.setAttribute('aria-invalid','true');label.textContent=arabic()?'يرجى إدخال قيمة صحيحة.':message;}
          }
          form.querySelector('[aria-invalid=true]')?.focus();
          saving=false; form.querySelectorAll('button').forEach(button=>{button.disabled=false;}); submit.textContent=text('Save plan','حفظ الخطة');
        }
      });
    } catch(error) {
      if(editor!==active) return;
      active.innerHTML=`<div role="alert" class="sx-plan-message">${escape(error.message)}</div><div class="sx-plan-buttons"><button type="button">${text('Back to plans','العودة إلى الخطط')}</button></div>`;
      active.querySelector('button').onclick=close;
    }
  }
  // Capture only the existing plan-create action, keeping the current panel,
  // card list and routing. No second application or catalogue is introduced.
  document.addEventListener('click',event=>{
    if(location.pathname.toLowerCase()!=='/admin' || new URLSearchParams(location.search).get('page')!=='manage-plans') return;
    const target=event.target.closest('button'), current=anchor();
    if(target && target===current?.button) {event.preventDefault();event.stopImmediatePropagation();open();}
  },true);
  window.salemaxPlanEditor = {open};
})();
