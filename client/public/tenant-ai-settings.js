(() => {
  'use strict';
  if (window.SaleMaxAiSettings) return;

  const providers = Object.freeze({
    openai: ['OpenAI', 'OpenAI'],
    gemini: ['Google Gemini', 'جوجل جيميني'],
    deepseek: ['DeepSeek', 'DeepSeek'],
  });
  const isArabic = () => window.SaleMaxLocale?.isArabic?.() ?? /^(ar(?:[-_]|$)|arabic)/i.test(localStorage.getItem('language') || document.documentElement.lang || 'en');
  const tr = (en, ar) => isArabic() ? ar : en;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const request = async (path, options = {}) => {
    const result = await window.SaleMaxWorkspace.request('ai', path, options);
    return result?.data ?? result;
  };

  function styles() {
    if (document.getElementById('sx-ai-provider-settings-css')) return;
    const style = document.createElement('style');
    style.id = 'sx-ai-provider-settings-css';
    style.textContent = `
      #sx-crm-appearance .ai-settings{display:grid;gap:14px;min-width:0}
      #sx-crm-appearance .ai-intro{margin:0;color:#475467}
      #sx-crm-appearance .ai-provider-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
      #sx-crm-appearance .ai-provider-card{display:grid;gap:7px;min-width:0;min-height:86px;padding:14px;text-align:start;border:1px solid #d7e2f2;border-radius:12px;background:#fff;color:#182230;cursor:pointer}
      #sx-crm-appearance .ai-provider-card:hover{border-color:#7ba6f8}
      #sx-crm-appearance .ai-provider-card:focus-visible{outline:3px solid #1768d4;outline-offset:2px}
      #sx-crm-appearance .ai-provider-card[aria-pressed=true]{border:2px solid #1768d4;padding:13px;box-shadow:0 0 0 2px #1768d414}
      #sx-crm-appearance .ai-provider-name{font-size:15px;font-weight:700}
      #sx-crm-appearance .ai-provider-state{font-size:12px;color:#667085}
      #sx-crm-appearance .ai-provider-state[data-state=active]{color:#05603a;font-weight:700}
      #sx-crm-appearance .ai-provider-state[data-state=saved]{color:#175cd3;font-weight:600}
      #sx-crm-appearance .ai-provider-panel{display:grid;gap:14px;padding:17px;border:1px solid #e2e8f0;border-radius:13px;background:#fcfdff;min-width:0}
      #sx-crm-appearance .ai-provider-panel h3{margin:0;font-size:17px}
      #sx-crm-appearance .ai-provider-panel p{margin:4px 0 0;color:#667085;font-size:13px}
      #sx-crm-appearance .ai-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      #sx-crm-appearance .ai-field{display:grid;gap:6px;min-width:0;font-weight:600;color:#344054}
      #sx-crm-appearance .ai-field small{font-size:12px;font-weight:400;color:#667085}
      #sx-crm-appearance .ai-field input{min-height:44px}
      #sx-crm-appearance .ai-actions{display:flex;align-items:center;flex-wrap:wrap;gap:9px}
      #sx-crm-appearance .ai-actions button{min-height:44px}
      #sx-crm-appearance .ai-actions .ai-primary{background:#1768d4;color:#fff;border-color:#1768d4}
      #sx-crm-appearance .ai-actions button:disabled{opacity:.55;cursor:wait}
      #sx-crm-appearance .ai-message{min-height:20px;color:#475467;font-size:13px}
      #sx-crm-appearance .ai-message[data-error=true]{color:#b42318}
      #sx-crm-appearance .ai-live-notice,#sx-crm-appearance .ai-limit{padding:13px 15px;border:1px solid #c7dcff;border-inline-start:3px solid #1768d4;border-radius:10px;background:#f5f8ff;color:#344054}
      #sx-crm-appearance .ai-limit{display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,240px) auto;align-items:end;gap:12px}
      #sx-crm-appearance .ai-limit p{margin:0;color:#667085;font-size:12px}
      html[data-sx-theme=dark] #sx-crm-appearance .ai-intro,html[data-sx-theme=dark] #sx-crm-appearance .ai-provider-state,html[data-sx-theme=dark] #sx-crm-appearance .ai-provider-panel p,html[data-sx-theme=dark] #sx-crm-appearance .ai-field small,html[data-sx-theme=dark] #sx-crm-appearance .ai-limit p{color:#a9b7ca}
      html[data-sx-theme=dark] #sx-crm-appearance .ai-provider-card,html[data-sx-theme=dark] #sx-crm-appearance .ai-provider-panel,html[data-sx-theme=dark] #sx-crm-appearance .ai-live-notice,html[data-sx-theme=dark] #sx-crm-appearance .ai-limit{background:#111a28;border-color:#34445b;color:#e6edf7}
      html[data-sx-theme=dark] #sx-crm-appearance .ai-provider-card[aria-pressed=true]{border-color:#78a9ff}
      html[data-sx-theme=dark] #sx-crm-appearance .ai-provider-state[data-state=active]{color:#75e0a7}
      html[data-sx-theme=dark] #sx-crm-appearance .ai-provider-state[data-state=saved]{color:#84adff}
      @media(max-width:760px){#sx-crm-appearance .ai-provider-grid{grid-template-columns:1fr}#sx-crm-appearance .ai-limit{grid-template-columns:1fr}#sx-crm-appearance .ai-fields{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function getProvider(data, id) {
    return data.providers?.find(item => item.provider === id) || { provider: id, configured: false, active: false, model: null, revision: 0 };
  }

  function errorMessage(error) {
    const labels = {
      PERMISSION_DENIED: tr('Only the business owner can manage provider settings.', 'مالك النشاط فقط يمكنه إدارة إعدادات المزود.'),
      STALE_REVISION: tr('Settings changed in another tab. Reload the page and try again.', 'تغيرت الإعدادات في نافذة أخرى. أعد تحميل الصفحة وحاول مجددًا.'),
      PROVIDER_NOT_CONFIGURED: tr('Save this provider’s settings before switching to it.', 'احفظ إعدادات هذا المزود قبل التبديل إليه.'),
      PROVIDER_KEY_REQUIRED: tr('Enter an API key for this provider.', 'أدخل مفتاح API لهذا المزود.'),
      INVALID_PROVIDER_CONFIG: tr('Enter a valid model ID for this provider.', 'أدخل معرّف نموذج صالحًا لهذا المزود.'),
      INVALID_PROVIDER_KEY: tr('The API key must be between 16 and 2,048 characters.', 'يجب أن يتراوح طول مفتاح API بين 16 و2,048 حرفًا.'),
      INVALID_DAILY_TOKEN_LIMIT: tr('Choose a daily limit from 1,000 to 1,000,000 tokens.', 'اختر حدًا يوميًا بين 1,000 و1,000,000 رمز.'),
      PROVIDER_CONNECTION_FAILED: tr('The provider test failed. Check the key, model access and provider account.', 'فشل اختبار المزود. تحقق من المفتاح وإتاحة النموذج وحساب المزود.'),
      AI_SETTINGS_UNAVAILABLE: tr('AI settings are temporarily unavailable. Try again.', 'إعدادات الذكاء الاصطناعي غير متاحة مؤقتًا. حاول مجددًا.'),
    };
    return labels[error?.message] || tr('The request could not be completed. Try again.', 'تعذر إكمال الطلب. حاول مجددًا.');
  }

  async function mount(box) {
    styles();
    box.setAttribute('aria-busy', 'true');
    box.innerHTML = `<p class="ai-intro" role="status">${esc(tr('Loading saved provider settings…', 'جارٍ تحميل إعدادات المزود المحفوظة…'))}</p>`;
    let data;
    try {
      data = await request('/settings');
    } catch (error) {
      box.removeAttribute('aria-busy');
      box.innerHTML = `<div class="ai-message" data-error="true" role="alert">${esc(errorMessage(error))}</div>${error.message === 'PERMISSION_DENIED' ? '' : `<button type="button" data-ai-retry>${esc(tr('Retry','إعادة المحاولة'))}</button>`}`;
      box.querySelector('[data-ai-retry]')?.addEventListener('click', () => mount(box));
      return;
    }

    const supported = Array.isArray(data.supportedProviders) ? data.supportedProviders.filter(id => providers[id]) : Object.keys(providers);
    let selected = data.provider || supported.find(id => getProvider(data, id).configured) || supported[0] || 'openai';
    let feedback = '';
    let feedbackError = false;
    const drafts = new Map();

    const render = () => {
      const current = getProvider(data, selected);
      const draft = drafts.get(selected);
      const model = draft?.model ?? current.model ?? (current.active ? data.model : '') ?? '';
      const key = draft?.apiKey ?? '';
      const status = feedback;
      box.setAttribute('aria-busy', 'false');
      box.innerHTML = `<div class="ai-settings">
        <p class="ai-intro">${esc(tr('Save credentials for each provider, then switch the business to any saved configuration. Only one provider is active at a time. Keys stay encrypted on the server and are never sent back to this page.', 'احفظ بيانات كل مزود، ثم بدّل النشاط إلى أي إعداد محفوظ. يعمل مزود واحد فقط في كل مرة. تُشفّر المفاتيح على الخادم ولا تُرسل إلى هذه الصفحة.'))}</p>
        <div class="ai-provider-grid" role="group" aria-label="${esc(tr('AI providers', 'مزودو الذكاء الاصطناعي'))}">${supported.map(id => {
          const entry = getProvider(data, id);
          const state = entry.active ? 'active' : entry.configured ? 'saved' : 'new';
          const stateText = entry.active ? tr('Active now', 'نشط الآن') : entry.configured ? tr('Saved · ready to switch', 'محفوظ · جاهز للتبديل') : tr('Not configured', 'غير مُعد');
          const detail = entry.model ? ` · ${esc(entry.model)}` : '';
          return `<button type="button" class="ai-provider-card" data-ai-select="${esc(id)}" aria-pressed="${selected === id}"><span class="ai-provider-name">${esc(isArabic() ? providers[id][1] : providers[id][0])}</span><span class="ai-provider-state" data-state="${state}">${esc(stateText)}${detail}</span></button>`;
        }).join('')}</div>
        <section class="ai-provider-panel" aria-labelledby="ai-provider-title"><div><h3 id="ai-provider-title">${esc(isArabic() ? providers[selected]?.[1] : providers[selected]?.[0])}</h3><p>${esc(current.configured ? tr('A key is saved for this provider. Leave the key field blank to keep it.', 'يوجد مفتاح محفوظ لهذا المزود. اترك حقل المفتاح فارغًا للاحتفاظ به.') : tr('Add a key and model to save this provider for later use.', 'أضف مفتاحًا ونموذجًا لحفظ هذا المزود واستخدامه لاحقًا.'))}</p></div>
          <div class="ai-fields"><label class="ai-field">${esc(tr('Model ID', 'معرّف النموذج'))}<input data-ai-model maxlength="80" autocomplete="off" value="${esc(model)}" placeholder="${esc(tr('Enter a model ID supported by this provider', 'أدخل معرّف نموذج يدعمه هذا المزود'))}"></label><label class="ai-field">${esc(tr('Provider API key', 'مفتاح API للمزود'))}<input data-ai-key type="password" autocomplete="new-password" maxlength="2048" value="${esc(key)}" placeholder="${esc(current.configured ? tr('Leave blank to keep the saved key', 'اتركه فارغًا للاحتفاظ بالمفتاح المحفوظ') : tr('Paste the provider API key', 'ألصق مفتاح API للمزود'))}"><small>${esc(tr('Saved keys are encrypted and never displayed again.', 'تُحفظ المفاتيح مشفّرة ولا تُعرض مرة أخرى.'))}</small></label></div>
          ${current.active ? `<div class="ai-live-notice">${esc(tr('This provider is shared by the business. Saving changes applies them to new AI calls from all live AI and Hybrid bots. No bot pause is needed.', 'هذا المزود مشترك للنشاط. تُطبّق التغييرات المحفوظة على طلبات الذكاء الاصطناعي الجديدة لجميع روبوتات AI وHybrid النشطة. لا يلزم إيقاف الروبوتات.'))}</div>` : ''}
          <div class="ai-actions"><button type="button" data-ai-test>${esc(tr('Test connection', 'اختبار الاتصال'))}</button><button type="button" data-ai-save>${esc(current.active ? tr('Save active settings', 'حفظ الإعدادات النشطة') : tr('Save for later', 'حفظ للاستخدام لاحقًا'))}</button>${current.active ? '' : current.configured ? `<button type="button" class="ai-primary" data-ai-activate>${esc(tr('Switch to this provider', 'التبديل إلى هذا المزود'))}</button>` : `<button type="button" class="ai-primary" data-ai-save-activate>${esc(tr('Save and use now', 'الحفظ والاستخدام الآن'))}</button>`}</div>
          <div class="ai-message" data-ai-status aria-live="polite" data-error="${feedbackError}">${esc(status)}</div>
        </section>
        <section class="ai-limit"><div><strong>${esc(tr('Shared daily token limit', 'حد الرموز اليومي المشترك'))}</strong><p>${esc(tr('The cap and usage counter are shared across this business’s bots and providers.', 'يُشارك حد الاستخدام وعدّاد الرموز بين روبوتات النشاط ومزوديه.'))}</p></div><label class="ai-field"><span class="sr-only">${esc(tr('Daily token limit', 'حد الرموز اليومي'))}</span><input data-ai-limit type="number" min="1000" max="1000000" step="1000" value="${Number(data.dailyTokenLimit || 50000)}"></label><button type="button" data-ai-save-limit ${data.configured ? '' : 'disabled'}>${esc(tr('Save limit', 'حفظ الحد'))}</button></section>
        <p class="ai-intro">${esc(tr('Connection tests send a short generic prompt without customer data and may incur a small provider charge. Prompt caching remains automatic where the selected model supports it.', 'ترسل اختبارات الاتصال طلبًا عامًا قصيرًا دون بيانات العملاء وقد تترتب عليها تكلفة بسيطة من المزود. يظل تخزين المطالبات مؤتمتًا عندما يدعمه النموذج المحدد.'))}</p>
      </div>`;

      box.querySelectorAll('[data-ai-select]').forEach(button => button.addEventListener('click', () => {
        const modelValue = box.querySelector('[data-ai-model]')?.value.trim() || '';
        const keyValue = box.querySelector('[data-ai-key]')?.value || '';
        if (modelValue || keyValue) drafts.set(selected, { model: modelValue, apiKey: keyValue });
        selected = button.dataset.aiSelect;
        feedback = '';
        feedbackError = false;
        render();
      }));

      const modelInput = box.querySelector('[data-ai-model]');
      const keyInput = box.querySelector('[data-ai-key]');
      const limitInput = box.querySelector('[data-ai-limit]');
      const setStatus = (message, error = false) => {
        const target = box.querySelector('[data-ai-status]');
        target.textContent = message;
        target.dataset.error = String(error);
      };
      const formData = () => ({ model: modelInput.value.trim(), apiKey: keyInput.value });
      const confirmActivation = () => window.confirm(current.active ? tr(
        'Saving updates the shared provider used by all live AI/Hybrid bots for new AI calls. Continue?',
        'سيحدّث الحفظ المزود المشترك لجميع روبوتات AI وHybrid النشطة في الطلبات الجديدة. هل تريد المتابعة؟',
      ) : tr(
        `Switching to ${providers[selected][0]} changes the provider used by all live AI/Hybrid bots for new AI calls. Continue?`,
        `سيؤدي التبديل إلى ${providers[selected][1]} إلى تغيير المزود المستخدم لجميع روبوتات AI وHybrid النشطة في الطلبات الجديدة. هل تريد المتابعة؟`,
      ));
      const setBusy = busy => {
        box.setAttribute('aria-busy', String(busy));
        box.querySelectorAll('button,input').forEach(control => { control.disabled = busy || (control.hasAttribute('data-ai-save-limit') && !data.configured); });
      };
      const saveAction = async (button, action, activate) => {
        const draftValues = formData();
        if (!draftValues.model) { setStatus(errorMessage({ message: 'INVALID_PROVIDER_CONFIG' }), true); return; }
        if ((activate || current.active) && !confirmActivation()) return;
        const payload = {
          action, provider: selected, model: draftValues.model,
          expectedProviderRevision: Number(current.revision || 0),
          expectedRevision: Number(data.revision || 0),
        };
        if (draftValues.apiKey) payload.apiKey = draftValues.apiKey;
        if (activate || current.active) payload.dailyTokenLimit = Number(limitInput.value);
        setBusy(true);
        setStatus(tr('Saving provider settings…', 'جارٍ حفظ إعدادات المزود…'));
        try {
          data = await request('/settings', { method: 'PUT', body: payload });
          drafts.delete(selected);
          feedback = action === 'save-provider' && !activate && !current.active
            ? tr('Provider saved. You can switch to it any time.', 'تم حفظ المزود. يمكنك التبديل إليه في أي وقت.')
            : tr('Provider settings saved and active.', 'تم حفظ إعدادات المزود وتفعيلها.');
          feedbackError = false;
          render();
        } catch (error) {
          drafts.set(selected, draftValues);
          if (error.message === 'STALE_REVISION') {
            data = await request('/settings').catch(() => data);
          }
          feedback = errorMessage(error);
          feedbackError = true;
          render();
        }
      };

      box.querySelector('[data-ai-test]').addEventListener('click', async event => {
        const values = formData();
        if (!values.model) { setStatus(errorMessage({ message: 'INVALID_PROVIDER_CONFIG' }), true); return; }
        const payload = { provider: selected, model: values.model };
        if (values.apiKey) payload.apiKey = values.apiKey;
        const button = event.currentTarget;
        setBusy(true);
        button.disabled = true;
        setStatus(tr('Testing provider connection…', 'جارٍ اختبار اتصال المزود…'));
        try {
          await request('/settings/test', { method: 'POST', body: payload });
          setStatus(tr('Connection succeeded. No customer data was sent.', 'نجح الاتصال. لم تُرسل أي بيانات للعملاء.'));
        } catch (error) { setStatus(errorMessage(error), true); }
        finally { setBusy(false); button.disabled = false; }
      });
      box.querySelector('[data-ai-save]').addEventListener('click', event => saveAction(event.currentTarget, 'save-provider', false));
      box.querySelector('[data-ai-save-activate]')?.addEventListener('click', event => saveAction(event.currentTarget, 'save-and-activate', true));
      box.querySelector('[data-ai-activate]')?.addEventListener('click', async event => {
        if (!confirmActivation()) return;
        const pendingModel = modelInput.value.trim();
        const pendingKey = keyInput.value;
        if (pendingKey || pendingModel !== (current.model || '')) drafts.set(selected, { model: pendingModel, apiKey: pendingKey });
        const button = event.currentTarget;
        setBusy(true);
        setStatus(tr('Switching active provider…', 'جارٍ تبديل المزود النشط…'));
        try {
          data = await request('/settings', { method: 'PUT', body: {
            action: 'activate-provider', provider: selected,
            expectedProviderRevision: Number(current.revision || 0), expectedRevision: Number(data.revision || 0),
          } });
          feedback = tr('Provider switched. New AI calls will use this provider.', 'تم تبديل المزود. ستستخدم الطلبات الجديدة هذا المزود.');
          feedbackError = false;
          render();
        } catch (error) {
          if (error.message === 'STALE_REVISION') data = await request('/settings').catch(() => data);
          feedback = errorMessage(error);
          feedbackError = true;
          render();
        }
      });
      box.querySelector('[data-ai-save-limit]').addEventListener('click', async event => {
        const limit = Number(limitInput.value);
        if (!Number.isSafeInteger(limit) || limit < 1000 || limit > 1000000) { setStatus(errorMessage({ message: 'INVALID_DAILY_TOKEN_LIMIT' }), true); return; }
        const button = event.currentTarget;
        setBusy(true);
        setStatus(tr('Saving shared limit…', 'جارٍ حفظ الحد المشترك…'));
        try {
          data = await request('/settings', { method: 'PUT', body: { action: 'update-limits', dailyTokenLimit: limit, expectedRevision: Number(data.revision || 0) } });
          feedback = tr('Shared daily limit saved.', 'تم حفظ الحد اليومي المشترك.');
          feedbackError = false;
          render();
        } catch (error) {
          if (error.message === 'STALE_REVISION') data = await request('/settings').catch(() => data);
          feedback = errorMessage(error);
          feedbackError = true;
          render();
        }
      });
    };

    render();
  }

  window.SaleMaxAiSettings = Object.freeze({ mount });
})();
