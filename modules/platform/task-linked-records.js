'use strict';

const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const dateOnly=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);

async function invoice(db,tenantId,id){
  if(!uuid(id))fail('INVALID_TASK_SOURCE_ID');
  const [[row]]=await db.query(`SELECT i.id,i.invoice_number,i.status,i.currency,i.total_minor,e.lead_id,e.learner_name,e.payer_name,e.payer_phone,
    (SELECT COALESCE(SUM(a.amount_minor-COALESCE((SELECT SUM(ar.amount_minor) FROM sx_training_payment_allocation_reversals ar WHERE ar.tenant_id=a.tenant_id AND ar.allocation_id=a.id),0)),0)
     FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id
     WHERE a.tenant_id=i.tenant_id AND a.invoice_id=i.id AND p.status='posted') AS collected_minor,
    (SELECT COALESCE(SUM(c.amount_minor),0) FROM sx_training_credit_notes c WHERE c.tenant_id=i.tenant_id AND c.invoice_id=i.id AND c.status='posted') AS credited_minor,
    (SELECT MIN(x.due_date) FROM sx_training_installments x WHERE x.tenant_id=i.tenant_id AND x.invoice_id=i.id AND x.status NOT IN ('paid','cancelled')) AS next_due_date
    FROM sx_training_invoices i JOIN sx_training_enrollments e ON e.tenant_id=i.tenant_id AND e.id=i.enrollment_id
    WHERE i.tenant_id=? AND i.id=? LIMIT 1`,[tenantId,id]);
  if(!row)fail('TASK_SOURCE_NOT_FOUND',404);
  const total=BigInt(row.total_minor),collected=BigInt(row.collected_minor),credited=BigInt(row.credited_minor),due=row.status==='issued'?(total>collected+credited?total-collected-credited:0n):0n;
  return {type:'invoice',id:row.id,invoiceId:row.id,invoiceNumber:row.invoice_number,status:row.status,currency:row.currency,learnerName:row.learner_name,payerName:row.payer_name,payerPhone:row.payer_phone,totalMinor:total.toString(),amountDueMinor:due.toString(),nextDueDate:row.next_due_date?dateOnly(row.next_due_date):null,dueAt:row.next_due_date?dateOnly(row.next_due_date):null,leadId:row.lead_id||null};
}

async function resolve(db,tenantId,type,id){
  if(type==='invoice')return invoice(db,tenantId,id);
  if(type==='installment'){
    if(!uuid(id))fail('INVALID_TASK_SOURCE_ID');
    const [[row]]=await db.query(`SELECT x.id,x.invoice_id,x.sequence_number,x.due_date,x.amount_minor,x.status,(SELECT COALESCE(SUM(a.amount_minor-COALESCE((SELECT SUM(ar.amount_minor) FROM sx_training_payment_allocation_reversals ar WHERE ar.tenant_id=a.tenant_id AND ar.allocation_id=a.id),0)),0) FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id WHERE a.tenant_id=x.tenant_id AND a.installment_id=x.id AND p.status='posted') AS collected_minor,(SELECT COALESCE(SUM(ca.amount_minor),0) FROM sx_training_credit_allocations ca JOIN sx_training_credit_notes c ON c.tenant_id=ca.tenant_id AND c.id=ca.credit_note_id WHERE ca.tenant_id=x.tenant_id AND ca.installment_id=x.id AND c.status='posted') AS credited_minor FROM sx_training_installments x WHERE x.tenant_id=? AND x.id=? LIMIT 1`,[tenantId,id]);
    if(!row)fail('TASK_SOURCE_NOT_FOUND',404);
    const parent=await invoice(db,tenantId,row.invoice_id);
    const amount=BigInt(row.amount_minor),collected=BigInt(row.collected_minor),credited=BigInt(row.credited_minor),remaining=['paid','cancelled'].includes(row.status)?0n:(amount>collected+credited?amount-collected-credited:0n);
    const installment={id:row.id,sequence:Number(row.sequence_number),dueDate:dateOnly(row.due_date),amountMinor:amount.toString(),collectedMinor:collected.toString(),creditedMinor:credited.toString(),status:row.status};
    return {...parent,type:'installment',id:row.id,installment,amountDueMinor:remaining.toString(),dueAt:installment.dueDate};
  }
  fail('UNSUPPORTED_TASK_SOURCE');
}

async function validate(db,ctx,type,id){
  if(!['invoice','installment'].includes(type))fail('UNSUPPORTED_TASK_SOURCE');
  if(!['owner','manager'].includes(ctx.role))fail('PERMISSION_DENIED',403);
  const record=await resolve(db,ctx.tenantId,type,id);if(record.status!=='issued')fail('TASK_INVOICE_NOT_ACTIVE',409);if(type==='installment'&&['paid','credited','settled','cancelled'].includes(record.installment.status))fail('TASK_INSTALLMENT_NOT_OPEN',409);return record;
}

module.exports={validate,resolve};
