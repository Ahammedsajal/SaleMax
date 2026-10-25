(() => {
  'use strict';
  if (window.__sxAdminShellLayout) return;
  window.__sxAdminShellLayout = true;

  let frame = 0;
  let observedDrawer = null;
  const resizeObserver = new ResizeObserver(schedule);

  function sync() {
    frame = 0;
    const html = document.documentElement;
    if (location.pathname.replace(/\/$/, '') !== '/admin' || window.innerWidth < 701) {
      html.removeAttribute('data-sx-admin-shell-layout');
      html.style.removeProperty('--sx-admin-drawer-width');
      if (observedDrawer) resizeObserver.unobserve(observedDrawer);
      observedDrawer = null;
      return;
    }

    const drawer = [...document.querySelectorAll('.MuiDrawer-paper.MuiDrawer-paperAnchorDockedLeft')]
      .find(node => node.querySelector('ul') && node.getBoundingClientRect().width > 0);
    const dockedRoot = drawer?.closest('.MuiDrawer-root.MuiDrawer-docked');
    const width = Math.round(drawer?.getBoundingClientRect().width || 0);
    if (!dockedRoot || width < 100) return;

    if (observedDrawer !== drawer) {
      if (observedDrawer) resizeObserver.unobserve(observedDrawer);
      observedDrawer = drawer;
      resizeObserver.observe(drawer);
    }

    const value = `${width}px`;
    if (dockedRoot.style.getPropertyValue('--sx-sidebar-docked-width') !== value) {
      dockedRoot.style.setProperty('--sx-sidebar-docked-width', value);
    }
    if (html.style.getPropertyValue('--sx-sidebar-inline-offset') !== value) {
      html.style.setProperty('--sx-sidebar-inline-offset', value);
    }
    html.setAttribute('data-sx-admin-shell-layout', '');
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(sync);
  }

  new MutationObserver(schedule).observe(document.documentElement, {childList: true, subtree: true});
  window.addEventListener('resize', schedule, {passive: true});
  schedule();
})();
