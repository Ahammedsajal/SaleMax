'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'client/public/meta-credential-controls.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'client/public/index.html'), 'utf8');

function run(page, fields) {
  let observerCallback;
  const document = {
    documentElement: {},
    querySelectorAll(selector) {
      assert.equal(selector, 'input');
      return fields;
    }
  };
  const window = { location: { search: `?page=${page}` }, addEventListener() {} };
  class MutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe(target, options) {
      assert.equal(target, document.documentElement);
      assert.equal(options.subtree, true);
      assert.equal(options.childList, true);
    }
  }
  vm.runInNewContext(source, { window, document, MutationObserver, URLSearchParams });
  return observerCallback;
}

function field(label, type = 'text') {
  const attributes = {};
  return {
    type, autocomplete: '', spellcheck: true,
    labels: [{ textContent: label }],
    setAttribute(name, value) { attributes[name] = value; },
    attributes
  };
}

test('only the Meta Access Token field is masked on manual Meta setup', () => {
  const token = field('Meta Access Token');
  const accountId = field('WhatsApp Business Account ID');
  const appId = field('App ID');
  run('wa-meta-manual', [token, accountId, appId]);

  assert.equal(token.type, 'password');
  assert.equal(token.autocomplete, 'off');
  assert.equal(token.spellcheck, false);
  assert.equal(token.attributes['data-sx-meta-token'], 'masked');
  assert.equal(accountId.type, 'text');
  assert.equal(appId.type, 'text');
});

test('other pages and unrelated credentials keep their original input types', () => {
  const token = field('Meta Access Token');
  const otherSecret = field('SMTP password');
  run('inbox', [token, otherSecret]);
  assert.equal(token.type, 'text');
  assert.equal(otherSecret.type, 'text');
});

test('late-rendered token inputs are masked by the DOM observer', () => {
  const fields = [];
  const callback = run('wa-meta-manual', fields);
  const lateToken = field('Meta Access Token');
  fields.push(lateToken);
  callback();
  assert.equal(lateToken.type, 'password');
});

test('the app shell loads the maintained hook before the React screen bundle', () => {
  const hook = index.indexOf('/meta-credential-controls.js?v=20261012-token-mask1');
  const app = index.indexOf('/static/js/main.73648acf.js');
  assert.notEqual(hook, -1);
  assert.ok(app > hook);
});
