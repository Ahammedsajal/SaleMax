(() => {
  'use strict';

  const originalFetch = window.fetch.bind(window);
  let canonicalSession = null;
  let canonicalCheckedAt = 0;
  let canonicalChecked = false;

  async function getCanonicalSession() {
    if (canonicalChecked && Date.now() - canonicalCheckedAt < 30000) return canonicalSession;
    canonicalCheckedAt = Date.now();
    canonicalChecked = true;
    try {
      const response = await originalFetch('/api/user/business-auth/me', {
        credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
      });
      const result = response.ok ? await response.json() : null;
      canonicalSession = result?.context?.audience === 'tenant' && typeof result.csrfToken === 'string'
        ? { csrfToken: result.csrfToken }
        : null;
    } catch (_) {
      canonicalSession = null;
    }
    return canonicalSession;
  }

  window.fetch = async (input, init = {}) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, location.href);
    const isPipelineApi = url.origin === location.origin &&
      (url.pathname === '/api/pipeline' || url.pathname.startsWith('/api/pipeline/'));

    if (!isPipelineApi || !(url.pathname === '/api/pipeline/tasks' || url.pathname.startsWith('/api/pipeline/tasks/'))) return originalFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, name) => headers.set(name, value));

    // Prefer the same HttpOnly business session used by the existing /user panel.
    // Fall back to the compatible legacy pipeline API for accounts not yet mapped.
    const session = await getCanonicalSession();
    if (session) {
      headers.delete('Authorization');
      headers.set('X-CSRF-Token', session.csrfToken);
      url.pathname = url.pathname.replace('/api/pipeline/tasks', '/api/user/training/tasks');
    } else {
      const currentToken = localStorage.getItem('wacrm_user');
      if (currentToken) headers.set('Authorization', `Bearer ${currentToken}`);
      else headers.delete('Authorization');
    }

    const request = input instanceof Request ? new Request(url.href, input) : url.href;
    return originalFetch(request, { ...init, credentials: 'same-origin', headers });
  };
})();
