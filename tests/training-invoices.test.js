'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const invoices=require('../modules/platform/training-invoices');
const saleReviews=require('../modules/platform/training-sale-reviews');
const {trainingCenter}=require('../modules/platform/categories');
function context(role='owner',tenantId='tenant-1'){return {audience:'tenant',identity:{id:'identity-'+role},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'membership-'+role,tenantId,role,status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['tenant.settings','finance.invoices']}};}
test('invoice register filters are bounded and use safe defaults',()=>{
  assert.deepEqual(invoices.listInput(),{page:1,limit:20,status:'issued',q:''});
  assert.deepEqual(invoices.listInput({page:'2',limit:'50',status:'all',q:' TC-26 '}),{page:2,limit:50,status:'all',q:'TC-26'});
  for(const input of [{page:0},{page:10001},{limit:51},{status:'paid'},{q:'x'.repeat(81)}])assert.throws(()=>invoices.listInput(input),error=>error.code.startsWith('INVALID_INVOICE_'));
});
test('invoice register access is restricted to the active tenant owner and accountant',()=>{
  assert.doesNotThrow(()=>invoices.requireRead(context('owner')));
  assert.doesNotThrow(()=>invoices.requireRead(context('accountant')));
  assert.throws(()=>invoices.requireRead(context('agent')),{code:'PERMISSION_DENIED'});
  const noDb={query(){throw Error('authorization must fail before database access')}};
  assert.rejects(invoices.list(noDb,context('manager'),{}),{code:'PERMISSION_DENIED'});
});
test('invoice register and detail are connected to the existing finance workspace and documented',()=>{
  const fs=require('node:fs'),path=require('node:path'),read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
  const router=read('modules/platform/training-finance-router.js'),pipeline=read('routes/pipeline.js'),ui=read('client/public/training-finance.js');
  assert.match(router,/\/accountant\/invoices/);assert.match(router,/invoices\.detail/);assert.match(router,/sales\/approved-for-invoice/);assert.match(router,/accountant\/sales\/\:leadId\/reviews\/\:reviewId\/convert/);assert.match(pipeline,/router\.post\('\/leads\/\:id\/sale-reviews\/\:reviewId\/convert'/);
  assert.match(ui,/Invoices awaiting collection/);assert.match(ui,/loadInvoicesAwaitingCollection\(node,mode,csrf\)/);assert.match(ui,/data-open-collection-invoice/);assert.doesNotMatch(ui,/Approved sales awaiting invoice/);assert.doesNotMatch(ui,/loadPendingSales\(node,mode,csrf\)/);assert.doesNotMatch(ui,/Invoice policy and approval/);assert.doesNotMatch(ui,/data-policy-form/);
  assert.match(ui,/taxTreatment\(data\)/);assert.match(ui,/Tax included/);assert.match(ui,/Tax added/);
  assert.match(ui,/New invoice/);assert.match(ui,/data-view-invoice/);assert.match(ui,/data-print-invoice/);assert.doesNotMatch(ui,/Posting and approval record/);assert.match(ui,/finance-settings/);assert.match(ui,/Issued invoices are immutable/);
  assert.match(ui,/managed in the Training Center Profile/);assert.doesNotMatch(ui,/Save and submit for accountant review/);assert.match(read('client/public/training-courses.js'),/field\('crNumber'/);assert.match(read('client/public/training-courses.js'),/field\('invoicePrefix'/);assert.match(ui,/hasTax\?`<th>/);
  assert.match(read('docs/API_DOCUMENTATION.md'),/Training invoice register and detail/);
  assert.match(read('docs/USER_MANUAL.md'),/Issued invoices/);
});
test('invoice builder is a polished accessible modal and never uses stale contact matches',()=>{
  const fs=require('node:fs'),path=require('node:path'),ui=fs.readFileSync(path.join(__dirname,'..','client/public/training-finance.js'),'utf8'),css=fs.readFileSync(path.join(__dirname,'..','client/public/salemax-brand.css'),'utf8');
  assert.match(ui,/role="dialog" aria-modal="true" aria-labelledby="sx-invoice-create-title" tabindex="-1"/);
  assert.match(ui,/id="sx-invoice-create-title"/);assert.match(ui,/event.key==='Escape'/);assert.match(ui,/returnFocus.focus()/);assert.match(ui,/dialog.focus()/);
  assert.match(ui,/<div class="sx-invoice-submit-bar"><div class="error" data-invoice-error/);
  assert.match(ui,/id="sx-generator-customer-fields" hidden/);assert.match(ui,/id="sx-generator-customer-fields" hidden>.*?<\/div><\/fieldset><fieldset/s);assert.match(ui,/customerFields.hidden=!manual&&!invoiceForm.dataset.customerId/);
  assert.match(ui,/invoiceForm\.dataset\.customerSource='';invoiceForm\.dataset\.customerId='';customerFields\.hidden=invoiceForm\.elements\.customerType\.value!=='manual';results\.hidden=true/);
  assert.match(ui,/results.querySelectorAll\('\[data-customer-index\]'\).forEach\(button=>button.onclick=\(\)=>\{const row=customerRows\[Number\(button.dataset.customerIndex\)\]/);
  assert.match(ui,/const queryVersion=\+\+customerQueryVersion/);assert.match(ui,/queryVersion!==customerQueryVersion/);assert.match(ui,/event\.key==='Tab'/);
  assert.match(css,/#sx-invoice-create-workspace:not\(\[hidden\]\).*place-items:center/s);assert.match(css,/#sx-finance-screen \[hidden\]\{display:none!important\}/);assert.match(css,/max-height:calc\(100dvh - 32px\)/);assert.match(css,/#sx-finance-screen #sx-generator-invoice \.actions input\[type="radio"\].*width:18px/);assert.match(css,/\.actions label:has\(input:checked\)/);
  assert.match(css,/sx-invoice-submit-bar\{position:sticky;bottom:calc\(-1 \* var\(--sx-invoice-dialog-padding\)\)/);assert.match(css,/sx-invoice-submit-bar>button\[type="submit"\]\{width:100%;min-height:46px/);
  assert.match(ui,/\.filter\(item=>!item\.hidden&&!item\.closest\('\[hidden\]'\)&&!item\.closest\('details:not\(\[open\]\)'\)\)/);
});
test('invoice payment-plan rows keep names readable on phone widths',()=>{
  const fs=require('node:fs'),path=require('node:path'),css=fs.readFileSync(path.join(__dirname,'..','client/public/salemax-brand.css'),'utf8'),index=fs.readFileSync(path.join(__dirname,'..','client/public/index.html'),'utf8');
  assert.match(css,/@media\(max-width:760px\)\{#sx-finance-screen #sx-generator-plans \.sx-invoice-plan\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:10px\}#sx-finance-screen #sx-generator-plans \.sx-invoice-plan>label:first-child\{grid-column:1\/-1\}/);
  assert.match(css,/#sx-finance-screen #sx-generator-plans \.sx-invoice-plan \[data-remove-plan\]\{grid-column:1\/-1;justify-self:end;min-width:96px;min-height:40px\}/);
  assert.match(css,/#sx-finance-screen #sx-generator-settings>#sx-generator-add-plan,#sx-finance-screen #sx-generator-settings>button\.primary\{grid-column:1\/-1;justify-self:stretch;width:100%;min-height:44px\}/);
  assert.match(index,/training-finance\.js\?v=20261012-invoice-modal-sticky1/);assert.match(index,/salemax-brand\.css\?v=20261012-invoice-modal-sticky1/);
});
test('approved-sale invoice queue rejects roles outside owner/accountant before database access',async()=>{
  const ctx=context('agent'),pool={getConnection(){throw Error('unauthorized role must be rejected before database access')}};
  await assert.rejects(saleReviews.listApprovedForInvoice(pool,ctx,{uid:'agent-uid'}),{code:'PERMISSION_DENIED'});
});
test('approved-sale invoice queue matches legacy UIDs without depending on database collation',async()=>{
  const ctx=context('owner');let sql='';
  const pool={async getConnection(){return {async query(query){sql=query;return [[]];},release(){}};}};
  assert.deepEqual(await saleReviews.listApprovedForInvoice(pool,ctx,{uid:'owner-uid'}),[]);
  assert.match(sql,/BINARY\s+l\.uid\s*=\s*BINARY\s+r\.legacy_uid/);
});
