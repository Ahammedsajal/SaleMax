'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'client/public/sales-finance/index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'client/public/sales-finance/sales-finance.js'),'utf8');
const css=fs.readFileSync(path.join(root,'client/public/sales-finance/sales-finance.css'),'utf8');

test('Sales Finance reconciliation uses an accessible in-page action dialog',()=>{
  assert.match(html,/<dialog id="actionDialog" aria-labelledby="actionTitle">/);
  assert.match(html,/id="actionError" class="dialog-error" role="alert"/);
  assert.match(html,/id="cancelAction"/);
  assert.match(js,/dialog\.showModal\(\)/);
  assert.match(js,/new FormData\(form\)/);
  assert.match(css,/dialog::backdrop/);
  assert.doesNotMatch(js,/(^|[^\w])(?:prompt|confirm)\s*\(/);
});

test('receipt allocation is limited to same-currency invoices and both remaining balances',()=>{
  assert.match(js,/x\.currency===receipt\.currency/);
  assert.match(js,/Math\.min\(available,Number\(invoice\.outstandingMinor\)\)/);
  assert.match(js,/amountInput\.max=String\(limit\/100\)/);
});

test('allocation and reversal forms provide bilingual labels and required reason validation',()=>{
  assert.match(js,/allocationAmount:'Amount to allocate'/);
  assert.match(js,/allocationAmount:'مبلغ المطابقة'/);
  assert.match(js,/reverseReason:'Reason for reversal'/);
  assert.match(js,/reverseReason:'سبب عكس المطابقة'/);
  assert.match(js,/if\(!reason\)throw new Error\('INVALID_FINANCE_INPUT'\)/);
  assert.match(js,/cancel:'Cancel'/);
  assert.match(js,/cancel:'إلغاء'/);
});
