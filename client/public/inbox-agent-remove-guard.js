(() => {
  'use strict';
  let isAgent = /^\/agent(?:\/|$)/.test(location.pathname);
  let checked = false;
  const visible = element => element && element.getClientRects().length > 0;

  function hideRemovalControls() {
    if (!isAgent) return;
    for (const button of document.querySelectorAll('button,[role="button"]')) {
      const label = [button.getAttribute('aria-label'), button.getAttribute('title'), button.getAttribute('data-testid')]
        .filter(Boolean).join(' ').toLowerCase();
      if (/remove agent|unassign|close chat|إزالة الموظف|إلغاء التعيين/.test(label)) button.style.display = 'none';
    }
    const headings = [...document.querySelectorAll('body *')].filter(element =>
      visible(element) && element.children.length === 0 && /^(assigned agent|الموظف المعيّن|الموظف المعين)$/i.test((element.textContent || '').trim()));
    for (const heading of headings) {
      let parent = heading.parentElement;
      for (let depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) {
        const icons = [...parent.querySelectorAll('button,[role="button"]')].filter(button =>
          visible(button) && !(button.textContent || '').trim() && button.querySelector('svg'));
        if (!icons.length || !parent.querySelector('*:not(button):not(svg)')) continue;
        for (const button of icons) {
          let row = button.parentElement;
          for (let level = 0; row && row !== parent && level < 4; level++, row = row.parentElement) {
            const rowText = (row.textContent || '').trim();
            if ([...row.querySelectorAll('button,[role="button"]')].filter(candidate => visible(candidate)).length === 1 &&
                rowText.length < 160 && /[a-zA-Z\u0600-\u06FF]{3}/.test(rowText) && !row.querySelector('input,[role="combobox"]')) {
              button.style.display = 'none';
              button.setAttribute('data-sx-agent-remove-hidden', 'true');
              break;
            }
          }
        }
        break;
      }
    }
  }

  async function resolveRole() {
    if (checked || !window.SaleMaxWorkspace?.session) return;
    checked = true;
    try {
      const session = await window.SaleMaxWorkspace.session();
      isAgent = isAgent || session?.role === 'agent';
    } catch {}
    hideRemovalControls();
  }
  const observer = new MutationObserver(() => { if (!checked) resolveRole(); else hideRemovalControls(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  resolveRole();
})();
