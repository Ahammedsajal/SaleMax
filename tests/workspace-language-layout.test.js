const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const publicRoot = path.join(__dirname, '../client/public');

function localeFixture(values) {
  class Storage {
    constructor() { this.values = new Map(Object.entries(values)); }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
  }
  const localStorage = new Storage(), sessionStorage = new Storage();
  const document = { documentElement: { dir: 'rtl', lang: 'ar' } };
  const events = [], listeners = {};
  const window = { dispatchEvent: event => events.push(event.type), addEventListener: (name, fn) => listeners[name] = fn };
  vm.runInNewContext(fs.readFileSync(path.join(publicRoot, 'workspace-locale.js'), 'utf8'), { window, document, Storage, localStorage, Event: class { constructor(type) { this.type = type; } } });
  return { window, document, localStorage, sessionStorage, events, listeners };
}

test('English startup repairs persisted Arabic direction before React reads it', () => {
  const f = localeFixture({ language: 'english', app_direction: 'rtl' });
  assert.equal(f.localStorage.getItem('app_direction'), 'ltr');
  assert.equal(f.document.documentElement.dir, 'ltr');
  assert.equal(f.document.documentElement.lang, 'en');
  assert.equal(f.window.SaleMaxLocale.isArabic(), false);
});

test('the shell default English language also repairs a stale RTL preference', () => {
  const f = localeFixture({ app_direction: 'rtl' });
  assert.equal(f.document.documentElement.dir, 'ltr');
  assert.equal(f.window.SaleMaxLocale.isArabic(), false);
});

test('changing language synchronizes direction and notifies extensions in the same tab', () => {
  const f = localeFixture({ language: 'arabic', app_direction: 'rtl' });
  f.localStorage.setItem('language', 'english');
  assert.equal(f.localStorage.getItem('app_direction'), 'ltr');
  assert.equal(f.window.SaleMaxLocale.isArabic(), false);
  assert.deepEqual(f.events, ['salemax:languagechange']);
  f.localStorage.setItem('language', 'ar-QA');
  assert.equal(f.localStorage.getItem('app_direction'), 'rtl');
  assert.equal(f.window.SaleMaxLocale.isArabic(), true);
  f.sessionStorage.setItem('language', 'english');
  assert.equal(f.window.SaleMaxLocale.isArabic(), true);
});

test('an independent RTL toggle does not turn explicit English labels Arabic', () => {
  const f = localeFixture({ language: 'english', app_direction: 'rtl', 'salemax-ui-language': 'en' });
  assert.equal(f.localStorage.getItem('app_direction'), 'rtl');
  assert.equal(f.window.SaleMaxLocale.isArabic(), false);
});

function financeBounds(width, drawers) {
  const source = fs.readFileSync(path.join(publicRoot, 'training-finance.js'), 'utf8');
  const fn = source.slice(source.indexOf('  function syncFinanceBounds('), source.indexOf('  let financeBoundsFrame='));
  const properties = {};
  const node = { style: { getPropertyValue: name => properties[name], setProperty: (name, value) => properties[name] = value } };
  const document = {
    getElementById: () => node,
    querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 80 }) }),
    querySelectorAll: () => drawers.map(({ left, right, modal, hidden }) => ({
      getBoundingClientRect: () => ({ left, right, width: right - left }),
      classList: { contains: () => false },
      closest: selector => selector === '.MuiModal-root' && modal ? {} : null,
      querySelector: () => null,
      hidden,
    })),
  };
  vm.runInNewContext(fn + '\nsyncFinanceBounds();', { document, window: { innerWidth: width }, financeResizeObserver: null, getComputedStyle: element => ({ display: element.hidden ? 'none' : 'block', visibility: 'visible' }) });
  return properties;
}

test('Finance covers the workspace and reserves the real sidebar edge in either direction', () => {
  assert.deepEqual(financeBounds(1440, [{ left: 1180, right: 1440 }]), { '--sx-finance-top-inset': '80px', '--sx-finance-left-inset': '0px', '--sx-finance-right-inset': '260px' });
  assert.equal(financeBounds(1440, [{ left: 0, right: 72 }])['--sx-finance-left-inset'], '72px');
  assert.equal(financeBounds(1440, [{ left: 0, right: 260, hidden: true }])['--sx-finance-left-inset'], '0px');
  assert.equal(financeBounds(390, [{ left: 0, right: 260, modal: true }])['--sx-finance-left-inset'], '0px');
});
