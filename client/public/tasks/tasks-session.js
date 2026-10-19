(() => {
  'use strict';

  const originalFetch = window.fetch.bind(window);
  // The business shell guards /user/login by checking whether wacrm_user is
  // present, not whether it is still valid. A stale token therefore bounces
  // users straight back to the dashboard when they follow the expired-session
  // link. Remove that token only when they explicitly choose Tasks recovery;
  // the existing login screen can then perform a real sign-in and refresh both
  // the legacy token and canonical HttpOnly session.
  if (typeof document !== 'undefined') {
    document.addEventListener('click', event => {
      const link = event.target?.closest?.('a.session-login-link');
      if (!link) return;
      const destination = new URL(link.href, location.href);
      if (destination.origin !== location.origin || destination.pathname !== '/user/login') return;
      localStorage.removeItem('wacrm_user');
    }, true);
  }

  window.fetch = async (input, init = {}) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, location.href);
    const isPipelineApi = url.origin === location.origin &&
      (url.pathname === '/api/pipeline' || url.pathname.startsWith('/api/pipeline/'));

    if (!isPipelineApi || !(url.pathname === '/api/pipeline/tasks' || url.pathname.startsWith('/api/pipeline/tasks/'))) return originalFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, name) => headers.set(name, value));

    // Reuse the current panel actor and credential. A separate cookie probe
    // can disagree with an already-authenticated Agent or business session.
    // Never retry a denied request under a different account.
    const activeHeaders = await window.SaleMaxWorkspace.headers();
    for (const name of ['Authorization', 'X-CSRF-Token', 'X-Salemax-Actor']) headers.delete(name);
    new Headers(activeHeaders).forEach((value, name) => headers.set(name, value));
    url.pathname = url.pathname.replace('/api/pipeline/tasks', '/api/workspace/tasks');

    const request = input instanceof Request ? new Request(url.href, input) : url.href;
    return originalFetch(request, { ...init, credentials: 'same-origin', headers });
  };
})();
