'use strict';

const crypto=require('node:crypto');

const STAGES=[
  {key:'training_invoice_issued',title:'Sale converted · invoice issued',color:'#12806a'},
  {key:'training_payment_received',title:'Payment received',color:'#2878b8'},
  {key:'training_course_started',title:'Course started',color:'#7055b7'},
  {key:'training_fully_paid',title:'Paid in full',color:'#13835f'},
  {key:'training_course_completed',title:'Course completed',color:'#197a70'},
  {key:'training_certificate_issued',title:'Certificate issued',color:'#a46b19'},
];
const stageIndex=key=>STAGES.findIndex(stage=>stage.key===key);

async function ensureStages(db,uidHash,uid){
  const [[existing]]=await db.query('SELECT stage_key FROM pipeline_stages WHERE uid_hash=? AND uid=? AND stage_key=? FOR UPDATE',[uidHash,uid,STAGES[0].key]);
  if(existing)return;
  const [[won]]=await db.query("SELECT position FROM pipeline_stages WHERE uid_hash=? AND uid=? AND stage_key='won' AND stage_type='won' FOR UPDATE",[uidHash,uid]);
  if(!won)throw Object.assign(new Error('WON_STAGE_NOT_CONFIGURED'),{code:'WON_STAGE_NOT_CONFIGURED'});
  const shift=STAGES.length;
  await db.query('UPDATE pipeline_stages SET position=position+? WHERE uid_hash=? AND uid=? AND position>?',[shift,uidHash,uid,Number(won.position)]);
  for(let i=0;i<STAGES.length;i++){
    const stage=STAGES[i];
    await db.query(`INSERT IGNORE INTO pipeline_stages(uid_hash,uid,stage_key,title,position,color,stage_type,probability,is_system)
      VALUES (?,?,?,?,?,?,'won',100,1)`,[uidHash,uid,stage.key,stage.title,Number(won.position)+i+1,stage.color]);
  }
}

async function advance(db,{uidHash,uid,leadId,milestone},{stagesReady=false}={}){
  const targetIndex=stageIndex(milestone);
  if(targetIndex<0)throw Object.assign(new Error('INVALID_TRAINING_JOURNEY_STAGE'),{code:'INVALID_TRAINING_JOURNEY_STAGE'});
  if(!stagesReady)await ensureStages(db,uidHash,uid);
  const [[lead]]=await db.query('SELECT stage_key,status FROM pipeline_leads WHERE uid_hash=? AND uid=? AND id=? FOR UPDATE',[uidHash,uid,leadId]);
  if(!lead||lead.status!=='won')return false;
  const currentIndex=stageIndex(lead.stage_key);
  if(currentIndex>=targetIndex)return false;
  const from=lead.stage_key,stage=STAGES[targetIndex];
  await db.query('UPDATE pipeline_leads SET stage_key=?,stage_entered_at=UTC_TIMESTAMP(3),last_activity_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE uid_hash=? AND uid=? AND id=? AND status=\'won\'',[stage.key,uidHash,uid,leadId]);
  await db.query(`INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,actor_id,activity_type,summary,details,created_at)
    VALUES (?,?,\'system\',NULL,\'stage_changed\',?,?,UTC_TIMESTAMP(3))`,[uidHash,leadId,stage.title,JSON.stringify({stageFrom:from,stageTo:stage.key,trainingMilestone:milestone})]);
  return true;
}

