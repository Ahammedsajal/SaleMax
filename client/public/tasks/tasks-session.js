(() => {
  'use strict';

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init = {}) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, location.href);
    const isPipelineApi = url.origin === location.origin &&
      (url.pathname === '/api/pipeline' || url.pathname.startsWith('/api/pipeline/'));

    if (!isPipelineApi) return originalFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, name) => headers.set(name, value));

    // Keep Tasks on the existing /user identity, including a token refreshed
    // elsewhere in the SaleMaX shell after this iframe has loaded.
    const currentToken = localStorage.getItem('wacrm_user');
    if (currentToken) headers.set('Authorization', `Bearer ${currentToken}`);
    else headers.delete('Authorization');

    return originalFetch(input, { ...init, headers });
  };
})();
