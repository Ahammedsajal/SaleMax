(() => {
  'use strict';
  if (window.__sxAiIntegrations) return;
  window.__sxAiIntegrations = true;
  const $ = selector => document.querySelector(selector);
  let preferences;
  const prefs = () => preferences || (preferences = window.SxTeamUiPreferences?.create({ storage: localStorage, document, getComputedStyle }));
  const arabic = () => prefs()?.isArabic() ?? window.SaleMaxLocale?.isArabic?.() ?? false;
  const tr = (en, ar) => arabic() ? ar : en;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const active = () => /^\/(?:user|agent)\/?$/.test(location.pathname) && new URLSearchParams(location.search).get('page') === 'ai-integrations';
  const identity = () => `${window.SaleMaxActor || 'user'}:${localStorage.getItem(window.SaleMaxActor === 'agent' ? 'wacrm_agent' : 'wacrm_user') || 'cookie'}`;
  const request = (path, options) => window.SaleMaxWorkspace.request('ai', '/settings' + path, options).then(result => result.data);
  let epoch = 0, loading = false, identityKey = '', data = null;

  function errorText(error) {
    return ({ PERMISSION_DENIED: tr('Only the business owner can configure AI integrations.', 'مالك النشاط فقط يمكنه إعداد تكاملات الذكاء الاصطناعي.'),
      AUTH_REQUIRED: tr('Your session expired. Sign in again.', 'انتهت الجلسة. سجّل الدخول مجددًا.'),
      STALE_REVISION: tr('Settings changed in another tab. Reload before saving.', 'تغيّرت الإعدادات في نافذة أخرى. أعد التحميل قبل الحفظ.'),
      LIVE_BOT_MUST_BE_PAUSED: tr('Pause active AI or Hybrid bots before changing the provider, model or key.', 'أوقف روبوتات الذكاء الاصطناعي أو الهجينة النشطة قبل تغيير المزود أو النموذج أو المفتاح.'),
      PROVIDER_KEY_REQUIRED: tr('Enter an API key for the selected provider.', 'أدخل مفتاح API للمزود المحدد.'),
      INVALID_PROVIDER_CONFIG: tr('Choose a provider and enter a valid model ID.', 'اختر مزودًا وأدخل معرّف نموذج صالحًا.'),
      INVALID_PROVIDER_KEY: tr('Check the provider API key.', 'تحقق من مفتاح API للمزود.') })[error.message] || tr('AI settings are unavailable. Check your connection and retry.', 'إعدادات الذكاء الاصطناعي غير متاحة. تحقق من الاتصال وأعد المحاولة.');
  }

  function syncPreferences(node) {
    const lang = arabic() ? 'ar' : 'en', dir = prefs()?.isRtl() ? 'rtl' : arabic() ? 'rtl' : 'ltr', theme = prefs()?.isDark() ? 'dark' : 'light';
    if (node.lang !== lang) node.lang = lang;
    if (node.dir !== dir) node.dir = dir;
    if (node.dataset.theme !== theme) node.dataset.theme = theme;
  }

  function layout(node) {
    node.innerHTML = `<div class="ai-wrap"><header><div><h1>${tr('AI Integrations', 'تكاملات الذكاء الاصطناعي')}</h1><p>${tr('One provider configuration for your business, with shared usage and prompt caching.', 'إعداد موحد لمزود نشاطك مع تتبع الاستخدام والتخزين المؤقت للمطالبات.')}</p></div><button type="button" data-reload>${tr('Refresh', 'تحديث')}</button></header><div data-feedback role="status" aria-live="polite"></div><div data-content><p>${tr('Loading AI integrations…', 'جارٍ تحميل تكاملات الذكاء الاصطناعي…')}</p></div></div>`;
    node.querySelector('[data-reload]').onclick = () => load(node);
  }

  function feedback(node, text, failed = false) {
    const box = node.querySelector('[data-feedback]');
    box.textContent = text;
    box.className = failed ? 'ai-feedback error' : 'ai-feedback';
  }

  function render(node, config, usage) {
    const providers = config.providers || [];
    const selected = config.provider || providers[0]?.id;
    const locked = config.lockedByLiveBot;
    const n = value => Number(value || 0).toLocaleString(arabic() ? 'ar-QA' : 'en-US');
    const usd = value => new Intl.NumberFormat(arabic() ? 'ar-QA' : 'en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(Number(value || 0));
    node.querySelector('[data-content]').innerHTML = `<section class="ai-card"><div class="ai-section-heading"><h2>${tr('Providers', 'المزودون')}</h2><span class="ai-badge">${config.configured ? tr('Configured', 'تم الإعداد') : tr('Setup required', 'يلزم الإعداد')}</span></div><p>${tr('Choose one active provider shared by this business. Existing encrypted credentials are retained when the key field is empty.', 'اختر مزودًا نشطًا مشتركًا للنشاط. يُحتفظ ببيانات الاعتماد المشفرة الحالية عند ترك حقل المفتاح فارغًا.')}</p><form data-config><fieldset ${locked ? 'disabled' : ''}><legend class="ai-sr-only">${tr('AI provider configuration', 'إعداد مزود الذكاء الاصطناعي')}</legend><div class="ai-providers">${providers.map(provider => `<label class="ai-provider"><input type="radio" name="provider" value="${esc(provider.id)}" ${provider.id === selected ? 'checked' : ''}><span><strong>${esc(provider.name)}</strong><small>${provider.id === config.provider && config.configured ? tr('Current business provider', 'المزود الحالي للنشاط') : tr('Supported adapter', 'تكامل مدعوم')}</small></span></label>`).join('')}</div><div class="ai-fields"><label>${tr('Model', 'النموذج')}<input name="model" required maxlength="80" pattern="[A-Za-z0-9._:\-]+" list="sx-ai-models" autocomplete="off" value="${esc(config.model || providers[0]?.recommendedModel || '')}"><datalist id="sx-ai-models"></datalist><small>${tr('Select a suggested model or enter a model ID available in your provider account.', 'اختر نموذجًا مقترحًا أو أدخل معرّف نموذج متاحًا في حساب المزود.')}</small></label><label>${config.configured ? tr('Replace API key (optional)', 'استبدال مفتاح API (اختياري)') : tr('API key', 'مفتاح API')}<input name="apiKey" type="password" autocomplete="new-password" maxlength="2048" ${config.configured ? '' : 'required'} placeholder="${config.configured ? tr('Leave blank to retain current key', 'اتركه فارغًا للاحتفاظ بالمفتاح الحالي') : tr('Enter provider API key', 'أدخل مفتاح API للمزود')}"><small>${tr('Stored encrypted on the server. Saved keys are never returned to this page.', 'يُحفظ مشفرًا على الخادم ولا يُعاد المفتاح المحفوظ إلى هذه الصفحة.')}</small></label></div><p data-rates class="ai-note"></p><button class="ai-primary" type="submit">${tr('Save AI integration', 'حفظ تكامل الذكاء الاصطناعي')}</button></fieldset></form>${locked ? `<p class="ai-notice">${tr('An AI or Hybrid bot is live. Pause active bots before changing provider credentials or the model.', 'يوجد روبوت ذكاء اصطناعي أو هجين نشط. أوقف الروبوتات النشطة قبل تغيير بيانات المزود أو النموذج.')} <a href="/user?page=wa-chatbot">${tr('Manage bots', 'إدارة الروبوتات')}</a></p>` : ''}</section>
    <section class="ai-card"><div class="ai-section-heading"><h2>${tr('Prompt caching', 'التخزين المؤقت للمطالبات')}</h2><span class="ai-badge">${tr('Configured automatically', 'مُعدّ تلقائيًا')}</span></div><p>${tr('Repeated instructions and business facts can be reused for at least 30 minutes on supported OpenAI models, reducing input costs while each question gets a fresh reply.', 'يمكن إعادة استخدام التعليمات ومعلومات النشاط المتكررة لمدة 30 دقيقة على الأقل في نماذج OpenAI المدعومة، لتقليل تكلفة الإدخال مع توليد رد جديد لكل سؤال.')}</p><p class="ai-note">${tr('A cache hit depends on the model, matching prefix, minimum length and provider availability. Short requests may have no cached tokens. Each customer still gets a newly generated reply. Gemini and DeepSeek manage their own caching; discounts are only estimated where rates are verified.', 'تعتمد الاستفادة على النموذج وتطابق البادئة والحد الأدنى للطول وتوفر المزود. قد لا تحتوي الطلبات القصيرة على رموز مخزنة. يُولّد رد جديد لكل عميل. يدير Gemini وDeepSeek التخزين الخاص بهما، وتُقدّر الخصومات عند التحقق من الأسعار فقط.')}</p></section>
    <section class="ai-card"><div class="ai-section-heading"><h2>${tr('Usage this month', 'استخدام هذا الشهر')}</h2><span dir="ltr">${esc(usage?.month || '')} · Asia/Qatar</span></div>${usage ? `<dl class="ai-stats">${[
      [tr('Estimated spend', 'الإنفاق التقديري'), usd(usage.estimatedUsd)], [tr('Input tokens', 'رموز الإدخال'), n(usage.inputTokens)],
      [tr('Output tokens', 'رموز الإخراج'), n(usage.outputTokens)], [tr('Cached input tokens', 'رموز الإدخال المخزنة'), n(usage.cachedInputTokens)],
      [tr('Cache-write tokens', 'رموز الكتابة للتخزين'), n(usage.cacheWriteTokens)], [tr('Requests with cache reads', 'طلبات استخدمت التخزين'), `${n(usage.cacheReadRequests)} / ${n(usage.providerRequests)}`],
      [tr('Cache-read savings', 'توفير قراءة التخزين'), usd(usage.readSavingsUsd)], [tr('Cache-write premium', 'تكلفة كتابة التخزين الإضافية'), usd(usage.writePremiumUsd)],
    ].map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : `<p role="alert">${tr('Usage could not be loaded. Refresh to retry.', 'تعذر تحميل الاستخدام. حدّث الصفحة للمحاولة مجددًا.')}</p>`}<p class="ai-note">${tr('Cache details and request counts start with this update; earlier monthly usage is not recalculated. Estimates may differ from your provider invoice.', 'تبدأ تفاصيل التخزين وعدد الطلبات من هذا التحديث ولا يُعاد حساب الاستخدام السابق. قد تختلف التقديرات عن فاتورة المزود.')}</p><p>${tr('At $10 estimated monthly spend, the owner and manager receive a reminder. Replies continue without a usage cap.', 'عند بلوغ الإنفاق الشهري التقديري 10 دولارات، يتلقى المالك والمدير تذكيرًا. تستمر الردود دون حد استخدام.')}</p></section>
    <section class="ai-card"><h2>${tr('Uses this shared integration', 'تستخدم هذا التكامل المشترك')}</h2><ul class="ai-workflows"><li>${tr('AI and Hybrid chatbot replies', 'ردود روبوتات الذكاء الاصطناعي والهجينة')}</li><li>${tr('Inbox reply suggestions', 'اقتراحات الردود في صندوق الوارد')}</li><li>${tr('English/Arabic translation', 'الترجمة بين الإنجليزية والعربية')}</li><li>${tr('AI steps in Automation Flows', 'خطوات الذكاء الاصطناعي في مسارات الأتمتة')}</li><li>${tr('Staff handoff summaries', 'ملخصات التحويل للموظفين')}</li></ul><p class="ai-note">${tr('Bot behavior, business facts and handoff rules remain in their existing screens. Provider availability depends on your provider account.', 'تُدار سلوكيات الروبوت ومعلومات النشاط وقواعد التحويل في صفحاتها الحالية. يعتمد توفر النماذج على حساب المزود.')}</p></section>`;
    const form = node.querySelector('[data-config]');
    const model = form.elements.model, key = form.elements.apiKey;
    let priorProvider = selected;
    function modelOptions() {
      const provider = providers.find(item => item.id === form.elements.provider.value);
      node.querySelector('#sx-ai-models').innerHTML = (provider?.models || []).map(item => `<option value="${esc(item.id)}"></option>`).join('');
      const rate = provider?.models.find(item => item.id === model.value);
      node.querySelector('[data-rates]').textContent = rate ? `${tr('Estimated USD per 1M tokens: input', 'الدولار التقديري لكل مليون رمز: إدخال')} ${rate.inputUsdPerMillion} · ${tr('output', 'إخراج')} ${rate.outputUsdPerMillion}${rate.cachedInputUsdPerMillion !== undefined ? ` · ${tr('cache read', 'قراءة التخزين')} ${rate.cachedInputUsdPerMillion} · ${tr('cache write', 'كتابة التخزين')} ${rate.cacheWriteUsdPerMillion}` : ''}` : tr('Custom model: usage is estimated at the provider’s conservative default rate.', 'نموذج مخصص: يُقدّر الاستخدام بالسعر الافتراضي التحفظي للمزود.');
    }
    form.addEventListener('change', event => {
      if (event.target.name === 'provider') {
        const next = form.elements.provider.value;
        if (next !== priorProvider) { key.value = ''; priorProvider = next; }
        model.value = next === config.provider ? config.model : providers.find(item => item.id === next)?.recommendedModel || '';
        key.required = !config.configured || next !== config.provider;
      }
      modelOptions();
    });
    model.addEventListener('input', modelOptions);
    modelOptions();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button[type=submit]');
      if (locked || button.disabled) return;
      button.disabled = true;
      const requestIdentity = identityKey;
      const payload = { provider: form.elements.provider.value, model: model.value.trim(), expectedRevision: Number(config.revision) };
      if (key.value) payload.apiKey = key.value;
      try {
        await request('', { method: 'PUT', body: payload });
        key.value = '';
        if (identity() === requestIdentity && node.isConnected) { await load(node); feedback(node, tr('AI integration saved.', 'تم حفظ تكامل الذكاء الاصطناعي.')); }
      } catch (error) { if (identity() === requestIdentity && node.isConnected) feedback(node, errorText(error), true); }
      finally { delete payload.apiKey; button.disabled = false; }
    });
  }

  async function load(node) {
    const current = ++epoch, key = identity();
    identityKey = key;
    loading = true;
    feedback(node, '');
    node.querySelector('[data-reload]').disabled = true;
    try {
      const session = await window.SaleMaxWorkspace.session();
      if (session.role !== 'owner' || !session.roleNavigation?.includes('ai-integrations')) throw Error('PERMISSION_DENIED');
      const [config, usage] = await Promise.all([request(''), request('/usage').catch(() => null)]);
      if (current !== epoch || !active() || identity() !== key || !node.isConnected) return;
      data = { config, usage };
      render(node, config, usage);
    } catch (error) {
      if (current === epoch && identity() === key && node.isConnected) {
        data = null; node.querySelector('[data-content]').replaceChildren(); feedback(node, errorText(error), true);
      }
    } finally { if (current === epoch) { loading = false; node.querySelector('[data-reload]').disabled = false; } }
  }

  function update() {
    let node = $('#sx-ai-integrations');
    if (!active()) { if (node) { epoch++; loading = false; data = null; node.remove(); } return; }
    if (!node) {
      node = document.createElement('main'); node.id = 'sx-ai-integrations'; node.setAttribute('aria-label', tr('AI Integrations', 'تكاملات الذكاء الاصطناعي'));
      syncPreferences(node); document.body.append(node); layout(node); load(node);
    } else {
      syncPreferences(node);
      if (identity() !== identityKey) { data = null; layout(node); load(node); }
    }
  }
  window.addEventListener('popstate', update);
  window.addEventListener('salemax:languagechange', () => {
    const node = $('#sx-ai-integrations');
    if (node) { syncPreferences(node); layout(node); if (data) render(node, data.config, data.usage); else load(node); }
  });
  window.addEventListener('storage', update);
  new MutationObserver(update).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['dir', 'lang', 'data-theme'] });
  update();
})();
