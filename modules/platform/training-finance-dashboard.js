'use strict';
const invoices = require('./training-invoices');
const {inputShape, todayQatar} = require('./training-receivables-report');
const fail = code => { throw Object.assign(Error(code), {code}); };
function filters(raw = {}) {
  const result = inputShape(raw);
  const view = raw.view || 'invoices';
  if (!['invoices','receipts','receivable','overdue'].includes(view)) fail('INVALID_FINANCE_VIEW');
  return {...result, view};
}
// One commercial invoice per row: a generated document stops counting when linked
// to its posted invoice. Archived and replaced documents are excluded.
function portfolioSql() {
  return `SELECT i.id,i.invoice_number,'posted' AS kind,i.issued_at,i.currency,i.total_minor,
    e.learner_name,e.payer_name,e.lead_id,e.id AS enrollment_id,s.application_submission_id,
    COALESCE((SELECT SUM(a.amount_minor-COALESCE((SELECT SUM(r.amount_minor) FROM sx_training_payment_allocation_reversals r WHERE r.tenant_id=a.tenant_id AND r.allocation_id=a.id),0)) FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id AND p.status='posted' WHERE a.tenant_id=i.tenant_id AND a.invoice_id=i.id),0) AS collected_minor,
    COALESCE((SELECT SUM(c.amount_minor) FROM sx_training_credit_notes c WHERE c.tenant_id=i.tenant_id AND c.invoice_id=i.id AND c.status='posted'),0) AS credited_minor,
    NULL AS snapshot
    FROM sx_training_invoices i JOIN sx_training_enrollments e ON e.tenant_id=i.tenant_id AND e.id=i.enrollment_id
    LEFT JOIN sx_training_sale_reviews s ON s.tenant_id=e.tenant_id AND s.id=e.sale_review_id
    WHERE i.tenant_id=? AND i.status='issued'
    UNION ALL
    SELECT d.id,d.invoice_number,'generated',d.created_at,'QAR',d.amount_minor,d.customer_name,d.customer_name,
    CASE WHEN d.customer_type='lead' THEN d.customer_id ELSE NULL END,NULL,NULL,0,0,d.snapshot
    FROM sx_invoice_generator_documents d
    WHERE d.tenant_id=?
    AND NOT EXISTS(SELECT 1 FROM sx_training_generated_invoice_links l WHERE l.tenant_id=d.tenant_id AND l.generated_document_id=d.id)
    AND NOT EXISTS(SELECT 1 FROM sx_invoice_generator_document_state ds WHERE ds.tenant_id=d.tenant_id AND ds.document_id=d.id AND ds.deleted_at IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM sx_invoice_generator_replacements r WHERE r.tenant_id=d.tenant_id AND r.prior_invoice_id=d.id)`;
}
function installmentSql() {
  return `SELECT x.invoice_id,x.due_date,GREATEST(0,x.amount_minor-
    COALESCE((SELECT SUM(a.amount_minor-COALESCE((SELECT SUM(r.amount_minor) FROM sx_training_payment_allocation_reversals r WHERE r.tenant_id=a.tenant_id AND r.allocation_id=a.id),0)) FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id AND p.status='posted' WHERE a.tenant_id=x.tenant_id AND a.installment_id=x.id),0)-
    COALESCE((SELECT SUM(a.amount_minor) FROM sx_training_credit_allocations a JOIN sx_training_credit_notes c ON c.tenant_id=a.tenant_id AND c.id=a.credit_note_id AND c.status='posted' WHERE a.tenant_id=x.tenant_id AND a.installment_id=x.id),0)) AS open_minor
    FROM sx_training_installments x WHERE x.tenant_id=? AND x.status<>'cancelled'
    UNION ALL SELECT d.id,j.due_date,j.amount_minor FROM sx_invoice_generator_documents d
    JOIN JSON_TABLE(d.snapshot,'$.installments[*]' COLUMNS(due_date DATE PATH '$.dueDate',amount_minor BIGINT PATH '$.amountMinor')) j
    WHERE d.tenant_id=?`;
}
async function report(db, ctx, raw = {}) {
  invoices.requireRead(ctx);
  const f = filters(raw), tenantId = ctx.tenant.id, asOf = todayQatar();
  const base = `SELECT v.*,GREATEST(0,v.total_minor-v.collected_minor-v.credited_minor) AS outstanding_minor,
    COALESCE(a.overdue_minor,0) AS overdue_minor,a.oldest_due_date
    FROM (${portfolioSql()}) v LEFT JOIN
    (SELECT invoice_id,SUM(CASE WHEN due_date<? THEN open_minor ELSE 0 END) AS overdue_minor,
    MIN(CASE WHEN open_minor>0 THEN due_date END) AS oldest_due_date FROM (${installmentSql()}) terms GROUP BY invoice_id) a ON a.invoice_id=v.id
    WHERE (?='' OR DATE(v.issued_at + INTERVAL 3 HOUR)>=?) AND (?='' OR DATE(v.issued_at + INTERVAL 3 HOUR)<=?)`;
  const args = [tenantId,tenantId,asOf,tenantId,tenantId,f.from,f.from,f.to,f.to];
  const [[summary]] = await db.query(`SELECT COUNT(*) AS invoice_count,COALESCE(SUM(total_minor),0) AS sales_minor,
    COALESCE(SUM(collected_minor),0) AS collected_minor,COALESCE(SUM(credited_minor),0) AS credited_minor,
    COALESCE(SUM(outstanding_minor),0) AS receivable_minor,SUM(outstanding_minor>0) AS receivable_count,
    COALESCE(SUM(overdue_minor),0) AS overdue_minor,SUM(overdue_minor>0) AS overdue_count,
    SUM(kind='generated') AS unposted_count FROM (${base}) portfolio`, args);
  const receiptBase = `SELECT r.id AS receipt_id,r.receipt_number,r.amount_minor,r.currency,r.received_at,r.method_snapshot AS method,
    i.id,i.invoice_number,'posted' AS kind,e.learner_name,e.payer_name,e.lead_id,e.id AS enrollment_id,s.application_submission_id
    FROM sx_training_receipts r JOIN sx_training_payments p ON p.tenant_id=r.tenant_id AND p.id=r.payment_id AND p.status='posted'
    JOIN sx_training_invoices i ON i.tenant_id=r.tenant_id AND i.id=r.invoice_id
    JOIN sx_training_enrollments e ON e.tenant_id=i.tenant_id AND e.id=i.enrollment_id
    LEFT JOIN sx_training_sale_reviews s ON s.tenant_id=e.tenant_id AND s.id=e.sale_review_id
    WHERE r.tenant_id=? AND (?='' OR DATE(r.received_at + INTERVAL 3 HOUR)>=?) AND (?='' OR DATE(r.received_at + INTERVAL 3 HOUR)<=?)`;
  const receiptArgs = [tenantId,f.from,f.from,f.to,f.to];
  const [[payments]] = await db.query(`SELECT COUNT(*) AS receipt_count,COALESCE(SUM(amount_minor),0) AS received_minor FROM (${receiptBase}) receipts`, receiptArgs);
  const [trend] = await db.query(`SELECT month,SUM(sales_minor) AS sales_minor,SUM(received_minor) AS received_minor FROM (
    SELECT DATE_FORMAT(issued_at + INTERVAL 3 HOUR,'%Y-%m') AS month,SUM(total_minor) AS sales_minor,0 AS received_minor FROM (${base}) v GROUP BY month
    UNION ALL SELECT DATE_FORMAT(received_at + INTERVAL 3 HOUR,'%Y-%m'),0,SUM(amount_minor) FROM (${receiptBase}) r GROUP BY 1
    ) activity GROUP BY month ORDER BY month DESC LIMIT 12`, [...args,...receiptArgs]);
  const [aging] = await db.query(`SELECT CASE WHEN terms.due_date>=? THEN 'current' WHEN DATEDIFF(?,terms.due_date)<=30 THEN '1-30' WHEN DATEDIFF(?,terms.due_date)<=60 THEN '31-60' WHEN DATEDIFF(?,terms.due_date)<=90 THEN '61-90' ELSE '90+' END AS bucket,
    COUNT(DISTINCT v.id) AS invoice_count,SUM(terms.open_minor) AS amount_minor
    FROM (${base}) v JOIN (${installmentSql()}) terms ON terms.invoice_id=v.id WHERE terms.open_minor>0 GROUP BY bucket`, [asOf,asOf,asOf,asOf,...args,tenantId,tenantId]);
  const clauses = [];
  if (f.view==='receivable') clauses.push('outstanding_minor>0');
  if (f.view==='overdue') clauses.push('overdue_minor>0');
  let params = f.view==='receipts' ? receiptArgs : args;
  if(f.bucket!=='all' && f.view!=='receipts') {
    clauses.push(`id IN (SELECT invoice_id FROM (${installmentSql()}) bucket_terms WHERE open_minor>0 AND CASE WHEN due_date>=? THEN 'current' WHEN DATEDIFF(?,due_date)<=30 THEN '1-30' WHEN DATEDIFF(?,due_date)<=60 THEN '31-60' WHEN DATEDIFF(?,due_date)<=90 THEN '61-90' ELSE '90+' END=?)`);
    params=[...params,tenantId,tenantId,asOf,asOf,asOf,asOf,f.bucket];
  }
  if (f.q) {
    clauses.push('(invoice_number LIKE ? OR learner_name LIKE ? OR payer_name LIKE ?)');
    const term = `%${f.q.replace(/[\\%_]/g,'\\$&')}%`;
    params = [...params,term,term,term];
  }
  const source = f.view==='receipts' ? receiptBase : base, where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const [[count]] = await db.query(`SELECT COUNT(*) AS total FROM (${source}) detail${where}`,params);
  const [items] = await db.query(`SELECT * FROM (${source}) detail${where} ORDER BY ${f.view==='receipts'?'received_at':'issued_at'} DESC,id LIMIT ? OFFSET ?`,[...params,f.limit,(f.page-1)*f.limit]);
  const numbers = row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key,/_minor$|_count$/.test(key) ? Number(value||0) : value]));
  return {asOf,from:f.from,to:f.to,view:f.view,page:f.page,limit:f.limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/f.limit),summary:numbers({...summary,...payments}),trend:trend.reverse().map(numbers),aging:aging.map(numbers),items:items.map(({snapshot,...row})=>numbers(row))};
}
module.exports = {filters,portfolioSql,installmentSql,report};
