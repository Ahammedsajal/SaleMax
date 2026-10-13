'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Finance invoice register actions use a readable full-width mobile layout',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../client/public/salemax-brand.css'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  assert.match(css,/@media\(max-width:760px\)\{\s*#sx-finance-screen #sx-invoice-register>\.toolbar\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/#sx-finance-screen #sx-invoice-register>\.toolbar>\.actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/#sx-finance-screen #sx-invoice-register>\.toolbar>\.actions>#sx-invoice-create\{grid-column:1\/-1\}/);
  assert.match(html,/salemax-brand\.css\?v=[^"]+/);
});

test('Phonebook mobile headers stay readable inside the grid horizontal scroller',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../client/public/salemax-brand.css'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  assert.match(css,/@media\(max-width:760px\)\{\s*#root \.MuiDataGrid-root:has\(\.MuiDataGrid-columnHeader\[data-field="phonebook_name"\]\)/);
  assert.match(css,/\.MuiDataGrid-columnHeader\[data-field="mobile"\].*?\{flex:0 0 160px!important;width:160px!important/s);
  assert.match(css,/\.MuiDataGrid-virtualScrollerContent,\s*#root \.MuiDataGrid-root:has\(\.MuiDataGrid-columnHeader\[data-field="phonebook_name"\]\) \.MuiDataGrid-virtualScrollerRenderZone,\s*#root \.MuiDataGrid-root:has\(\.MuiDataGrid-columnHeader\[data-field="phonebook_name"\]\) \.MuiDataGrid-row\{width:1140px!important/s);
  assert.match(html,/salemax-brand\.css\?v=[^"]+/);
});

test('Finance invoice and receipt share controls call the authenticated delivery endpoint',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../client/public/training-finance.js'),'utf8');
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/training-finance-router.js'),'utf8');
  assert.match(source,/data-send-document="email"/);assert.match(source,/data-send-document="whatsapp"/);assert.match(source,/\/documents\/\$\{type\}\/\$\{encodeURIComponent\(id\)\}\/deliveries/);
  assert.match(router,/documents\/:type\/:id\/deliveries/);assert.match(router,/canonicalGuard/);
});

test('generated invoice history loads as the first Finance section before the issued invoice register',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../client/public/training-finance.js'),'utf8');
  assert.match(source,/id='sx-generated-invoice-history'/);
  assert.match(source,/generatedArea\.insertAdjacentElement\('afterend',card\)/);
  assert.match(source,/loadGeneratedInvoices\(card,mode,csrf\)/);
  assert.match(source,/Generated invoice PDFs/);
});

test('invoice policy and reminder controls open from Settings without taking space on the invoice page',()=>{
  const fs=require('node:fs'),path=require('node:path'),source=fs.readFileSync(path.join(__dirname,'../client/public/training-finance.js'),'utf8');
  const start=source.indexOf('async function loadInvoiceRegister'),end=source.indexOf('async function loadReminderSettings',start),register=source.slice(start,end);
  assert.match(register,/id="sx-finance-settings-open"/);
  assert.match(register,/id="sx-finance-settings" hidden/);
  assert.doesNotMatch(register,/loadReminderSettings\(card,mode,csrf\)\]\)/);
  assert.match(register,/openSettings\.onclick=\(\)=>\{[\s\S]*?loadFinancePolicy\(node,mode,csrf\);loadReminderSettings\(card,mode,csrf\)/);
  assert.match(source,/id="sx-finance-settings-policy"/);
  assert.match(source,/Invoice footer is managed in the Training Center Profile/);
  assert.doesNotMatch(source,/Default invoice footer/);
});
