'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-telephony.js'),'utf8');
const callCenter=fs.readFileSync(path.join(__dirname,'../client/public/call-center/index.html'),'utf8');
const shell=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
const gatewayApi=fs.readFileSync(path.join(__dirname,'../modules/platform/tenant-asterisk-gateways.js'),'utf8');
const callCenterApi=fs.readFileSync(path.join(__dirname,'../modules/platform/call-center-router.js'),'utf8');

test('business gateway displays enforced TLS as read-only and preserves the API value',()=>{
  assert.match(ui,/<output aria-label="\$\{tr\('Transport','النقل'\)\}">TLS<\/output>/);
  assert.doesNotMatch(ui,/<select name="transport">/);
  assert.match(ui,/transport:'tls'/);
  assert.match(ui,/TLS is required for business gateway connections/);
  assert.match(ui,/\.sx-pbx-field output\{display:flex/);
});

test('business and Call Center gateway labels leave the quoted model unverified',()=>{
  assert.match(ui,/Dinstar 4-Port LTE Gateway/);
  assert.match(ui,/quotation confirms a Dinstar LTE gateway with up to four SIMs[\s\S]*?does not identify the exact model, SKU, bands, or firmware/i);
  assert.doesNotMatch(ui,/Dinstar UC2000-VE/);
  assert.match(gatewayApi,/input\.name===undefined\?'Dinstar 4-Port LTE Gateway'/);
  assert.match(callCenterApi,/Dinstar 4-Port LTE Gateway \(model unverified\)/);
  assert.match(callCenter,/Dinstar LTE gateway · model unverified/);
  assert.match(callCenter,/بوابة Dinstar LTE · الطراز غير مؤكد/);
  assert.doesNotMatch(callCenter,/DINSTAR UC2000-VE/);
  assert.match(shell,/admin-telephony\.js\?v=20261116-dinstar-model-caveat1/);
});
