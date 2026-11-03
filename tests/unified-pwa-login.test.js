'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../client/public/unified-pwa-login.js'), 'utf8');

function browser(href, seed = {}) {
  class MockStorage {
    constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
    getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
    removeItem(key) { this.values.delete(String(key)); }
  }
  class MockXHR {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { (this.headers ||= {})[name] = value; }
    send(body) { this.body = body; }
  }
  const url = new URL(href);
  const replaced = [];
  const timers = [];
  const location = {
    href: url.href,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    replace: value => replaced.push(value),
  };
  const localStorage = new MockStorage(seed.localStorage);
  const sessionStorage = new MockStorage(seed.sessionStorage);
  const window = { fetch: async () => ({ ok: true }) };
  const context = {
    Storage: MockStorage,
    XMLHttpRequest: MockXHR,
    Request: class Request { constructor(value) { this.url = value; this.headers = new Headers(); } },
    Headers,
    URL,
    URLSearchParams,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    location,
    localStorage,
    sessionStorage,
    window,
    setTimeout: fn => { timers.push(fn); return timers.length; },
    WeakSet,
  };
  vm.runInNewContext(source, context);
  return { context, localStorage, sessionStorage, location, replaced, timers, MockXHR };
}

function token(role) {
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url');
  return `header.${payload}.signature`;
}

test('agent token from the shared user login is stored separately and enters agent mode', () => {
  const app = browser('https://7network.live/user/login');
  app.localStorage.setItem('wacrm_user', token('agent'));

  assert.equal(app.localStorage.getItem('wacrm_user'), null);
  assert.equal(app.localStorage.getItem('wacrm_agent'), token('agent'));
  assert.equal(app.localStorage.getItem('sx_workspace_actor_preference'), 'agent');
  assert.equal(app.sessionStorage.getItem('sx_workspace_actor'), 'agent');
  app.timers[0]();
  assert.deepEqual(app.replaced, ['/user?actor=agent&page=dashboard']);
});

test('PWA dashboard launch restores an agent role saved by the shared login', () => {
  const app = browser('https://7network.live/user?page=dashboard', {
    localStorage: { wacrm_agent: token('agent'), sx_workspace_actor_preference: 'agent' },
  });

  assert.deepEqual(app.replaced, ['/user?actor=agent&page=dashboard']);
});

test('PWA dashboard launch preserves older agent sessions without a saved role preference', () => {
  const app = browser('https://7network.live/user?page=dashboard', {
    localStorage: { wacrm_agent: token('agent') },
  });

  assert.deepEqual(app.replaced, ['/user?actor=agent&page=dashboard']);
});

test('business login keeps the business token and selects the business dashboard', () => {
  const app = browser('https://7network.live/user/login');
  app.localStorage.setItem('wacrm_user', token('user'));

  assert.equal(app.localStorage.getItem('wacrm_user'), token('user'));
  assert.equal(app.localStorage.getItem('sx_workspace_actor_preference'), 'user');
  assert.equal(app.sessionStorage.getItem('sx_workspace_actor'), null);
});

test('explicit agent login intent is added only to the shared login request', () => {
  const app = browser('https://7network.live/user/login?actor=agent');
  const xhr = new app.MockXHR();
  xhr.open('POST', '/api/user/login');
  xhr.send(JSON.stringify({ email: 'agent@example.test', password: 'password' }));
  assert.deepEqual(JSON.parse(xhr.body), { email: 'agent@example.test', password: 'password', actor: 'agent' });

  const unrelated = new app.MockXHR();
  unrelated.open('POST', '/api/user/signup');
  unrelated.send(JSON.stringify({ email: 'agent@example.test' }));
  assert.deepEqual(JSON.parse(unrelated.body), { email: 'agent@example.test' });
});

test('agent mode maps legacy user-token reads to the agent token and scopes API requests', () => {
  const app = browser('https://7network.live/user?actor=agent&page=dashboard', {
    localStorage: { wacrm_agent: token('agent') },
  });
  assert.equal(app.localStorage.getItem('wacrm_user'), token('agent'));

  const xhr = new app.MockXHR();
  xhr.open('GET', '/api/workspace/session');
  xhr.send();
  assert.equal(xhr.headers['X-Salemax-Actor'], 'agent');
});
