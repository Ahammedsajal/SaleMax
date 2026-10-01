'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const finance=require('../modules/platform/finance-contract');

test('QAR invoice balances reconcile posted credits and allocations without floating point',()=>{
  const first=finance.invoiceBalance({grossMinor:300000,allocatedMinor:100000});
  assert.deepEqual(first,{grossMinor:300000,openMinor:200000,creditedMinor:0,allocatedMinor:100000});
  assert.equal(finance.invoiceBalance({grossMinor:300000,creditMinor:50000,allocatedMinor:100000}).openMinor,150000);
  assert.equal(finance.invoiceBalance({grossMinor:300000,creditMinor:50000,creditReversalMinor:20000,allocatedMinor:100000,allocationReversalMinor:10000}).openMinor,180000);
  assert.throws(()=>finance.invoiceBalance({grossMinor:300000,allocatedMinor:300001}),{code:'INVOICE_BALANCE_OUT_OF_RANGE'});
  assert.throws(()=>finance.invoiceBalance({grossMinor:300000,allocatedMinor:10000,allocationReversalMinor:10001}),{code:'INVALID_REVERSAL_TOTAL'});
});

test('payment availability distinguishes gross receipt, completed refunds, chargebacks and allocations',()=>{
  const payment=finance.paymentBalance({grossMinor:100000,completedRefundMinor:10000,chargebackMinor:5000,allocatedMinor:60000});
  assert.deepEqual(payment,{grossMinor:100000,netFundsMinor:85000,allocatedMinor:60000,availableMinor:25000});
  assert.equal(finance.paymentBalance({grossMinor:100000,completedRefundMinor:10000,refundReversalMinor:2000,allocatedMinor:30000,allocationReversalMinor:5000}).availableMinor,67000);
  assert.throws(()=>finance.paymentBalance({grossMinor:10000,completedRefundMinor:5000,allocatedMinor:5001}),{code:'PAYMENT_BALANCE_OUT_OF_RANGE'});
});

test('invoice installment schedule uses exact integer minor units and bounded due dates',()=>{
  assert.deepEqual(finance.assertInstallments([{amountMinor:100000,dueDate:'2026-10-02'},{amountMinor:100000,dueDate:'2026-11-02'},{amountMinor:100000,dueDate:'2026-12-02'}],300000),{totalMinor:300000,count:3});
  assert.throws(()=>finance.assertInstallments([{amountMinor:299999,dueDate:'2026-10-02'}],300000),{code:'INSTALLMENT_TOTAL_MISMATCH'});
  assert.throws(()=>finance.assertInstallments([{amountMinor:0,dueDate:'2026-10-02'},{amountMinor:300000,dueDate:'2026-11-02'}],300000),{code:'INVALID_INSTALLMENT_AMOUNT'});
  assert.throws(()=>finance.assertInstallments([{amountMinor:300000,dueDate:'2026-02-30'}],300000),{code:'INVALID_INSTALLMENT_DATE'});
  assert.throws(()=>finance.assertInstallments(Array(13).fill({amountMinor:1,dueDate:'2026-10-02'}),13),{code:'INVALID_INSTALLMENT_SCHEDULE'});
});

test('journal entries must balance debits and credits in one currency',()=>{
  assert.deepEqual(finance.assertBalancedJournal([{currency:'QAR',debitMinor:300000,creditMinor:0},{currency:'QAR',debitMinor:0,creditMinor:300000}]),{currency:'QAR',debitsMinor:300000,creditsMinor:300000});
  assert.throws(()=>finance.assertBalancedJournal([{currency:'QAR',debitMinor:300000,creditMinor:0},{currency:'QAR',debitMinor:0,creditMinor:299999}]),{code:'JOURNAL_UNBALANCED'});
  assert.throws(()=>finance.assertBalancedJournal([{currency:'QAR',debitMinor:100,creditMinor:0},{currency:'USD',debitMinor:0,creditMinor:100}]),{code:'CURRENCY_MISMATCH'});
  assert.throws(()=>finance.assertBalancedJournal([{currency:'QAR',debitMinor:100,creditMinor:100},{currency:'QAR',debitMinor:0,creditMinor:100}]),{code:'INVALID_JOURNAL_LINE'});
});

test('revenue recognition is capped by eligible consideration independently of cash collection',()=>{
  assert.deepEqual(finance.assertRecognition({eligibleMinor:300000,recognizedMinor:100000,proposedMinor:50000}),{eligibleMinor:300000,recognizedMinor:100000,remainingMinor:150000});
  assert.throws(()=>finance.assertRecognition({eligibleMinor:300000,recognizedMinor:250000,proposedMinor:50001}),{code:'REVENUE_RECOGNITION_EXCEEDS_CONSIDERATION'});
});

test('posting remains fail-closed until an accountant approves a complete Qatar finance profile',()=>{
  const pending=finance.postingReadiness({jurisdiction:'QA',currency:'QAR',legalName:'Example Training Center',invoicePrefix:'TC-26',taxMode:'no_tax',revenueMethod:'deferred_until_delivery',issueApprover:'accountant',status:'draft'});
  assert.equal(pending.ready,false);assert.ok(pending.reasons.includes('FINANCE_POLICY_NOT_APPROVED'));assert.ok(pending.reasons.includes('ACCOUNTANT_APPROVAL_REQUIRED'));
  const approved=finance.postingReadiness({jurisdiction:'QA',currency:'QAR',legalName:'Example Training Center',invoicePrefix:'TC-26',taxMode:'exclusive',taxRateBps:0,revenueMethod:'deferred_until_delivery',issueApprover:'accountant',status:'approved',approvedByRole:'accountant',approvedBy:'synthetic-accountant'});
  assert.equal(approved.ready,true);assert.deepEqual(approved.reasons,[]);
  assert.equal(finance.postingReadiness({jurisdiction:'QA',currency:'QAR',legalName:'Example',invoicePrefix:'X',taxMode:'exclusive',revenueMethod:'deferred_until_delivery',issueApprover:'owner',status:'approved',approvedByRole:'owner',approvedBy:'owner'}).ready,false);
});
