'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const report=require('../modules/platform/training-receivables-report');

test('receivables report bounds paging and accepts only defined aging filters',()=>{
  assert.deepEqual(report.inputShape({page:'2',limit:'50',bucket:'31-60',q:'Aisha',from:'2026-10-01',to:'2026-10-31'}),{page:2,limit:50,bucket:'31-60',q:'Aisha',from:'2026-10-01',to:'2026-10-31'});
  assert.deepEqual(report.inputShape(),{page:1,limit:25,bucket:'all',q:'',from:'',to:''});
  for(const input of [{bucket:'future'},{page:0},{limit:101},{q:'x'.repeat(81)},{from:'2026-02-30'},{from:'2026-10-11',to:'2026-10-10'}])assert.throws(()=>report.inputShape(input));
});

test('receivables report uses a Qatar-local ISO report date',()=>{
  assert.match(report.todayQatar(),/^\d{4}-\d{2}-\d{2}$/);
});

test('finance report labels settled and partial invoices separately and can clear every filter',()=>{
  const screen=fs.readFileSync(path.join(__dirname,'../client/public/training-finance.js'),'utf8');
  const index=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  assert.match(screen,/Settled \/ part-settled/);assert.match(screen,/partialInvoiceCount/);
  assert.match(screen,/Clear filters/);assert.match(screen,/bucket='all';q='';from='';to='';page=1;render\(\)/);
  assert.match(index,/training-finance\.js\?v=20261006-profile-invoice2/);
});

test('finance report exposes payment credit from posted invoice receipts net of reversals',async()=>{
  const queries=[],tenantId='tenant-finance-credit',from='2026-10-01',to='2026-10-31';
  const db={async query(sql,params){queries.push({sql,params});
    if(sql.includes('COUNT(DISTINCT invoice_id) AS invoice_count'))return [[{invoice_count:0,installment_count:0,outstanding_minor:0,current_minor:0,overdue_minor:0,overdue_invoice_count:0}]];
    if(sql.includes('GROUP BY bucket'))return [[]];
    if(sql.includes('AS issued_invoice_count'))return [[{issued_invoice_count:1,billed_minor:300000,collected_minor:260000,credited_minor:0,credited_invoice_count:0,settled_invoice_count:0,partial_invoice_count:1}]];
    if(sql.includes('AS pending')||sql.includes('AS amount_minor FROM sx_training_payments'))return [[{count:0,amount_minor:0}]];
    if(sql.includes('COUNT(DISTINCT pay.id) AS payment_count'))return [[{agent_id:17,agent_name:'Agent Snapshot',sale_count:1,payment_count:3,received_minor:350000,applied_minor:260000,reversed_minor:40000,credited_minor:310000}]];
    if(sql.includes('COUNT(*) AS total FROM ('))return [[{total:0}]];
    if(sql.startsWith('SELECT * FROM ('))return [[]];
    throw new Error(`Unexpected report query: ${sql}`);
  }};
  const ctx={audience:'tenant',identity:{id:'finance-reader'},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'finance-member',tenantId,role:'accountant',status:'active'},category:{key:'training_center',version:1,capabilities:['finance.invoices','tenant.settings']},subscription:{status:'active',capabilities:['finance.invoices','tenant.settings']}};
  const result=await report.list(db,ctx,{from,to});
  assert.deepEqual(result.agentPaymentCredit,[{agentId:17,agentName:'Agent Snapshot',saleCount:1,paymentCount:3,receivedMinor:350000,appliedMinor:260000,reversedMinor:40000,creditedMinor:310000}]);
  const creditQuery=queries.find(item=>item.sql.includes('COUNT(DISTINCT pay.id) AS payment_count'));
  assert.match(creditQuery.sql,/pay\.status='posted'/);assert.match(creditQuery.sql,/LEFT JOIN \(SELECT a\.tenant_id/);assert.match(creditQuery.sql,/training_payment_allocation_reversals/);assert.match(creditQuery.sql,/sx_training_refunds WHERE tenant_id=\? AND status='completed'/);assert.match(creditQuery.sql,/sx_training_payment_disputes WHERE tenant_id=\? AND status='lost'/);assert.match(creditQuery.sql,/c\.tenant_id=\?/);
  assert.deepEqual(creditQuery.params,[tenantId,tenantId,tenantId,tenantId,tenantId,from,from,to,to]);
});
