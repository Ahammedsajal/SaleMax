'use strict';
const crypto=require('node:crypto');
const moment=require('moment-timezone');
const plans=require('./plans');
const reports=require('../../helper/pipeline/reports');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const sqlDate=value=>moment.utc(value).format('YYYY-MM-DD HH:mm:ss.SSS');
function workerInput(workerId,limit){if(typeof workerId!=='string'||!/^[A-Za-z0-9._:-]{3,100}$/.test(workerId)||!Number.isSafeInteger(limit)||limit<1||limit>50)fail('INVALID_REPORT_WORKER');}
function windowFor({period,timezone,scheduledAt}){
  if(!moment.tz.zone(timezone))fail('INVALID_TIMEZONE');
  const slot=moment.utc(scheduledAt).tz(timezone);if(!slot.isValid())fail('INVALID_SCHEDULED_TIME');
  let start,end,date;
  if(period==='daily'){const cutoffIsDayBoundary=slot.hour()===0&&slot.minute()===0&&slot.second()===0&&slot.millisecond()===0;date=slot.clone().subtract(cutoffIsDayBoundary?1:0,'day').format('YYYY-MM-DD');start=slot.clone().startOf('day').subtract(cutoffIsDayBoundary?1:0,'day');end=slot.clone();}
  else if(period==='weekly'){const previous=slot.clone().subtract(1,'week');start=previous.clone().startOf('isoWeek');end=start.clone().add(1,'week');date=start.format('YYYY-MM-DD');}
  else if(period==='monthly'){const previous=slot.clone().subtract(1,'month');start=previous.clone().startOf('month');end=start.clone().add(1,'month');date=start.format('YYYY-MM-DD');}
  else fail('INVALID_REPORT_PERIOD');
  return {period,timezone,date,start:period==='daily'?start.utc().format('YYYY-MM-DD HH:mm:ss.SSS'):start.utc().format('YYYY-MM-DD HH:mm:ss.SSS'),end:end.utc().format('YYYY-MM-DD HH:mm:ss.SSS'),cutoffAt:slot.utc().format('YYYY-MM-DD HH:mm:ss.SSS')};
}
function nextRunAfter({period,timezone,localTime,local_time:localTimeDb},scheduledAt){
  const [hour,minute]=String(localTime??localTimeDb).slice(0,5).split(':').map(Number);let next=moment.utc(scheduledAt).tz(timezone);
  if(period==='daily')next.add(1,'day');else if(period==='weekly')next.add(1,'week').isoWeekday(1);else if(period==='monthly')next.add(1,'month').date(1);else fail('INVALID_REPORT_PERIOD');
  return next.hour(hour).minute(minute).second(0).millisecond(0).utc().format('YYYY-MM-DD HH:mm:ss.SSS');
}
async function enqueueDue(db,{now=new Date(),limit=25}={}){
  if(!(now instanceof Date)&&typeof now!=='string')fail('INVALID_REPORT_WORKER_TIME');if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_REPORT_WORKER_LIMIT');
  const nowSql=sqlDate(now);let enqueued=0,duplicates=0;await db.beginTransaction();
  try{
    for(let n=0;n<limit;n++){
      const [[schedule]]=await db.query(`SELECT id,tenant_id,period,timezone,DATE_FORMAT(local_time,'%H:%i') AS local_time,revision,DATE_FORMAT(next_run_at,'%Y-%m-%d %H:%i:%s.%f') AS scheduled_at
        FROM sx_training_report_schedules WHERE status='active' AND next_run_at<=? ORDER BY next_run_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,[nowSql]);
      if(!schedule)break;
      const window=windowFor({period:schedule.period,timezone:schedule.timezone,scheduledAt:schedule.scheduled_at});
      const id=crypto.randomUUID();
      try{
        await db.query(`INSERT INTO sx_training_report_runs(id,tenant_id,schedule_id,schedule_revision,period,period_start,period_end,cutoff_at,timezone,metric_definition_version,status)
          VALUES (?,?,?,?,?,?,?,?,?,1,'queued')`,[id,schedule.tenant_id,schedule.id,Number(schedule.revision),schedule.period,window.start,window.end,window.cutoffAt,schedule.timezone]);enqueued++;
      }catch(error){if(error.code!=='ER_DUP_ENTRY')throw error;duplicates++;}
      const next=nextRunAfter(schedule,schedule.scheduled_at);
      await db.query('UPDATE sx_training_report_schedules SET next_run_at=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?',[next,schedule.tenant_id,schedule.id]);
    }
    await db.commit();return {enqueued,duplicates,externalWrites:false};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function claimRuns(db,{workerId,limit=10,leaseSeconds=120}={}){
  workerInput(workerId,limit);if(!Number.isSafeInteger(leaseSeconds)||leaseSeconds<10||leaseSeconds>300)fail('INVALID_REPORT_WORKER_LEASE');await db.beginTransaction();
  try{
    const [rows]=await db.query(`SELECT id,tenant_id,schedule_id,schedule_revision,revision,revision_reason,supersedes_run_id,period,DATE_FORMAT(period_start,'%Y-%m-%d %H:%i:%s.%f') AS period_start,DATE_FORMAT(period_end,'%Y-%m-%d %H:%i:%s.%f') AS period_end,DATE_FORMAT(cutoff_at,'%Y-%m-%d %H:%i:%s.%f') AS cutoff_at,timezone,metric_definition_version,attempts,status
      FROM sx_training_report_runs WHERE ((status IN ('queued','retry') AND available_at<=UTC_TIMESTAMP(3)) OR (status='processing' AND lease_expires_at<=UTC_TIMESTAMP(3))) ORDER BY available_at,created_at,id LIMIT ? FOR UPDATE SKIP LOCKED`,[limit]);
    const items=[];
    for(const row of rows){if(Number(row.attempts)>=5){await db.query("UPDATE sx_training_report_runs SET status='dead',lease_owner=NULL,lease_expires_at=NULL,last_error_code='MAX_ATTEMPTS_EXCEEDED',updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",[row.tenant_id,row.id]);continue;}
      const attempt=Number(row.attempts)+1;await db.query("UPDATE sx_training_report_runs SET status='processing',attempts=?,lease_owner=?,lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",[attempt,workerId,leaseSeconds,row.tenant_id,row.id]);items.push({...row,attempt});}
    await db.commit();return items;
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function buildSnapshot(pool,run){
  const db=await pool.getConnection();let ownerUid;
  try{
    const [[tenant]]=await db.query('SELECT id,status,category_key,category_version FROM sx_tenants WHERE id=?',[run.tenant_id]);
    if(!tenant||tenant.status!=='active'||tenant.category_key!=='training_center'||Number(tenant.category_version)!==1)fail('REPORT_TENANT_UNAVAILABLE');
    const entitlement=await plans.loadEntitlements(db,tenant.id);
    if(!entitlement||!['active','trial','grace'].includes(entitlement.status)||!entitlement.capabilities.includes('reports.read')||!entitlement.capabilities.includes('reports.schedule'))fail('REPORT_ENTITLEMENT_UNAVAILABLE');
    const [owners]=await db.query(`SELECT u.uid,o.legacy_uid_hash FROM sx_legacy_ownership o JOIN user u ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
      JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id AND m.role='owner' AND m.status='active'
      JOIN sx_identities i ON i.id=m.identity_id AND i.status='active' WHERE o.tenant_id=? LIMIT 2`,[tenant.id]);
    if(owners.length!==1||owners[0].legacy_uid_hash!==sha(owners[0].uid))fail('REPORT_OWNER_LINK_UNAVAILABLE');ownerUid=owners[0].uid;
  }finally{db.release();}
  const window=windowFor({period:run.period,timezone:run.timezone,scheduledAt:run.cutoff_at});
  const report=await reports.getActivityReport({pool,uid:ownerUid,role:'owner',period:run.period,at:window.date,timezone:run.timezone,cutoffAt:window.cutoffAt,page:1,limit:1});
  const snapshot={schemaVersion:1,metricDefinitionVersion:Number(run.metric_definition_version),scheduleRevision:Number(run.schedule_revision),revision:Number(run.revision||1),revisionReason:run.revision_reason||null,supersedesRunId:run.supersedes_run_id||null,period:run.period,timezone:run.timezone,from:report.from,to:report.to,cutoffAt:report.cutoffAt||window.cutoffAt,generatedAt:new Date().toISOString(),activityCount:report.total,summary:report.summary,finance:report.finance||null,customerDetailsIncluded:false,delivery:{email:'not_configured',whatsapp:'not_configured'}};
  return snapshot;
}
async function completeRun(db,{run,workerId,snapshot}){
  const json=JSON.stringify(snapshot),digest=crypto.createHash('sha256').update(json).digest('hex');await db.beginTransaction();
  try{const [[current]]=await db.query('SELECT status,lease_owner,(lease_expires_at>UTC_TIMESTAMP(3)) AS valid FROM sx_training_report_runs WHERE tenant_id=? AND id=? FOR UPDATE',[run.tenant_id,run.id]);if(!current||current.status!=='processing'||current.lease_owner!==workerId||Number(current.valid)!==1)fail('REPORT_RUN_LEASE_REQUIRED');
    await db.query("UPDATE sx_training_report_runs SET status='generated',snapshot_json=?,snapshot_sha256=?,generated_at=UTC_TIMESTAMP(3),lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",[json,digest,run.tenant_id,run.id]);await db.commit();return {id:run.id,status:'generated',snapshotSha256:digest,externallySent:false};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function failRun(db,{run,workerId,errorCode,suppressed=false}){
  const code=typeof errorCode==='string'&&/^[A-Z0-9_]{2,100}$/.test(errorCode)?errorCode:'REPORT_GENERATION_FAILED';await db.beginTransaction();
  try{const [[current]]=await db.query('SELECT status,lease_owner,(lease_expires_at>UTC_TIMESTAMP(3)) AS valid,attempts FROM sx_training_report_runs WHERE tenant_id=? AND id=? FOR UPDATE',[run.tenant_id,run.id]);if(!current||current.status!=='processing'||current.lease_owner!==workerId||Number(current.valid)!==1)fail('REPORT_RUN_LEASE_REQUIRED');
    const dead=!suppressed&&Number(current.attempts)>=5,status=suppressed?'suppressed':dead?'dead':'retry',delay=Math.min(1800,30*2**Math.min(Number(current.attempts)-1,6));
    await db.query(`UPDATE sx_training_report_runs SET status=?,available_at=IF(?='retry',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),available_at),lease_owner=NULL,lease_expires_at=NULL,last_error_code=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?`,[status,status,delay,code,run.tenant_id,run.id]);await db.commit();return {id:run.id,status,errorCode:code,externalWrites:false};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function listLatest(db,tenantId){
  const [rows]=await db.query(`SELECT id,schedule_id,period,revision,revision_reason,supersedes_run_id,status,DATE_FORMAT(period_start,'%Y-%m-%d %H:%i:%s.%f') AS period_start,DATE_FORMAT(generated_at,'%Y-%m-%d %H:%i:%s.%f') AS generated_at,last_error_code,snapshot_json
    FROM sx_training_report_runs WHERE tenant_id=? ORDER BY schedule_id,period_start DESC,revision DESC LIMIT 600`,[tenantId]);
  const schedules=new Map();
  for(const row of rows){
    const version={id:row.id,scheduleId:row.schedule_id,period:row.period,revision:Number(row.revision),revisionReason:row.revision_reason||null,supersedesRunId:row.supersedes_run_id||null,status:row.status,periodStart:row.period_start,generatedAt:row.generated_at,errorCode:row.last_error_code,snapshot:typeof row.snapshot_json==='string'?JSON.parse(row.snapshot_json):row.snapshot_json||null};
    const latest=schedules.get(row.schedule_id);
    if(!latest)schedules.set(row.schedule_id,{...version,versions:[version]});else if(latest.periodStart===version.periodStart)latest.versions.push(version);
  }
  return [...schedules.values()];
}
async function tick(pool,{workerId=`reports-${process.pid}`,limit=10,now=new Date()}={}){
  workerInput(workerId,limit);const db=await pool.getConnection();let due;
  try{due=await enqueueDue(db,{now,limit:Math.min(100,limit*3)});}finally{db.release();}
  const claimDb=await pool.getConnection();let items;try{items=await claimRuns(claimDb,{workerId,limit});}finally{claimDb.release();}
  const outcomes=[];
  for(const run of items){try{const snapshot=await buildSnapshot(pool,run);const c=await pool.getConnection();try{outcomes.push(await completeRun(c,{run,workerId,snapshot}));}finally{c.release();}}
    catch(error){const c=await pool.getConnection();try{outcomes.push(await failRun(c,{run,workerId,errorCode:error.code||error.name,suppressed:['REPORT_TENANT_UNAVAILABLE','REPORT_ENTITLEMENT_UNAVAILABLE','REPORT_OWNER_LINK_UNAVAILABLE'].includes(error.code)}));}finally{c.release();}}
  }
  return {queued:due.enqueued,duplicatePeriods:due.duplicates,processed:outcomes,externalWrites:false,externallySent:false};
}
module.exports={windowFor,nextRunAfter,enqueueDue,claimRuns,buildSnapshot,completeRun,failRun,listLatest,tick};
