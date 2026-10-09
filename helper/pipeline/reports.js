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
async function getFinanceSummary(connection,uid,window,cutoffAt){
  const asOfMoment=cutoffAt?moment.utc(cutoffAt):moment.utc();if(!asOfMoment.isValid())fail('Report cutoff must be a valid timestamp.');const asOf=asOfMoment.format('YYYY-MM-DD HH:mm:ss.SSS');
  const tables=['sx_legacy_ownership','sx_tenants','sx_memberships','sx_training_invoices','sx_training_installments','sx_training_payment_allocations','sx_training_payments','sx_training_payment_allocation_reversals','sx_training_refunds','sx_training_payment_disputes','sx_training_credit_notes','sx_training_credit_allocations','sx_training_journal_entries','sx_training_journal_lines'];
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
      JOIN sx_training_payments p ON p.tenant_id=x.tenant_id AND p.id=x.payment_id AND p.status='posted' AND p.verified_at<=?
      LEFT JOIN (SELECT tenant_id,allocation_id,SUM(amount_minor) AS reversed_minor FROM sx_training_payment_allocation_reversals WHERE tenant_id=? AND created_at<=? GROUP BY tenant_id,allocation_id) r
        ON r.tenant_id=x.tenant_id AND r.allocation_id=x.id
      WHERE x.tenant_id=? GROUP BY x.tenant_id,x.invoice_id
    ) a ON a.tenant_id=i.tenant_id AND a.invoice_id=i.id
    LEFT JOIN (SELECT tenant_id,invoice_id,SUM(amount_minor) AS credited_minor FROM sx_training_credit_notes WHERE tenant_id=? AND status='posted' AND reviewed_at<=? GROUP BY tenant_id,invoice_id) c
      ON c.tenant_id=i.tenant_id AND c.invoice_id=i.id
    WHERE i.tenant_id=? AND i.status='issued' AND i.issued_at>=? AND i.issued_at<?`,[asOf,tenantId,asOf,tenantId,tenantId,asOf,tenantId,window.start,window.end]);
  const [[cashReceived]]=await connection.query(`SELECT COUNT(*) AS payment_count,COALESCE(SUM(amount_minor),0) AS received_minor
    FROM sx_training_payments WHERE tenant_id=? AND status='posted' AND verified_at<=? AND received_at>=? AND received_at<?`,[tenantId,asOf,window.start,window.end]);
  const [[refunds]]=await connection.query(`SELECT COUNT(*) AS refund_count,COALESCE(SUM(amount_minor),0) AS refunded_minor
    FROM sx_training_refunds WHERE tenant_id=? AND status='completed' AND completed_at<=? AND completed_at>=? AND completed_at<?`,[tenantId,asOf,window.start,window.end]);
  const [[creditsIssued]]=await connection.query(`SELECT COUNT(*) AS credit_count,COALESCE(SUM(amount_minor),0) AS credit_minor
    FROM sx_training_credit_notes WHERE tenant_id=? AND status='posted' AND reviewed_at<=? AND reviewed_at>=? AND reviewed_at<?`,[tenantId,asOf,window.start,window.end]);
  const [[disputes]]=await connection.query(`SELECT SUM(created_at>=? AND created_at<? AND created_at<=?) AS reported_count,COALESCE(SUM(CASE WHEN created_at>=? AND created_at<? AND created_at<=? THEN amount_minor ELSE 0 END),0) AS reported_minor,
      SUM(created_at<=? AND (status='open' OR resolved_at>?)) AS open_count,COALESCE(SUM(CASE WHEN created_at<=? AND (status='open' OR resolved_at>?) THEN amount_minor ELSE 0 END),0) AS open_minor
    FROM sx_training_payment_disputes WHERE tenant_id=?`,[window.start,window.end,asOf,window.start,window.end,asOf,asOf,asOf,asOf,asOf,tenantId]);
  const [[receivable]]=await connection.query(`SELECT COALESCE(SUM(GREATEST(i.total_minor-COALESCE(a.allocated_minor,0)-COALESCE(c.credited_minor,0),0)),0) AS outstanding_minor,
      SUM(i.total_minor<COALESCE(a.allocated_minor,0)+COALESCE(c.credited_minor,0)) AS mismatch_count
    FROM sx_training_invoices i
    LEFT JOIN (SELECT x.tenant_id,x.invoice_id,SUM(CAST(x.amount_minor AS DECIMAL(65,0))-CAST(COALESCE(r.reversed_minor,0) AS DECIMAL(65,0))) AS allocated_minor
      FROM sx_training_payment_allocations x JOIN sx_training_payments p ON p.tenant_id=x.tenant_id AND p.id=x.payment_id AND p.status='posted' AND p.verified_at<=?
      LEFT JOIN (SELECT tenant_id,allocation_id,SUM(amount_minor) AS reversed_minor FROM sx_training_payment_allocation_reversals WHERE tenant_id=? AND created_at<=? GROUP BY tenant_id,allocation_id) r ON r.tenant_id=x.tenant_id AND r.allocation_id=x.id
      WHERE x.tenant_id=? GROUP BY x.tenant_id,x.invoice_id) a ON a.tenant_id=i.tenant_id AND a.invoice_id=i.id
    LEFT JOIN (SELECT tenant_id,invoice_id,SUM(amount_minor) AS credited_minor FROM sx_training_credit_notes WHERE tenant_id=? AND status='posted' AND reviewed_at<=? GROUP BY tenant_id,invoice_id) c ON c.tenant_id=i.tenant_id AND c.invoice_id=i.id
    WHERE i.tenant_id=? AND i.status='issued' AND i.issued_at<=?`,[asOf,tenantId,asOf,tenantId,tenantId,asOf,tenantId,asOf]);
  const asOfDate=moment.utc(asOf).tz(window.timezone).format('YYYY-MM-DD');
  const [agingRows]=await connection.query(`SELECT CASE WHEN x.due_date>=? THEN 'current' WHEN DATEDIFF(?,x.due_date)<=30 THEN '1-30' WHEN DATEDIFF(?,x.due_date)<=60 THEN '31-60' WHEN DATEDIFF(?,x.due_date)<=90 THEN '61-90' ELSE '90+' END AS bucket,
      COALESCE(SUM(GREATEST(x.amount_minor-COALESCE(a.applied_minor,0)-COALESCE(c.credited_minor,0),0)),0) AS outstanding_minor,
      COUNT(DISTINCT CASE WHEN x.due_date<? THEN i.id END) AS overdue_invoice_count
    FROM sx_training_installments x JOIN sx_training_invoices i ON i.tenant_id=x.tenant_id AND i.id=x.invoice_id AND i.status='issued'
    LEFT JOIN (SELECT a.tenant_id,a.installment_id,SUM(a.amount_minor-COALESCE(r.reversed_minor,0)) AS applied_minor FROM sx_training_payment_allocations a
      JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id AND p.status='posted' AND p.verified_at<=?
      LEFT JOIN (SELECT tenant_id,allocation_id,SUM(amount_minor) AS reversed_minor FROM sx_training_payment_allocation_reversals WHERE tenant_id=? AND created_at<=? GROUP BY tenant_id,allocation_id) r ON r.tenant_id=a.tenant_id AND r.allocation_id=a.id
      WHERE a.tenant_id=? GROUP BY a.tenant_id,a.installment_id) a ON a.tenant_id=x.tenant_id AND a.installment_id=x.id
    LEFT JOIN (SELECT ca.tenant_id,ca.installment_id,SUM(ca.amount_minor) AS credited_minor FROM sx_training_credit_allocations ca
      JOIN sx_training_credit_notes cn ON cn.tenant_id=ca.tenant_id AND cn.id=ca.credit_note_id AND cn.status='posted' AND cn.reviewed_at<=? WHERE ca.tenant_id=? GROUP BY ca.tenant_id,ca.installment_id) c ON c.tenant_id=x.tenant_id AND c.installment_id=x.id
    WHERE x.tenant_id=? AND x.status<>'cancelled' AND i.issued_at<=? GROUP BY bucket`,[asOfDate,asOfDate,asOfDate,asOfDate,asOfDate,asOf,tenantId,asOf,tenantId,asOf,tenantId,tenantId,asOf]);
  const aging=Object.fromEntries(['current','1-30','31-60','61-90','90+'].map(key=>{const row=agingRows.find(item=>item.bucket===key);return [key,{outstandingMinor:String(row?.outstanding_minor||0),overdueInvoiceCount:key==='current'?0:Number(row?.overdue_invoice_count||0)}];}));
  const [[cashFlow]]=await connection.query(`SELECT COALESCE(SUM(CASE WHEN l.account_code IN ('cash','bank','cash_in_transit') THEN CAST(l.debit_minor AS DECIMAL(65,0))-CAST(l.credit_minor AS DECIMAL(65,0)) ELSE 0 END),0) AS net_collections_minor
    FROM sx_training_journal_entries e JOIN sx_training_journal_lines l ON l.tenant_id=e.tenant_id AND l.entry_id=e.id
    WHERE e.tenant_id=? AND e.occurred_at>=? AND e.occurred_at<? AND e.created_at<=? AND e.entry_type IN ('payment_posted','refund_posted','chargeback_posted')`,[tenantId,window.start,window.end,asOf]);
  return {currency:'QAR',invoiceScope:'issued_in_selected_period',issuedInvoiceCount:Number(totals.invoice_count),billedMinor:String(totals.billed_minor||0),
    collectedOnPeriodIssuedInvoicesMinor:String(totals.collected_minor||0),creditedOnPeriodIssuedInvoicesMinor:String(totals.credited_minor||0),outstandingOnPeriodIssuedInvoicesMinor:String(totals.outstanding_minor||0),
    cashReceivedMinor:String(cashReceived.received_minor||0),paymentsReceivedCount:Number(cashReceived.payment_count||0),refundsPaidMinor:String(refunds.refunded_minor||0),refundCount:Number(refunds.refund_count||0),
    creditsIssuedMinor:String(creditsIssued.credit_minor||0),creditNotesIssuedCount:Number(creditsIssued.credit_count||0),disputesReportedCount:Number(disputes.reported_count||0),disputesReportedMinor:String(disputes.reported_minor||0),openDisputesCount:Number(disputes.open_count||0),openDisputesMinor:String(disputes.open_minor||0),netCollectionsMinor:String(cashFlow.net_collections_minor||0),
    receivablesAsOf:moment.utc(asOf).toISOString(),allOutstandingMinor:String(receivable.outstanding_minor||0),overdueReceivablesMinor:Object.entries(aging).filter(([key])=>key!=='current').reduce((sum,[,value])=>sum+BigInt(value.outstandingMinor),0n).toString(),receivablesAging:aging,reconciliation:{status:Number(totals.mismatched||0)+Number(receivable.mismatch_count||0)>0?'attention':'clear',
      periodIssuedInvoiceMismatchCount:Number(totals.mismatched||0),allInvoiceMismatchCount:Number(receivable.mismatch_count||0)}};
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
      SUM(pa.activity_type='agent_message_sent') AS agent_replies,
      COUNT(DISTINCT pa.lead_id) AS leads_touched
      FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
      WHERE pa.uid_hash=? AND pa.created_at>=? AND pa.created_at<? AND pa.activity_type IN ('contact_outcome','note_added','agent_message_sent')${agentScope}`,[uidHash,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [[cohortContact]]=await connection.query(`SELECT COUNT(DISTINCT l.id) AS contacted FROM pipeline_leads l
      JOIN pipeline_activity pa ON pa.uid_hash=l.uid_hash AND pa.lead_id=l.id AND pa.created_at>=? AND pa.created_at<?
        AND pa.activity_type IN ('contact_outcome','agent_message_sent')
      WHERE l.uid_hash=? AND l.created_at>=? AND l.created_at<?${agentScope}`,[window.start,window.end,uidHash,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [outcomeRows]=await connection.query(`SELECT JSON_UNQUOTE(JSON_EXTRACT(pa.details,'$.outcome')) AS outcome,COUNT(*) AS total
      FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
      WHERE pa.uid_hash=? AND pa.created_at>=? AND pa.created_at<? AND pa.activity_type='contact_outcome'${agentScope}
      GROUP BY outcome ORDER BY total DESC,outcome`,[uidHash,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [[followups]]=await connection.query(`SELECT COUNT(*) AS n FROM pipeline_leads l WHERE l.uid_hash=? AND l.next_follow_up_at>=? AND l.next_follow_up_at<? AND l.status='open'${agentScope}`,[uidHash,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [[followupsRequired]]=await connection.query(`SELECT COUNT(*) AS n FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
      WHERE pa.uid_hash=? AND pa.created_at>=? AND pa.created_at<? AND pa.activity_type='contact_outcome'
      AND JSON_UNQUOTE(JSON_EXTRACT(pa.details,'$.followUpRequired'))='true'${agentScope}`,[uidHash,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [[overdue]]=await connection.query(`SELECT COUNT(*) AS n FROM pipeline_leads l WHERE l.uid_hash=? AND l.next_follow_up_at<COALESCE(?,UTC_TIMESTAMP(3)) AND l.status='open'${agentScope}`,[uidHash,cutoffAt?moment.utc(cutoffAt).format('YYYY-MM-DD HH:mm:ss.SSS'):null,...(role==='agent'?[agentId]:[])]);
    const finance=role==='owner'?await getFinanceSummary(connection,uid,window,cutoffAt):null;
    const offset=(currentPage-1)*pageSize;
    const [events]=await connection.query(`SELECT pa.id,pa.lead_id AS leadId,pa.actor_type AS actorType,
      CASE WHEN pa.actor_type='agent' THEN COALESCE(a.name,'Agent') WHEN pa.actor_type='system' THEN 'System' ELSE 'Business user' END AS attendedBy,
      pa.activity_type AS activityType,pa.summary,pa.details,pa.created_at AS occurredAt,
      l.title AS leadTitle,COALESCE(c.display_name,l.contact_name) AS contactName,l.mobile,l.stage_key AS stageKey,l.next_follow_up_at AS nextFollowUpAt
      FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
      LEFT JOIN pipeline_contacts c ON c.uid_hash=l.uid_hash AND c.id=l.contact_id
      LEFT JOIN agents a ON pa.actor_type='agent' AND a.id=CAST(IF(pa.actor_id REGEXP '^[0-9]+$',pa.actor_id,'0') AS UNSIGNED)
        AND a.owner_uid COLLATE utf8mb4_general_ci=l.uid COLLATE utf8mb4_general_ci
      WHERE pa.uid_hash=? AND pa.created_at>=? AND pa.created_at<? AND pa.activity_type IN ('contact_outcome','note_added','agent_message_sent')${agentScope}
      ORDER BY pa.created_at DESC,pa.id DESC LIMIT ? OFFSET ?`,[uidHash,window.start,window.end,...(role==='agent'?[agentId]:[]),pageSize,offset]);
    const total=Number(counts?.outcomes||0)+Number(counts?.notes||0)+Number(counts?.agent_replies||0);
    await connection.commit();
    return {period:window.period,timezone:window.timezone,from:window.start,to:window.end,...(cutoffAt?{cutoffAt:moment.utc(cutoffAt).toISOString()}:{}),page:currentPage,limit:pageSize,total,hasMore:offset+events.length<total,
      summary:{leadsCreated:Number(created.n||0),newLeadsContacted:Number(cohortContact.contacted||0),newLeadsUntouched:Math.max(0,Number(created.n||0)-Number(cohortContact.contacted||0)),leadsTouched:Number(counts.leads_touched||0),outcomes:Number(counts.outcomes||0),notes:Number(counts.notes||0),agentReplies:Number(counts.agent_replies||0),followUpsRequired:Number(followupsRequired.n||0),followUpsDue:Number(followups.n||0),followUpsOverdue:Number(overdue.n||0),outcomeCounts:outcomeRows.map(row=>({outcome:row.outcome,total:Number(row.total)}))},
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
    const [stages]=await connection.query(`SELECT ps.stage_key AS stageKey,ps.title,ps.stage_type AS stageType,ps.position,COUNT(l.id) AS total,
      COUNT(CASE WHEN l.created_at>=? AND l.created_at<? THEN l.id END) AS cohortTotal
      FROM pipeline_stages ps LEFT JOIN pipeline_leads l ON l.uid_hash=ps.uid_hash AND l.uid=ps.uid AND l.stage_key=ps.stage_key${role==='agent'?' AND l.owner_agent_id=?':''}
      WHERE ps.uid_hash=? AND ps.uid=? GROUP BY ps.stage_key,ps.title,ps.stage_type,ps.position ORDER BY ps.position,ps.stage_key`,[window.start,window.end,...(role==='agent'?[agentId]:[]),uidHash,uid]);
    const [sources]=await connection.query(`SELECT l.source_type AS sourceType,l.primary_origin AS origin,COUNT(*) AS total
      FROM pipeline_leads l WHERE l.uid_hash=? AND l.uid=? AND l.created_at>=? AND l.created_at<?${role==='agent'?' AND l.owner_agent_id=?':''}
      GROUP BY l.source_type,l.primary_origin ORDER BY total DESC,l.source_type`,[uidHash,uid,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [[flow]]=await connection.query(`SELECT
      (SELECT COUNT(*) FROM pipeline_leads l WHERE l.uid_hash=? AND l.uid=? AND l.created_at>=? AND l.created_at<?${role==='agent'?' AND l.owner_agent_id=?':''}) AS new_leads,
      SUM(pa.activity_type='stage_changed') AS stage_changes,
      SUM(pa.activity_type='sale_converted') AS sales_converted,
      SUM(pa.activity_type='sale_converted' AND pa.actor_type='agent') AS sales_closed_by_agents,
      COUNT(DISTINCT CASE WHEN pa.activity_type IN ('contact_outcome','agent_message_sent') THEN pa.lead_id END) AS leads_attended
      FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
      WHERE pa.uid_hash=? AND l.uid=? AND pa.created_at>=? AND pa.created_at<?${role==='agent'?' AND l.owner_agent_id=?':''}`,[uidHash,uid,window.start,window.end,...(role==='agent'?[agentId]:[]),uidHash,uid,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [agentRows]=await connection.query(`SELECT a.id AS agentId,a.name AS agentName,a.is_active AS active,
      COUNT(DISTINCT l.id) AS assignedLeads,
      COUNT(DISTINCT CASE WHEN l.created_at>=? AND l.created_at<? THEN l.id END) AS newLeads,
      COUNT(DISTINCT CASE WHEN l.next_follow_up_at>=? AND l.next_follow_up_at<? AND l.status='open' THEN l.id END) AS followUpsDue,
      COUNT(DISTINCT CASE WHEN l.next_follow_up_at<? AND l.status='open' THEN l.id END) AS followUpsOverdue,
      COALESCE(MAX(attendance.attended_leads),0) AS attendedLeads,
      COALESCE(MAX(attendance.agent_replies),0) AS agentReplies,
      COALESCE(MAX(sales.sales_attributed),0) AS salesAttributed,
      COALESCE(MAX(sales.sales_closed_by_agent),0) AS salesClosedByAgent
      FROM agents a LEFT JOIN pipeline_leads l ON l.uid_hash=? AND l.uid=? AND l.owner_agent_id=a.id
      LEFT JOIN (
        SELECT CAST(pa.actor_id AS UNSIGNED) AS agent_id,COUNT(DISTINCT pa.lead_id) AS attended_leads,SUM(pa.activity_type='agent_message_sent') AS agent_replies
        FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
        WHERE pa.uid_hash=? AND l.uid=? AND pa.actor_type='agent' AND pa.actor_id REGEXP '^[0-9]+$'
          AND pa.activity_type IN ('contact_outcome','agent_message_sent') AND pa.created_at>=? AND pa.created_at<?
        GROUP BY CAST(pa.actor_id AS UNSIGNED)
      ) attendance ON attendance.agent_id=a.id
      LEFT JOIN (
        SELECT e.legacy_uid_hash,e.legacy_uid,c.sales_agent_id,
          COUNT(DISTINCT c.id) AS sales_attributed,
          COUNT(DISTINCT CASE WHEN c.confirmed_by_actor_type='agent'
          AND c.confirmed_by_actor_id COLLATE ascii_bin=CAST(c.sales_agent_id AS CHAR CHARACTER SET ascii) COLLATE ascii_bin
            THEN c.id END) AS sales_closed_by_agent
        FROM sx_training_sale_conversions c
        JOIN sx_training_enrollments e ON e.tenant_id=c.tenant_id AND e.id=c.enrollment_id
        JOIN sx_training_invoices i ON i.tenant_id=c.tenant_id AND i.id=c.invoice_id
        WHERE e.legacy_uid_hash=? AND e.legacy_uid=? AND c.sales_agent_id IS NOT NULL
          AND i.issued_at>=? AND i.issued_at<?
        GROUP BY e.legacy_uid_hash,e.legacy_uid,c.sales_agent_id
      ) sales ON sales.legacy_uid_hash=? AND sales.legacy_uid=? AND sales.sales_agent_id=a.id
      WHERE a.owner_uid COLLATE utf8mb4_general_ci=? COLLATE utf8mb4_general_ci${role==='agent'?' AND a.id=?':''} GROUP BY a.id,a.name,a.is_active ORDER BY salesClosedByAgent DESC,salesAttributed DESC,attendedLeads DESC,newLeads DESC,a.name`,[window.start,window.end,window.start,window.end,window.end,uidHash,uid,uidHash,uid,window.start,window.end,uidHash,uid,window.start,window.end,uidHash,uid,uid,...(role==='agent'?[agentId]:[])]);
    const [transitions]=await connection.query(`SELECT JSON_UNQUOTE(JSON_EXTRACT(pa.details,'$.stageTo')) AS stageKey,COUNT(*) AS total
      FROM pipeline_activity pa JOIN pipeline_leads l ON l.uid_hash=pa.uid_hash AND l.id=pa.lead_id
      WHERE pa.uid_hash=? AND l.uid=? AND pa.activity_type='stage_changed' AND pa.created_at>=? AND pa.created_at<?${role==='agent'?' AND l.owner_agent_id=?':''}
      GROUP BY stageKey ORDER BY total DESC,stageKey`,[uidHash,uid,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const [[cohortFunnel]]=await connection.query(`WITH cohort_leads AS (
      SELECT l.id,l.uid_hash,l.uid FROM pipeline_leads l
      WHERE l.uid_hash=? AND l.uid=? AND l.created_at>=? AND l.created_at<?${role==='agent'?' AND l.owner_agent_id=?':''}
    ) SELECT COUNT(*) AS new_leads,
      COALESCE(SUM(EXISTS(SELECT 1 FROM pipeline_activity pa WHERE pa.uid_hash=c.uid_hash AND pa.lead_id=c.id AND pa.activity_type IN ('contact_outcome','agent_message_sent'))),0) AS attended,
      COALESCE(SUM(EXISTS(SELECT 1 FROM pipeline_activity pa WHERE pa.uid_hash=c.uid_hash AND pa.lead_id=c.id AND pa.activity_type='contact_outcome' AND JSON_UNQUOTE(JSON_EXTRACT(pa.details,'$.outcome'))='interested')),0) AS interested,
      COALESCE(SUM(EXISTS(SELECT 1 FROM pipeline_activity pa WHERE pa.uid_hash=c.uid_hash AND pa.lead_id=c.id AND pa.activity_type='contact_outcome' AND (JSON_UNQUOTE(JSON_EXTRACT(pa.details,'$.followUpRequired'))='true' OR JSON_UNQUOTE(JSON_EXTRACT(pa.details,'$.outcome'))='follow_up_scheduled'))),0) AS follow_up,
      COALESCE(SUM(EXISTS(SELECT 1 FROM sx_training_sale_conversions sc JOIN sx_training_enrollments e ON e.tenant_id=sc.tenant_id AND e.id=sc.enrollment_id WHERE e.legacy_uid_hash=c.uid_hash AND e.legacy_uid=c.uid AND e.lead_id=c.id)),0) AS sales_converted,
      COALESCE(SUM(EXISTS(SELECT 1 FROM sx_training_enrollments e JOIN sx_training_invoices i ON i.tenant_id=e.tenant_id AND i.enrollment_id=e.id AND i.status='issued' WHERE e.legacy_uid_hash=c.uid_hash AND e.legacy_uid=c.uid AND e.lead_id=c.id)),0) AS invoices_issued,
      COALESCE(SUM(EXISTS(SELECT 1 FROM sx_training_enrollments e JOIN sx_training_invoices i ON i.tenant_id=e.tenant_id AND i.enrollment_id=e.id JOIN sx_training_receipts r ON r.tenant_id=i.tenant_id AND r.invoice_id=i.id WHERE e.legacy_uid_hash=c.uid_hash AND e.legacy_uid=c.uid AND e.lead_id=c.id)),0) AS payment_received,
      COALESCE(SUM(EXISTS(SELECT 1 FROM sx_training_enrollments e WHERE e.legacy_uid_hash=c.uid_hash AND e.legacy_uid=c.uid AND e.lead_id=c.id AND e.started_at IS NOT NULL)),0) AS course_started,
      COALESCE(SUM(EXISTS(SELECT 1 FROM sx_training_enrollments e JOIN sx_training_invoices i ON i.tenant_id=e.tenant_id AND i.enrollment_id=e.id AND i.status='issued' WHERE e.legacy_uid_hash=c.uid_hash AND e.legacy_uid=c.uid AND e.lead_id=c.id AND (SELECT COALESCE(SUM(CAST(a.amount_minor AS DECIMAL(65,0))-CAST(COALESCE((SELECT SUM(ar.amount_minor) FROM sx_training_payment_allocation_reversals ar WHERE ar.tenant_id=a.tenant_id AND ar.allocation_id=a.id),0) AS DECIMAL(65,0))),0) FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id AND p.status='posted' WHERE a.tenant_id=e.tenant_id AND a.invoice_id=i.id)>=i.total_minor)),0) AS fully_paid,
      COALESCE(SUM(EXISTS(SELECT 1 FROM sx_training_enrollments e WHERE e.legacy_uid_hash=c.uid_hash AND e.legacy_uid=c.uid AND e.lead_id=c.id AND e.completed_at IS NOT NULL)),0) AS course_completed,
      COALESCE(SUM(EXISTS(SELECT 1 FROM sx_training_enrollments e JOIN sx_training_certificates cert ON cert.tenant_id=e.tenant_id AND cert.enrollment_id=e.id WHERE e.legacy_uid_hash=c.uid_hash AND e.legacy_uid=c.uid AND e.lead_id=c.id)),0) AS certificate_issued
      FROM cohort_leads c`,[uidHash,uid,window.start,window.end,...(role==='agent'?[agentId]:[])]);
    const learnerScope=role==='agent'?` AND EXISTS (SELECT 1 FROM sx_training_sale_conversions attributed
      WHERE attributed.tenant_id=e.tenant_id AND attributed.enrollment_id=e.id AND attributed.sales_agent_id=?)`:'';
    const metricWindowArgs=()=>[uidHash,uid,window.start,window.end,...(role==='agent'?[agentId]:[])];
    const [[journeyActivity]]=await connection.query(`WITH journey_events AS (
      SELECT 'invoice_issued' AS event_type,i.id AS event_id,0 AS amount_minor
      FROM sx_training_invoices i JOIN sx_training_enrollments e ON e.tenant_id=i.tenant_id AND e.id=i.enrollment_id
      WHERE e.legacy_uid_hash=? AND e.legacy_uid=? AND i.status='issued' AND i.issued_at>=? AND i.issued_at<?${learnerScope}
      UNION ALL
      SELECT 'payment_received',r.id,r.amount_minor
      FROM sx_training_receipts r JOIN sx_training_invoices i ON i.tenant_id=r.tenant_id AND i.id=r.invoice_id
      JOIN sx_training_enrollments e ON e.tenant_id=i.tenant_id AND e.id=i.enrollment_id
      WHERE e.legacy_uid_hash=? AND e.legacy_uid=? AND r.issued_at>=? AND r.issued_at<?${learnerScope}
      UNION ALL
      SELECT ev.event_type,ev.id,0
      FROM sx_training_enrollment_events ev JOIN sx_training_enrollments e ON e.tenant_id=ev.tenant_id AND e.id=ev.enrollment_id
      WHERE e.legacy_uid_hash=? AND e.legacy_uid=? AND ev.created_at>=? AND ev.created_at<? AND ev.event_type IN ('course_started','course_completed')${learnerScope}
      UNION ALL
      SELECT 'certificate_issued',cert.id,0
      FROM sx_training_certificates cert JOIN sx_training_enrollments e ON e.tenant_id=cert.tenant_id AND e.id=cert.enrollment_id
      WHERE e.legacy_uid_hash=? AND e.legacy_uid=? AND cert.issued_at>=? AND cert.issued_at<?${learnerScope}
    ) SELECT COUNT(DISTINCT CASE WHEN event_type='invoice_issued' THEN event_id END) AS invoices_issued,
      COUNT(DISTINCT CASE WHEN event_type='payment_received' THEN event_id END) AS payment_receipts_issued,
      COALESCE(SUM(CASE WHEN event_type='payment_received' THEN amount_minor ELSE 0 END),0) AS payments_received_minor,
      COUNT(DISTINCT CASE WHEN event_type='course_started' THEN event_id END) AS courses_started,
      COUNT(DISTINCT CASE WHEN event_type='course_completed' THEN event_id END) AS courses_completed,
      COUNT(DISTINCT CASE WHEN event_type='certificate_issued' THEN event_id END) AS certificates_issued
      FROM journey_events`,[...metricWindowArgs(),...metricWindowArgs(),...metricWindowArgs(),...metricWindowArgs()]);
    const [[learnerJourney]]=await connection.query(`SELECT COUNT(*) AS enrolled,
      SUM(e.started_at IS NOT NULL) AS course_started,SUM(e.completed_at IS NOT NULL) AS course_completed,
      SUM(cert.id IS NOT NULL) AS certificates_issued,
      SUM((SELECT COALESCE(SUM(CAST(a.amount_minor AS DECIMAL(65,0))-CAST(COALESCE((SELECT SUM(ar.amount_minor) FROM sx_training_payment_allocation_reversals ar WHERE ar.tenant_id=a.tenant_id AND ar.allocation_id=a.id),0) AS DECIMAL(65,0))),0)
        FROM sx_training_payment_allocations a JOIN sx_training_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id AND p.status='posted'
        WHERE a.tenant_id=e.tenant_id AND a.invoice_id=i.id)>=i.total_minor) AS fully_paid
      FROM sx_training_enrollments e JOIN sx_training_invoices i ON i.tenant_id=e.tenant_id AND i.enrollment_id=e.id
      LEFT JOIN sx_training_certificates cert ON cert.tenant_id=e.tenant_id AND cert.enrollment_id=e.id
      WHERE e.legacy_uid_hash=? AND e.legacy_uid=?${learnerScope}`,[uidHash,uid,...(role==='agent'?[agentId]:[])]);
    const mappedStages=stages.map(row=>({...row,total:Number(row.total),cohortTotal:Number(row.cohortTotal||0)})),mappedAgents=agentRows.map(row=>({agentId:Number(row.agentId),agentName:row.agentName||'Agent',active:Number(row.active)===1,assignedLeads:Number(row.assignedLeads),newLeads:Number(row.newLeads),attendedLeads:Number(row.attendedLeads),agentReplies:Number(row.agentReplies||0),followUpsDue:Number(row.followUpsDue||0),followUpsOverdue:Number(row.followUpsOverdue||0),salesAttributed:Number(row.salesAttributed),salesClosedByAgent:Number(row.salesClosedByAgent)}));
    const report={period:window.period,timezone:window.timezone,from:window.start,to:window.end,asOf:new Date().toISOString(),
      summary:{newLeads:Number(flow.new_leads||0),leadsAttended:Number(flow.leads_attended||0),stageChanges:Number(flow.stage_changes||0),salesConverted:Number(flow.sales_converted||0),salesClosedByAgents:Number(flow.sales_closed_by_agents||0),openLeads:mappedStages.filter(row=>row.stageType==='open').reduce((sum,row)=>sum+row.total,0),wonLeads:mappedStages.filter(row=>row.stageType==='won').reduce((sum,row)=>sum+row.total,0),lostLeads:mappedStages.filter(row=>row.stageType==='lost').reduce((sum,row)=>sum+row.total,0)},
      cohortFunnel:{newLeads:Number(cohortFunnel.new_leads||0),attended:Number(cohortFunnel.attended||0),interested:Number(cohortFunnel.interested||0),followUp:Number(cohortFunnel.follow_up||0),salesConverted:Number(cohortFunnel.sales_converted||0),invoicesIssued:Number(cohortFunnel.invoices_issued||0),paymentReceived:Number(cohortFunnel.payment_received||0),courseStarted:Number(cohortFunnel.course_started||0),fullyPaid:Number(cohortFunnel.fully_paid||0),courseCompleted:Number(cohortFunnel.course_completed||0),certificateIssued:Number(cohortFunnel.certificate_issued||0)},
      journeyActivity:{invoicesIssued:Number(journeyActivity.invoices_issued||0),paymentReceiptsIssued:Number(journeyActivity.payment_receipts_issued||0),paymentsReceivedMinor:String(journeyActivity.payments_received_minor||0),coursesStarted:Number(journeyActivity.courses_started||0),coursesCompleted:Number(journeyActivity.courses_completed||0),certificatesIssued:Number(journeyActivity.certificates_issued||0)},
      learnerJourney:{enrolled:Number(learnerJourney.enrolled||0),courseStarted:Number(learnerJourney.course_started||0),courseCompleted:Number(learnerJourney.course_completed||0),fullyPaid:Number(learnerJourney.fully_paid||0),certificatesIssued:Number(learnerJourney.certificates_issued||0)},
      stages:mappedStages,sources:sources.map(row=>({...row,total:Number(row.total)})),stageTransitions:transitions.map(row=>({...row,total:Number(row.total)})),agents:mappedAgents};
    await connection.commit();return report;
  }catch(error){try{await connection.rollback();}catch(_){}throw error;}finally{connection.release();}
}
module.exports={periodWindow,getActivityReport,getJourneyReport};
