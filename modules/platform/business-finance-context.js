'use strict';
const parse=value=>typeof value==='string'?JSON.parse(value):value||{};
const date=value=>{if(!value)return '';if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(d):'';};
function minor(value){const n=Number(value||0);if(!Number.isSafeInteger(n)||n<0)throw Object.assign(Error('INVALID_FINANCIAL_AMOUNT'),{code:'INVALID_FINANCIAL_AMOUNT'});return n;}
function money(value,currency='QAR'){return new Intl.NumberFormat('en-QA',{style:'currency',currency}).format(minor(value)/100);}
async function invoice(db,tenantId,type,id){
 if(type==='generated'){
  const [[r]]=await db.query(`SELECT d.* FROM sx_invoice_generator_documents d WHERE d.tenant_id=? AND d.id=?
   AND NOT EXISTS(SELECT 1 FROM sx_invoice_generator_document_state x WHERE x.tenant_id=d.tenant_id AND x.document_id=d.id AND x.deleted_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM sx_invoice_generator_replacements x WHERE x.tenant_id=d.tenant_id AND x.prior_invoice_id=d.id)`,[tenantId,id]);
  if(!r)return null;
  const [[link]]=await db.query('SELECT invoice_id FROM sx_training_generated_invoice_links WHERE tenant_id=? AND generated_document_id=?',[tenantId,id]);
  if(link)return invoice(db,tenantId,'training_invoice',link.invoice_id);
  const s=parse(r.snapshot);return {invoiceId:r.id,number:r.invoice_number,customer:s.customer?.name||r.customer_name,phone:s.customer?.phone||'',product:(s.lines||[]).map(l=>l.descriptionEn||l.descriptionAr||r.course_name).join(', ').slice(0,500)||r.course_name,currency:s.currency||'QAR',total:minor(s.totalMinor||r.amount_minor),balance:minor(s.totalMinor||r.amount_minor),paid:0,dueDate:s.installments?.[0]?.dueDate||null,installments:s.installments||[],canonicalId:r.id};
 }
 if(type==='training_invoice'){
  const [[r]]=await db.query(`SELECT i.id,i.invoice_number,i.currency,i.total_minor,e.payer_name,e.learner_name,e.payer_phone,e.status AS enrollment_status,
   (SELECT GROUP_CONCAT(l.description_en ORDER BY l.line_number SEPARATOR ', ') FROM sx_training_invoice_lines l WHERE l.tenant_id=i.tenant_id AND l.invoice_id=i.id) AS product,
   (SELECT MIN(x.due_date) FROM sx_training_installments x WHERE x.tenant_id=i.tenant_id AND x.invoice_id=i.id AND x.status NOT IN ('paid','cancelled','credited','settled')) AS due_date,
   COALESCE((SELECT SUM(a.amount_minor-COALESCE((SELECT SUM(v.amount_minor) FROM sx_training_payment_allocation_reversals v WHERE v.tenant_id=a.tenant_id AND v.allocation_id=a.id),0)) FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id AND p.status='posted' WHERE a.tenant_id=i.tenant_id AND a.invoice_id=i.id),0) AS paid,
   COALESCE((SELECT SUM(c.amount_minor) FROM sx_training_credit_notes c WHERE c.tenant_id=i.tenant_id AND c.invoice_id=i.id AND c.status='posted'),0) AS credited,
   (SELECT l.generated_document_id FROM sx_training_generated_invoice_links l WHERE l.tenant_id=i.tenant_id AND l.invoice_id=i.id LIMIT 1) AS generated_id
   FROM sx_training_invoices i JOIN sx_training_enrollments e ON e.tenant_id=i.tenant_id AND e.id=i.enrollment_id WHERE i.tenant_id=? AND i.id=? AND i.status='issued'`,[tenantId,id]);
  if(!r)return null;const total=minor(r.total_minor),paid=minor(r.paid),credited=minor(r.credited);
  return {invoiceId:r.id,number:r.invoice_number,customer:r.learner_name||r.payer_name,phone:r.payer_phone,product:r.product||'Course / service',currency:r.currency,total,paid,balance:Math.max(0,total-paid-credited),dueDate:date(r.due_date)||null,canonicalId:r.generated_id||r.id,enrollmentStatus:r.enrollment_status};
 }
 if(type==='sales_invoice'){
  const [[r]]=await db.query(`SELECT i.*,COALESCE((SELECT SUM(a.amount_minor) FROM sx_sales_receipt_allocations a JOIN sx_sales_receipts r ON r.tenant_id=a.tenant_id AND r.id=a.receipt_id AND r.status='active' WHERE a.tenant_id=i.tenant_id AND a.invoice_id=i.id AND a.reversed_at IS NULL),0) AS paid FROM sx_sales_invoices i WHERE i.tenant_id=? AND i.id=? AND i.status='issued'`,[tenantId,id]);
  if(!r)return null;const total=minor(r.total_minor),paid=minor(r.paid);return {invoiceId:r.id,number:r.invoice_number,customer:r.customer_name,phone:r.customer_mobile,product:r.description,currency:r.currency,total,paid,balance:Math.max(0,total-paid),dueDate:date(r.due_at)||null,canonicalId:r.id};
 }
 throw Object.assign(Error('INVALID_FINANCE_SOURCE'),{code:'INVALID_FINANCE_SOURCE'});
}
async function load(db,event){
 const t=event.tenant_id,type=event.source_type,id=event.source_id,meta=parse(event.payload_json);let result;
 if(['generated','training_invoice','sales_invoice'].includes(type))result=await invoice(db,t,type,id);
 else if(type==='training_receipt'){
  const [[r]]=await db.query(`SELECT r.invoice_id,r.receipt_number,r.amount_minor,r.received_at FROM sx_training_receipts r JOIN sx_training_payments p ON p.tenant_id=r.tenant_id AND p.id=r.payment_id AND p.status='posted' WHERE r.tenant_id=? AND r.id=?`,[t,id]);
  if(r){result=await invoice(db,t,'training_invoice',r.invoice_id);if(result)Object.assign(result,{receiptNumber:r.receipt_number,received:minor(r.amount_minor),receivedAt:r.received_at});}
 }else if(type==='sales_receipt'){
  const [[r]]=await db.query("SELECT * FROM sx_sales_receipts WHERE tenant_id=? AND id=? AND status='active'",[t,id]);
  if(r)result={number:null,receiptNumber:r.receipt_number,customer:r.payer_name,phone:null,product:'Payment on account',currency:r.currency,received:minor(r.amount_minor),receivedAt:r.received_at,total:null,balance:null};
 }else if(type==='sales_allocation'){
  const [[r]]=await db.query(`SELECT a.invoice_id,a.amount_minor,r.receipt_number,r.received_at FROM sx_sales_receipt_allocations a JOIN sx_sales_receipts r ON r.tenant_id=a.tenant_id AND r.id=a.receipt_id AND r.status='active' WHERE a.tenant_id=? AND a.id=? AND a.reversed_at IS NULL`,[t,id]);
  if(r){result=await invoice(db,t,'sales_invoice',r.invoice_id);if(result)Object.assign(result,{receiptNumber:r.receipt_number,received:minor(r.amount_minor),receivedAt:r.received_at,customerOnly:true});}
 }
 if(!result)return null;
 if(event.kind==='payment_due'){
  if(result.balance<=0)return null;
  if(result.enrollmentStatus==='cancelled')return null;
  if(type==='training_invoice'||type==='generated'){const [[dispute]]=await db.query("SELECT id FROM sx_training_payment_disputes WHERE tenant_id=? AND invoice_id=? AND status='open' LIMIT 1",[t,result.invoiceId]);if(dispute)return null;}
  const due=meta.dueDate;if(!/^\d{4}-\d{2}-\d{2}$/.test(due||''))return null;
  if(type==='generated'&&result.installments)result.amountDue=result.installments.filter(x=>x.dueDate===due).reduce((n,x)=>n+minor(x.amountMinor),0);
  else if(type==='training_invoice'||type==='generated'){
   const [[r]]=await db.query(`SELECT COALESCE(SUM(x.open_minor),0) AS due FROM (${require('./training-finance-dashboard').installmentSql()}) x WHERE x.invoice_id=? AND x.due_date=?`,[t,t,result.invoiceId,due]);result.amountDue=minor(r.due);
  }else result.amountDue=result.dueDate===due?result.balance:0;
  if(!result.amountDue)return null;result.dueDate=due;
 }
 return result;
}
function message(kind,data,{business='7Network',test=false}={}){
 const title={invoice_issued:'Invoice issued',payment_due:'Payment due reminder',payment_received:'Payment received'}[kind];if(!title)throw Error('INVALID_FINANCE_EVENT');
 const lines=[test?'TEST / SAMPLE — no real transaction':business,title,'',`Customer / Lead: ${data.customer||'Customer'}`,`Contact number: ${data.phone||'Not provided'}`,`Course / Product: ${data.product||'Service'}`];
 if(data.number)lines.push(`Invoice: ${data.number}`);if(kind==='payment_received'&&data.receiptNumber)lines.push(`Receipt: ${data.receiptNumber}`);
 if(data.total!==null&&data.total!==undefined)lines.push(`Invoice amount: ${money(data.total,data.currency)}`);
 if(kind==='payment_received')lines.push(`Amount received: ${money(data.received,data.currency)}`,`Received on: ${date(data.receivedAt)}`);
 if(kind==='payment_due')lines.push(`Payment due: ${money(data.amountDue,data.currency)}`);
 if(data.balance!==null&&data.balance!==undefined)lines.push(`Remaining balance: ${money(data.balance,data.currency)}`);
 if(data.dueDate)lines.push(`Due date: ${data.dueDate}`);
 lines.push('',kind==='payment_received'?'Thank you. This payment has been confirmed.':kind==='payment_due'?'Please arrange the due payment. If you have already paid, contact the team.':'The invoice has been issued successfully.');
 return lines.join('\n');
}
module.exports={parse,date,minor,money,invoice,load,message};
