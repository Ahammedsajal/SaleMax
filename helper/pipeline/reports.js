'use strict';
const crypto=require('node:crypto');
const moment=require('moment-timezone');
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const periods=Object.freeze({daily:'day',weekly:'isoWeek',monthly:'month'});
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function periodWindow({period='daily',at,timezone='Asia/Qatar',cutoffAt}){
  const unit=periods[period];
  if(!unit)fail('Choose a daily, weekly or monthly report period.');
  if(!moment.tz.zone(timezone))fail('Choose a valid business timezone.');
  const reference=at?moment.tz(at,'YYYY-MM-DD',true,timezone):moment.tz(timezone);
  if(!reference.isValid())fail('Report date must use YYYY-MM-DD.');
  const start=reference.clone().startOf(unit);let end=start.clone().add(1,unit);
  if(period==='daily'&&cutoffAt){const cutoff=moment.utc(cutoffAt),startUtc=start.clone().utc(),endUtc=end.clone().utc();if(!cutoff.isValid()||!cutoff.isAfter(startUtc)||cutoff.isAfter(endUtc))fail('Report cutoff must fall inside the selected local day.');end=cutoff;}
  return {start:start.clone().utc().format('YYYY-MM-DD HH:mm:ss.SSS'),end:end.clone().utc().format('YYYY-MM-DD HH:mm:ss.SSS'),timezone,period};
}
function parseDetails(value){if(!value)return null;try{return typeof value==='string'?JSON.parse(value):value;}catch(_){return null;}}
async function getFinanceSummary(connection,uid,window){
  const tables=['sx_legacy_ownership','sx_tenants','sx_memberships','sx_training_invoices','sx_training_payment_allocations','sx_training_payments','sx_training_payment_allocation_reversals','sx_training_credit_notes','sx_training_credit_allocations','sx_training_journal_entries','sx_training_journal_lines'];
  const [available]=await connection.query('SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)',[tables]);
  if(Number(available[0]?.total)!==tables.length)return null;
  const [users]=await connection.query('SELECT id FROM user WHERE uid=? LIMIT 2',[uid]);
  if(users.length!==1)return null;
  const [owners]=await connection.query(`SELECT t.id AS tenantId FROM sx_legacy_ownership o
    JOIN sx_tenants t ON t.id=o.tenant_id AND t.category_key='training_center' AND t.category_version=1 AND t.status='active'
    JOIN sx_memberships m ON m.tenant_id=t.id AND m.id=o.membership_id AND m.role='owner' AND m.status='active'
    WHERE o.source_table='user' AND o.source_id=? AND o.legacy_uid_hash=? LIMIT 2`,[String(users[0].id),hash(uid)]);
  if(owners.length!==1)return null;
  const tenantId=owners[0].tenantId;
  const [[totals]]=await connection.query(`SELECT COUNT(*) AS invoice_count,
      COALESCE(SUM(i.total_minor),0) AS billed_minor,
      COALESCE(SUM(COALESCE(a.allocated_minor,0)),0) AS collected_minor,
      COALESCE(SUM(COALESCE(c.credited_minor,0)),0) AS credited_minor,
      COALESCE(SUM(CASE WHEN i.total_minor>=COALESCE(a.allocated_minor,0)+COALESCE(c.credited_minor,0)
        THEN i.total_minor-COALESCE(a.allocated_minor,0)-COALESCE(c.credited_minor,0) ELSE 0 END),0) AS outstanding_minor,
      COALESCE(SUM(i.total_minor<COALESCE(a.allocated_minor,0)+COALESCE(c.credited_minor,0)),0) AS mismatched
    FROM sx_training_invoices i
    LEFT JOIN (
      SELECT x.tenant_id,x.invoice_id,SUM(CAST(x.amount_minor AS DECIMAL(65,0))-CAST(COALESCE(r.reversed_minor,0) AS DECIMAL(65,0))) AS allocated_minor
      FROM sx_training_payment_allocations x
      JOIN sx_training_payments p ON p.tenant_id=x.tenant_id AND p.id=x.payment_id AND p.status='posted'
      LEFT JOIN (SELECT tenant_id,allocation_id,SUM(amount_minor) AS reversed_minor FROM sx_training_payment_allocation_reversals WHERE tenant_id=? GROUP BY tenant_id,allocation_id) r
        ON r.tenant_id=x.tenant_id AND r.allocation_id=x.id
      WHERE x.tenant_id=? GROUP BY x.tenant_id,x.invoice_id
    ) a ON a.tenant_id=i.tenant_id AND a.invoice_id=i.id
    LEFT JOIN (SELECT tenant_id,invoice_id,SUM(amount_minor) AS credited_minor FROM sx_training_credit_notes WHERE tenant_id=? AND status='posted' GROUP BY tenant_id,invoice_id) c
      ON c.tenant_id=i.tenant_id AND c.invoice_id=i.id
    WHERE i.tenant_id=? AND i.status='issued' AND i.issued_at>=? AND i.issued_at<?`,[tenantId,tenantId,tenantId,tenantId,window.start,window.end]);
  if(Number(totals.mismatched)>0)fail('Finance balances need reconciliation before this report can be shown.',500);
  const [[cashFlow]]=await connection.query(`SELECT COALESCE(SUM(CASE WHEN l.account_code IN ('cash','bank','cash_in_transit') THEN CAST(l.debit_minor AS DECIMAL(65,0))-CAST(l.credit_minor AS DECIMAL(65,0)) ELSE 0 END),0) AS net_collections_minor
    FROM sx_training_journal_entries e JOIN sx_training_journal_lines l ON l.tenant_id=e.tenant_id AND l.entry_id=e.id
    WHERE e.tenant_id=? AND e.occurred_at>=? AND e.occurred_at<? AND e.entry_type IN ('payment_posted','refund_posted','chargeback_posted')`,[tenantId,window.start,window.end]);
  return {currency:'QAR',invoiceScope:'issued_in_selected_period',issuedInvoiceCount:Number(totals.invoice_count),billedMinor:String(totals.billed_minor||0),collectedMinor:String(totals.collected_minor||0),creditedMinor:String(totals.credited_minor||0),outstandingMinor:String(totals.outstanding_minor||0),netCollectionsMinor:String(cashFlow.net_collections_minor||0)};
}
async function getActivityReport({pool,uid,role='owner',agentId,period='daily',at,timezone='Asia/Qatar',cutoffAt,page=1,limit=50}){
  if(!pool||typeof uid!=='string'||!uid)fail('A business workspace is required.',400);
  if(!['owner','manager','agent'].includes(role))fail('This role cannot view the legacy lead activity report.',403);
  if(role==='agent'&&(!Number.isSafeInteger(Number(agentId))||Number(agentId)<1))fail('Agent identity is invalid.',403);
  const currentPage=Number(page),pageSize=Number(limit);
  if(!Number.isSafeInteger(currentPage)||currentPage<1||currentPage>10000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)fail('Report page or page size is invalid.');
  const window=periodWindow({period,at,timezone,cutoffAt}),uidHash=hash(uid),db=typeof pool.promise==='function'?pool.promise():pool;
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
    const [[overdue]]=await connection.query(`SELECT COUNT(*) AS n FROM pipeline_leads l WHERE l.uid_hash=? AND l.next_follow_up_at<COALESCE(?,UTC_TIMESTAMP(3)) AND l.status='open'${agentScope}`,[uidHash,cutoffAt?moment.utc(cutoffAt).format('YYYY-MM-DD HH:mm:ss.SSS'):null,...(role==='agent'?[agentId]:[])]);
    const finance=role==='owner'?await getFinanceSummary(connection,uid,window):null;
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
    return {period:window.period,timezone:window.timezone,from:window.start,to:window.end,...(cutoffAt?{cutoffAt:moment.utc(cutoffAt).toISOString()}:{}),page:currentPage,limit:pageSize,total,hasMore:offset+events.length<total,
      summary:{leadsCreated:Number(created.n||0),leadsTouched:Number(counts.leads_touched||0),outcomes:Number(counts.outcomes||0),notes:Number(counts.notes||0),followUpsRequired:Number(followupsRequired.n||0),followUpsDue:Number(followups.n||0),followUpsOverdue:Number(overdue.n||0),outcomeCounts:outcomeRows.map(row=>({outcome:row.outcome,total:Number(row.total)}))},
      ...(finance?{finance}:{}),
      items:events.map(event=>({...event,details:parseDetails(event.details)}))};
  }catch(error){try{await connection.rollback();}catch(_){}throw error;}
  finally{connection.release();}
}
async function getJourneyReport({pool,uid,role='owner',agentId,period='daily',at,timezone='Asia/Qatar'}){
  if(!pool||typeof uid!=='string'||!uid)fail('A business workspace is required.',400);
  if(!['owner','manager','agent'].includes(role))fail('This role cannot view the lead journey report.',403);
  if(role==='agent'&&(!Number.isSafeInteger(Number(agentId))||Number(agentId)<1))fail('Agent identity is invalid.',403);
  const window=periodWindow({period,at,timezone}),uidHash=hash(uid),db=typeof pool.promise==='function'?pool.promise():pool,connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [stages]=await connection.query(`SELECT ps.stage_key AS stageKey,ps.title,ps.stage_type AS stageType,ps.position,COUNT(l.id) AS total
      FROM pipeline_stages ps LEFT JOIN pipeline_leads l ON l.uid_hash=ps.uid_hash AND l.uid=ps.uid AND l.stage_key=ps.stage_key${role==='agent'?' AND l.owner_agent_id=?':''}
      WHERE ps.uid_hash=? AND ps.uid=? GROUP BY ps.stage_key,ps.title,ps.stage_type,ps.position ORDER BY ps.position,ps.stage_key`,[...(role==='agent'?[agentId]:[]),uidHash,uid]);
    const [sources]=await connection.query(`SELECT l.source_type AS sourceType,l.primary_origin AS origin,COUNT(*) AS total
      FROM pipeline_leads l WHERE l.uid_hash=? AND l.uid=? AND l.created_at>=? AND l.created_at<?${role==='agent'?' AND l.owner_agent_id=?':''}
      GROUP BY l.source_type,l.primary_origin ORDER BY total DESC,l.source_type`,[uidHash,uid,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [[flow]]=await connection.query(`SELECT
      (SELECT COUNT(*) FROM pipeline_leads l WHERE l.uid_hash=? AND l.uid=? AND l.created_at>=? AND l.created_at<?${role==='agent'?' AND l.owner_agent_id=?':''}) AS new_leads,
      SUM(pa.activity_type='stage_changed') AS stage_changes,
      SUM(pa.activity_type='sale_converted') AS sales_converted,
      SUM(pa.activity_type='sale_converted' AND pa.actor_type='agent') AS sales_closed_by_agents,
      COUNT(DISTINCT CASE WHEN pa.activity_type IN ('contact_outcome','note_added') THEN pa.lead_id END) AS leads_attended
      FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
      WHERE pa.uid_hash=? AND l.uid=? AND pa.created_at>=? AND pa.created_at<?${role==='agent'?' AND l.owner_agent_id=?':''}`,[uidHash,uid,window.start,window.end,...(role==='agent'?[agentId]:[]),uidHash,uid,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [agentRows]=await connection.query(`SELECT a.id AS agentId,a.name AS agentName,a.is_active AS active,
      COUNT(DISTINCT l.id) AS assignedLeads,
      COUNT(DISTINCT CASE WHEN l.created_at>=? AND l.created_at<? THEN l.id END) AS newLeads,
      COUNT(DISTINCT CASE WHEN pa.activity_type IN ('contact_outcome','note_added') AND pa.created_at>=? AND pa.created_at<? THEN l.id END) AS attendedLeads,
      COUNT(DISTINCT CASE WHEN pa.activity_type='sale_converted' AND pa.created_at>=? AND pa.created_at<? THEN l.id END) AS salesAttributed,
      COUNT(DISTINCT CASE WHEN pa.activity_type='sale_converted' AND pa.actor_type='agent' AND pa.actor_id COLLATE utf8mb4_general_ci=CAST(a.id AS CHAR) COLLATE utf8mb4_general_ci AND pa.created_at>=? AND pa.created_at<? THEN l.id END) AS salesClosedByAgent
      FROM agents a LEFT JOIN pipeline_leads l ON l.uid_hash=? AND l.uid=? AND l.owner_agent_id=a.id
      LEFT JOIN pipeline_activity pa ON pa.uid_hash=l.uid_hash AND pa.lead_id=l.id AND pa.created_at>=? AND pa.created_at<?
      WHERE a.owner_uid COLLATE utf8mb4_general_ci=? COLLATE utf8mb4_general_ci${role==='agent'?' AND a.id=?':''} GROUP BY a.id,a.name,a.is_active ORDER BY salesClosedByAgent DESC,salesAttributed DESC,attendedLeads DESC,newLeads DESC,a.name`,[window.start,window.end,window.start,window.end,window.start,window.end,window.start,window.end,uidHash,uid,window.start,window.end,uid,...(role==='agent'?[agentId]:[])]);
    const [transitions]=await connection.query(`SELECT JSON_UNQUOTE(JSON_EXTRACT(pa.details,'$.stageTo')) AS stageKey,COUNT(*) AS total
      FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
      WHERE pa.uid_hash=? AND l.uid=? AND pa.activity_type='stage_changed' AND pa.created_at>=? AND pa.created_at<?${role==='agent'?' AND l.owner_agent_id=?':''}
      GROUP BY stageKey ORDER BY total DESC,stageKey`,[uidHash,uid,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [[learnerJourney]]=await connection.query(`SELECT COUNT(*) AS enrolled,
      SUM(e.started_at IS NOT NULL) AS course_started,SUM(e.completed_at IS NOT NULL) AS course_completed,
      SUM(cert.id IS NOT NULL) AS certificates_issued,
      SUM((SELECT COALESCE(SUM(CAST(a.amount_minor AS DECIMAL(65,0))-CAST(COALESCE((SELECT SUM(ar.amount_minor) FROM sx_training_payment_allocation_reversals ar WHERE ar.tenant_id=a.tenant_id AND ar.allocation_id=a.id),0) AS DECIMAL(65,0))),0)
        FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id AND p.status='posted'
        WHERE a.tenant_id=e.tenant_id AND a.invoice_id=i.id)>=i.total_minor) AS fully_paid
      FROM sx_training_enrollments e JOIN sx_training_invoices i ON i.tenant_id=e.tenant_id AND i.enrollment_id=e.id
      LEFT JOIN sx_training_certificates cert ON cert.tenant_id=e.tenant_id AND cert.enrollment_id=e.id
      WHERE e.legacy_uid_hash=? AND e.legacy_uid=?${role==='agent'?' AND e.lead_id IN (SELECT id FROM pipeline_leads WHERE uid_hash=? AND uid=? AND owner_agent_id=?)':''}`,[uidHash,uid,...(role==='agent'?[uidHash,uid,agentId]:[])]);
    const mappedStages=stages.map(row=>({...row,total:Number(row.total)})),mappedAgents=agentRows.map(row=>({agentId:Number(row.agentId),agentName:row.agentName||'Agent',active:Number(row.active)===1,assignedLeads:Number(row.assignedLeads),newLeads:Number(row.newLeads),attendedLeads:Number(row.attendedLeads),salesAttributed:Number(row.salesAttributed),salesClosedByAgent:Number(row.salesClosedByAgent)}));
    await connection.commit();return {period:window.period,timezone:window.timezone,from:window.start,to:window.end,asOf:new Date().toISOString(),summary:{newLeads:Number(flow.new_leads||0),leadsAttended:Number(flow.leads_attended||0),stageChanges:Number(flow.stage_changes||0),salesConverted:Number(flow.sales_converted||0),salesClosedByAgents:Number(flow.sales_closed_by_agents||0),openLeads:mappedStages.filter(row=>row.stageType==='open').reduce((sum,row)=>sum+row.total,0),wonLeads:mappedStages.filter(row=>row.stageType==='won').reduce((sum,row)=>sum+row.total,0),lostLeads:mappedStages.filter(row=>row.stageType==='lost').reduce((sum,row)=>sum+row.total,0)},learnerJourney:{enrolled:Number(learnerJourney.enrolled||0),courseStarted:Number(learnerJourney.course_started||0),courseCompleted:Number(learnerJourney.course_completed||0),fullyPaid:Number(learnerJourney.fully_paid||0),certificatesIssued:Number(learnerJourney.certificates_issued||0)},stages:mappedStages,sources:sources.map(row=>({...row,total:Number(row.total)})),stageTransitions:transitions.map(row=>({...row,total:Number(row.total)})),agents:mappedAgents};
  }catch(error){try{await connection.rollback();}catch(_){}throw error;}finally{connection.release();}
}
module.exports={periodWindow,getActivityReport,getJourneyReport};
