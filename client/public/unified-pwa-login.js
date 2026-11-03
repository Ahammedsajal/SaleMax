/* Share the existing PWA entry point while retaining separate user and agent
 * credentials. Role comes from the signed-in token and is enforced server-side. */
(() => {
  'use strict';
  if (window.__sxUnifiedPwaLogin) return;
  window.__sxUnifiedPwaLogin = true;

  const originalGet = Storage.prototype.getItem;
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;
  const params = new URLSearchParams(location.search);
  const path = location.pathname.replace(/\/$/, '') || '/';
  const loginIntent = path === '/user/login' && params.get('actor') === 'agent';
  const raw = key => originalGet.call(localStorage, key);
  const decodeRole = token => {
    try {
      const payload = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(payload)).role || null;
    } catch {
      return null;
    }
  };
  const agentWorkspacePath = () => ['/user', '/pipeline', '/call-center', '/sales-workspace', '/tasks'].includes(location.pathname.replace(/\/$/, ''));
  const activeAgent = () => agentWorkspacePath() && (params.get('actor') === 'agent' || sessionStorage.getItem('sx_workspace_actor') === 'agent');
  const agentUrl = value => {
    const target = new URL(value, location.href);
    const page = target.searchParams.get('page') || 'dashboard';
    target.pathname = '/user';
    target.search = '';
    target.searchParams.set('actor', 'agent');
    target.searchParams.set('page', page);
    return target.pathname + target.search + target.hash;
  };

  if (path === '/user/login' || params.get('actor') === 'user') {
    sessionStorage.removeItem('sx_workspace_actor');
  } else if (params.get('actor') === 'agent') {
    sessionStorage.setItem('sx_workspace_actor', 'agent');
  }

  // The installed PWA manifest starts at /user. Restore the last authenticated
  // role before the React router evaluates its protected route.
  const storedActor = raw('sx_workspace_actor_preference');
  const hasAgentSession = Boolean(raw('wacrm_agent'));
  const hasUserSession = Boolean(raw('wacrm_user'));
  const shouldRestoreAgent = storedActor === 'agent' || (!storedActor && hasAgentSession && !hasUserSession);
  if (path === '/user' && params.get('actor') !== 'agent' && shouldRestoreAgent && hasAgentSession) {
    location.replace(agentUrl(location.href));
    return;
  }

  // Keep legacy storage keys isolated. The server-signed token role selects the
  // destination; this client adapter does not grant or infer permissions.
  Storage.prototype.getItem = function(key) {
    if (this === localStorage && key === 'wacrm_user' && activeAgent()) {
      return raw('wacrm_agent') || originalGet.call(this, key);
    }
    return originalGet.call(this, key);
  };
  Storage.prototype.setItem = function(key, value) {
    if (this === localStorage && key === 'wacrm_user') {
      const role = decodeRole(value);
      if (role === 'agent') {
        originalSet.call(this, 'wacrm_agent', value);
        originalSet.call(this, 'sx_workspace_actor_preference', 'agent');
        sessionStorage.setItem('sx_workspace_actor', 'agent');
        window.SaleMaxActor = 'agent';
        setTimeout(() => location.replace('/user?actor=agent&page=dashboard'), 0);
        return;
      }
      if (role === 'user') {
        originalSet.call(this, key, value);
        originalSet.call(this, 'sx_workspace_actor_preference', 'user');
        if (path === '/user/login') sessionStorage.removeItem('sx_workspace_actor');
        return;
      }
    }
    if (this === localStorage && key === 'wacrm_agent') {
      originalSet.call(this, key, value);
      originalSet.call(this, 'sx_workspace_actor_preference', 'agent');
      return;
    }
    return originalSet.call(this, key, value);
  };

  // Permit an explicit agent intent for the rare case where the same email and
  // password exist in both legacy account tables. Normal sign-in auto-detects.
  const addAgentIntent = body => {
    if (!loginIntent || typeof body !== 'string') return body;
    try {
      const value = JSON.parse(body);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return body;
      value.actor = 'agent';
      return JSON.stringify(value);
    } catch {
      return body;
    }
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const agentRequests = new WeakSet();
  const agentLoginRequests = new WeakSet();
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    try {
      const target = new URL(url, location.href);
      if (target.origin === location.origin && target.pathname.startsWith('/api/')) agentRequests.add(this);
      if (loginIntent && method.toUpperCase() === 'POST' && target.origin === location.origin && target.pathname === '/api/user/login') {
        agentLoginRequests.add(this);
      }
    } catch {}
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (agentLoginRequests.has(this)) body = addAgentIntent(body);
    if (agentRequests.has(this) && activeAgent()) {
      try {
        this.setRequestHeader('X-Salemax-Actor', 'agent');
      } catch {}
    }
    return originalSend.call(this, body);
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function(input, init = {}) {
      if (activeAgent()) {
        try {
          const sourceUrl = input instanceof Request ? input.url : input;
          const target = new URL(sourceUrl, location.href);
          if (target.origin === location.origin && target.pathname.startsWith('/api/')) {
            const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
            headers.set('X-Salemax-Actor', 'agent');
            const token = raw('wacrm_agent');
            if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
            if (loginIntent && target.pathname === '/api/user/login' && typeof init.body === 'string') init.body = addAgentIntent(init.body);
            init = { ...init, headers };
          }
        } catch {}
      } else if (loginIntent) {
        try {
          const sourceUrl = input instanceof Request ? input.url : input;
          const target = new URL(sourceUrl, location.href);
          if (target.origin === location.origin && target.pathname === '/api/user/login' && typeof init.body === 'string') init.body = addAgentIntent(init.body);
        } catch {}
      }
      return originalFetch.call(this, input, init);
    };
  }
  if (activeAgent()) window.SaleMaxActor = 'agent';
})();
