(() => {
  'use strict';

  const FOCUS_KEY = '7networkLeadChatFocus';
  const SEARCH_PREFIX = 'chatid:';
  const TIMEOUT_MS = 30000;
  const idOf = value => String(value?.chat_id || '').trim();
  const readJson = (storage, key) => {
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch (_) { return null; }
  };

  function inboxTarget(search = location.search) {
    const params = new URLSearchParams(search);
    return params.get('page') === 'inbox' ? String(params.get('chatId') || '').trim() : '';
  }

  function exactQuery(chatId) {
    return SEARCH_PREFIX + String(chatId || '').trim();
  }

  function findInboxSurface(root) {
    for (const input of root.querySelectorAll('input[type="text"]')) {
      if (!/search|بحث/i.test(input.getAttribute('placeholder') || '')) continue;
      if (input.getClientRects && !input.getClientRects().length) continue;
      let parent = input.parentElement;
      for (let depth = 0; parent && depth < 9; depth++, parent = parent.parentElement) {
        const children = Array.from(parent.children || []);
        const inputIndex = children.findIndex(child => child.contains(input));
        if (inputIndex < 1 || inputIndex + 1 >= children.length) continue;
        if (!children[0].querySelector('h6,[role="heading"]')) continue;
        return { input, list: children[inputIndex + 1] };
      }
    }
    return null;
  }

  function isEmptyResult(list) {
    return list?.children?.length === 1
      && !list.querySelector('[class*="MuiAvatar-root"]')
      && !list.querySelector('[class*="MuiCircularProgress-root"]')
      && Boolean(list.querySelector('svg'))
      && String(list.textContent || '').trim().length > 10;
  }

  function exactResultRow(list) {
    if (list?.children?.length !== 1) return null;
    const row = list.children[0];
    return row.querySelector('[class*="MuiAvatar-root"]') ? row : null;
  }

  function setReactInput(input, value) {
    if (input.value === value) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function announce(message) {
    const banner = document.createElement('div');
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.textContent = message;
    banner.style.cssText = 'position:fixed;z-index:2147483000;top:12px;left:50%;transform:translateX(-50%);max-width:min(92vw,560px);padding:12px 16px;border-radius:10px;background:#fff4e5;color:#663c00;border:1px solid #edc98a;box-shadow:0 4px 18px #0002;font:500 14px/1.4 Roboto,Arial,sans-serif';
    document.body.appendChild(banner);
    window.setTimeout(() => banner.remove(), 7000);
  }

  function start() {
    const chatId = inboxTarget();
    if (!chatId || !window.MutationObserver || !document.body) return;

    const focus = readJson(sessionStorage, FOCUS_KEY);
    const previousSearch = String(focus?.chatId === chatId ? focus?.previousFilters?.search || '' : '');
    const emptyQuery = exactQuery('__7network_no_match_' + Math.random().toString(36).slice(2));
    const targetQuery = exactQuery(chatId);
    const deadline = Date.now() + TIMEOUT_MS;
    let phase = 'await-input';
    let surface = null;
    let phaseAt = 0;
    let finished = false;
    const observer = new MutationObserver(tick);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(tick, 200);

    function stop() {
      finished = true;
      observer.disconnect();
      window.clearInterval(interval);
      try { sessionStorage.removeItem(FOCUS_KEY); } catch (_) { /* URL remains authoritative */ }
    }

    function restoreSearch() {
      const current = findInboxSurface(document);
      if (current) setReactInput(current.input, previousSearch);
    }

    function fail() {
      stop();
      restoreSearch();
      announce(document.documentElement.lang?.toLowerCase().startsWith('ar')
        ? 'تعذر فتح هذه المحادثة. قد لا تكون متاحة لحسابك أو لم تعد موجودة.'
        : 'Could not open that conversation. It may be unavailable to your account or no longer exist.');
    }

    function tick() {
      if (finished) return;
      if (Date.now() >= deadline) return fail();

      if (!surface || !surface.input.isConnected || !surface.list.isConnected) {
        surface = findInboxSurface(document);
        if (!surface) return;
      }

      if (phase === 'await-input') {
        phase = 'await-empty';
        phaseAt = Date.now();
        setReactInput(surface.input, emptyQuery);
        return;
      }

      if (phase === 'await-empty') {
        if (surface.input.value !== emptyQuery && Date.now() - phaseAt > 1200) {
          phaseAt = Date.now();
          setReactInput(surface.input, emptyQuery);
        }
        if (Date.now() - phaseAt >= 650 && isEmptyResult(surface.list)) {
          phase = 'await-result';
          phaseAt = Date.now();
          setReactInput(surface.input, targetQuery);
        }
        return;
      }

      if (phase === 'await-result') {
        if (surface.input.value !== targetQuery && Date.now() - phaseAt > 1200) {
          phaseAt = Date.now();
          setReactInput(surface.input, targetQuery);
        }
        const row = exactResultRow(surface.list);
        if (row && Date.now() - phaseAt >= 650) {
          phase = 'await-selection';
          phaseAt = Date.now();
          row.scrollIntoView?.({ block: 'nearest' });
          row.click();
        }
        return;
      }

      if (idOf(readJson(localStorage, 'chatInfo')) === chatId) {
        stop();
        restoreSearch();
      } else if (Date.now() - phaseAt > 2500) {
        phase = 'await-result';
        phaseAt = Date.now() - 650;
      }
    }

    tick();
  }

  const api = Object.freeze({ inboxTarget, exactQuery, findInboxSurface, isEmptyResult, exactResultRow, setReactInput });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.SaleMaxInboxDeepLink = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();
