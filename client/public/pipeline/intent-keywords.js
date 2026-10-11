(() => {
  const clean = value => String(value ?? '').trim().normalize('NFKC').slice(0, 80);
  const key = value => clean(value).toLocaleLowerCase();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  function add(keywords, candidate) {
    const current = (Array.isArray(keywords) ? keywords : []).map(clean).filter(Boolean).slice(0, 30);
    const value = clean(candidate);
    if (!value) return { keywords: current, added: false, reason: 'empty' };
    if (current.some(item => key(item) === key(value))) return { keywords: current, added: false, reason: 'duplicate' };
    if (current.length >= 30) return { keywords: current, added: false, reason: 'limit' };
    return { keywords: [...current, value], added: true, reason: null };
  }

  function render(keywords, removeLabel) {
    return (Array.isArray(keywords) ? keywords : []).map((keyword, index) =>
      `<span class="intent-keyword-chip" role="listitem"><span>${escape(keyword)}</span><button type="button" data-remove-keyword="${index}" aria-label="${escape(`${removeLabel} ${keyword}`)}">×</button></span>`,
    ).join('');
  }

  const api = { add, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.salemaxIntentKeywords = api;
})();
