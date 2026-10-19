(() => {
  'use strict';
  if (window.__sxTrainingFaqs) return;
  window.__sxTrainingFaqs = true;
  const base = '/api/user/chatbots/faqs';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isAr = () => window.SaleMaxLocale?.isArabic() ?? /^(ar(?:[-_]|$)|arabic)/i.test(localStorage.getItem('language') || document.documentElement.lang || 'en');
  const tr = (en, ar) => isAr() ? ar : en;
  const active = () => location.pathname.replace(/\/$/, '') === '/user' && new URLSearchParams(location.search).get('page') === 'faqs';
  let items = [], loading = false, errorText = '';
  async function api(path = '', method = 'GET', body) {
    const token = localStorage.getItem('wacrm_user'); if (!token) throw Error('AUTH_REQUIRED');
    const response = await fetch(base + path, { method, credentials: 'same-origin', cache: 'no-store', headers: { Authorization: 'Bearer ' + token, ...(body ? {'Content-Type':'application/json'} : {}) }, body: body ? JSON.stringify(body) : undefined });
    let result; try { result = await response.json(); } catch { throw Error('SERVER_ERROR'); }
    if (!response.ok || result.success === false) throw Error(result.code || 'REQUEST_FAILED');
    return result.data;
  }
  function layout(root) {
    const bar = document.querySelector('header.MuiAppBar-root');
    const barRect = bar?.getBoundingClientRect(), barStyle = bar && getComputedStyle(bar);
    const top = window.innerWidth < 900 && barStyle?.position === 'fixed' && barStyle.display !== 'none' ? Math.max(0, barRect?.bottom || 0) : 0;
    root.style.top = `${Math.ceil(top)}px`;
    let inset = 0;
    if (window.innerWidth >= 900) {
      const drawer = [...document.querySelectorAll('.MuiDrawer-paper')].find(item => item.querySelector('[data-sx-sidebar-list]') && getComputedStyle(item).display !== 'none' && item.getBoundingClientRect().width > 0);
      if (drawer) { const rect = drawer.getBoundingClientRect(); inset = rect.left < 12 ? rect.right : Math.max(0, window.innerWidth - rect.left); }
      else inset = 260;
    }
    root.style.insetInlineStart = `${Math.ceil(inset)}px`;
    root.style.insetInlineEnd = '0px';
  }
  function render() {
    if (!active()) { document.getElementById('sx-faqs-screen')?.remove(); return; }
    let root = document.getElementById('sx-faqs-screen');
    if (!root) { root = document.createElement('section'); root.id = 'sx-faqs-screen'; document.body.append(root); }
    root.dir = isAr() ? 'rtl' : 'ltr'; layout(root);
    root.innerHTML = `<div class="sx-faqs-wrap"><header class="sx-faqs-heading"><div><span class="sx-faqs-eyebrow">${tr('BUSINESS KNOWLEDGE','معلومات العمل')}</span><h1>${tr('FAQs','الأسئلة الشائعة')}</h1><p>${tr('Add approved answers once. Your Guided and Hybrid bots can use the same FAQ library. Replies match when at least two meaningful words from a question appear.','أضف الإجابات المعتمدة مرة واحدة ليستخدمها الروبوت الموجّه وHybrid. تتم المطابقة عند ظهور كلمتين أساسيتين على الأقل من السؤال.')}</p></div><button class="sx-faqs-primary" data-add>${tr('＋ Add FAQ','＋ إضافة سؤال شائع')}</button></header><div class="sx-faqs-status" role="status">${loading ? tr('Loading FAQs…','جارٍ تحميل الأسئلة…') : errorText ? esc(errorText) : ''}</div><div class="sx-faqs-list">${items.length ? items.map(item => `<article class="sx-faq-card ${item.active ? '' : 'is-inactive'}"><div class="sx-faq-card-head"><span class="sx-faq-state">${item.active ? tr('Active','نشط') : tr('Paused','متوقف')}</span><div class="sx-faq-actions"><button type="button" data-edit="${esc(item.id)}">${tr('Edit','تعديل')}</button><button type="button" data-toggle="${esc(item.id)}">${item.active ? tr('Pause','إيقاف') : tr('Enable','تفعيل')}</button></div></div><div class="sx-faq-languages">${item.questionEn ? `<section><h2>${tr('English','الإنجليزية')}</h2><strong>${esc(item.questionEn)}</strong><p>${esc(item.answerEn)}</p></section>` : ''}${item.questionAr ? `<section lang="ar" dir="rtl"><h2>${tr('Arabic','العربية')}</h2><strong>${esc(item.questionAr)}</strong><p>${esc(item.answerAr)}</p></section>` : ''}</div></article>`).join('') : !loading ? `<div class="sx-faq-empty"><strong>${tr('No FAQs added yet','لم تتم إضافة أسئلة شائعة بعد')}</strong><p>${tr('Add approved answers about your business, products, services and policies. Active bots use this shared knowledge.','أضف إجابات معتمدة عن نشاطك ومنتجاتك وخدماتك وسياساتك. تستخدم الروبوتات النشطة هذه المعلومات المشتركة.')}</p><button class="sx-faqs-primary" data-add>${tr('Add your first FAQ','أضف أول سؤال شائع')}</button></div>` : ''}</div></div><dialog class="sx-faq-dialog"><form method="dialog" class="sx-faq-form"><div class="sx-faq-dialog-heading"><h2></h2><button type="button" class="sx-faq-close" data-close aria-label="${tr('Close','إغلاق')}">×</button></div><p>${tr('Enter at least one language. Each question needs two meaningful words so the bot can match it reliably.','أدخل لغة واحدة على الأقل. يجب أن يتضمن السؤال كلمتين أساسيتين لتتمكن الروبوتات من مطابقته.')}</p><div class="sx-faq-locale-grid"><section class="sx-faq-locale" lang="en" dir="ltr"><h3>${tr('English','الإنجليزية')}</h3><label>${tr('English question','السؤال بالإنجليزية')}<input name="questionEn" maxlength="400"></label><label>${tr('English approved answer','الإجابة المعتمدة بالإنجليزية')}<textarea name="answerEn" maxlength="1600" rows="4"></textarea></label></section><section class="sx-faq-locale" lang="ar" dir="rtl"><h3>${tr('Arabic','العربية')}</h3><label>${tr('Arabic question','السؤال بالعربية')}<input name="questionAr" maxlength="400" dir="rtl"></label><label>${tr('Arabic approved answer','الإجابة المعتمدة بالعربية')}<textarea name="answerAr" maxlength="1600" rows="4" dir="rtl"></textarea></label></section></div><div class="sx-faq-error" role="alert"></div><footer><button type="button" data-close>${tr('Cancel','إلغاء')}</button><button class="sx-faqs-primary" type="submit">${tr('Save FAQ','حفظ السؤال')}</button></footer></form></dialog>`;
    bind(root);
  }
  function bind(root) {
    const dialog = root.querySelector('dialog'), form = dialog.querySelector('form');
    const open = item => { form.dataset.id = item?.id || ''; form.dataset.revision = item?.revision || ''; form.querySelector('h2').textContent = item ? tr('Edit FAQ','تعديل السؤال الشائع') : tr('Add FAQ','إضافة سؤال شائع'); for (const key of ['questionEn','answerEn','questionAr','answerAr']) form.elements[key].value = item?.[key] || ''; form.querySelector('.sx-faq-error').textContent = ''; dialog.showModal(); form.elements.questionEn.focus(); };
    root.querySelectorAll('[data-add]').forEach(button => button.onclick = () => open(null));
    root.querySelectorAll('[data-close]').forEach(button => button.onclick = () => dialog.close());
    root.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => open(items.find(item => item.id === button.dataset.edit)));
    root.querySelectorAll('[data-toggle]').forEach(button => button.onclick = async () => { const item = items.find(row => row.id === button.dataset.toggle); if (!item) return; button.disabled = true; try { await api('/' + item.id, 'PUT', { ...item, active: !item.active, expectedRevision: item.revision }); await load(); } catch (error) { errorText = errorLabel(error.message); render(); } });
    form.onsubmit = async event => { event.preventDefault(); const submit = form.querySelector('[type=submit]'); submit.disabled = true; const payload = Object.fromEntries(['questionEn','answerEn','questionAr','answerAr'].map(key => [key, form.elements[key].value.trim()])); try { if (form.dataset.id) await api('/' + form.dataset.id, 'PUT', { ...payload, expectedRevision: Number(form.dataset.revision) }); else await api('', 'POST', payload); dialog.close(); await load(); } catch (error) { form.querySelector('.sx-faq-error').textContent = errorLabel(error.message); } finally { submit.disabled = false; } };
  }
  function errorLabel(code) { return ({ FAQ_QUESTION_AND_ANSWER_REQUIRED:tr('Provide a question and answer in English or Arabic.','أدخل السؤال والإجابة بالإنجليزية أو العربية.'), FAQ_QUESTION_NEEDS_TWO_WORDS:tr('Each question needs at least two meaningful words.','يجب أن يتضمن السؤال كلمتين أساسيتين على الأقل.'), STALE_REVISION:tr('This FAQ changed in another session. Reload and try again.','تم تعديل هذا السؤال في جلسة أخرى. أعد التحميل وحاول مجددًا.'), PERMISSION_DENIED:tr('Your account cannot manage chatbot FAQs.','حسابك غير مخوّل لإدارة الأسئلة الشائعة للروبوت.') })[code] || tr(`Could not save this FAQ (${code}).` ,`تعذر حفظ السؤال الشائع (${code}).`); }
  async function load() { if (!active() || loading) return; loading = true; errorText = ''; render(); try { items = (await api()).items || []; } catch (error) { errorText = errorLabel(error.message); } finally { loading = false; render(); } }
  let queued = false; function update() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; if (active() && !document.getElementById('sx-faqs-screen')) load(); else if (!active()) render(); else layout(document.getElementById('sx-faqs-screen')); }); }
  new MutationObserver(update).observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['class','aria-hidden'] });
  window.addEventListener('resize', update); window.addEventListener('popstate', update); window.addEventListener('storage', update); update();
})();
