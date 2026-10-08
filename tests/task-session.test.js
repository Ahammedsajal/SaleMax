'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../client/public/tasks/tasks-session.js'), 'utf8');

test('Tasks uses the latest shared business token for every pipeline request', async () => {
  let currentToken = 'initial-business-token';
  const calls = [];
  const window = {
    fetch: async (input, init) => {
      calls.push({ input, init });
      return { ok: false };
    },
  };
  const context = {
    window,
    localStorage: { getItem: key => key === 'wacrm_user' ? currentToken : null },
    location: { href: 'https://crm.salemax.qa/tasks/', origin: 'https://crm.salemax.qa' },
    URL,
    Headers,
    Request,
  };
  vm.runInNewContext(source, context, { filename: 'tasks-session.js' });

  await window.fetch('/api/pipeline/tasks', { headers: { Authorization: 'Bearer stale-token' } });
  currentToken = 'refreshed-business-token';
  await window.fetch('/api/pipeline/tasks/participants', { headers: { 'X-Trace': 'kept' } });

  const tasksCalls = calls.filter(call => String(call.input).includes('/api/pipeline/tasks'));
  assert.equal(new Headers(tasksCalls[0].init.headers).get('authorization'), 'Bearer initial-business-token');
  assert.equal(new Headers(tasksCalls[1].init.headers).get('authorization'), 'Bearer refreshed-business-token');
  assert.equal(new Headers(tasksCalls[1].init.headers).get('x-trace'), 'kept');
});

test('Tasks uses the existing HttpOnly business session and CSRF token when it is available', async () => {
  const calls=[];
  const window={fetch:async(input,init)=>{
    calls.push({input,init});
    if(String(input).includes('/api/user/business-auth/me'))return {ok:true,json:async()=>({context:{audience:'tenant'},csrfToken:'csrf-proof'})};
    return {ok:true};
  }};
  const context={window,localStorage:{getItem:()=> 'legacy-token'},location:{href:'https://crm.salemax.qa/tasks/',origin:'https://crm.salemax.qa'},URL,Headers,Request};
  vm.runInNewContext(source,context,{filename:'tasks-session.js'});
  await window.fetch('/api/pipeline/tasks',{headers:{Authorization:'Bearer legacy-token'}});
  const taskCall=calls.find(call=>String(call.input).includes('/api/user/training/tasks'));
  assert.ok(taskCall);
  assert.equal(new URL(String(taskCall.input)).pathname,'/api/user/training/tasks');
  assert.equal(new Headers(taskCall.init.headers).get('authorization'),null);
  assert.equal(new Headers(taskCall.init.headers).get('x-csrf-token'),'csrf-proof');
  assert.equal(taskCall.init.credentials,'same-origin');
});

test('Tasks does not rewrite authorization for requests outside its same-origin pipeline API', async () => {
  const calls = [];
  const window = {
    fetch: async (input, init) => {
      calls.push({ input, init });
      return { ok: true };
    },
  };
  const context = {
    window,
    localStorage: { getItem: () => 'business-token' },
    location: { href: 'https://crm.salemax.qa/tasks/', origin: 'https://crm.salemax.qa' },
    URL,
    Headers,
    Request,
  };
  vm.runInNewContext(source, context, { filename: 'tasks-session.js' });

  await window.fetch('https://example.com/health', { headers: { Authorization: 'Bearer third-party-token' } });

  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer third-party-token');
});
