'use strict';
const invoices=require('./training-invoices');
const fail=code=>{const error=Error(code);error.code=code;throw error;};
const buckets=new Set(['all','current','1-30','31-60','61-90','90+']);
function inputShape(input={}){
  const page=input.page===undefined?1:Number(input.page),limit=input.limit===undefined?25:Number(input.limit),bucket=input.bucket===undefined?'all':input.bucket,q=input.q===undefined?'':input.q;
  if(!Number.isSafeInteger(page)||page<1||page>10000||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_RECEIVABLE_PAGE');
  if(!buckets.has(bucket))fail('INVALID_RECEIVABLE_BUCKET');if(typeof q!=='string'||q.length>80)fail('INVALID_RECEIVABLE_SEARCH');
  return {page,limit,bucket,q:q.trim()};
}
function todayQatar(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}`;}
function baseSql(){
  return `SELECT i.id AS invoice_id,i.invoice_number,i.issued_at,i.currency,e.learner_name,e.payer_name,l.description_en AS course_name_en,l.description_ar AS course_name_ar,x.id AS installment_id,x.sequence_number,x.due_date,x.amount_minor,
    GREATEST(x.amount_minor-COALESCE((SELECT SUM(a.amount_minor-COALESCE((SELECT SUM(ar.amount_minor) FROM sx_training_payment_allocation_reversals ar WHERE ar.tenant_id=a.tenant_id AND ar.allocation_id=a.id),0)) FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id WHERE a.tenant_id=x.tenant_id AND a.installment_id=x.id AND p.status='posted'),0)-COALESCE((SELECT SUM(ca.amount_minor) FROM sx_training_credit_allocations ca JOIN sx_training_credit_notes cn ON cn.tenant_id=ca.tenant_id AND cn.id=ca.credit_note_id WHERE ca.tenant_id=x.tenant_id AND ca.installment_id=x.id AND cn.status='posted'),0),0) AS open_minor,
    DATEDIFF(?,x.due_date) AS age_days,
    CASE WHEN x.due_date>=? THEN 'current' WHEN DATEDIFF(?,x.due_date)<=30 THEN '1-30' WHEN DATEDIFF(?,x.due_date)<=60 THEN '31-60' WHEN DATEDIFF(?,x.due_date)<=90 THEN '61-90' ELSE '90+' END AS bucket
    FROM sx_training_installments x JOIN sx_training_invoices i ON i.tenant_id=x.tenant_id AND i.id=x.invoice_id JOIN sx_training_enrollments e ON e.tenant_id=i.tenant_id AND e.id=i.enrollment_id LEFT JOIN sx_training_invoice_lines l ON l.tenant_id=i.tenant_id AND l.invoice_id=i.id AND l.line_number=1
    WHERE x.tenant_id=? AND i.status='issued' AND x.status<>'cancelled'`;
}
async function list(db,ctx,raw={}){
  invoices.requireRead(ctx);const {page,limit,bucket,q}=inputShape(raw),today=todayQatar(),tenantId=ctx.tenant.id,base=baseSql(),dateParams=[today,today,today,today,today,tenantId];
  const [[totals]]=await db.query(`SELECT COUNT(DISTINCT invoice_id) AS invoice_count,COUNT(DISTINCT installment_id) AS installment_count,COALESCE(SUM(open_minor),0) AS outstanding_minor,COALESCE(SUM(CASE WHEN bucket='current' THEN open_minor ELSE 0 END),0) AS current_minor,COALESCE(SUM(CASE WHEN bucket<>'current' THEN open_minor ELSE 0 END),0) AS overdue_minor,COUNT(DISTINCT CASE WHEN bucket<>'current' AND open_minor>0 THEN invoice_id END) AS overdue_invoice_count FROM (${base}) receivables WHERE open_minor>0`,dateParams);
  const [aging]=await db.query(`SELECT bucket,COUNT(DISTINCT invoice_id) AS invoice_count,COUNT(*) AS installment_count,COALESCE(SUM(open_minor),0) AS outstanding_minor FROM (${base}) receivables WHERE open_minor>0 GROUP BY bucket`,dateParams);
  const [[pending]]=await db.query("SELECT COUNT(*) AS count,COALESCE(SUM(amount_minor),0) AS amount_minor FROM sx_training_payments WHERE tenant_id=? AND status='pending_verification'",[tenantId]);
  const clauses=['open_minor>0'],params=[...dateParams];if(bucket!=='all'){clauses.push('bucket=?');params.push(bucket);}if(q){const term=`%${q.replace(/[\\%_]/g,'\\$&')}%`;clauses.push('(invoice_number LIKE ? OR learner_name LIKE ? OR payer_name LIKE ? OR course_name_en LIKE ? OR course_name_ar LIKE ?)');params.push(term,term,term,term,term);}
  const where=clauses.join(' AND '),offset=(page-1)*limit,[[count]]=await db.query(`SELECT COUNT(*) AS total FROM (${base}) receivables WHERE ${where}`,params);
  const [rows]=await db.query(`SELECT * FROM (${base}) receivables WHERE ${where} ORDER BY age_days DESC,due_date,invoice_number,sequence_number LIMIT ? OFFSET ?`,[...params,limit,offset]);
  const mapAmount=value=>Number(value||0);return {asOf:today,page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit),summary:{invoiceCount:mapAmount(totals.invoice_count),installmentCount:mapAmount(totals.installment_count),outstandingMinor:mapAmount(totals.outstanding_minor),currentMinor:mapAmount(totals.current_minor),overdueMinor:mapAmount(totals.overdue_minor),overdueInvoiceCount:mapAmount(totals.overdue_invoice_count),pendingVerificationCount:mapAmount(pending.count),pendingVerificationMinor:mapAmount(pending.amount_minor)},aging:Object.fromEntries(['current','1-30','31-60','61-90','90+'].map(key=>{const row=aging.find(item=>item.bucket===key);return [key,{invoiceCount:mapAmount(row?.invoice_count),installmentCount:mapAmount(row?.installment_count),outstandingMinor:mapAmount(row?.outstanding_minor)}];})),items:rows.map(row=>({invoiceId:row.invoice_id,invoiceNumber:row.invoice_number,issuedAt:row.issued_at,currency:row.currency,learnerName:row.learner_name,payerName:row.payer_name,courseNameEn:row.course_name_en,courseNameAr:row.course_name_ar,installmentId:row.installment_id,sequence:Number(row.sequence_number),dueDate:row.due_date,amountMinor:mapAmount(row.amount_minor),outstandingMinor:mapAmount(row.open_minor),daysOverdue:Math.max(0,Number(row.age_days)),bucket:row.bucket}))};
}
module.exports={inputShape,todayQatar,list};
