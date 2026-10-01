'use strict';
const crypto=require('node:crypto');
const moment=require('moment-timezone');
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const periods=Object.freeze({daily:'day',weekly:'isoWeek',monthly:'month'});
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function periodWindow({period='daily',at,timezone='Asia/Qatar'}){
  const unit=periods[period];
  if(!unit)fail('Choose a daily, weekly or monthly report period.');
  if(!moment.tz.zone(timezone))fail('Choose a valid business timezone.');
  const reference=at?moment.tz(at,'YYYY-MM-DD',true,timezone):moment.tz(timezone);
  if(!reference.isValid())fail('Report date must use YYYY-MM-DD.');
  const start=reference.clone().startOf(unit),end=start.clone().add(1,unit);
  return {start:start.clone().utc().format('YYYY-MM-DD HH:mm:ss.SSS'),end:end.clone().utc().format('YYYY-MM-DD HH:mm:ss.SSS'),timezone,period};
}
function parseDetails(value){if(!value)return null;try{return typeof value==='string'?JSON.parse(value):value;}catch(_){return null;}}
async function getActivityReport({pool,uid,role='owner',agentId,period='daily',at,timezone='Asia/Qatar',page=1,limit=50}){
  if(!pool||typeof uid!=='string'||!uid)fail('A business workspace is required.',400);
  if(!['owner','agent'].includes(role))fail('This role cannot view the legacy lead activity report.',403);
  if(role==='agent'&&(!Number.isSafeInteger(Number(agentId))||Number(agentId)<1))fail('Agent identity is invalid.',403);
  const currentPage=Number(page),pageSize=Number(limit);
  if(!Number.isSafeInteger(currentPage)||currentPage<1||currentPage>10000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)fail('Report page or page size is invalid.');
  const window=periodWindow({period,at,timezone}),uidHash=hash(uid),db=typeof pool.promise==='function'?pool.promise():pool;
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const agentScope=role==='agent'?' AND l.owner_agent_id=?':'';
    const [[created]]=await connection.query(`SELECT COUNT(*) AS n FROM pipeline_leads l WHERE l.uid_hash=? AND l.created_at>=? AND l.created_at<?${agentScope}`,[uidHash,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [[counts]]=await connection.query(`SELECT
      SUM(pa.activity_type='contact_outcome') AS outcomes,
      SUM(pa.activity_type='note_added') AS notes,
      COUNT(DISTINCT pa.lead_id) AS leads_touched
      FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
      WHERE pa.uid_hash=? AND pa.created_at>=? AND pa.created_at<? AND pa.activity_type IN ('contact_outcome','note_added')${agentScope}`,[uidHash,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [outcomeRows]=await connection.query(`SELECT JSON_UNQUOTE(JSON_EXTRACT(pa.details,'$.outcome')) AS outcome,COUNT(*) AS total
      FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
      WHERE pa.uid_hash=? AND pa.created_at>=? AND pa.created_at<? AND pa.activity_type='contact_outcome'${agentScope}
      GROUP BY outcome ORDER BY total DESC,outcome`,[uidHash,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [[followups]]=await connection.query(`SELECT COUNT(*) AS n FROM pipeline_leads l WHERE l.uid_hash=? AND l.next_follow_up_at>=? AND l.next_follow_up_at<? AND l.status='open'${agentScope}`,[uidHash,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [[followupsRequired]]=await connection.query(`SELECT COUNT(*) AS n FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
      WHERE pa.uid_hash=? AND pa.created_at>=? AND pa.created_at<? AND pa.activity_type='contact_outcome'
      AND JSON_UNQUOTE(JSON_EXTRACT(pa.details,'$.followUpRequired'))='true'${agentScope}`,[uidHash,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [[overdue]]=await connection.query(`SELECT COUNT(*) AS n FROM pipeline_leads l WHERE l.uid_hash=? AND l.next_follow_up_at<UTC_TIMESTAMP(3) AND l.status='open'${agentScope}`,[uidHash,...(role==='agent'?[agentId]:[])]);
    const offset=(currentPage-1)*pageSize;
    const [events]=await connection.query(`SELECT pa.id,pa.lead_id AS leadId,pa.actor_type AS actorType,
      CASE WHEN pa.actor_type='agent' THEN COALESCE(a.name,'Agent') WHEN pa.actor_type='system' THEN 'System' ELSE 'Business user' END AS attendedBy,
      pa.activity_type AS activityType,pa.summary,pa.details,pa.created_at AS occurredAt,
      l.title AS leadTitle,COALESCE(c.display_name,l.contact_name) AS contactName,l.mobile,l.stage_key AS stageKey,l.next_follow_up_at AS nextFollowUpAt
      FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
      LEFT JOIN pipeline_contacts c ON c.uid_hash=l.uid_hash AND c.id=l.contact_id
      LEFT JOIN agents a ON pa.actor_type='agent' AND a.id=CAST(IF(pa.actor_id REGEXP '^[0-9]+$',pa.actor_id,'0') AS UNSIGNED)
        AND a.owner_uid COLLATE utf8mb4_general_ci=l.uid COLLATE utf8mb4_general_ci
      WHERE pa.uid_hash=? AND pa.created_at>=? AND pa.created_at<? AND pa.activity_type IN ('contact_outcome','note_added')${agentScope}
      ORDER BY pa.created_at DESC,pa.id DESC LIMIT ? OFFSET ?`,[uidHash,window.start,window.end,...(role==='agent'?[agentId]:[]),pageSize,offset]);
    const total=Number(counts?.outcomes||0)+Number(counts?.notes||0);
    await connection.commit();
    return {period:window.period,timezone:window.timezone,from:window.start,to:window.end,page:currentPage,limit:pageSize,total,hasMore:offset+events.length<total,
      summary:{leadsCreated:Number(created.n||0),leadsTouched:Number(counts.leads_touched||0),outcomes:Number(counts.outcomes||0),notes:Number(counts.notes||0),followUpsRequired:Number(followupsRequired.n||0),followUpsDue:Number(followups.n||0),followUpsOverdue:Number(overdue.n||0),outcomeCounts:outcomeRows.map(row=>({outcome:row.outcome,total:Number(row.total)}))},
      items:events.map(event=>({...event,details:parseDetails(event.details)}))};
  }catch(error){try{await connection.rollback();}catch(_){}throw error;}
  finally{connection.release();}
}
module.exports={periodWindow,getActivityReport};
