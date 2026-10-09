(() => {
  'use strict';
  if (window.__sxAgentSessionContext) return;
  window.__sxAgentSessionContext = true;
  const agentPage = () => /^\/agent(?:\/login)?\/?$/.test(location.pathname);
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;
  const requests = new WeakSet();
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    requests.delete(this);
    try {
      const target = new URL(url, location.origin);
      if (agentPage() && method.toUpperCase() === 'GET' && target.origin === location.origin && target.pathname === '/api/user/get_me') {
        target.pathname = '/api/agent/session-context';
        url = target.href;
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
