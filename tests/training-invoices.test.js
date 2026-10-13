'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const invoices=require('../modules/platform/training-invoices');
const saleReviews=require('../modules/platform/training-sale-reviews');
const {trainingCenter}=require('../modules/platform/categories');
function context(role='owner',tenantId='tenant-1'){return {audience:'tenant',identity:{id:'identity-'+role},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'membership-'+role,tenantId,role,status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['tenant.settings','finance.invoices']}};}
test('invoice register filters are bounded and use safe defaults',()=>{
  assert.deepEqual(invoices.listInput(),{page:1,limit:20,status:'issued',q:'',courseId:'',from:'',to:''});
  assert.deepEqual(invoices.listInput({page:'2',limit:'50',status:'all',q:' TC-26 ',courseId:'a419050e-16b8-4f60-b77d-a956ce855e1c',from:'2026-10-01',to:'2026-10-31'}),{page:2,limit:50,status:'all',q:'TC-26',courseId:'a419050e-16b8-4f60-b77d-a956ce855e1c',from:'2026-10-01',to:'2026-10-31'});
  for(const input of [{page:0},{page:10001},{limit:51},{status:'paid'},{q:'x'.repeat(81)},{courseId:'not-a-course'},{from:'2026-02-30'},{from:'2026-10-02',to:'2026-10-01'}])assert.throws(()=>invoices.listInput(input),error=>error.code.startsWith('INVALID_INVOICE_'));
});
test('invoice summaries are tenant scoped, filter aware and aggregate paid installments',async()=>{
  const calls=[],db={async query(sql,params){calls.push({sql,params});if(sql.includes('AS invoice_count'))return [[{invoice_count:3,fully_paid:1,partially_paid:1,unpaid:1,invoiced_minor:60000,collected_minor:30000,outstanding_minor:30000}]];return [[{status:'paid',count:2},{status:'partial',count:1},{status:'overdue',count:1}]];}};
  const data=await invoices.summary(db,context(),{q:'INV-26',courseId:'a419050e-16b8-4f60-b77d-a956ce855e1c',from:'2026-10-01',to:'2026-10-31'});
  assert.equal(data.invoiceCount,3);assert.equal(data.fullyPaidInvoices,1);assert.equal(data.partiallyPaidInvoices,1);assert.equal(data.unpaidInvoices,1);assert.deepEqual(data.installments,{total:4,paid:2,partial:1,due:0,overdue:1,pending:0,credited:0,settled:0});
  assert.equal(calls.length,2);assert.match(calls[0].sql,/i\.tenant_id=\?/);assert.match(calls[0].sql,/l\.course_id=\?/);assert.match(calls[0].sql,/DATE\(i\.issued_at \+ INTERVAL 3 HOUR\)/);assert.equal(calls[0].params[0],'tenant-1');assert.equal(calls[1].params[0],'tenant-1');
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
  assert.match(ui,/Approved sales awaiting invoice/);assert.match(ui,/loadPendingSales\(node,mode,csrf\)/);assert.match(ui,/data-convert-sale/);assert.match(ui,/FINANCE_POLICY_NOT_APPROVED/);assert.match(ui,/legacyAt\('\/api\/pipeline'/);
  assert.match(ui,/taxTreatment\(data\)/);assert.match(ui,/Tax included/);assert.match(ui,/Tax added/);
  assert.match(ui,/New invoice/);assert.match(ui,/data-view-invoice/);assert.match(ui,/data-print-invoice/);assert.doesNotMatch(ui,/Posting and approval record/);assert.match(ui,/finance-settings/);assert.match(ui,/Issued invoices are immutable/);
  assert.match(router,/invoices\.summary/);assert.match(ui,/Paid in full/);assert.match(ui,/Invoice number, name, mobile or email/);assert.match(ui,/Issued from/);assert.match(ui,/data-generated-filter/);
  assert.match(ui,/managed in the Training Center Profile/);assert.match(ui,/Invoice policy and approval/);assert.match(ui,/Save and submit for accountant review/);
  assert.match(read('docs/API_DOCUMENTATION.md'),/Training invoice register and detail/);
  assert.match(read('docs/USER_MANUAL.md'),/Issued invoices/);
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
