(() => {
  'use strict';

  const copy = () => document.documentElement.lang?.toLowerCase().startsWith('ar') || (localStorage.getItem('language') || '').toLowerCase().startsWith('ar')
    ? { translate: 'ترجمة', working: 'جارٍ الترجمة…', toEnglish: 'تُرجم إلى الإنجليزية', toArabic: 'تُرجم إلى العربية', failed: 'تعذرت الترجمة. اضغط لإعادة المحاولة.', empty: 'اكتب رسالة أولاً.', review: 'راجع الترجمة قبل الإرسال.', translateMessage: 'ترجمة الرسالة', showOriginal: 'عرض الرسالة الأصلية', translating: 'جارٍ الترجمة…' }
    : { translate: 'Translate', working: 'Translating…', toEnglish: 'Translated to English', toArabic: 'Translated to Arabic', failed: 'Translation failed. Click to retry.', empty: 'Write a message first.', review: 'Review the translation before sending.', translateMessage: 'Translate message', showOriginal: 'Show original message', translating: 'Translating…' };

  const visible = element => element && element.getClientRects().length > 0;
  const textOf = element => String(element?.getAttribute('placeholder') || element?.getAttribute('aria-label') || '').toLowerCase();
  const findEditor = () => [...document.querySelectorAll('textarea')].find(element => visible(element) && /quick repl|type.*message|اكتب.*رسالة/.test(textOf(element))) || null;

  function commonAncestor(elements) {
    if (elements.some(element => !element)) return null;
    let current = elements[0];
    while (current && !elements.every(element => current.contains(element))) current = current.parentElement;
    return current;
  }

  function setReactValue(editor, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(editor, value); else editor.value = value;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: value }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const draftTranslations = new WeakMap();

  async function translate(editor, button, status) {
    const strings = copy();
    const saved = draftTranslations.get(editor);
    if (saved && editor.value === saved.original) {
      setReactValue(editor, saved.translated);
      button.title = saved.targetLanguage === 'ar' ? strings.toArabic : strings.toEnglish;
      status.textContent = strings.review;
      return;
    }
    if (saved && editor.value === saved.translated) {
      setReactValue(editor, saved.original);
      button.title = strings.translateMessage;
      status.textContent = '';
      return;
    }
    const original = editor.value;
    if (!original.trim()) { status.textContent = strings.empty; return; }
    button.disabled = true;
    button.title = strings.working;
    button.setAttribute('aria-label', strings.working);
    status.textContent = '';
    try {
      const result = await window.SaleMaxWorkspace.request('inboxTranslation', '', { method: 'POST', body: { text: original } });
      const translated = result.data?.text;
      if (typeof translated !== 'string' || !translated.trim()) throw new Error('TRANSLATION_FAILED');
      if (editor.value !== original) throw new Error('DRAFT_CHANGED');
      const cleanTranslation = translated.trim();
      draftTranslations.set(editor, { original, translated: cleanTranslation, targetLanguage: result.data.targetLanguage });
      setReactValue(editor, cleanTranslation);
      editor.focus();
      editor.setSelectionRange(cleanTranslation.length, cleanTranslation.length);
      button.title = strings.showOriginal;
      button.setAttribute('aria-label', strings.showOriginal);
      status.textContent = strings.review;
    } catch {
      button.title = strings.failed;
      button.setAttribute('aria-label', strings.failed);
      status.textContent = strings.failed;
    } finally {
      button.disabled = false;
    }
  }

  function addStyles() {
    if (document.getElementById('sx-inbox-translation-style')) return;
    const style = document.createElement('style');
    style.id = 'sx-inbox-translation-style';
    style.textContent = '.sx-inbox-translate-status{position:absolute;inset-inline-start:12px;bottom:calc(100% + 4px);font:12px Roboto,Arial,sans-serif;color:#667085;pointer-events:none}.sx-inbox-translation-icon{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;width:20px;height:20px;margin-inline-start:5px;padding:0;border:0;border-radius:50%;background:transparent;color:#65758b;font:600 9px/1 Arial,sans-serif;cursor:pointer;opacity:.8}.sx-inbox-translation-icon:hover{background:rgba(23,104,212,.1);color:#1768d4;opacity:1}.sx-inbox-translation-icon:disabled{opacity:.55;cursor:wait}';
    document.head.append(style);
  }

  function incomingTextBubble(body) {
    if (!body?.matches('.MuiTypography-body2') || !body.textContent.trim()) return null;
    let current = body.parentElement;
    while (current && current !== document.body) {
      const style = getComputedStyle(current);
      const left = parseFloat(style.borderBottomLeftRadius) || 0;
      const right = parseFloat(style.borderBottomRightRadius) || 0;
      if (left <= 8 && right >= 12) return current;
      current = current.parentElement;
    }
    return null;
  }

  let readAccess;
  async function mountReceivedMessageTranslations() {
    if (!/^\/user\/?$/.test(location.pathname) || !/[?&]page=inbox(?:&|$)/.test(location.search)) return;
    if (!readAccess) readAccess = window.SaleMaxWorkspace?.session?.().then(session => session?.permissions?.['conversations.read'] === true).catch(() => false);
    if (!readAccess || !await readAccess) return;
    const bodies = document.querySelectorAll('.MuiTypography-body2');
    for (const body of bodies) {
      if (!visible(body) || body.dataset.sxInboxTranslationBound === 'true') continue;
      const bubble = incomingTextBubble(body);
      if (!bubble || bubble.querySelector('img,video,audio,svg,button')) continue;
      if (bubble.querySelectorAll('.MuiTypography-body2').length !== 1) continue;
      const original = body.innerText.trim();
      if (!original || original.length > 4000) continue;

      const originalMarkup = body.innerHTML;
      const originalDirection = body.getAttribute('dir');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sx-inbox-translation-icon';
      button.textContent = '文A';
      button.title = copy().translateMessage;
      button.setAttribute('aria-label', copy().translateMessage);
      let translated = '';
      let showingTranslation = false;
      let translating = false;

      const showOriginal = () => {
        body.innerHTML = originalMarkup;
        if (originalDirection === null) body.removeAttribute('dir'); else body.setAttribute('dir', originalDirection);
        body.append(button);
        showingTranslation = false;
        button.title = copy().translateMessage;
        button.setAttribute('aria-label', copy().translateMessage);
      };
      const showTranslation = () => {
        body.replaceChildren(document.createTextNode(translated), button);
        body.setAttribute('dir', 'auto');
        showingTranslation = true;
        button.title = copy().showOriginal;
        button.setAttribute('aria-label', copy().showOriginal);
      };

      button.addEventListener('click', () => {
        if (translating) return;
        if (showingTranslation) { showOriginal(); return; }
        if (translated) { showTranslation(); return; }
        translating = true;
        button.disabled = true;
        button.title = copy().translating;
        button.setAttribute('aria-label', copy().translating);
        window.SaleMaxWorkspace.request('inboxTranslation', '', { method: 'POST', body: { text: original } })
          .then(response => {
            const value = response.data?.text;
            if (typeof value !== 'string' || !value.trim()) throw new Error('TRANSLATION_FAILED');
            translated = value.trim();
            showTranslation();
          })
          .catch(() => {
            button.title = copy().failed;
            button.setAttribute('aria-label', copy().failed);
          })
          .finally(() => { translating = false; button.disabled = false; });
      });
      body.dataset.sxInboxTranslationBound = 'true';
      body.append(button);
    }
  }

  async function mount() {
    if (!/^\/user\/?$/.test(location.pathname) || !/[?&]page=inbox(?:&|$)/.test(location.search)) return;
    const editor = findEditor();
    if (!editor || editor.closest('[data-sx-inbox-translate-mounted]')) return;

    const buttons = [...document.querySelectorAll('button')].filter(visible);
    const attach = buttons.find(button => /^(attach|إرفاق)$/i.test(button.getAttribute('aria-label') || button.title || button.textContent.trim()));
    const emoji = buttons.find(button => /^(emoji|emojis|رمز تعبيري)$/i.test(button.getAttribute('aria-label') || button.title || button.textContent.trim()));
    const voice = buttons.find(button => /^(record voice|voice message|تسجيل صوت)$/i.test(button.getAttribute('aria-label') || button.title || button.textContent.trim()));
    const row = commonAncestor([editor, attach, emoji, voice]) || editor.parentElement?.parentElement;
    if (!row) return;
    row.setAttribute('data-sx-inbox-translate-mounted', 'pending');
    let session;
    try { session = await window.SaleMaxWorkspace?.session?.(); } catch { row.removeAttribute('data-sx-inbox-translate-mounted'); return; }
    if (!editor.isConnected || findEditor() !== editor) { row.removeAttribute('data-sx-inbox-translate-mounted'); return; }
    if (session?.permissions?.['conversations.reply'] !== true) { row.setAttribute('data-sx-inbox-translate-mounted', 'denied'); return; }
    row.setAttribute('data-sx-inbox-translate-mounted', 'true');
    addStyles();

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sx-inbox-translation-icon';
    button.textContent = '文A';
    button.title = copy().translateMessage;
    button.setAttribute('aria-label', copy().translateMessage);
    button.addEventListener('click', () => translate(editor, button, status));

    const status = document.createElement('span');
    status.className = 'sx-inbox-translate-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const anchor = emoji || voice;
    if (anchor?.parentElement === row) row.insertBefore(button, anchor); else editor.parentElement?.after(button);
    row.style.position ||= 'relative';
    row.append(status);
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; mount().catch(() => {}); mountReceivedMessageTranslations().catch(() => {}); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mount().catch(() => {});
  mountReceivedMessageTranslations().catch(() => {});
})();
