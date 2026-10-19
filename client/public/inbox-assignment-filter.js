(() => {
  'use strict';
  const labels = () => document.documentElement.lang?.toLowerCase().startsWith('ar')
    ? { all: 'كل المحادثات', assigned: 'مُسندة / محوّلة', title: 'حالة الإسناد' }
    : { all: 'All conversations', assigned: 'Assigned / transferred', title: 'Assignment' };
  const readFilters = () => { try { return JSON.parse(localStorage.getItem('chatFilters') || '{}'); } catch { return {}; } };
  const reactChange = root => {
    for (const node of [root, ...root.querySelectorAll('*')]) {
      const key = Object.keys(node).find(name => name.startsWith('__reactProps$'));
      const onChange = key && node[key]?.onChange;
      if (typeof onChange === 'function') return onChange;
    }
    return null;
  };
  function apply(value, control) {
    const origin = value === 'assigned' ? 'assigned' : '';
    const change = reactChange(control);
    if (change) {
      try { change({ target: { value: origin }, currentTarget: { value: origin } }); return; } catch (_) { /* use the persisted app filter below */ }
    }
    const filters = readFilters();
    localStorage.setItem('chatFilters', JSON.stringify({ ...filters, origin, originFilter: origin || 'all', assignedOnly: value === 'assigned', offset: 0 }));
    location.reload();
  }
  function mount() {
    const selects = [...document.querySelectorAll('[role="combobox"]')];
    const control = selects.find(node => {
      const labelled = (node.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
      const wrapper = node.closest('.MuiFormControl-root') || node.parentElement?.parentElement;
      const text = `${labelled} ${wrapper?.textContent || ''}`.toLowerCase();
      return /origin|source|المصدر/.test(text);
    });
    if (!control) return;
    const originField = control.closest('.MuiFormControl-root') || control.parentElement?.parentElement;
    if (!originField || originField.parentElement.querySelector(':scope > .sx-inbox-assignment-filter')) return;
    const current = readFilters().origin === 'assigned' ? 'assigned' : '';
    const copy = labels();
    const wrapper = document.createElement('div'); wrapper.className = 'sx-inbox-assignment-filter';
    wrapper.style.cssText = 'margin:0 0 16px;min-width:180px;flex:1 1 180px';
    const label = document.createElement('label'); label.textContent = copy.title; label.style.cssText = 'display:block;margin:0 0 6px;font-size:12px';
    const select = document.createElement('select'); select.setAttribute('aria-label', copy.title); select.style.cssText = 'width:100%;min-height:40px;border:1px solid #c5ccd5;border-radius:6px;padding:0 10px;background:transparent;color:inherit';
    for (const [value, text] of [['', copy.all], ['assigned', copy.assigned]]) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.appendChild(option); }
    select.value = current; select.addEventListener('change', () => apply(select.value, originField));
    wrapper.append(label, select); originField.parentElement.insertBefore(wrapper, originField);
  }
  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mount();
})();
