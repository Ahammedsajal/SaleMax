(() => {
  'use strict';

  const FOCUS_KEY = '7networkLeadChatFocus';
  const DONE_KEY = '7networkLeadChatCompleted';
  const FAILED_KEY = '7networkLeadChatFailed';
  const TIMEOUT_MS = 20000;
  const idOf = value => String(value?.chat_id || '').trim();
  const readJson = (storage, key) => {
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch (_) { return null; }
  };

  function chatIdFromProps(props) {
    const chat = props?.chat;
    return idOf(chat) || String(props?.chat_id || props?.chatId || '').trim();
  }

  function fiberOf(element) {
    const key = Object.keys(element || {}).find(name => name.startsWith('__reactFiber$'));
    return key ? element[key] : null;
  }

  function clickableHost(componentFiber) {
    const queue = componentFiber?.child ? [componentFiber.child] : [];
    while (queue.length) {
      const fiber = queue.shift();
      const element = fiber?.tag === 5 ? fiber.stateNode : null;
      if (element?.nodeType === 1 && typeof fiber.memoizedProps?.onClick === 'function') return element;
      if (fiber?.child) queue.push(fiber.child);
      if (fiber?.sibling) queue.push(fiber.sibling);
    }
    return null;
  }

  function findExactChatRow(root, chatId) {
    const wanted = String(chatId || '').trim();
    if (!wanted || !root?.querySelectorAll) return null;
    for (const element of root.querySelectorAll('*')) {
      let fiber = fiberOf(element);
      while (fiber) {
        if (chatIdFromProps(fiber.memoizedProps) === wanted) {
          const host = clickableHost(fiber);
          if (host) return host;
        }
        fiber = fiber.return;
      }
    }
    return null;
  }

  function inboxTarget(search = location.search) {
    const params = new URLSearchParams(search);
    return params.get('page') === 'inbox' ? String(params.get('chatId') || '').trim() : '';
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

  function restoreFilters(focus) {
    if (focus?.previousFilters == null) localStorage.removeItem('chatFilters');
    else localStorage.setItem('chatFilters', JSON.stringify(focus.previousFilters));
  }

  function fail(focus, chatId) {
    restoreFilters(focus);
    sessionStorage.removeItem(FOCUS_KEY);
    sessionStorage.setItem(FAILED_KEY, chatId);
    location.reload();
  }

  function start() {
    const chatId = inboxTarget();
    if (!chatId || !window.MutationObserver || !document.body) return;

    if (sessionStorage.getItem(FAILED_KEY) === chatId) {
      sessionStorage.removeItem(FAILED_KEY);
      announce(document.documentElement.lang?.toLowerCase().startsWith('ar')
        ? 'تعذر فتح هذه المحادثة. قد لا تكون متاحة لحسابك أو لم تعد موجودة.'
        : 'Could not open that conversation. It may be unavailable to your account or no longer exist.');
      return;
    }

    const selected = idOf(readJson(localStorage, 'chatInfo'));
    if (selected === chatId && sessionStorage.getItem(DONE_KEY) === chatId) return;

    let focus = readJson(sessionStorage, FOCUS_KEY);
    if (!focus || focus.chatId !== chatId || Date.now() - Number(focus.startedAt || 0) > 60000) {
      const previousFilters = readJson(localStorage, 'chatFilters');
      focus = { chatId, previousFilters, startedAt: Date.now() };
      sessionStorage.setItem(FOCUS_KEY, JSON.stringify(focus));
      sessionStorage.removeItem(DONE_KEY);
      const filters = {
        search: chatId, origin: '', unreadOnly: false, assignedOnly: false,
        instanceFilter: '', instance: '', dateRange: { start: null, end: null },
        limit: 20, offset: 0, filterType: 'all', hasNote: false,
        statusFilter: 'all', agentFilter: '', conversationKind: 'all'
      };
      localStorage.setItem('chatFilters', JSON.stringify(filters));
      localStorage.setItem('chatInfo', 'null');
      location.reload();
      return;
    }

    const requestedFilters = readJson(localStorage, 'chatFilters');
    if (requestedFilters?.search !== chatId) {
      localStorage.setItem('chatFilters', JSON.stringify({
        search: chatId, origin: '', unreadOnly: false, assignedOnly: false,
        instanceFilter: '', instance: '', dateRange: { start: null, end: null },
        limit: 20, offset: 0, filterType: 'all', hasNote: false,
        statusFilter: 'all', agentFilter: '', conversationKind: 'all'
      }));
      location.reload();
      return;
    }

    let finished = false;
    let clickAttempted = false;
    const startedAt = Date.now();
    const observer = new MutationObserver(trySelect);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(trySelect, 200);

    function done() {
      finished = true;
      observer.disconnect();
      window.clearInterval(interval);
    }

    function trySelect() {
      if (finished) return;
      if (idOf(readJson(localStorage, 'chatInfo')) === chatId) {
        done();
        sessionStorage.setItem(DONE_KEY, chatId);
        sessionStorage.removeItem(FOCUS_KEY);
        restoreFilters(focus);
        window.setTimeout(() => location.reload(), 100);
        return;
      }
      if (!clickAttempted) {
        const row = findExactChatRow(document.body, chatId);
        if (row) {
          clickAttempted = true;
          row.scrollIntoView?.({ block: 'nearest' });
          row.click();
        }
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        done();
        fail(focus, chatId);
      }
    }

    trySelect();
  }

  const api = Object.freeze({ chatIdFromProps, findExactChatRow, inboxTarget });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.SaleMaxInboxDeepLink = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();
