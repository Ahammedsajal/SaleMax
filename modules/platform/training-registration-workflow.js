'use strict';
const crypto=require('node:crypto');
const plan=require('./training-offer-plan');
const fail=code=>{throw Object.assign(new Error(code),{code,status:400});};
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const profileKeys=['certificate_name','qid','nationality','phone_res','address','city','social_contact','emergency_phone','local_address','city_state','birth_date','gender','graduated','source','referral_name'];
function signature(value){
 let strokes;try{strokes=JSON.parse(value);}catch{fail('INVALID_SIGNATURE');}
 if(!Array.isArray(strokes)||!strokes.length||strokes.length>100)fail('INVALID_SIGNATURE');
 let count=0,travel=0;
 for(const stroke of strokes){if(!Array.isArray(stroke)||stroke.length<1)fail('INVALID_SIGNATURE');for(let i=0;i<stroke.length;i++){const point=stroke[i];if(!Array.isArray(point)||point.length!==2||point.some(n=>!Number.isFinite(n)||n<0||n>1))fail('INVALID_SIGNATURE');if(i)travel+=Math.hypot(point[0]-stroke[i-1][0],point[1]-stroke[i-1][1]);count++;}}
 if(count<8||count>3000||travel<0.05)fail('INVALID_SIGNATURE');return JSON.stringify(strokes);
}
async function options(db,tenantId){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [courses]=await db.query(`SELECT c.id,c.code,COALESCE(c.student_id_prefix,c.code) AS studentIdPrefix,c.name_en AS nameEn,c.name_ar AS nameAr,c.difficulty_level AS difficultyLevel,o.id AS offerId,o.version AS offerVersion,o.price_minor AS priceMinor,o.registration_fee_minor AS registrationFeeMinor,o.payment_term_count AS paymentTermCount,o.payment_interval AS paymentInterval FROM sx_training_courses c JOIN sx_training_offers o ON o.tenant_id=c.tenant_id AND o.course_id=c.id AND o.status='active' WHERE c.tenant_id=? AND c.status='active' AND (o.valid_from IS NULL OR o.valid_from<=?) AND (o.valid_until IS NULL OR o.valid_until>=?) ORDER BY c.name_en`,[tenantId,today,today]);
 const [batches]=await db.query(`SELECT id,course_id AS courseId,code,starts_on AS startsOn,ends_on AS endsOn FROM sx_training_batches WHERE tenant_id=? AND status IN ('scheduled','open') AND starts_on>=? AND reserved_seats<capacity ORDER BY starts_on`,[tenantId,today]);
 return {courses,batches};
}
async function staffOptions(db,tenantId,uid){
 const [members]=await db.query(`SELECT m.id,i.display_name AS name FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id AND i.status='active' WHERE m.tenant_id=? AND m.status='active' AND m.role IN ('owner','manager','accountant')`,[tenantId]);
 const [agents]=await db.query("SELECT id,name FROM agents WHERE owner_uid=? AND is_active=1",[uid]);
 return [...members,...agents.map(a=>({id:'agent:'+a.id,name:a.name}))];
}
async function create(db,{tenantId,uid,submissionId,leadId,data,actor,referenceCode}){
 if(!data.course_id||!data.email||!data.student_signature)fail('REGISTRATION_DETAILS_REQUIRED');
 signature(data.student_signature);
 if(!['Lead','Walk-In','Student Referral'].includes(data.source))fail('INVALID_REGISTRATION_SOURCE');
 if(data.source==='Student Referral'&&!data.referral_name)fail('REFERRAL_NAME_REQUIRED');
 if(data.qid&&!/^\d{11}$/.test(data.qid))fail('INVALID_QID');
 if(data.gender&&!['Male','Female'].includes(data.gender)||data.graduated&&!['Yes','No'].includes(data.graduated))fail('INVALID_REGISTRATION_DETAILS');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 for(const [key,choices] of Object.entries({level:['beginner','intermediate','advanced','all_levels'],class_day:['weekdays','weekends','sun-tue-thu','mon-wed','flexible'],class_time:['morning','afternoon','evening','flexible']}))if(data[key]&&!choices.includes(data[key]))fail('INVALID_REGISTRATION_DETAILS');
 if(data.birth_date&&data.birth_date>today)fail('INVALID_BIRTH_DATE');
 const {courses,batches}=await options(db,tenantId),course=courses.find(c=>c.id===data.course_id);if(!course)fail('INVALID_COURSE');
 if(data.batch_id&&!batches.some(b=>b.id===data.batch_id&&b.courseId===course.id))fail('INVALID_BATCH');
 const staff=actor?await staffOptions(db,tenantId,uid):[];
 if(actor&&!data.staff_attended)fail('INVALID_STAFF_ATTENDED');if(data.staff_attended&&!staff.some(s=>s.id===data.staff_attended))fail('INVALID_STAFF_ATTENDED');
 const count=Number(course.paymentTermCount),interval=course.paymentInterval,total=Number(course.priceMinor)+Number(course.registrationFeeMinor);
 if(!['full',`offer:${course.offerId}`].includes(data.payment_plan_id))fail('INVALID_PAYMENT_PLAN');
 const installments=plan.expectedSchedule(total,data.payment_plan_id==='full'?1:count,data.payment_plan_id==='full'?'once':interval,today);if(!installments)fail('INVALID_PAYMENT_PLAN');
 const uidHash=sha(uid),[[lead]]=await db.query('SELECT status,qualification_data,stage_key FROM pipeline_leads WHERE uid_hash=? AND uid=? AND id=? FOR UPDATE',[uidHash,uid,leadId]);if(!lead||lead.status!=='open')fail('LEAD_NOT_OPEN');
 let qualification=typeof lead.qualification_data==='string'?JSON.parse(lead.qualification_data):lead.qualification_data||{};
 for(const key of profileKeys)if(data[key])qualification[key]=data[key];
 await db.query("INSERT IGNORE INTO pipeline_stages(uid_hash,uid,stage_key,title,position,color,stage_type,probability,is_system) SELECT ?,?,'training_registration_pending','Student registration · pending approval',COALESCE(MAX(position),0)+1,'#a66c16','open',70,1 FROM pipeline_stages WHERE uid_hash=?",[uidHash,uid,uidHash]);
 await db.query("UPDATE pipeline_leads SET qualification_data=?,stage_key='training_registration_pending',stage_entered_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE uid_hash=? AND id=?",[JSON.stringify(qualification),uidHash,leadId]);
 const [[revision]]=await db.query('SELECT updated_at FROM pipeline_leads WHERE uid_hash=? AND id=?',[uidHash,leadId]);
 const prefix=course.studentIdPrefix,year=Number(today.slice(0,4)),sequencePrefix=prefix;
 await db.query('INSERT INTO sx_training_student_sequences(tenant_id,prefix,period_year,last_value) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE last_value=last_value+1',[tenantId,sequencePrefix,year]);
 const [[seq]]=await db.query('SELECT last_value FROM sx_training_student_sequences WHERE tenant_id=? AND prefix=? AND period_year=? FOR UPDATE',[tenantId,sequencePrefix,year]);
 const studentNumber=`${prefix}-${year}-${String(seq.last_value).padStart(6,'0')}`,provisionalInvoiceNumber=`PF-${studentNumber}`,id=crypto.randomUUID(),reviewId=crypto.randomUUID();
 const terms='Registration pending approval. '+data.consent_text;delete data.consent_text;
 await db.query(`INSERT INTO sx_training_sale_reviews(id,tenant_id,legacy_uid_hash,legacy_uid,lead_id,application_submission_id,request_key,request_hash,course_id,offer_id,batch_id,course_name_en,course_name_ar,offer_version,currency,price_minor,registration_fee_minor,discount_minor,net_minor,learner_name,payer_name,payer_email,payer_phone,invoice_email,terms_snapshot,installments,lead_updated_at_snapshot,submitted_by_type,submitted_by_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'QAR',?,?,0,?,?,?,?,?,?,?,?,?,?,?)`,[reviewId,tenantId,uidHash,uid,leadId,submissionId,crypto.randomUUID(),sha(JSON.stringify({submissionId,courseId:course.id})),course.id,course.offerId,data.batch_id||null,course.nameEn,course.nameAr,course.offerVersion,course.priceMinor,course.registrationFeeMinor,total,data.certificate_name||data.contact_name,data.contact_name,data.email,data.phone||null,data.email,terms.slice(0,2000),JSON.stringify(installments),revision.updated_at,actor?.actorType||'user',actor?.actorId||uid]);
 data.student_id=studentNumber;data.tuition_qar=(total/100).toFixed(2);data.courses=[{courseName:course.nameEn,level:data.level||course.difficultyLevel,classDay:data.class_day||'',timing:data.class_time||'',terms:data.enrollment_terms||''}];
 data.payment_plan=installments.map(p=>({date:p.dueDate,billNo:provisionalInvoiceNumber,amount:(p.amountMinor/100).toFixed(2),officeSignature:'',studentSignature:''}));
 const snapshot={referenceCode,studentNumber,provisionalInvoiceNumber,status:'pending_approval',currency:'QAR',totalMinor:total,courseNameEn:course.nameEn,courseNameAr:course.nameAr,installments,staffAttended:staff.find(s=>s.id===data.staff_attended)?.name||null};
 await db.query('INSERT INTO sx_training_registrations(id,tenant_id,submission_id,sale_review_id,student_number,provisional_invoice_number,snapshot_json) VALUES (?,?,?,?,?,?,?)',[id,tenantId,submissionId,reviewId,studentNumber,provisionalInvoiceNumber,JSON.stringify(snapshot)]);
 await db.query('UPDATE sx_training_form_submissions SET submission_data=? WHERE tenant_id=? AND id=?',[JSON.stringify(data),tenantId,submissionId]);
 const [members]=await db.query("SELECT m.identity_id,m.role FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id AND i.status='active' WHERE m.tenant_id=? AND m.status='active' AND m.role IN ('owner','accountant')",[tenantId]);
 if(!members.some(m=>m.role==='accountant'))members.push({role:'accountant',identity_id:'unassigned'});for(const recipient of [{role:'candidate',identity_id:'candidate'},...members])for(const channel of ['email','whatsapp'])await db.query('INSERT INTO sx_training_registration_deliveries(id,tenant_id,registration_id,recipient_kind,recipient_id,channel) VALUES (?,?,?,?,?,?)',[crypto.randomUUID(),tenantId,id,recipient.role,recipient.identity_id,channel]);
 await db.query("INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,actor_id,activity_type,summary,details) VALUES (?,?,'system',NULL,'registration_submitted','Student registration pending approval',?)",[uidHash,leadId,JSON.stringify({registrationId:id,studentNumber,saleReviewId:reviewId,provisionalInvoiceNumber,stageFrom:lead.stage_key,stageTo:'training_registration_pending'})]);
 return {...snapshot,registrationId:id,saleReviewId:reviewId,notifications:'queued'};
}
async function queueInvoice(db,tenantId,saleReviewId){
 const [[registration]]=await db.query('SELECT id FROM sx_training_registrations WHERE tenant_id=? AND sale_review_id=?',[tenantId,saleReviewId]);if(!registration)return;
 const [recipients]=await db.query('SELECT DISTINCT recipient_kind,recipient_id,channel FROM sx_training_registration_deliveries WHERE tenant_id=? AND registration_id=?',[tenantId,registration.id]);
 for(const r of recipients)await db.query("INSERT IGNORE INTO sx_training_registration_deliveries(id,tenant_id,registration_id,recipient_kind,recipient_id,channel,event_type) VALUES (?,?,?,?,?,?,'invoice_issued')",[crypto.randomUUID(),tenantId,registration.id,r.recipient_kind,r.recipient_id,r.channel]);
}
module.exports={profileKeys,signature,options,staffOptions,create,queueInvoice};
