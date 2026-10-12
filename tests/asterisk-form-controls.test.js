'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-asterisk.js'),'utf8');

test('PBX setup presents enforced SIP TLS as a read-only value, not a one-choice dropdown',()=>{
  assert.match(ui,/<output class="sx-asterisk-readonly">TLS<\/output>/);
  assert.match(ui,/gatewaySipTransport:'tls'/);
  assert.doesNotMatch(ui,/<select name="gatewaySipTransport">/);
  assert.match(ui,/TLS is required for direct-internet SIP connections/);
  assert.match(ui,/\.sx-asterisk-card \.sx-asterisk-readonly\{display:flex/);
});