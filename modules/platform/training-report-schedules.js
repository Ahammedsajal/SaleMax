'use strict';
const crypto=require('node:crypto');
const moment=require('moment-timezone');
const {decision}=require('./policy');
const reportRunner=require('./training-report-runner');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function validateContext(ctx){
  if(!ctx||ctx.audience!=='tenant'||ctx.tenant?.status!=='active'||ctx.membership?.status!=='active'||ctx.membership?.tenantId!==ctx.tenant?.id)fail('TENANT_CONTEXT_REQUIRED');
  const report=decision(ctx,{capability:'reports.read',permission:'reports.read'});if(!report.allowed)fail(report.code);
  const schedule=decision(ctx,{capability:'reports.schedule',permission:'reports.schedule'});if(!schedule.allowed)fail(schedule.code);
  if(ctx.membership.role!=='owner')fail('PERMISSION_DENIED');
}
function normalize(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['period','timezone','localTime','emailEnabled','emailDestination','whatsappEnabled','whatsappDestination','status','expectedRevision'].includes(k)))fail('INVALID_REPORT_SCHEDULE');
  if(input.expectedRevision!==undefined&&(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0))fail('INVALID_REVISION');
  if(!['daily','weekly','monthly'].includes(input.period))fail('INVALID_REPORT_PERIOD');
  const timezone=typeof input.timezone==='string'?input.timezone.trim():'';if(timezone.length>64||!moment.tz.zone(timezone))fail('INVALID_TIMEZONE');
  if(typeof input.localTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.localTime))fail('INVALID_LOCAL_TIME');
  for(const key of ['emailEnabled','whatsappEnabled'])if(typeof input[key]!=='boolean')fail('INVALID_REPORT_CHANNEL');
  if(!input.emailEnabled&&!input.whatsappEnabled)fail('REPORT_CHANNEL_REQUIRED');
  const email=typeof input.emailDestination==='string'?input.emailDestination.trim().toLowerCase():'';
  const phone=typeof input.whatsappDestination==='string'?input.whatsappDestination.trim().replace(/[\s().-]/g,''):'';
  if(input.emailEnabled&&email&&(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))fail('INVALID_REPORT_EMAIL');
  if(input.whatsappEnabled&&phone&&!/^\+[1-9]\d{7,14}$/.test(phone))fail('INVALID_REPORT_WHATSAPP');
  const status=input.status??'active';if(!['active','paused'].includes(status))fail('INVALID_REPORT_SCHEDULE_STATUS');
  return {period:input.period,timezone,localTime:input.localTime,emailEnabled:input.emailEnabled,emailDestination:input.emailEnabled?email:null,whatsappEnabled:input.whatsappEnabled,whatsappDestination:input.whatsappEnabled?phone:null,status};
}
function nextRun({period,timezone,localTime},now=new Date()){
  const [hour,minute]=localTime.split(':').map(Number);let next=moment.tz(now,timezone).seconds(0).milliseconds(0);
  if(period==='daily')next.hour(hour).minute(minute);else if(period==='weekly')next.isoWeekday(1).hour(hour).minute(minute);else if(period==='monthly')next.date(1).hour(hour).minute(minute);else fail('INVALID_REPORT_PERIOD');
  if(!next.isAfter(moment.tz(now,timezone))){if(period==='daily')next.add(1,'day');else if(period==='weekly')next.add(1,'week');else next.add(1,'month');}
  return next.utc().format('YYYY-MM-DD HH:mm:ss.SSS');
}
function shape(row){return {id:row.id,period:row.period,timezone:row.timezone,localTime:String(row.local_time).slice(0,5),emailEnabled:Boolean(row.email_enabled),emailDestination:row.email_destination||'',emailVerified:Boolean(row.email_verified_at),whatsappEnabled:Boolean(row.whatsapp_enabled),whatsappDestination:row.whatsapp_destination||'',whatsappVerified:Boolean(row.whatsapp_verified_at),status:row.status,revision:Number(row.revision),nextRunAt:row.next_run_at};}
async function list(db,ctx){validateContext(ctx);const [rows]=await db.query(`SELECT id,tenant_id,period,timezone,local_time,email_enabled,email_destination,email_verified_at,whatsapp_enabled,whatsapp_destination,whatsapp_verified_at,status,revision,DATE_FORMAT(next_run_at,'%Y-%m-%d %H:%i:%s.%f') AS next_run_at FROM sx_training_report_schedules WHERE tenant_id=? ORDER BY FIELD(period,'daily','weekly','monthly')`,[ctx.tenant.id]);const [recipients]=await db.query("SELECT channel,COUNT(*) AS total FROM sx_training_report_recipients WHERE tenant_id=? AND status='verified' GROUP BY channel",[ctx.tenant.id]);const counts=Object.fromEntries(recipients.map(x=>[x.channel,Number(x.total)]));const runs=await reportRunner.listLatest(db,ctx.tenant.id);const latest=new Map(runs.map(run=>[run.period,run])),providers=await require('./training-report-delivery').providerCapabilities(db,ctx.tenant.id);return rows.map(row=>({...shape(row),recipientCounts:{email:counts.email||0,whatsapp:counts.whatsapp||0},providers,latestRun:latest.get(row.period)||null}));}
async function save(db,ctx,input){
  validateContext(ctx);const data=normalize(input),tenantId=ctx.tenant.id,id=crypto.randomUUID(),runAt=nextRun(data);
  await db.beginTransaction();try{
    const [[tenant]]=await db.query('SELECT status FROM sx_tenants WHERE id=? FOR UPDATE',[tenantId]);if(!tenant||tenant.status!=='active')fail('ACCOUNT_INACTIVE');
    const [[current]]=await db.query('SELECT id,revision,email_enabled,email_destination,email_verified_at,whatsapp_enabled,whatsapp_destination,whatsapp_verified_at FROM sx_training_report_schedules WHERE tenant_id=? AND period=? FOR UPDATE',[tenantId,data.period]);
    if(current){if(input.expectedRevision!==Number(current.revision))fail('STALE_REPORT_SCHEDULE');const keepEmail=Number(current.email_enabled)===Number(data.emailEnabled)&&(current.email_destination||null)===data.emailDestination,keepWhatsApp=Number(current.whatsapp_enabled)===Number(data.whatsappEnabled)&&(current.whatsapp_destination||null)===data.whatsappDestination;await db.query(`UPDATE sx_training_report_schedules SET timezone=?,local_time=?,email_enabled=?,email_destination=?,email_verified_at=?,whatsapp_enabled=?,whatsapp_destination=?,whatsapp_verified_at=?,status=?,revision=revision+1,next_run_at=?,updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?`,[data.timezone,data.localTime+':00',Number(data.emailEnabled),data.emailDestination,keepEmail?current.email_verified_at:null,Number(data.whatsappEnabled),data.whatsappDestination,keepWhatsApp?current.whatsapp_verified_at:null,data.status,runAt,ctx.identity.id,tenantId,current.id]);await db.query("UPDATE sx_training_report_verifications SET status='superseded' WHERE tenant_id=? AND schedule_id=? AND status='pending'",[tenantId,current.id]);await audit(db,ctx,'reports.schedule-updated',current.id,data);await db.commit();return {id:current.id,revision:Number(current.revision)+1,nextRunAt:runAt,status:data.status};}
    if(input.expectedRevision!==undefined&&input.expectedRevision!==0)fail('STALE_REPORT_SCHEDULE');
    await db.query(`INSERT INTO sx_training_report_schedules(id,tenant_id,period,timezone,local_time,email_enabled,email_destination,whatsapp_enabled,whatsapp_destination,status,next_run_at,created_by_identity_id,updated_by_identity_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,tenantId,data.period,data.timezone,data.localTime+':00',Number(data.emailEnabled),data.emailDestination,Number(data.whatsappEnabled),data.whatsappDestination,data.status,runAt,ctx.identity.id,ctx.identity.id]);await audit(db,ctx,'reports.schedule-created',id,data);await db.commit();return {id,revision:1,nextRunAt:runAt,status:data.status};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function audit(db,ctx,action,id,data){const safe={period:data.period,timezone:data.timezone,localTime:data.localTime,emailEnabled:data.emailEnabled,whatsappEnabled:data.whatsappEnabled,status:data.status};await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity',?,'report-schedule',?,?,?)`,[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,action,id,JSON.stringify(safe),crypto.randomUUID()]);}
async function reviseRun(db,ctx,input){
  validateContext(ctx);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['scheduleId','runId','expectedRevision','requestKey','reason'].includes(key))||!uuid(input.scheduleId)||!uuid(input.runId)||!uuid(input.requestKey)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)fail('INVALID_REPORT_REVISION');
  input={...input,scheduleId:input.scheduleId.toLowerCase(),runId:input.runId.toLowerCase(),requestKey:input.requestKey.toLowerCase()};
  const reason=typeof input.reason==='string'?input.reason.trim():'';if(reason.length<10||reason.length>500||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(reason))fail('INVALID_REPORT_REVISION_REASON');
  const tenantId=ctx.tenant.id,newId=crypto.randomUUID();await db.beginTransaction();
  try{
    const [[tenant]]=await db.query('SELECT status FROM sx_tenants WHERE id=? FOR UPDATE',[tenantId]);if(!tenant||tenant.status!=='active')fail('ACCOUNT_INACTIVE');
    const [[source]]=await db.query(`SELECT id,schedule_id,schedule_revision,revision,period,DATE_FORMAT(period_start,'%Y-%m-%d %H:%i:%s.%f') AS period_start,DATE_FORMAT(period_end,'%Y-%m-%d %H:%i:%s.%f') AS period_end,DATE_FORMAT(cutoff_at,'%Y-%m-%d %H:%i:%s.%f') AS cutoff_at,timezone,metric_definition_version,status
      FROM sx_training_report_runs WHERE tenant_id=? AND schedule_id=? AND id=? FOR UPDATE`,[tenantId,input.scheduleId,input.runId]);
    if(!source)fail('REPORT_RUN_NOT_FOUND');
    const [[replay]]=await db.query('SELECT id,schedule_id,supersedes_run_id,revision,revision_reason,status,DATE_FORMAT(period_start,\'%Y-%m-%d %H:%i:%s.%f\') AS period_start FROM sx_training_report_runs WHERE tenant_id=? AND request_key=? FOR UPDATE',[tenantId,input.requestKey]);
    if(replay){if(replay.schedule_id!==source.schedule_id||replay.supersedes_run_id!==source.id||replay.revision_reason!==reason||input.expectedRevision!==Number(source.revision))fail('IDEMPOTENCY_CONFLICT');await db.commit();return {id:replay.id,scheduleId:replay.schedule_id,supersedesRunId:replay.supersedes_run_id,revision:Number(replay.revision),periodStart:replay.period_start,status:replay.status,reason:replay.revision_reason,repeated:true};}
    if(source.status!=='generated')fail('REPORT_RUN_NOT_REVISIONABLE');
    if(Number(source.revision)!==input.expectedRevision)fail('STALE_REPORT_REVISION');
    const [[latest]]=await db.query('SELECT id,revision FROM sx_training_report_runs WHERE tenant_id=? AND schedule_id=? AND period_start=? ORDER BY revision DESC LIMIT 1 FOR UPDATE',[tenantId,source.schedule_id,source.period_start]);
    if(!latest||latest.id!==source.id)fail('STALE_REPORT_REVISION');
    await db.query(`INSERT INTO sx_training_report_runs(id,tenant_id,schedule_id,schedule_revision,revision,period,period_start,period_end,cutoff_at,timezone,metric_definition_version,status,revision_reason,supersedes_run_id,request_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'queued',?,?,?)`,[newId,tenantId,source.schedule_id,Number(source.schedule_revision),Number(source.revision)+1,source.period,source.period_start,source.period_end,source.cutoff_at,source.timezone,Number(source.metric_definition_version),reason,source.id,input.requestKey]);
    const digest=crypto.createHash('sha256').update(reason).digest('hex');
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','reports.snapshot-revision-requested','report-run',?,?,?)`,[crypto.randomUUID(),tenantId,ctx.identity.id,newId,JSON.stringify({scheduleId:source.schedule_id,period:source.period,periodStart:source.period_start,revision:Number(source.revision)+1,supersedesRunId:source.id,reasonSha256:digest}),input.requestKey]);
    await db.commit();return {id:newId,scheduleId:source.schedule_id,supersedesRunId:source.id,revision:Number(source.revision)+1,periodStart:source.period_start,status:'queued',reason,repeated:false};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
module.exports={validateContext,normalize,nextRun,list,save,reviseRun};
