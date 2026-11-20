/* The legacy CRM provider reads theme_mode once, when React first renders. */
(() => {
  'use strict';

  const root = document.documentElement;
  root.dataset.theme = 'light';
  root.dataset.sxTheme = 'light';
  root.style.colorScheme = 'only light';

  function rememberLightMode() {
    try {
      if (localStorage.getItem('theme_mode') !== 'light') {
        localStorage.setItem('theme_mode', 'light');
      }
    } catch { /* The document still declares the light color scheme. */ }
  }

  rememberLightMode();
  window.addEventListener('storage', event => {
    if (event.key === 'theme_mode' || event.key === null) rememberLightMode();
  });
  window.addEventListener('pageshow', rememberLightMode);
})();
