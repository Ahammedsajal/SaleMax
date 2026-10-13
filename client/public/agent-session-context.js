(() => {
  'use strict';
  if (window.__sxAgentSessionContext) return;
  window.__sxAgentSessionContext = true;
  const isAgentArea = () => /^\/agent(?:\/|$)/.test(location.pathname);

  // The legacy app's shared 401 handler always redirects non-admin sessions
  // to /user, including requests made from the agent panel. Keep that redirect
  // inside the agent entry point and preserve any separate business session.
  const originalRemoveItem = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function(key) {
    if (key === 'wacrm_user' && isAgentArea()) return;
    return originalRemoveItem.call(this, key);
  };
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method].bind(history);
    history[method] = function(state, title, url) {
      if (isAgentArea() && typeof url === 'string') {
        try {
          const target = new URL(url, location.href);
          if (target.origin === location.origin && target.pathname.replace(/\/$/, '') === '/user') {
            url = '/agent/login';
          }
        } catch {}
      }
      return original(state, title, url);
    };
  }

  const agentPage = () => /^\/agent(?:\/login)?\/?$/.test(location.pathname);
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;
  const requests = new WeakSet();
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    requests.delete(this);
    try {
      const target = new URL(url, location.origin);
      // The legacy selector passes token_user but its HTTP helper ignores that
      // option without an agent flag. Keep the existing route, use Agent auth.
      if (agentPage() && method.toUpperCase() === 'GET' && target.origin === location.origin && target.pathname === '/api/qr/get_all_agent') {
        requests.add(this);
      }
    } catch {}
    return originalOpen.call(this, method, url, ...args);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (requests.has(this) && name.toLowerCase() === 'authorization') return;
    return originalHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    if (requests.has(this)) {
      const token = localStorage.getItem('wacrm_agent');
      if (token) originalHeader.call(this, 'Authorization', 'Bearer ' + token);
    }
    return originalSend.apply(this, args);
  };
})();
