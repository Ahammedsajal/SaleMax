'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const invoices=require('../modules/platform/training-invoices');
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
  const router=read('modules/platform/training-finance-router.js'),ui=read('client/public/training-finance.js');
  assert.match(router,/\/accountant\/invoices/);assert.match(router,/invoices\.detail/);
  assert.match(ui,/Issued invoices/);assert.match(ui,/Posting and approval record/);assert.match(ui,/finance-settings/);
  assert.match(read('docs/API_DOCUMENTATION.md'),/Training invoice register and detail/);
  assert.match(read('docs/USER_MANUAL.md'),/Issued invoices/);
});
