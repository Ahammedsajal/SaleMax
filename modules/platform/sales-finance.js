'use strict';
const crypto=require('node:crypto');
const {decision}=require('./policy');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const methods=new Set(['cash','bank_transfer','card','cheque','other']);
function assertContext(ctx,permission='sales.finance.read'){
  if(ctx?.audience!=='tenant'||!ctx.category?.capabilities?.includes('sales.finance'))fail('CATEGORY_UNAVAILABLE');
  const access=decision(ctx,{capability:'sales.finance',permission});if(!access.allowed)fail(access.code);
  if(!ctx.identity?.id||!ctx.membership?.id)fail('PERMISSION_DENIED');
}
function parseAmount(value){if((typeof value!=='string'&&typeof value!=='number')||!/^[1-9]\d{0,14}$/.test(String(value)))fail('INVALID_FINANCE_AMOUNT');return String(value);}
function optional(value,max,code='INVALID_FINANCE_INPUT'){if(value===undefined||value===null||value==='')return null;if(typeof value!=='string'||value.trim().length>max)fail(code);return value.trim();}
function dateValue(value,{optional:allowEmpty=false}={}){if((value===undefined||value===null||value==='')&&allowEmpty)return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('INVALID_FINANCE_DATE');return value;}
function storedDateTimeMillis(value){
  // MySQL DATETIME has no timezone. mysql2 materializes it as a Date using
  // the client timezone, so compare its wall-clock fields as UTC to the
  // normalized UTC instant that was stored.
  if(value instanceof Date)return Date.UTC(value.getFullYear(),value.getMonth(),value.getDate(),value.getHours(),value.getMinutes(),value.getSeconds(),value.getMilliseconds());
  if(typeof value==='string')return Date.parse(value.trim().replace(' ','T').replace(/(?:Z|[+-]\d{2}:?\d{2})$/,'')+'Z');
  return NaN;
}
async function audit(db,ctx,action,type,id,reason,changes){await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,reason,changes,correlation_id)
  VALUES (?,?,?,'identity',?,?,?,?,?,?)`,[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,action,type,id,reason||null,JSON.stringify(changes||{}),crypto.randomUUID()]);}
async function issueInvoice(db,ctx,dealId,input={}){
  assertContext(ctx,'sales.invoice.issue');if(!uuid(dealId))fail('INVALID_SALES_DEAL_ID');const dueAt=dateValue(input.dueAt,{optional:true});
  await db.beginTransaction();try{
    const [[tenant]]=await db.query('SELECT id FROM sx_tenants WHERE id=? AND status=\'active\' FOR UPDATE',[ctx.tenant.id]);if(!tenant)fail('CATEGORY_UNAVAILABLE');
    const [[existing]]=await db.query('SELECT id,invoice_number AS invoiceNumber FROM sx_sales_invoices WHERE tenant_id=? AND deal_id=? FOR UPDATE',[ctx.tenant.id,dealId]);
    if(existing){await db.commit();return {...existing,repeated:true};}
    const [[deal]]=await db.query(`SELECT d.id,d.status,d.amount_minor AS amountMinor,d.currency,d.product_name_snapshot AS description,d.lead_uid_hash AS leadUidHash,d.lead_id AS leadId,
        l.contact_name AS customerName,l.mobile AS customerMobile,l.title AS leadTitle
      FROM sx_sales_deals d JOIN pipeline_leads l ON l.uid_hash=d.lead_uid_hash AND l.id=d.lead_id
      WHERE d.tenant_id=? AND d.id=? FOR UPDATE`,[ctx.tenant.id,dealId]);
    if(!deal)fail('SALES_DEAL_NOT_FOUND');if(deal.status!=='approved')fail('SALES_DEAL_NOT_APPROVED');
    const year=new Date().getUTCFullYear();const [[sequence]]=await db.query('SELECT last_number AS lastNumber FROM sx_sales_invoice_sequences WHERE tenant_id=? AND invoice_year=? FOR UPDATE',[ctx.tenant.id,year]);
    const next=Number(sequence?.lastNumber||0)+1;
    if(sequence)await db.query('UPDATE sx_sales_invoice_sequences SET last_number=? WHERE tenant_id=? AND invoice_year=?',[next,ctx.tenant.id,year]);
    else await db.query('INSERT INTO sx_sales_invoice_sequences(tenant_id,invoice_year,last_number) VALUES(?,?,?)',[ctx.tenant.id,year,next]);
    const invoiceNumber=`SMX-${year}-${String(next).padStart(6,'0')}`,id=crypto.randomUUID(),customerName=String(deal.customerName||deal.leadTitle||'Customer').trim();
    await db.query(`INSERT INTO sx_sales_invoices(id,tenant_id,deal_id,invoice_number,customer_name,customer_mobile,description,total_minor,currency,due_at,status,created_by_identity_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,'issued',?)`,[id,ctx.tenant.id,dealId,invoiceNumber,customerName,deal.customerMobile,deal.description,deal.amountMinor,deal.currency,dueAt,ctx.identity.id]);
    await audit(db,ctx,'sales.invoice.issued','sales_invoice',id,null,{dealId,invoiceNumber,totalMinor:String(deal.amountMinor),currency:deal.currency,dueAt});
    await require('./business-notifications').enqueue(db,ctx.tenant.id,{kind:'invoice_issued',sourceType:'sales_invoice',sourceId:id,key:`invoice:${id}`});
    await db.commit();return {id,dealId,invoiceNumber,customerName,customerMobile:deal.customerMobile,description:deal.description,totalMinor:String(deal.amountMinor),currency:deal.currency,dueAt,status:'issued',repeated:false};
  }catch(error){await db.rollback();throw error;}
}
async function nextDocumentNumber(db,ctx,kind){
  const year=new Date().getUTCFullYear(),table=kind==='receipt'?'sx_sales_receipt_sequences':'sx_sales_invoice_sequences';
  const [[sequence]]=await db.query(`SELECT last_number AS lastNumber FROM ${table} WHERE tenant_id=? AND invoice_year=? FOR UPDATE`,[ctx.tenant.id,year]);
  const next=Number(sequence?.lastNumber||0)+1;
  if(sequence)await db.query(`UPDATE ${table} SET last_number=? WHERE tenant_id=? AND invoice_year=?`,[next,ctx.tenant.id,year]);
  else await db.query(`INSERT INTO ${table}(tenant_id,invoice_year,last_number) VALUES(?,?,?)`,[ctx.tenant.id,year,next]);
  return `${kind==='receipt'?'RCP':'SMX'}-${year}-${String(next).padStart(6,'0')}`;
}
async function createInvoice(db,ctx,input={}){
  assertContext(ctx,'sales.invoice.issue');
  if(!uuid(input.idempotencyKey))fail('INVALID_FINANCE_INPUT');
  const data={customerName:optional(input.customerName,255),customerMobile:optional(input.customerMobile,64),description:optional(input.description,500),totalMinor:parseAmount(input.totalMinor),currency:String(input.currency||'').trim().toUpperCase(),dueAt:dateValue(input.dueAt,{optional:true})};
  if(!data.customerName||!data.description)fail('INVALID_FINANCE_INPUT');
  if(!/^[A-Z]{3}$/.test(data.currency))fail('INVALID_FINANCE_CURRENCY');
  const payloadHash=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  await db.beginTransaction();try{
    const [[tenant]]=await db.query("SELECT id FROM sx_tenants WHERE id=? AND status='active' FOR UPDATE",[ctx.tenant.id]);if(!tenant)fail('CATEGORY_UNAVAILABLE');
    const [[prior]]=await db.query('SELECT id,invoice_number AS invoiceNumber,payload_hash AS payloadHash FROM sx_sales_invoices WHERE tenant_id=? AND idempotency_key=? FOR UPDATE',[ctx.tenant.id,input.idempotencyKey]);
    if(prior){if(prior.payloadHash!==payloadHash)fail('IDEMPOTENCY_CONFLICT');await db.commit();return {id:prior.id,invoiceNumber:prior.invoiceNumber,repeated:true};}
    const id=crypto.randomUUID(),invoiceNumber=await nextDocumentNumber(db,ctx,'invoice');
    await db.query("INSERT INTO sx_sales_invoices(id,tenant_id,deal_id,idempotency_key,payload_hash,invoice_number,customer_name,customer_mobile,description,total_minor,currency,due_at,status,created_by_identity_id) VALUES(?,?,NULL,?,?,?,?,?,?,?,?,?,'issued',?)",[id,ctx.tenant.id,input.idempotencyKey,payloadHash,invoiceNumber,data.customerName,data.customerMobile,data.description,data.totalMinor,data.currency,data.dueAt,ctx.identity.id]);
    await audit(db,ctx,'sales.invoice.issued','sales_invoice',id,null,{...data,invoiceNumber,source:'direct',dealId:null});
    await require('./business-notifications').enqueue(db,ctx.tenant.id,{kind:'invoice_issued',sourceType:'sales_invoice',sourceId:id,key:`invoice:${id}`});
    await db.commit();return {id,invoiceNumber,...data,status:'issued',repeated:false};
  }catch(error){await db.rollback();throw error;}
}
async function document(db,ctx,kind,id){
  assertContext(ctx,'sales.finance.read');if(!uuid(id)||!['invoice','receipt'].includes(kind))fail('INVALID_FINANCE_INPUT');
  const table=kind==='invoice'?'sx_sales_invoices':'sx_sales_receipts';
  const [[row]]=await db.query(`SELECT * FROM ${table} WHERE tenant_id=? AND id=?`,[ctx.tenant.id,id]);
  if(!row)fail(kind==='invoice'?'SALES_INVOICE_NOT_FOUND':'SALES_RECEIPT_NOT_FOUND');
  return {kind,businessName:ctx.tenant.name||'',number:kind==='invoice'?row.invoice_number:row.receipt_number||'RCP-'+row.id.toUpperCase(),customerName:kind==='invoice'?row.customer_name:row.payer_name,customerMobile:row.customer_mobile||null,description:kind==='invoice'?row.description:row.note,amountMinor:String(kind==='invoice'?row.total_minor:row.amount_minor),currency:row.currency,date:kind==='invoice'?row.issued_at:row.received_at,dueAt:row.due_at||null,paymentMethod:row.payment_method||null,reference:row.external_reference||null,status:row.status};
}
async function recordReceipt(db,ctx,input){
  assertContext(ctx,'sales.receipt.record');
  if(!uuid(input?.idempotencyKey)||!methods.has(input?.paymentMethod))fail('INVALID_FINANCE_INPUT');
  const amount=parseAmount(input.amountMinor),currency=String(input.currency||'').trim().toUpperCase();if(!/^[A-Z]{3}$/.test(currency))fail('INVALID_FINANCE_CURRENCY');
  const receivedAt=input.receivedAt;if(typeof receivedAt!=='string'||Number.isNaN(Date.parse(receivedAt))||!/Z$|[+-]\d{2}:?\d{2}$/.test(receivedAt))fail('INVALID_FINANCE_DATE');
  const externalReference=optional(input.externalReference,191),payerName=optional(input.payerName,255),note=optional(input.note,1000);const receivedDate=new Date(receivedAt);
  if(receivedDate.getTime()>Date.now()+86400000)fail('FINANCE_RECEIPT_FUTURE_DATE');
  await db.beginTransaction();try{
    const [[tenant]]=await db.query('SELECT id FROM sx_tenants WHERE id=? AND status=\'active\' FOR UPDATE',[ctx.tenant.id]);if(!tenant)fail('CATEGORY_UNAVAILABLE');
    const [[repeat]]=await db.query(`SELECT id,receipt_number AS receiptNumber,amount_minor AS amountMinor,currency,payment_method AS paymentMethod,external_reference AS externalReference,payer_name AS payerName,received_at AS receivedAt,note,status FROM sx_sales_receipts WHERE tenant_id=? AND idempotency_key=? FOR UPDATE`,[ctx.tenant.id,input.idempotencyKey]);
    if(repeat){if(String(repeat.amountMinor)!==amount||repeat.currency!==currency||repeat.paymentMethod!==input.paymentMethod||repeat.externalReference!==externalReference||repeat.payerName!==payerName||storedDateTimeMillis(repeat.receivedAt)!==receivedDate.getTime()||repeat.note!==note)fail('IDEMPOTENCY_CONFLICT');await db.commit();return {...repeat,repeated:true};}
    const id=crypto.randomUUID(),receiptNumber=await nextDocumentNumber(db,ctx,'receipt');await db.query(`INSERT INTO sx_sales_receipts(id,tenant_id,idempotency_key,receipt_number,external_reference,payment_method,payer_name,amount_minor,currency,received_at,note,recorded_by_identity_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[id,ctx.tenant.id,input.idempotencyKey,receiptNumber,externalReference,input.paymentMethod,payerName,amount,currency,receivedDate.toISOString().slice(0,23).replace('T',' '),note,ctx.identity.id]);
    await audit(db,ctx,'sales.receipt.recorded','sales_receipt',id,null,{externalReference,paymentMethod:input.paymentMethod,amountMinor:amount,currency,receivedAt:receivedDate.toISOString()});
    await require('./business-notifications').enqueue(db,ctx.tenant.id,{kind:'payment_received',sourceType:'sales_receipt',sourceId:id,key:`receipt:${id}`});
    await db.commit();return {id,receiptNumber,amountMinor:amount,currency,paymentMethod:input.paymentMethod,status:'unmatched',repeated:false};
  }catch(error){await db.rollback();throw error;}
}
async function allocateReceipt(db,ctx,input){
  assertContext(ctx,'sales.receipt.allocate');
  if(!uuid(input?.receiptId)||!uuid(input?.invoiceId)||!uuid(input?.idempotencyKey))fail('INVALID_FINANCE_INPUT');const amount=parseAmount(input.amountMinor);
  await db.beginTransaction();try{
    const [[tenant]]=await db.query('SELECT id FROM sx_tenants WHERE id=? AND status=\'active\' FOR UPDATE',[ctx.tenant.id]);if(!tenant)fail('CATEGORY_UNAVAILABLE');
    const [[repeat]]=await db.query(`SELECT id,receipt_id AS receiptId,invoice_id AS invoiceId,amount_minor AS amountMinor FROM sx_sales_receipt_allocations WHERE tenant_id=? AND idempotency_key=? FOR UPDATE`,[ctx.tenant.id,input.idempotencyKey]);
    if(repeat){if(repeat.receiptId!==input.receiptId||repeat.invoiceId!==input.invoiceId||String(repeat.amountMinor)!==amount)fail('IDEMPOTENCY_CONFLICT');await db.commit();return {...repeat,repeated:true};}
    const [[receipt]]=await db.query(`SELECT id,amount_minor AS amountMinor,currency,status FROM sx_sales_receipts WHERE tenant_id=? AND id=? FOR UPDATE`,[ctx.tenant.id,input.receiptId]);if(!receipt)fail('SALES_RECEIPT_NOT_FOUND');if(receipt.status!=='active')fail('SALES_RECEIPT_VOID');
    const [[invoice]]=await db.query(`SELECT id,total_minor AS totalMinor,currency,status FROM sx_sales_invoices WHERE tenant_id=? AND id=? FOR UPDATE`,[ctx.tenant.id,input.invoiceId]);if(!invoice)fail('SALES_INVOICE_NOT_FOUND');if(invoice.status!=='issued')fail('SALES_INVOICE_VOID');if(invoice.currency!==receipt.currency)fail('FINANCE_CURRENCY_MISMATCH');
    const [[receiptAllocated]]=await db.query(`SELECT COALESCE(SUM(CAST(amount_minor AS DECIMAL(65,0))),0) AS allocated FROM sx_sales_receipt_allocations WHERE tenant_id=? AND receipt_id=? AND reversed_at IS NULL`,[ctx.tenant.id,receipt.id]);
    const [[invoiceAllocated]]=await db.query(`SELECT COALESCE(SUM(CAST(amount_minor AS DECIMAL(65,0))),0) AS allocated FROM sx_sales_receipt_allocations WHERE tenant_id=? AND invoice_id=? AND reversed_at IS NULL`,[ctx.tenant.id,invoice.id]);
    const value=BigInt(amount),receiptRemaining=BigInt(receipt.amountMinor)-BigInt(receiptAllocated.allocated),invoiceRemaining=BigInt(invoice.totalMinor)-BigInt(invoiceAllocated.allocated);
    if(value>receiptRemaining)fail('RECEIPT_OVERALLOCATED');if(value>invoiceRemaining)fail('INVOICE_OVERPAID');
    const id=crypto.randomUUID();await db.query(`INSERT INTO sx_sales_receipt_allocations(id,tenant_id,receipt_id,invoice_id,idempotency_key,amount_minor,allocated_by_identity_id) VALUES(?,?,?,?,?,?,?)`,[id,ctx.tenant.id,receipt.id,invoice.id,input.idempotencyKey,amount,ctx.identity.id]);
    await audit(db,ctx,'sales.receipt.allocated','sales_receipt_allocation',id,null,{receiptId:receipt.id,invoiceId:invoice.id,amountMinor:amount,currency:receipt.currency});
    await require('./business-notifications').enqueue(db,ctx.tenant.id,{kind:'payment_received',sourceType:'sales_allocation',sourceId:id,key:`receipt-allocation:${id}`});
    await db.commit();return {id,receiptId:receipt.id,invoiceId:invoice.id,amountMinor:amount,currency:receipt.currency,repeated:false};
  }catch(error){await db.rollback();throw error;}
}
async function reverseAllocation(db,ctx,id,input){
  assertContext(ctx,'sales.receipt.allocate');if(!uuid(id))fail('INVALID_FINANCE_ALLOCATION_ID');const reason=optional(input?.reason,1000);if(!reason||reason.length<3)fail('FINANCE_REVERSAL_REASON_REQUIRED');
  await db.beginTransaction();try{const [[tenant]]=await db.query('SELECT id FROM sx_tenants WHERE id=? AND status=\'active\' FOR UPDATE',[ctx.tenant.id]);if(!tenant)fail('CATEGORY_UNAVAILABLE');
    const [[allocation]]=await db.query(`SELECT id,reversed_at AS reversedAt,receipt_id AS receiptId,invoice_id AS invoiceId,amount_minor AS amountMinor FROM sx_sales_receipt_allocations WHERE tenant_id=? AND id=? FOR UPDATE`,[ctx.tenant.id,id]);if(!allocation)fail('SALES_ALLOCATION_NOT_FOUND');if(allocation.reversedAt)fail('SALES_ALLOCATION_ALREADY_REVERSED');
    await db.query(`UPDATE sx_sales_receipt_allocations SET reversed_by_identity_id=?,reversed_at=UTC_TIMESTAMP(3),reversal_reason=? WHERE tenant_id=? AND id=? AND reversed_at IS NULL`,[ctx.identity.id,reason,ctx.tenant.id,id]);
    await audit(db,ctx,'sales.receipt_allocation.reversed','sales_receipt_allocation',id,reason,{receiptId:allocation.receiptId,invoiceId:allocation.invoiceId,amountMinor:String(allocation.amountMinor)});await db.commit();return {id,status:'reversed'};
  }catch(error){await db.rollback();throw error;}
}
function filters(input){const status=input.status||'all';if(!['all','outstanding','paid','overdue','void'].includes(status))fail('INVALID_FINANCE_FILTER');return status;}
async function listInvoices(db,ctx,{status='all',query='',limit=50}={}){
  assertContext(ctx,'sales.finance.read');status=filters({status});limit=Math.max(1,Math.min(100,Number(limit)||50));const search=String(query||'').trim().slice(0,100),where=['i.tenant_id=?'],args=[ctx.tenant.id];
  if(status==='void')where.push("i.status='void'");else if(status==='paid')where.push("i.status='issued' AND COALESCE(paid.allocated,0)>=i.total_minor");else if(status==='outstanding')where.push("i.status='issued' AND COALESCE(paid.allocated,0)<i.total_minor");else if(status==='overdue')where.push("i.status='issued' AND COALESCE(paid.allocated,0)<i.total_minor AND i.due_at<CURRENT_DATE");
  if(search){where.push('(i.invoice_number LIKE ? OR i.customer_name LIKE ? OR i.customer_mobile LIKE ?)');for(let i=0;i<3;i++)args.push(`%${search}%`);}
  args.push(limit);
  const [items]=await db.query(`SELECT i.id,i.deal_id AS dealId,i.invoice_number AS invoiceNumber,i.customer_name AS customerName,i.customer_mobile AS customerMobile,i.description,
      i.total_minor AS totalMinor,i.currency,i.due_at AS dueAt,i.status,i.issued_at AS issuedAt,COALESCE(paid.allocated,0) AS collectedMinor,
      GREATEST(CAST(i.total_minor AS DECIMAL(65,0))-COALESCE(paid.allocated,0),0) AS outstandingMinor,
      CASE WHEN i.status='void' THEN 'void' WHEN COALESCE(paid.allocated,0)>=i.total_minor THEN 'paid' WHEN i.due_at<CURRENT_DATE THEN 'overdue' WHEN COALESCE(paid.allocated,0)>0 THEN 'partially_paid' ELSE 'outstanding' END AS collectionStatus
    FROM sx_sales_invoices i LEFT JOIN (SELECT tenant_id,invoice_id,SUM(CAST(amount_minor AS DECIMAL(65,0))) AS allocated FROM sx_sales_receipt_allocations WHERE tenant_id=? AND reversed_at IS NULL GROUP BY tenant_id,invoice_id) paid ON paid.tenant_id=i.tenant_id AND paid.invoice_id=i.id
    WHERE ${where.join(' AND ')} ORDER BY (i.status='issued') DESC,i.due_at,i.issued_at DESC LIMIT ?`,[ctx.tenant.id,...args]);
  return {items,canIssue:decision(ctx,{capability:'sales.finance',permission:'sales.invoice.issue'}).allowed};
}
async function unbilledSales(db,ctx,{limit=100}={}){
  assertContext(ctx,'sales.invoice.issue');limit=Math.max(1,Math.min(200,Number(limit)||100));
  const [items]=await db.query(`SELECT d.id AS dealId,d.product_name_snapshot AS description,d.amount_minor AS amountMinor,d.currency,d.decided_at AS approvedAt,
      COALESCE(l.contact_name,l.title,'Customer') AS customerName,l.mobile AS customerMobile
    FROM sx_sales_deals d JOIN pipeline_leads l ON l.uid_hash=d.lead_uid_hash AND l.id=d.lead_id
    LEFT JOIN sx_sales_invoices i ON i.tenant_id=d.tenant_id AND i.deal_id=d.id
    WHERE d.tenant_id=? AND d.status='approved' AND i.id IS NULL ORDER BY d.decided_at,d.id LIMIT ?`,[ctx.tenant.id,limit]);
  return {items};
}
async function listReceipts(db,ctx,{status='all',limit=100}={}){
  assertContext(ctx,'sales.finance.read');if(!['all','unmatched','partially_matched','matched','void'].includes(status))fail('INVALID_FINANCE_FILTER');limit=Math.max(1,Math.min(200,Number(limit)||100));
  const filter=status==='void'?" AND r.status='void'":status==='unmatched'?" AND r.status='active' AND COALESCE(a.allocated,0)=0":status==='partially_matched'?" AND r.status='active' AND COALESCE(a.allocated,0)>0 AND COALESCE(a.allocated,0)<r.amount_minor":status==='matched'?" AND r.status='active' AND COALESCE(a.allocated,0)>=r.amount_minor":status==='all'?'':" AND r.status='active'";
  const [items]=await db.query(`SELECT r.id,r.receipt_number AS receiptNumber,r.external_reference AS externalReference,r.payment_method AS paymentMethod,r.payer_name AS payerName,r.amount_minor AS amountMinor,r.currency,r.received_at AS receivedAt,r.note,r.status,
      COALESCE(a.allocated,0) AS allocatedMinor,GREATEST(CAST(r.amount_minor AS DECIMAL(65,0))-COALESCE(a.allocated,0),0) AS unmatchedMinor,
      CASE WHEN r.status='void' THEN 'void' WHEN COALESCE(a.allocated,0)=0 THEN 'unmatched' WHEN COALESCE(a.allocated,0)>=r.amount_minor THEN 'matched' ELSE 'partially_matched' END AS reconciliationStatus
    FROM sx_sales_receipts r LEFT JOIN (SELECT tenant_id,receipt_id,SUM(CAST(amount_minor AS DECIMAL(65,0))) AS allocated FROM sx_sales_receipt_allocations WHERE tenant_id=? AND reversed_at IS NULL GROUP BY tenant_id,receipt_id) a ON a.tenant_id=r.tenant_id AND a.receipt_id=r.id
    WHERE r.tenant_id=?${filter} ORDER BY r.received_at DESC,r.id DESC LIMIT ?`,[ctx.tenant.id,ctx.tenant.id,limit]);
  return {items};
}
async function listAllocations(db,ctx,receiptId){
  assertContext(ctx,'sales.receipt.allocate');if(!uuid(receiptId))fail('INVALID_FINANCE_INPUT');
  const [items]=await db.query(`SELECT a.id,a.receipt_id AS receiptId,a.invoice_id AS invoiceId,a.amount_minor AS amountMinor,a.allocated_at AS allocatedAt,a.reversed_at AS reversedAt,a.reversal_reason AS reversalReason,i.invoice_number AS invoiceNumber,i.customer_name AS customerName,i.currency
    FROM sx_sales_receipt_allocations a JOIN sx_sales_invoices i ON i.tenant_id=a.tenant_id AND i.id=a.invoice_id
    WHERE a.tenant_id=? AND a.receipt_id=? ORDER BY a.allocated_at,a.id`,[ctx.tenant.id,receiptId]);
  return {items};
}
async function overview(db,ctx){
  assertContext(ctx,'sales.finance.read');
  const [invoiceRows]=await db.query(`SELECT i.currency,COUNT(*) AS invoiceCount,COALESCE(SUM(i.total_minor),0) AS billedMinor,
      COALESCE(SUM(LEAST(i.total_minor,COALESCE(paid.allocated,0))),0) AS collectedMinor,
      COALESCE(SUM(GREATEST(CAST(i.total_minor AS DECIMAL(65,0))-COALESCE(paid.allocated,0),0)),0) AS outstandingMinor,
      COALESCE(SUM(CASE WHEN i.due_at<CURRENT_DATE THEN GREATEST(CAST(i.total_minor AS DECIMAL(65,0))-COALESCE(paid.allocated,0),0) ELSE 0 END),0) AS overdueMinor,
      SUM(CASE WHEN i.due_at<CURRENT_DATE AND GREATEST(CAST(i.total_minor AS DECIMAL(65,0))-COALESCE(paid.allocated,0),0)>0 THEN 1 ELSE 0 END) AS overdueInvoiceCount
    FROM sx_sales_invoices i LEFT JOIN (SELECT tenant_id,invoice_id,SUM(CAST(amount_minor AS DECIMAL(65,0))) AS allocated FROM sx_sales_receipt_allocations WHERE tenant_id=? AND reversed_at IS NULL GROUP BY tenant_id,invoice_id) paid ON paid.tenant_id=i.tenant_id AND paid.invoice_id=i.id
    WHERE i.tenant_id=? AND i.status='issued' GROUP BY i.currency ORDER BY i.currency`,[ctx.tenant.id,ctx.tenant.id]);
  const [receiptRows]=await db.query(`SELECT r.currency,COUNT(*) AS receiptCount,COALESCE(SUM(r.amount_minor),0) AS receivedMinor,
      COALESCE(SUM(GREATEST(CAST(r.amount_minor AS DECIMAL(65,0))-COALESCE(a.allocated,0),0)),0) AS unmatchedMinor,
      SUM(CASE WHEN COALESCE(a.allocated,0)=0 THEN 1 ELSE 0 END) AS unmatchedCount
    FROM sx_sales_receipts r LEFT JOIN (SELECT tenant_id,receipt_id,SUM(CAST(amount_minor AS DECIMAL(65,0))) AS allocated FROM sx_sales_receipt_allocations WHERE tenant_id=? AND reversed_at IS NULL GROUP BY tenant_id,receipt_id) a ON a.tenant_id=r.tenant_id AND a.receipt_id=r.id
    WHERE r.tenant_id=? AND r.status='active' GROUP BY r.currency ORDER BY r.currency`,[ctx.tenant.id,ctx.tenant.id]);
  return {role:ctx.membership.role,permissions:Object.fromEntries(['sales.invoice.issue','sales.receipt.record','sales.receipt.allocate','sales.finance.report'].map(permission=>[permission,decision(ctx,{capability:'sales.finance',permission}).allowed])),invoicesByCurrency:invoiceRows,receiptsByCurrency:receiptRows};
}
async function report(db,ctx,{from,to}={}){
  assertContext(ctx,'sales.finance.report');from=dateValue(from);to=dateValue(to);if(from>to)fail('INVALID_FINANCE_DATE');
  const [rows]=await db.query(`SELECT currency,DATE_FORMAT(issued_at,'%Y-%m') AS month,COUNT(*) AS invoiceCount,COALESCE(SUM(total_minor),0) AS billedMinor
    FROM sx_sales_invoices WHERE tenant_id=? AND status='issued' AND issued_at>=? AND issued_at<DATE_ADD(?,INTERVAL 1 DAY)
    GROUP BY currency,DATE_FORMAT(issued_at,'%Y-%m') ORDER BY month,currency`,[ctx.tenant.id,from,to]);
  const [collections]=await db.query(`SELECT r.currency,DATE_FORMAT(r.received_at,'%Y-%m') AS month,COUNT(DISTINCT r.id) AS receiptCount,COALESCE(SUM(a.amount_minor),0) AS allocatedMinor
    FROM sx_sales_receipts r JOIN sx_sales_receipt_allocations a ON a.tenant_id=r.tenant_id AND a.receipt_id=r.id AND a.reversed_at IS NULL
    WHERE r.tenant_id=? AND r.status='active' AND r.received_at>=? AND r.received_at<DATE_ADD(?,INTERVAL 1 DAY)
    GROUP BY r.currency,DATE_FORMAT(r.received_at,'%Y-%m') ORDER BY month,currency`,[ctx.tenant.id,from,to]);
  return {from,to,invoices:rows,collections};
}
module.exports={createInvoice,document,issueInvoice,recordReceipt,allocateReceipt,reverseAllocation,listInvoices,unbilledSales,listReceipts,listAllocations,overview,report};
