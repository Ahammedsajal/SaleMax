(() => {
  'use strict';

  const keepLight = () => {
    document.documentElement.dataset.sxTheme = 'light';
    document.documentElement.style.colorScheme = 'light';
    try {
      if (localStorage.getItem('theme_mode') !== 'light') localStorage.setItem('theme_mode', 'light');
    } catch {}
  };

  const themeControl = element => {
    if (!(element instanceof Element)) return null;
    const control = element.closest('button,[role="button"]');
    if (!control) return null;
    const label = [control.getAttribute('aria-label'), control.getAttribute('title'), control.textContent]
      .filter(Boolean).join(' ').trim();
    return /(?:dark mode|light mode|الوضع الداكن|الوضع الفاتح|switch to (?:dark|light) mode)/i.test(label)
      ? control : null;
  };

  const style = document.createElement('style');
  style.textContent = `
    :root{color-scheme:light!important}
    #root button[aria-label*="dark mode" i],#root button[aria-label*="light mode" i],
    #root button[aria-label*="الوضع الداكن"],#root button[aria-label*="الوضع الفاتح"]{display:none!important}
  `;
  document.head.append(style);
  keepLight();
  document.addEventListener('click', event => {
    if (!themeControl(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    keepLight();
  }, true);
  window.addEventListener('storage', event => {
    if (event.key === 'theme_mode' && event.newValue !== 'light') keepLight();
  });
  new MutationObserver(() => {
    if (document.documentElement.dataset.sxTheme !== 'light') keepLight();
  }).observe(document.documentElement, {attributes: true, attributeFilter: ['data-sx-theme']});
})();
