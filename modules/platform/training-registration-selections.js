'use strict';
const MAX_COURSES=10;
const fields=['course_id','batch_id','payment_plan_id','level','class_day','class_time','enrollment_terms'];
const fail=code=>{throw Object.assign(new Error(code),{code,status:400});};
function normalize(data){
 const rows=data.course_selections===undefined?[Object.fromEntries(fields.map(k=>[k,data[k]||'']))]:data.course_selections;
 if(!Array.isArray(rows)||!rows.length||rows.length>MAX_COURSES)fail('INVALID_COURSE_SELECTIONS');
 const seen=new Set();return rows.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!fields.includes(k)))fail('INVALID_COURSE_SELECTIONS');
  const clean={};for(const key of fields){const value=row[key]??'';if(typeof value!=='string'||value.length>255)fail('INVALID_COURSE_SELECTIONS');clean[key]=value.trim();}
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean.course_id))fail('INVALID_COURSE');
  if(seen.has(clean.course_id))fail('DUPLICATE_REGISTRATION_COURSE');seen.add(clean.course_id);
  if(!clean.payment_plan_id)fail('INVALID_PAYMENT_PLAN');return clean;
 });
}
function summary(items){
 const first=items[0];if(!first)return {};
 return {...first,courseCount:items.length,registrations:items,totalMinor:items.reduce((n,r)=>n+Number(r.totalMinor),0),installments:items.flatMap(r=>r.installments.map(p=>({...p,courseName:r.courseNameEn,billNo:r.provisionalInvoiceNumber}))),courseNameEn:items.map(r=>r.courseNameEn).join(' + '),courseNameAr:items.map(r=>r.courseNameAr).join(' + ')};
}
async function previous(db,tenantId,submissionId){const [rows]=await db.query('SELECT snapshot_json FROM sx_training_registrations WHERE tenant_id=? AND submission_id=? ORDER BY course_position,id',[tenantId,submissionId]);return summary(rows.map(r=>typeof r.snapshot_json==='string'?JSON.parse(r.snapshot_json):r.snapshot_json));}
module.exports={MAX_COURSES,fields,normalize,summary,previous};
