'use strict';
const students=require('./training-enrollment-progress');
const branding=require('./training-document-branding');
async function list(db,ctx,{search=''}={}){
 students.authorize(ctx);
 const term='%'+String(search).trim().slice(0,100).replace(/[\\%_]/g,'\\$&')+'%';
 const [items]=await db.query(`SELECT r.id,r.student_number AS studentNumber,r.provisional_invoice_number AS provisionalInvoiceNumber,r.created_at AS registeredAt,r.snapshot_json AS snapshot,s.submission_data AS submissionData,s.reference_code AS referenceCode,s.lead_id AS leadId,v.status AS approvalStatus,v.revision AS reviewRevision,v.id AS saleReviewId,COALESCE(c.invoice_id,NULL) AS invoiceId FROM sx_training_registrations r JOIN sx_training_form_submissions s ON s.tenant_id=r.tenant_id AND s.id=r.submission_id JOIN sx_training_sale_reviews v ON v.tenant_id=r.tenant_id AND v.id=r.sale_review_id LEFT JOIN sx_training_sale_conversions c ON c.tenant_id=r.tenant_id AND c.sale_review_id=r.sale_review_id WHERE r.tenant_id=? AND c.id IS NULL AND (r.student_number LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(s.submission_data,'$.contact_name')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(s.submission_data,'$.phone')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(s.submission_data,'$.email')) LIKE ?) ORDER BY r.created_at DESC LIMIT 100`,[ctx.tenant.id,term,term,term,term]);
 for(const item of items){item.snapshot=typeof item.snapshot==='string'?JSON.parse(item.snapshot):item.snapshot;item.submissionData=typeof item.submissionData==='string'?JSON.parse(item.submissionData):item.submissionData;const [deliveries]=await db.query('SELECT recipient_kind AS recipient,channel,status,error_code AS errorCode FROM sx_training_registration_deliveries WHERE tenant_id=? AND registration_id=? ORDER BY recipient_kind,channel',[ctx.tenant.id,item.id]);item.deliveries=deliveries;}
 return {items,businessProfile:await branding.get(db,ctx.tenant.id)};
}
module.exports={list};
