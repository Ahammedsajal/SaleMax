(() => {
  'use strict';
  if (window.SaleMaxLocale) return;
  const language = () => {
    const value = String(localStorage.getItem('language') || 'english').toLowerCase();
    if (/^(ar(?:[-_]|$)|arabic)/.test(value)) return 'ar';
    if (/^(en(?:[-_]|$)|english)/.test(value)) return 'en';
    return null;
  };
  const isArabic = () => language() === 'ar' || (!language() && document.documentElement.dir === 'rtl');
  const write = Storage.prototype.setItem;
  function synchronize() {
    const next = language();
    if (!next) return;
    // The existing React direction provider reads this setting at startup.
    // Preserve an explicit direction toggle until the language changes.
    if (localStorage.getItem('salemax-ui-language') !== next) {
      write.call(localStorage, 'app_direction', next === 'ar' ? 'rtl' : 'ltr');
      write.call(localStorage, 'salemax-ui-language', next);
      document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
    }
    document.documentElement.lang = next;
  }
  window.SaleMaxLocale = Object.freeze({ language, isArabic });
  synchronize();
  Storage.prototype.setItem = function (key, value) {
    const before = this === localStorage && key === 'language' ? language() : null;
    const result = write.call(this, key, value);
    if (this === localStorage && key === 'language') {
      synchronize();
      if (language() !== before) window.dispatchEvent(new Event('salemax:languagechange'));
    }
    return result;
  };
  window.addEventListener('storage', event => {
    if (event.key === 'language') {
      synchronize();
      window.dispatchEvent(new Event('salemax:languagechange'));
    }
  });
})();
