(() => {
  'use strict';
  const loginPaths = ['/user/login', '/user/login/', '/agent/login', '/agent/login/'];
  const businessPaths = ['/user', '/user/', '/agent', '/agent/'];
  if (![...loginPaths, ...businessPaths].includes(location.pathname)) return;

  const params = new URLSearchParams(location.search);
  const encoded = params.get('mcp_return');
  const requestedActor = params.get('mcp_actor') === 'agent' ? 'agent' : 'user';
  const pendingKey = '7network.mcp.oauthReturn';
  const validDestination = (value, actor) => {
    try {
      const url = new URL(value, location.origin);
      return url.origin === location.origin && url.pathname === '/mcp/oauth/authorize'
        && /^[A-Za-z0-9_-]{40,64}$/.test(url.searchParams.get('tx') || '')
        && url.searchParams.get('actor') === actor && !url.hash;
    } catch (_) { return false; }
  };

  let pending;
  try {
    if (loginPaths.includes(location.pathname) && encoded && validDestination(encoded, requestedActor)) {
      pending = { destination: encoded, actor: requestedActor, expiresAt: Date.now() + 10 * 60 * 1000 };
      sessionStorage.setItem(pendingKey, JSON.stringify(pending));
    } else {
      pending = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
    }
  } catch (_) { return; }

  if (!pending || !['user', 'agent'].includes(pending.actor) || !validDestination(pending.destination, pending.actor)
    || !Number.isFinite(pending.expiresAt) || pending.expiresAt <= Date.now()) {
    try { sessionStorage.removeItem(pendingKey); } catch (_) {}
    return;
  }

  const actor = pending.actor;
  const destination = new URL(pending.destination, location.origin);
  const tokenKey = actor === 'agent' ? 'wacrm_agent' : 'wacrm_user';
  if (params.get('mcp_force_login') === '1') {
    try { localStorage.removeItem(tokenKey); } catch (_) {}
    params.delete('mcp_force_login');
    history.replaceState(history.state, '', `${location.pathname}?${params.toString()}`);
    location.reload();
    return;
  }

  const started = Date.now();
  const poll = window.setInterval(() => {
    let token = null;
    try { token = localStorage.getItem(tokenKey); } catch (_) {}
    if (token) {
      window.clearInterval(poll);
      try { sessionStorage.removeItem(pendingKey); } catch (_) {}
      location.replace(destination.pathname + destination.search);
    } else if (Date.now() - started > 10 * 60 * 1000) {
      window.clearInterval(poll);
      try { sessionStorage.removeItem(pendingKey); } catch (_) {}
    }
  }, 300);
})();
