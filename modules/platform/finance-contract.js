'use strict';

class FinanceContractError extends Error {
  constructor(code) { super(code); this.code=code; }
}
function fail(code){throw new FinanceContractError(code);}
function minor(value,code='INVALID_MONEY',{positive=false}={}){
  if(!Number.isSafeInteger(value)||value<(positive?1:0))fail(code);
  return value;
}
function sum(values,code){return values.reduce((total,value)=>{const result=total+minor(value,code);if(!Number.isSafeInteger(result))fail(code);return result;},0);}
function exactTotal(values,code){return values.reduce((total,value)=>{const result=total+value;if(!Number.isSafeInteger(result))fail(code);return result;},0);}

function invoiceBalance({grossMinor,creditMinor=0,creditReversalMinor=0,allocatedMinor=0,allocationReversalMinor=0}){
  const gross=minor(grossMinor,'INVALID_INVOICE_AMOUNT',{positive:true});
  const credits=minor(creditMinor,'INVALID_CREDIT_AMOUNT'),creditReversals=minor(creditReversalMinor,'INVALID_CREDIT_REVERSAL');
  const allocated=minor(allocatedMinor,'INVALID_ALLOCATION'),allocationReversals=minor(allocationReversalMinor,'INVALID_ALLOCATION_REVERSAL');
  if(creditReversals>credits||allocationReversals>allocated)fail('INVALID_REVERSAL_TOTAL');
  const openMinor=exactTotal([gross,-credits,creditReversals,-allocated,allocationReversals],'INVOICE_BALANCE_OUT_OF_RANGE');
  if(openMinor<0||openMinor>gross)fail('INVOICE_BALANCE_OUT_OF_RANGE');
  return {grossMinor:gross,openMinor,creditedMinor:credits-creditReversals,allocatedMinor:allocated-allocationReversals};
}

function paymentBalance({grossMinor,completedRefundMinor=0,refundReversalMinor=0,chargebackMinor=0,chargebackReversalMinor=0,allocatedMinor=0,allocationReversalMinor=0}){
  const gross=minor(grossMinor,'INVALID_PAYMENT_AMOUNT',{positive:true});
  const refunded=minor(completedRefundMinor,'INVALID_REFUND_AMOUNT'),refundReversed=minor(refundReversalMinor,'INVALID_REFUND_REVERSAL');
  const charged=minor(chargebackMinor,'INVALID_CHARGEBACK_AMOUNT'),chargeReversed=minor(chargebackReversalMinor,'INVALID_CHARGEBACK_REVERSAL');
  const allocated=minor(allocatedMinor,'INVALID_ALLOCATION'),allocationReversed=minor(allocationReversalMinor,'INVALID_ALLOCATION_REVERSAL');
  if(refundReversed>refunded||chargeReversed>charged||allocationReversed>allocated)fail('INVALID_REVERSAL_TOTAL');
  const netFunds=exactTotal([gross,-refunded,refundReversed,-charged,chargeReversed],'PAYMENT_BALANCE_OUT_OF_RANGE');
  const availableMinor=exactTotal([netFunds,-allocated,allocationReversed],'PAYMENT_BALANCE_OUT_OF_RANGE');
  if(netFunds<0||availableMinor<0||availableMinor>netFunds)fail('PAYMENT_BALANCE_OUT_OF_RANGE');
  return {grossMinor:gross,netFundsMinor:netFunds,allocatedMinor:allocated-allocationReversed,availableMinor};
}

function assertInstallments(installments,grossMinor){
  if(!Array.isArray(installments)||installments.length<1||installments.length>12)fail('INVALID_INSTALLMENT_SCHEDULE');
  const totalMinor=sum(installments.map(item=>item?.amountMinor),'INVALID_INSTALLMENT_AMOUNT');
  if(totalMinor!==minor(grossMinor,'INVALID_INVOICE_AMOUNT',{positive:true}))fail('INSTALLMENT_TOTAL_MISMATCH');
  let previousDate='';
  for(const item of installments){minor(item?.amountMinor,'INVALID_INSTALLMENT_AMOUNT',{positive:true});if(typeof item.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)||!Number.isFinite(Date.parse(item.dueDate+'T00:00:00Z'))||new Date(item.dueDate+'T00:00:00Z').toISOString().slice(0,10)!==item.dueDate||item.dueDate<previousDate)fail('INVALID_INSTALLMENT_DATE');previousDate=item.dueDate;}
  return {totalMinor,count:installments.length};
}

