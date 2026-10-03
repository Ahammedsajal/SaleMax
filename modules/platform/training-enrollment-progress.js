'use strict';
const crypto=require('node:crypto');
const {decision}=require('./policy');
const pipelineJourney=require('./training-lead-journey');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function authorize(ctx){if(!ctx||ctx.audience!=='tenant'||ctx.tenant?.categoryKey!=='training_center'||Number(ctx.tenant.categoryVersion)!==1||ctx.tenant.status!=='active'||ctx.membership?.tenantId!==ctx.tenant.id||ctx.membership.status!=='active')fail('TENANT_CONTEXT_REQUIRED',403);const result=decision(ctx,{capability:'training.courses',permission:'courses.manage'});if(!result.allowed)fail(result.code||'PERMISSION_DENIED',403);if(!uuid(ctx.identity?.id))fail('IDENTITY_REQUIRED',401);}
async function paid(db,tenantId,invoice){
  const [[row]]=await db.query(`SELECT COALESCE(SUM(CAST(a.amount_minor AS DECIMAL(65,0))-CAST(COALESCE(r.reversed_minor,0) AS DECIMAL(65,0))),0) AS paid_minor
    FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id AND p.status='posted'
    LEFT JOIN (SELECT tenant_id,allocation_id,SUM(amount_minor) AS reversed_minor FROM sx_training_payment_allocation_reversals WHERE tenant_id=? GROUP BY tenant_id,allocation_id) r ON r.tenant_id=a.tenant_id AND r.allocation_id=a.id
    WHERE a.tenant_id=? AND a.invoice_id=?`,[tenantId,tenantId,invoice.id]);
  const paidMinor=String(row?.paid_minor||0);return {paidMinor,fullyPaid:BigInt(paidMinor)>=BigInt(String(invoice.total_minor))};
}
function certificateShape(row){return row?{id:row.id,certificateNumber:row.certificate_number,learnerName:row.learner_name_snapshot,courseNameEn:row.course_name_en_snapshot,courseNameAr:row.course_name_ar_snapshot,issuedAt:row.issued_at,externalDispatch:false}:null;}
async function list(db,ctx,{page=1,limit=25,q='',status=''}={}){
  authorize(ctx);page=Number(page);limit=Number(limit);q=String(q||'').trim().slice(0,100);if(!Number.isSafeInteger(page)||page<1||page>10000||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_ENROLLMENT_PAGE',400);
  if(status&&!['reserved','requested','confirmed','started','cancelled','completed'].includes(status))fail('INVALID_ENROLLMENT_STATUS',400);
  const filters=['e.tenant_id=?'],params=[ctx.tenant.id];if(status){filters.push('e.status=?');params.push(status);}if(q){filters.push('(e.learner_name LIKE ? OR e.payer_name LIKE ? OR i.invoice_number LIKE ? OR c.name_en LIKE ? OR c.name_ar LIKE ?)');params.push(...Array(5).fill(`%${q}%`));}
  const where=filters.join(' AND '),[[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_training_enrollments e JOIN sx_training_invoices i ON i.tenant_id=e.tenant_id AND i.enrollment_id=e.id JOIN sx_training_courses c ON c.tenant_id=e.tenant_id AND c.id=e.course_id WHERE ${where}`,params);
  const [rows]=await db.query(`SELECT e.id,e.status,e.started_at AS startedAt,e.completed_at AS completedAt,e.learner_name AS learnerName,e.payer_name AS payerName,e.payer_email AS payerEmail,e.batch_id AS batchId,i.id AS invoiceId,i.invoice_number AS invoiceNumber,i.total_minor AS totalMinor,c.name_en AS courseNameEn,c.name_ar AS courseNameAr,cert.id AS certificateId,cert.certificate_number AS certificateNumber,cert.issued_at AS certificateIssuedAt,(SELECT COALESCE(SUM(CAST(a.amount_minor AS DECIMAL(65,0))-CAST(COALESCE((SELECT SUM(ar.amount_minor) FROM sx_training_payment_allocation_reversals ar WHERE ar.tenant_id=a.tenant_id AND ar.allocation_id=a.id),0) AS DECIMAL(65,0))),0) FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id AND p.status='posted' WHERE a.tenant_id=e.tenant_id AND a.invoice_id=i.id) AS paidMinor FROM sx_training_enrollments e JOIN sx_training_invoices i ON i.tenant_id=e.tenant_id AND i.enrollment_id=e.id JOIN sx_training_courses c ON c.tenant_id=e.tenant_id AND c.id=e.course_id LEFT JOIN sx_training_certificates cert ON cert.tenant_id=e.tenant_id AND cert.enrollment_id=e.id WHERE ${where} ORDER BY e.created_at DESC,e.id LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
  const totals=Object.fromEntries(['reserved','requested','confirmed','started','cancelled','completed'].map(key=>[key,0]));const [statusRows]=await db.query('SELECT status,COUNT(*) AS total FROM sx_training_enrollments WHERE tenant_id=? GROUP BY status',[ctx.tenant.id]);for(const row of statusRows)if(Object.hasOwn(totals,row.status))totals[row.status]=Number(row.total);
  return {tenantName:String(ctx.tenant.name||'Training Center'),page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit),q,status:status||'all',statusCounts:totals,items:rows.map(row=>{const outstanding=BigInt(String(row.totalMinor))-BigInt(String(row.paidMinor||0));return {...row,totalMinor:String(row.totalMinor),paidMinor:String(row.paidMinor||0),outstandingMinor:String(outstanding>0n?outstanding:0n),certificate:row.certificateId?{id:row.certificateId,number:row.certificateNumber,issuedAt:row.certificateIssuedAt}:null};})};
}
async function transition(db,ctx,enrollmentId,{action}={}){
  authorize(ctx);if(!uuid(enrollmentId)||!['start','complete','issue_certificate'].includes(action))fail('INVALID_ENROLLMENT_ACTION',400);
  await db.beginTransaction();try{
    await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[ctx.tenant.id]);
    const [[enrollment]]=await db.query('SELECT e.id,e.status,e.learner_name,e.course_id,e.started_at,e.completed_at,i.id AS invoice_id,i.total_minor,c.name_en,c.name_ar FROM sx_training_enrollments e JOIN sx_training_invoices i ON i.tenant_id=e.tenant_id AND i.enrollment_id=e.id JOIN sx_training_courses c ON c.tenant_id=e.tenant_id AND c.id=e.course_id WHERE e.tenant_id=? AND e.id=? FOR UPDATE',[ctx.tenant.id,enrollmentId]);if(!enrollment)fail('ENROLLMENT_NOT_FOUND',404);
    if(action==='start'){
      if(enrollment.status==='started'){await db.commit();return {enrollmentId,status:'started',startedAt:enrollment.started_at,repeated:true};}
      if(!['reserved','requested','confirmed'].includes(enrollment.status))fail('ENROLLMENT_CANNOT_START');
      await db.query("UPDATE sx_training_enrollments SET status='started',started_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",[ctx.tenant.id,enrollmentId]);
      await db.query("INSERT INTO sx_training_enrollment_events(id,tenant_id,enrollment_id,event_type,actor_identity_id,details_json) VALUES (?,?,?,'course_started',?,JSON_OBJECT('previousStatus',?))",[crypto.randomUUID(),ctx.tenant.id,enrollmentId,ctx.identity.id,enrollment.status]);await pipelineJourney.advanceEnrollment(db,{tenantId:ctx.tenant.id,enrollmentId,milestone:'training_course_started'});
      await db.commit();return {enrollmentId,status:'started',repeated:false};
    }
    const payment=await paid(db,ctx.tenant.id,{id:enrollment.invoice_id,total_minor:enrollment.total_minor});if(!payment.fullyPaid)fail('FULL_PAYMENT_REQUIRED');
    if(action==='complete'){
      if(enrollment.status==='completed'){await db.commit();return {enrollmentId,status:'completed',completedAt:enrollment.completed_at,repeated:true};}
      if(enrollment.status!=='started')fail('ENROLLMENT_MUST_BE_STARTED');
      await db.query("UPDATE sx_training_enrollments SET status='completed',completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",[ctx.tenant.id,enrollmentId]);
      await db.query("INSERT INTO sx_training_enrollment_events(id,tenant_id,enrollment_id,event_type,actor_identity_id,details_json) VALUES (?,?,?,'course_completed',?,JSON_OBJECT('paidMinor',?,'invoiceTotalMinor',?))",[crypto.randomUUID(),ctx.tenant.id,enrollmentId,ctx.identity.id,payment.paidMinor,String(enrollment.total_minor)]);await pipelineJourney.advanceEnrollment(db,{tenantId:ctx.tenant.id,enrollmentId,milestone:'training_course_completed'});
      await db.commit();return {enrollmentId,status:'completed',repeated:false};
    }
    if(enrollment.status!=='completed')fail('ENROLLMENT_MUST_BE_COMPLETED');
    const [[existing]]=await db.query('SELECT * FROM sx_training_certificates WHERE tenant_id=? AND enrollment_id=? FOR UPDATE',[ctx.tenant.id,enrollmentId]);if(existing){await db.commit();return {enrollmentId,status:'completed',certificate:certificateShape(existing),repeated:true};}
    const year=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Qatar',year:'numeric'}).format(new Date()));await db.query("INSERT INTO sx_training_number_sequences(tenant_id,prefix,period_year,last_value) VALUES (?,'CERT',?,1) ON DUPLICATE KEY UPDATE last_value=last_value+1",[ctx.tenant.id,year]);const [[sequence]]=await db.query("SELECT last_value FROM sx_training_number_sequences WHERE tenant_id=? AND prefix='CERT' AND period_year=? FOR UPDATE",[ctx.tenant.id,year]);const certificateNumber=`CERT-${year}-${String(sequence.last_value).padStart(6,'0')}`,certificateId=crypto.randomUUID(),issuedAt=new Date();
    await db.query('INSERT INTO sx_training_certificates(id,tenant_id,enrollment_id,certificate_number,learner_name_snapshot,course_name_en_snapshot,course_name_ar_snapshot,issued_by_identity_id,issued_at) VALUES (?,?,?,?,?,?,?,?,?)',[certificateId,ctx.tenant.id,enrollmentId,certificateNumber,enrollment.learner_name,enrollment.name_en,enrollment.name_ar,ctx.identity.id,issuedAt]);
    await db.query("INSERT INTO sx_training_enrollment_events(id,tenant_id,enrollment_id,event_type,actor_identity_id,details_json) VALUES (?,?,?,'certificate_issued',?,JSON_OBJECT('certificateNumber',?))",[crypto.randomUUID(),ctx.tenant.id,enrollmentId,ctx.identity.id,certificateNumber]);await pipelineJourney.advanceEnrollment(db,{tenantId:ctx.tenant.id,enrollmentId,milestone:'training_certificate_issued'});
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','training.certificate-issued','training-certificate',?,?,?)`,[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,certificateId,JSON.stringify({enrollmentId,certificateNumber}),crypto.randomUUID()]);
    await db.commit();return {enrollmentId,status:'completed',certificate:{id:certificateId,certificateNumber,learnerName:enrollment.learner_name,courseNameEn:enrollment.name_en,courseNameAr:enrollment.name_ar,issuedAt,externalDispatch:false},repeated:false};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
module.exports={authorize,paid,list,transition,certificateShape};
