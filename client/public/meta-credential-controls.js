(() => {
  'use strict';

  const targetPage = 'wa-meta-manual';
  const metaTokenLabel = /^(?:meta access token|رمز وصول meta)$/i;

  function maskTokenField() {
    if (new URLSearchParams(window.location.search).get('page') !== targetPage) return;

    for (const input of document.querySelectorAll('input')) {
      if (input.type === 'password') continue;
      const labels = Array.from(input.labels || []);
      if (!labels.some(label => metaTokenLabel.test(label.textContent.trim()))) continue;

      input.type = 'password';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('data-sx-meta-token', 'masked');
    }
  }

  const observer = new MutationObserver(maskTokenField);
  observer.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('popstate', maskTokenField);
  maskTokenField();
})();
