(() => {
  'use strict';

  const root = document.getElementById('root');
  if (!root) return;

  const removeStrayLoginMarker = () => {
    if (window.location.pathname.replace(/\/+$/, '') !== '/user/login') return;

    root.querySelectorAll('.MuiBox-root').forEach((panel) => {
      if (!panel.querySelector('input[type="password"]')) return;
      if (!panel.querySelector('input[type="email"], input[type="text"]')) return;
      const isLoginPanel = [...panel.querySelectorAll('button')]
        .some((button) => /^sign in\b/i.test(button.textContent.trim()));
      if (!isLoginPanel) return;

      [...panel.childNodes].forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() === '0') node.remove();
      });
    });
  };

  removeStrayLoginMarker();
  new MutationObserver(removeStrayLoginMarker).observe(root, { childList: true, subtree: true });
})();
