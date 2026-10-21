/* Rebrand the platform chrome while leaving tenant artwork and customer content alone. */
(() => {
  'use strict';

  const root = '/branding/7network/';
  const platformLogoPaths = new Set([
    '/media/salemax-logo.png', '/media/salemax-icon.png',
    '/media/7network-logo.png', '/media/7network-icon.png',
    '/logo192.png', '/logo512.png',
  ]);
  const platformChrome = [
    'header', 'nav', 'aside', '.MuiAppBar-root', '.MuiDrawer-paper',
    '[data-platform-brand]', '.brand-text', '.logo-box',
  ].join(',');
  let queued = false;

  function darkSurface(node) {
    for (let el = node; el && el !== document.documentElement; el = el.parentElement) {
      const scheme = el.getAttribute?.('data-mui-color-scheme') || el.getAttribute?.('data-theme');
      if (scheme) return /dark/i.test(scheme);
      const color = getComputedStyle(el).backgroundColor;
      const values = color.match(/[\d.]+/g)?.map(Number);
      if (!values || values.length < 3 || (values.length === 4 && values[3] < 0.9)) continue;
      return (values[0] * 299 + values[1] * 587 + values[2] * 114) / 1000 < 145;
    }
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function refreshImages() {
    document.querySelectorAll('img').forEach(img => {
      let path;
      try {
        const url = new URL(img.getAttribute('src'), location.href);
        if (url.origin !== location.origin) return;
        path = url.pathname;
      } catch { return; }

      const marked = img.dataset.sevenNetworkBrand;
      const legacy = platformLogoPaths.has(path);
      const ownedMark = path.startsWith(root) && marked;
      if (!legacy && !ownedMark) return;
      const icon = (legacy ? /(?:icon|logo192|logo512)/i.test(path) && !/salemax-logo|7network-logo/i.test(path) : marked === 'icon');
      const kind = icon ? 'icon' : 'logo';
      const target = root + (icon ? 'icon-192.png?v=20261022-clear1' : (darkSurface(img) ? 'logo-dark.png?v=20261022-clear1' : 'logo-light.png?v=20261022-clear1'));
      img.dataset.sevenNetworkBrand = kind;
      if (img.getAttribute('src') !== target) img.setAttribute('src', target);
      if (img.alt !== '7Network') img.alt = '7Network';
    });
  }

  function refreshChromeText() {
    document.querySelectorAll(platformChrome).forEach(container => {
      if (container.closest('[data-sx-tenant-brand], [data-customer-content], [contenteditable="true"]')) return;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        if (!/salemax/i.test(node.nodeValue || '') || node.parentElement?.closest('input,textarea,script,style,[contenteditable="true"],[data-sx-tenant-brand],[data-customer-content]')) continue;
        node.nodeValue = node.nodeValue.replace(/salemax/gi, '7Network');
      }
    });
    if (/salemax/i.test(document.title)) document.title = document.title.replace(/salemax/gi, '7Network');
  }

  function refresh() { queued = false; refreshImages(); refreshChromeText(); }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(refresh); } }
  function start() {
    refresh();
    new MutationObserver(schedule).observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['src', 'class', 'data-theme', 'data-mui-color-scheme'],
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
