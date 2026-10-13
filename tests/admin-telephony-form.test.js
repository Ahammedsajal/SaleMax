'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-telephony.js'),'utf8');

test('business gateway displays enforced TLS as read-only and preserves the API value',()=>{
  assert.match(ui,/<output aria-label="\$\{tr\('Transport','النقل'\)\}">TLS<\/output>/);
  assert.doesNotMatch(ui,/<select name="transport">/);
  assert.match(ui,/transport:'tls'/);
  assert.match(ui,/TLS is required for business gateway connections/);
  assert.match(ui,/\.sx-pbx-field output\{display:flex/);
});
