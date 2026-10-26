(() => {
  'use strict';

  const copy = () => document.documentElement.lang?.toLowerCase().startsWith('ar') || (localStorage.getItem('language') || '').toLowerCase().startsWith('ar')
    ? { translate: 'ترجمة', working: 'جارٍ الترجمة…', toEnglish: 'تُرجم إلى الإنجليزية', toArabic: 'تُرجم إلى العربية', failed: 'تعذرت الترجمة. حاول مرة أخرى.', empty: 'اكتب رسالة أولاً.', review: 'راجع الترجمة قبل الإرسال.' }
    : { translate: 'Translate', working: 'Translating…', toEnglish: 'Translated to English', toArabic: 'Translated to Arabic', failed: 'Translation failed. Try again.', empty: 'Write a message first.', review: 'Review the translation before sending.' };

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

  async function translate(editor, button, status) {
    const strings = copy();
    const original = editor.value;
    if (!original.trim()) { status.textContent = strings.empty; return; }
    button.disabled = true;
    button.textContent = strings.working;
    status.textContent = '';
    try {
      const result = await window.SaleMaxWorkspace.request('inboxTranslation', '', { method: 'POST', body: { text: original } });
      const translated = result.data?.text;
      if (typeof translated !== 'string' || !translated.trim()) throw new Error('TRANSLATION_FAILED');
      if (editor.value !== original) throw new Error('DRAFT_CHANGED');
      setReactValue(editor, translated);
      editor.focus();
      editor.setSelectionRange(translated.length, translated.length);
      button.textContent = result.data.targetLanguage === 'ar' ? strings.toArabic : strings.toEnglish;
      status.textContent = strings.review;
    } catch {
      button.textContent = strings.translate;
      status.textContent = strings.failed;
    } finally {
      button.disabled = false;
    }
  }

  function addStyles() {
    if (document.getElementById('sx-inbox-translation-style')) return;
    const style = document.createElement('style');
    style.id = 'sx-inbox-translation-style';
    style.textContent = '.sx-inbox-translate-button{flex:0 0 auto;min-height:34px;margin:0 5px;padding:0 10px;border:1px solid #c9d8f5;border-radius:8px;background:#f5f8ff;color:#1768d4;font:500 12px Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap}.sx-inbox-translate-button:disabled{opacity:.65;cursor:wait}.sx-inbox-translate-status{position:absolute;inset-inline-start:12px;bottom:calc(100% + 4px);font:12px Roboto,Arial,sans-serif;color:#667085;pointer-events:none}';
    document.head.append(style);
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
    button.className = 'sx-inbox-translate-button';
    button.textContent = copy().translate;
    button.title = copy().review;
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
    requestAnimationFrame(() => { scheduled = false; mount().catch(() => {}); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mount().catch(() => {});
})();