function assertBalancedJournal(lines){
  if(!Array.isArray(lines)||lines.length<2)fail('INVALID_JOURNAL_LINES');
  const currencies=new Set(lines.map(line=>line?.currency));
  if(currencies.size!==1||typeof [...currencies][0]!=='string'||!/[A-Z]{3}/.test([...currencies][0])||!/^[A-Z]{3}$/.test([...currencies][0]))fail('CURRENCY_MISMATCH');
  let debits=0,credits=0;
  for(const line of lines){
    const debit=minor(line.debitMinor,'INVALID_JOURNAL_AMOUNT'),credit=minor(line.creditMinor,'INVALID_JOURNAL_AMOUNT');
    if((debit===0)===(credit===0))fail('INVALID_JOURNAL_LINE');
    debits=exactTotal([debits,debit],'JOURNAL_UNBALANCED');credits=exactTotal([credits,credit],'JOURNAL_UNBALANCED');
  }
  if(debits===0||credits===0||debits!==credits)fail('JOURNAL_UNBALANCED');
  return {currency:[...currencies][0],debitsMinor:debits,creditsMinor:credits};
}

function assertRecognition({eligibleMinor,recognizedMinor=0,proposedMinor}){
  const eligible=minor(eligibleMinor,'INVALID_ELIGIBLE_CONSIDERATION');
  const recognized=minor(recognizedMinor,'INVALID_RECOGNIZED_REVENUE');
  const proposed=minor(proposedMinor,'INVALID_RECOGNITION_AMOUNT');
  if(recognized>eligible||proposed>eligible-recognized)fail('REVENUE_RECOGNITION_EXCEEDS_CONSIDERATION');
  return {eligibleMinor:eligible,recognizedMinor:recognized,remainingMinor:eligible-recognized-proposed};
}

function postingReadiness(policy){
  const reasons=[];
  if(!policy||policy.status!=='approved')reasons.push('FINANCE_POLICY_NOT_APPROVED');
  if(policy?.jurisdiction!=='QA'||policy?.currency!=='QAR')reasons.push('QATAR_FINANCE_PROFILE_REQUIRED');
  if(typeof policy?.legalName!=='string'||policy.legalName.trim().length<2)reasons.push('LEGAL_ENTITY_REQUIRED');
  if(typeof policy?.invoicePrefix!=='string'||!/^[A-Z0-9-]{2,16}$/.test(policy.invoicePrefix))reasons.push('INVOICE_NUMBERING_REQUIRED');
  if(!['no_tax','exclusive','inclusive'].includes(policy?.taxMode))reasons.push('TAX_POLICY_REQUIRED');
  if(['exclusive','inclusive'].includes(policy?.taxMode)&&(!Number.isInteger(policy.taxRateBps)||policy.taxRateBps<0||policy.taxRateBps>10000))reasons.push('TAX_RATE_REQUIRED');
  if(!['deferred_until_delivery','over_time'].includes(policy?.revenueMethod))reasons.push('REVENUE_METHOD_REQUIRED');
  if(!['owner','accountant'].includes(policy?.issueApprover))reasons.push('INVOICE_APPROVER_REQUIRED');
  if(policy?.approvedByRole!=='accountant'||typeof policy.approvedBy!=='string'||!policy.approvedBy)reasons.push('ACCOUNTANT_APPROVAL_REQUIRED');
  return {ready:reasons.length===0,reasons};
}

module.exports={FinanceContractError,invoiceBalance,paymentBalance,assertInstallments,assertBalancedJournal,assertRecognition,postingReadiness};
