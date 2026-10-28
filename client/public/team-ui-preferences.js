(() => {
  'use strict';

  function create({storage, document, getComputedStyle} = {}) {
    const buttons = () => [...(document?.querySelectorAll?.('button') || [])].map(button => [
      button.textContent,
      button.getAttribute?.('aria-label'),
      button.getAttribute?.('title'),
    ].filter(Boolean).join(' ').trim().toLowerCase());
    const storedLocale = () => {
      try {
        return [storage?.getItem('language'), storage?.getItem('salemax-language')]
          .filter(Boolean).join(' ').toLowerCase();
      } catch { return ''; }
    };
    const isArabic = () => {
      const locale = `${storedLocale()} ${document?.documentElement?.lang || ''}`.toLowerCase();
      if (/(?:^|[^a-z])ar(?:[-_.]|$)|arabic|العربية/.test(locale)) return true;
      return buttons().some(value => /^(?:lang(?:uage)?\s*)?(?:arabic|العربية)(?:\.json)?$/.test(value));
    };
    const isRtl = () => {
      if ([document?.documentElement?.dir, document?.body?.dir].some(value => String(value || '').toLowerCase() === 'rtl')) return true;
      const labels=buttons();
      if(labels.some(value=>/(?:switch|تبديل).*\bltr\b|\bltr\b.*(?:switch|تبديل)/.test(value)))return true;
      if(labels.some(value=>/(?:switch|تبديل).*\brtl\b|\brtl\b.*(?:switch|تبديل)/.test(value)))return false;
      return isArabic();
    };
    const isDark = () => {
      const labels = buttons();
      if (labels.some(value => /^(?:light mode|الوضع الفاتح)$/.test(value))) return true;
      if (labels.some(value => /^(?:dark mode|الوضع الداكن)$/.test(value))) return false;
      if (typeof getComputedStyle !== 'function') return false;
      for (const element of [document?.body, document?.documentElement, document?.querySelector?.('#root')]) {
        if (!element) continue;
        const match = String(getComputedStyle(element).backgroundColor || '').match(/rgba?\((\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/i);
        if (!match) continue;
        const [red, green, blue] = match.slice(1).map(Number);
        const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
        if (luminance < 0.28) return true;
        if (luminance > 0.55) return false;
      }
      return false;
    };
    return {isArabic, isRtl, isDark};
  }

  if (typeof module === 'object' && module.exports) module.exports = {create};
  if (typeof window !== 'undefined') window.SxTeamUiPreferences = {create};
})();