async function reconcileExisting(pool,{uid}){
  if(typeof uid!=='string'||!uid)return 0;
  const db=typeof pool.promise==='function'?pool.promise():pool,uidHash=crypto.createHash('sha256').update(uid).digest('hex');
  const connection=await db.getConnection();let advanced=0;
  try{
    await connection.beginTransaction();
    const [tenants]=await connection.query(`SELECT DISTINCT tenant_id FROM sx_training_enrollments
      WHERE legacy_uid_hash=? AND legacy_uid=? AND lead_id IS NOT NULL ORDER BY tenant_id`,[uidHash,uid]);
    for(const {tenant_id:tenantId} of tenants){
      await connection.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[tenantId]);
      const [rows]=await connection.query(`SELECT l.id AS lead_id,e.id AS enrollment_id,e.started_at,e.completed_at,
          i.total_minor,EXISTS(SELECT 1 FROM sx_training_receipts r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id) AS has_receipt,
          cert.id AS certificate_id,
          COALESCE((SELECT SUM(CAST(a.amount_minor AS DECIMAL(65,0))-CAST(COALESCE((SELECT SUM(ar.amount_minor)
            FROM sx_training_payment_allocation_reversals ar WHERE ar.tenant_id=a.tenant_id AND ar.allocation_id=a.id),0) AS DECIMAL(65,0)))
            FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id AND p.status='posted'
            WHERE a.tenant_id=i.tenant_id AND a.invoice_id=i.id),0) AS paid_minor
        FROM pipeline_leads l JOIN sx_training_enrollments e ON e.legacy_uid_hash=l.uid_hash AND e.legacy_uid=l.uid AND e.lead_id=l.id
        JOIN sx_training_invoices i ON i.tenant_id=e.tenant_id AND i.enrollment_id=e.id AND i.status='issued'
        LEFT JOIN sx_training_certificates cert ON cert.tenant_id=e.tenant_id AND cert.enrollment_id=e.id
        WHERE e.tenant_id=? AND l.uid_hash=? AND l.uid=? AND l.status='won' AND l.stage_key='won'
        ORDER BY e.id FOR UPDATE`,[tenantId,uidHash,uid]);
      if(!rows.length)continue;
      await ensureStages(connection,uidHash,uid);
      for(const row of rows){
        let milestone='training_invoice_issued';
        if(row.has_receipt)milestone='training_payment_received';
        if(BigInt(row.paid_minor||0)>=BigInt(row.total_minor||0))milestone='training_fully_paid';
        if(row.started_at)milestone='training_course_started';
        if(row.completed_at)milestone='training_course_completed';
        if(row.certificate_id)milestone='training_certificate_issued';
        if(await advance(connection,{uidHash,uid,leadId:row.lead_id,milestone},{stagesReady:true}))advanced++;
      }
    }
    await connection.commit();return advanced;
  }catch(error){try{await connection.rollback();}catch{}throw error;}finally{connection.release();}
}

async function advanceEnrollment(db,{tenantId,enrollmentId,milestone}){
  const [[enrollment]]=await db.query(`SELECT legacy_uid_hash,legacy_uid,lead_id FROM sx_training_enrollments
    WHERE tenant_id=? AND id=? FOR UPDATE`,[tenantId,enrollmentId]);
  if(!enrollment?.lead_id||!enrollment.legacy_uid_hash||!enrollment.legacy_uid)return false;
  return advance(db,{uidHash:enrollment.legacy_uid_hash,uid:enrollment.legacy_uid,leadId:enrollment.lead_id,milestone});
}

async function advancePayment(db,{tenantId,invoiceId}){
  const [[row]]=await db.query(`SELECT e.id AS enrollment_id,e.legacy_uid_hash,e.legacy_uid,e.lead_id,i.total_minor,
      COALESCE((SELECT SUM(CAST(a.amount_minor AS DECIMAL(65,0))-CAST(COALESCE((SELECT SUM(ar.amount_minor)
        FROM sx_training_payment_allocation_reversals ar WHERE ar.tenant_id=a.tenant_id AND ar.allocation_id=a.id),0) AS DECIMAL(65,0)))
        FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id AND p.status='posted'
        WHERE a.tenant_id=i.tenant_id AND a.invoice_id=i.id),0) AS paid_minor
    FROM sx_training_invoices i JOIN sx_training_enrollments e ON e.tenant_id=i.tenant_id AND e.id=i.enrollment_id
    WHERE i.tenant_id=? AND i.id=? AND i.status='issued' FOR UPDATE`,[tenantId,invoiceId]);
  if(!row?.lead_id||!row.legacy_uid_hash||!row.legacy_uid)return false;
  const fullyPaid=BigInt(row.paid_minor||0)>=BigInt(row.total_minor||0);
  return advance(db,{uidHash:row.legacy_uid_hash,uid:row.legacy_uid,leadId:row.lead_id,milestone:fullyPaid?'training_fully_paid':'training_payment_received'});
}

module.exports={STAGES,ensureStages,advance,advanceEnrollment,advancePayment,reconcileExisting};
