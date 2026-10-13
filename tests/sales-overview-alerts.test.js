'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'client/public/sales-workspace/index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'client/public/sales-workspace/sales-workspace.js'),'utf8');
const css=fs.readFileSync(path.join(root,'client/public/sales-workspace/sales-workspace.css'),'utf8');

test('Sales Overview has an accessible alerts panel inside the existing business workspace',()=>{
  assert.match(html,/id="overviewAlertsPanel"[^>]*aria-labelledby="overviewAlertsTitle"/);
  assert.match(html,/id="overviewAlerts"[^>]*aria-live="polite"/);
  assert.match(html,/sales-design-tokens\.css[\s\S]*sales-workspace\/sales-workspace\.css/);
});

test('overview alerts reuse only role-visible lead, deal, and call data and link to existing work queues',()=>{
  assert.match(js,/function renderOverviewAlerts\(hasNav\)/);
  assert.match(js,/if\(state\.role==='accountant'\)\{panel\.hidden=true;return;\}/);
  assert.match(js,/if\(hasNav\('leads'\)\)/);
  assert.match(js,/if\(hasNav\('sales-deals'\)\)/);
  assert.match(js,/hasNav\('call-center'\)&&state\.overview\.callsError/);
  assert.match(js,/state\.overview\.followups\?\.summary\?\.overdue/);
  assert.match(js,/state\.overview\.pendingDeals\?\.items/);
  assert.match(js,/user\?page=lead-pipeline&view=followups/);
  assert.match(js,/user\?page=sales-workspace&section=deals/);
  assert.match(js,/user\?page=call-center/);
  assert.match(js,/\[`\$\{key\}Error`\]=true/);
});

test('overview alert styling follows the shared brand tokens and supports RTL/mobile layout',()=>{
  assert.match(css,/\.overview-alerts-panel/);
  assert.match(css,/var\(--sx-brand\)/);
  assert.match(css,/border-inline-start/);
  assert.match(css,/@media\(max-width:600px\)[\s\S]*\.overview-alert\{/);
});
