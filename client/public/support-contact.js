(function () {
  'use strict';
  function updateSupportContact() {
    document.querySelectorAll('a[href]').forEach(function (link) {
      try {
        const url = new URL(link.href, location.origin);
        if (!['wa.me', 'api.whatsapp.com'].includes(url.hostname)) return;
        const phone = url.hostname === 'wa.me' ? url.pathname.replace(/\D/g, '') : url.searchParams.get('phone');
        if (phone !== '918430088300') return;
        if (url.hostname === 'wa.me') url.pathname = '/97455160323';
        else url.searchParams.set('phone', '97455160323');
        link.href = url.toString();
        link.querySelectorAll('span').forEach(function (span) {
          if (/8430088300/.test(span.textContent.replace(/\D/g, ''))) span.textContent = '+974 5516 0323';
        });
      } catch (_) {}
    });
  }
  new MutationObserver(updateSupportContact).observe(document.documentElement, { childList: true, subtree: true });
  updateSupportContact();
})();
