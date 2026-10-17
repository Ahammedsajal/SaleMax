'use strict';
const plan=require('./invoice-communication-plan');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const date=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const timestamp=value=>value instanceof Date?value.toISOString():value?String(value).replace(' ','T').replace(/Z?$/,'Z'):null;
async function load(db,tenantId,documentId){
  const [[row]]=await db.query(`SELECT d.id,d.invoice_number,d.snapshot,d.customer_type,d.customer_id,
    COALESCE(ds.revision,1) AS revision,ds.deleted_at,r.replacement_invoice_id,
    track.reminders_opted_out,links.invoice_id AS formal_invoice_id
    FROM sx_invoice_generator_documents d JOIN sx_tenants t ON t.id=d.tenant_id AND t.status='active' AND t.category_key='training_center'
    LEFT JOIN sx_invoice_generator_document_state ds ON ds.tenant_id=d.tenant_id AND ds.document_id=d.id
    LEFT JOIN sx_invoice_generator_replacements r ON r.tenant_id=d.tenant_id AND r.prior_invoice_id=d.id
    LEFT JOIN sx_invoice_communication_documents track ON track.tenant_id=d.tenant_id AND track.document_id=d.id
    LEFT JOIN sx_training_generated_invoice_links links ON links.tenant_id=d.tenant_id AND links.generated_document_id=d.id
    WHERE d.tenant_id=? AND d.id=?`,[tenantId,documentId]);
  if(!row)return loadFormal(db,tenantId,documentId);
  const snapshot=parse(row.snapshot),document={id:row.id,revision:Number(row.revision),invoiceNumber:row.invoice_number,status:'generated',deleted:Boolean(row.deleted_at),replaced:Boolean(row.replacement_invoice_id),optedOut:Boolean(Number(row.reminders_opted_out)),customerType:row.customer_type,customerId:row.customer_id,
    name:snapshot.customer?.name||snapshot.enrollment?.payerName||'',email:snapshot.customer?.email||'',phone:snapshot.customer?.phone||'',language:snapshot.customerLanguage==='ar'?'ar':'en',currency:'QAR',totalMinor:String(snapshot.totalMinor),businessName:snapshot.businessProfile?.nameEn||snapshot.companyName||snapshot.legalName||'',snapshot,
    installments:(snapshot.installments||[]).map(x=>({sequence:Number(x.sequence),dueDate:date(x.dueDate),amountMinor:String(x.amountMinor)}))};
  let allocations=[],credits=[],receipts=[];
  if(row.formal_invoice_id){
    return loadFormal(db,tenantId,row.formal_invoice_id,document);

  }
  const terms=document.installments.map(x=>({...x,...plan.balance(x,allocations,credits)}));
  document.outstandingMinor=String(terms.filter(x=>!x.cancelled).reduce((total,x)=>total+BigInt(x.openMinor),0n));
  return {document,allocations,credits,terms,receipts};
}
async function loadFormal(db,tenantId,invoiceId,document=null){
  let allocations=[],credits=[],receipts=[];
    const [[formal]]=await db.query(`SELECT i.id,i.invoice_number,i.status,i.currency,i.total_minor,i.invoice_email,i.issued_at,i.legal_name_snapshot,i.legal_registration_snapshot,i.legal_address_snapshot,i.subtotal_minor,i.tax_minor,i.terms_snapshot,track.reminders_opted_out,e.learner_name,e.payer_name,e.payer_phone,e.status AS enrollment_status,
      EXISTS(SELECT 1 FROM sx_training_payment_disputes d WHERE d.tenant_id=i.tenant_id AND d.invoice_id=i.id AND d.status='open') AS disputed,
      (SELECT p.status FROM sx_training_reminder_preferences p WHERE p.tenant_id=i.tenant_id AND p.invoice_id=i.id) AS reminder_preference
      FROM sx_training_invoices i JOIN sx_tenants tenant ON tenant.id=i.tenant_id AND tenant.status='active' AND tenant.category_key='training_center' LEFT JOIN sx_invoice_communication_documents track ON track.tenant_id=i.tenant_id AND track.formal_invoice_id=i.id JOIN sx_training_enrollments e ON e.tenant_id=i.tenant_id AND e.id=i.enrollment_id WHERE i.tenant_id=? AND i.id=?`,[tenantId,invoiceId]);
    if(!formal)return null;
    if(!document){
      const [lines]=await db.query('SELECT line_number,description_en,description_ar,quantity,unit_amount_minor,discount_minor,tax_minor,total_minor FROM sx_training_invoice_lines WHERE tenant_id=? AND invoice_id=? ORDER BY line_number',[tenantId,formal.id]);
      const businessProfile=await require('./training-document-branding').get(db,tenantId),snapshot={id:formal.id,revision:1,invoiceNumber:formal.invoice_number,issuedAt:timestamp(formal.issued_at),companyName:businessProfile.nameEn,legalName:formal.legal_name_snapshot,legalAddress:formal.legal_address_snapshot,crNumber:formal.legal_registration_snapshot,businessProfile,totalMinor:String(formal.total_minor),subtotalMinor:String(formal.subtotal_minor),taxMinor:String(formal.tax_minor),footer:formal.terms_snapshot||'',customer:{name:formal.payer_name||formal.learner_name,email:formal.invoice_email,phone:formal.payer_phone},lines:lines.map(x=>({descriptionEn:x.description_en,descriptionAr:x.description_ar,quantity:Number(x.quantity),unitAmountMinor:String(x.unit_amount_minor),discountMinor:String(x.discount_minor),taxMinor:String(x.tax_minor),totalMinor:String(x.total_minor)}))};
      document={id:formal.id,revision:1,sourceType:'formal',status:formal.status,currency:formal.currency,invoiceNumber:formal.invoice_number,snapshot,businessName:businessProfile.nameEn,language:'en',optedOut:Boolean(Number(formal.reminders_opted_out))};
    }
    document.formalInvoiceId=formal.id;document.formalInvoiceNumber=formal.invoice_number;document.status=formal.status;document.currency=formal.currency;document.totalMinor=String(formal.total_minor);document.email=formal.invoice_email||document.email;document.phone=formal.payer_phone||document.phone;document.name=formal.payer_name||formal.learner_name||document.name;document.disputed=Boolean(Number(formal.disputed));document.enrollmentCancelled=formal.enrollment_status==='cancelled';document.optedOut=document.optedOut||formal.reminder_preference==='opted_out';
    const [rawTerms]=await db.query('SELECT id,sequence_number,due_date,amount_minor,status FROM sx_training_installments WHERE tenant_id=? AND invoice_id=? ORDER BY sequence_number',[tenantId,formal.id]);
    document.installments=rawTerms.map(x=>({id:x.id,sequence:Number(x.sequence_number),dueDate:date(x.due_date),amountMinor:String(x.amount_minor),cancelled:x.status==='cancelled'}));
    const [payments]=await db.query(`SELECT a.installment_id,a.amount_minor,p.status,r.id AS receipt_id,
      COALESCE((SELECT SUM(reversal.amount_minor) FROM sx_training_payment_allocation_reversals reversal WHERE reversal.tenant_id=a.tenant_id AND reversal.allocation_id=a.id),0) AS reversed_minor
      FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id
      LEFT JOIN sx_training_receipts r ON r.tenant_id=p.tenant_id AND r.payment_id=p.id WHERE a.tenant_id=? AND a.invoice_id=?`,[tenantId,formal.id]);
    allocations=payments.map(x=>({installmentId:x.installment_id,status:x.status,receiptId:x.receipt_id,amountMinor:String(x.amount_minor),reversedMinor:String(x.reversed_minor)}));
    const [creditRows]=await db.query(`SELECT a.installment_id,a.amount_minor,c.status FROM sx_training_credit_allocations a JOIN sx_training_credit_notes c ON c.tenant_id=a.tenant_id AND c.id=a.credit_note_id WHERE a.tenant_id=? AND c.invoice_id=?`,[tenantId,formal.id]);
    credits=creditRows.map(x=>({installmentId:x.installment_id,status:x.status,amountMinor:String(x.amount_minor)}));
    const [receiptRows]=await db.query(`SELECT r.receipt_number,r.amount_minor,r.currency,r.received_at,r.method_snapshot FROM sx_training_receipts r JOIN sx_training_payments p ON p.tenant_id=r.tenant_id AND p.id=r.payment_id AND p.status='posted' WHERE r.tenant_id=? AND r.invoice_id=? ORDER BY r.issued_at`,[tenantId,formal.id]);
    receipts=receiptRows.map(x=>({number:x.receipt_number,amountMinor:String(x.amount_minor),currency:x.currency,receivedAt:timestamp(x.received_at),method:x.method_snapshot}));
  const terms=document.installments.map(x=>({...x,...plan.balance(x,allocations,credits)}));
  document.outstandingMinor=String(terms.filter(x=>!x.cancelled).reduce((total,x)=>total+BigInt(x.openMinor),0n));
  return {document,allocations,credits,terms,receipts};
}
function fromSnapshot(snapshot){return {id:snapshot.id,revision:Number(snapshot.revision||1),status:'generated',email:snapshot.customer?.email||'',phone:snapshot.customer?.phone||'',name:snapshot.customer?.name||''};}
module.exports={parse,load,fromSnapshot};
