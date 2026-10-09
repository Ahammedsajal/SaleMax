const test=require('node:test');
const assert=require('node:assert/strict');
const {periodWindow,getActivityReport,getJourneyReport}=require('../helper/pipeline/reports');

test('pipeline reports define Qatar-local daily, Monday-weekly and monthly periods',()=>{
  assert.deepEqual(periodWindow({period:'daily',at:'2026-10-01',timezone:'Asia/Qatar'}),{period:'daily',timezone:'Asia/Qatar',start:'2026-09-30 21:00:00.000',end:'2026-10-01 21:00:00.000'});
  assert.equal(periodWindow({period:'weekly',at:'2026-10-01',timezone:'Asia/Qatar'}).start,'2026-09-27 21:00:00.000');
  assert.equal(periodWindow({period:'monthly',at:'2026-10-01',timezone:'Asia/Qatar'}).end,'2026-10-31 21:00:00.000');
});

test('pipeline reports reject unsupported periods, invalid dates, roles and paging before database access',async()=>{
  assert.throws(()=>periodWindow({period:'quarterly',timezone:'Asia/Qatar'}),{status:400});
  assert.throws(()=>periodWindow({period:'daily',at:'2026-13-40',timezone:'Asia/Qatar'}),{status:400});
  assert.throws(()=>periodWindow({period:'daily',timezone:'Mars/Doha'}),{status:400});
  const pool={getConnection(){throw new Error('must not connect')}};
  await assert.rejects(getActivityReport({pool,uid:'synthetic',role:'accountant'}),{status:403});
  await assert.rejects(getActivityReport({pool,uid:'synthetic',role:'owner',page:0}),{status:400});
});

test('managers can read sales activity reports without receiving finance totals',async()=>{
  const queries=[];
  const connection={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql){queries.push(sql);
    if(sql.includes('SUM(pa.activity_type'))return [[{outcomes:0,notes:0,leads_touched:0}]];
    if(sql.includes('GROUP BY outcome'))return [[]];
    if(sql.includes('SELECT pa.id'))return [[]];
    return [[{n:0}]];
  }};
  const report=await getActivityReport({pool:{async getConnection(){return connection;}},uid:'business-owner',role:'manager',period:'daily',at:'2026-10-01'});
  assert.equal(report.period,'daily');
  assert.deepEqual(report.finance,undefined);
  assert.equal(queries.some(sql=>sql.includes('information_schema.TABLES')),false);
});

test('activity reports include agent WhatsApp replies with attribution and channel but no message text',async()=>{
  const queries=[];
  const reply={id:91,leadId:'lead-1',actorType:'agent',actorId:'17',attendedBy:'Mona',activityType:'agent_message_sent',summary:'Agent replied in WhatsApp conversation',details:{origin:'meta',providerMessageId:'provider-1'},occurredAt:'2026-10-01 10:00:00',leadTitle:'Course enquiry',contactName:'Aisha',mobile:'+97455555555'};
  const connection={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql){queries.push(sql);
    if(sql.includes('SUM(pa.activity_type'))return [[{outcomes:1,notes:1,agent_replies:1,leads_touched:2}]];
    if(sql.includes('GROUP BY outcome'))return [[{outcome:'connected',total:1}]];
    if(sql.includes('SELECT pa.id'))return [[reply]];
    return [[{n:0}]];
  }};
  const report=await getActivityReport({pool:{async getConnection(){return connection;}},uid:'business-owner',role:'manager',period:'daily',at:'2026-10-01'});
  assert.equal(report.total,3);assert.equal(report.summary.agentReplies,1);assert.equal(report.summary.leadsTouched,2);
  assert.equal(report.items[0].activityType,'agent_message_sent');assert.equal(report.items[0].attendedBy,'Mona');
  assert.deepEqual(report.items[0].details,{origin:'meta',providerMessageId:'provider-1'});
  assert.equal(queries.filter(sql=>sql.includes("activity_type IN ('contact_outcome','note_added','agent_message_sent')")).length,2);
});

test('owner finance separates period cash from invoice cohorts and flags, rather than hiding, mismatches',async()=>{
  const tables=['sx_legacy_ownership','sx_tenants','sx_memberships','sx_training_invoices','sx_training_installments','sx_training_payment_allocations','sx_training_payments','sx_training_payment_allocation_reversals','sx_training_refunds','sx_training_payment_disputes','sx_training_credit_notes','sx_training_credit_allocations','sx_training_journal_entries','sx_training_journal_lines'];
  const queries=[];const connection={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,params=[]){queries.push({sql,params});
    if(sql.includes('information_schema.TABLES'))return [[{total:tables.length}]];
    if(sql.includes('FROM user WHERE uid='))return [[{id:7}]];
    if(sql.includes('FROM sx_legacy_ownership'))return [[{tenantId:'tenant-a'}]];
    if(sql.includes('AS invoice_count'))return [[{invoice_count:2,billed_minor:'20000',collected_minor:'5000',credited_minor:'0',outstanding_minor:'15000',mismatched:1}]];
    if(sql.includes('AS payment_count'))return [[{payment_count:1,received_minor:'3000'}]];
    if(sql.includes('AS refund_count'))return [[{refund_count:1,refunded_minor:'500'}]];
    if(sql.includes('AS credit_count'))return [[{credit_count:1,credit_minor:'250'}]];
    if(sql.includes('AS reported_count'))return [[{reported_count:1,reported_minor:'1000',open_count:1,open_minor:'1000'}]];
    if(sql.includes('AS mismatch_count'))return [[{outstanding_minor:'15000',mismatch_count:1}]];
    if(sql.includes('AS bucket'))return [[{bucket:'1-30',outstanding_minor:'2500',overdue_invoice_count:1}]];
    if(sql.includes('AS net_collections_minor'))return [[{net_collections_minor:'2500'}]];
    if(sql.includes('AS contacted'))return [[{contacted:0}]];
    if(sql.includes('SELECT COUNT(*) AS n'))return [[{n:0}]];
    if(sql.includes('SUM(pa.activity_type'))return [[{outcomes:0,notes:0,agent_replies:0,leads_touched:0}]];
    if(sql.includes('GROUP BY outcome'))return [[]];
    if(sql.includes('JSON_UNQUOTE(JSON_EXTRACT(pa.details,\'$.outcome\'))'))return [[]];
    if(sql.includes('SELECT pa.id'))return [[]];
    throw new Error(`Unexpected finance report query: ${sql}`);
  }};
  const report=await getActivityReport({pool:{async getConnection(){return connection;}},uid:'synthetic-owner',role:'owner',period:'daily',at:'2026-10-01'});
  assert.equal(report.finance.billedMinor,'20000');assert.equal(report.finance.collectedOnPeriodIssuedInvoicesMinor,'5000');assert.equal(report.finance.cashReceivedMinor,'3000');assert.equal(report.finance.refundsPaidMinor,'500');assert.equal(report.finance.creditsIssuedMinor,'250');
  assert.equal(report.finance.allOutstandingMinor,'15000');assert.equal(report.finance.overdueReceivablesMinor,'2500');assert.equal(report.finance.reconciliation.status,'attention');
  for(const query of queries)assert.equal(query.params.length,(query.sql.match(/\?/g)||[]).length,`placeholder count for ${query.sql.slice(0,90)}`);
});

test('journey report combines current pipeline stages, period sources and agent sales credit',async()=>{
  const queries=[];
  const connection={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql){queries.push(sql);
    if(sql.includes('FROM pipeline_stages'))return [[{stageKey:'new',title:'New',stageType:'open',position:0,total:'2',cohortTotal:'1'},{stageKey:'won',title:'Won',stageType:'won',position:4,total:'1',cohortTotal:'1'}]];
    if(sql.includes('GROUP BY l.source_type'))return [[{sourceType:'whatsapp',origin:'whatsapp',total:'2'}]];
    if(sql.includes('WITH cohort_leads AS'))return [[{new_leads:2,attended:2,interested:1,follow_up:1,sales_converted:1,invoices_issued:1,payment_received:1,course_started:1,fully_paid:1,course_completed:1,certificate_issued:1}]];
    if(sql.includes('AS new_leads'))return [[{new_leads:2,stage_changes:3,sales_converted:1,sales_closed_by_agents:1,leads_attended:2}]];
    if(sql.includes('FROM agents a'))return [[{agentId:7,agentName:'Mona',active:1,assignedLeads:2,newLeads:2,attendedLeads:2,salesAttributed:1,salesClosedByAgent:1}]];
    if(sql.includes("JSON_EXTRACT(pa.details,'$.stageTo')"))return [[{stageKey:'contacted',total:'3'}]];
    if(sql.includes('payment_receipts_issued'))return [[{invoices_issued:1,payment_receipts_issued:2,payments_received_minor:'12500',courses_started:1,courses_completed:1,certificates_issued:1}]];
    if(sql.includes('AS enrolled'))return [[{enrolled:2,course_started:1,course_completed:1,certificates_issued:1,fully_paid:1}]];
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const report=await getJourneyReport({pool:{async getConnection(){return connection;}},uid:'business-owner',role:'owner',period:'daily',at:'2026-10-01'});
  assert.deepEqual(report.summary,{newLeads:2,leadsAttended:2,stageChanges:3,salesConverted:1,salesClosedByAgents:1,openLeads:2,wonLeads:1,lostLeads:0});
  assert.equal(report.stages[0].total,2);assert.equal(report.sources[0].total,2);
  assert.equal(report.stages[0].cohortTotal,1);
  assert.equal(report.agents[0].salesClosedByAgent,1);assert.equal(report.stageTransitions[0].stageKey,'contacted');
  assert.deepEqual(report.cohortFunnel,{newLeads:2,attended:2,interested:1,followUp:1,salesConverted:1,invoicesIssued:1,paymentReceived:1,courseStarted:1,fullyPaid:1,courseCompleted:1,certificateIssued:1});
  assert.equal(report.learnerJourney.courseStarted,1);assert.equal(report.learnerJourney.certificatesIssued,1);
  assert.deepEqual(report.journeyActivity,{invoicesIssued:1,paymentReceiptsIssued:2,paymentsReceivedMinor:'12500',coursesStarted:1,coursesCompleted:1,certificatesIssued:1});
  const agentQuery=queries.find(sql=>sql.includes('FROM agents a'));
  assert.match(agentQuery,/c\.sales_agent_id/);
  assert.match(agentQuery,/c\.confirmed_by_actor_type='agent'/);
  assert.match(agentQuery,/pa\.actor_type='agent'/);
  assert.match(agentQuery,/CAST\(pa\.actor_id AS UNSIGNED\) AS agent_id/);
  assert.match(agentQuery,/COUNT\(DISTINCT pa\.lead_id\) AS attended_leads/);
  assert.match(agentQuery,/pa\.activity_type IN \('contact_outcome','agent_message_sent'\)/);assert.doesNotMatch(agentQuery,/note_added/);
  assert.doesNotMatch(agentQuery,/COUNT\(DISTINCT CASE WHEN pa\.activity_type IN/);
  assert.doesNotMatch(agentQuery,/pa\.activity_type='sale_converted'/);
  const flowQuery=queries.find(sql=>sql.includes('AS leads_attended')),cohortQuery=queries.find(sql=>sql.includes('AS attended,'));
  assert.match(flowQuery,/pa\.activity_type IN \('contact_outcome','agent_message_sent'\)/);assert.doesNotMatch(flowQuery,/note_added/);
  assert.match(cohortQuery,/pa\.activity_type IN \('contact_outcome','agent_message_sent'\)/);assert.doesNotMatch(cohortQuery,/note_added/);
  assert.match(queries.find(sql=>sql.includes('payment_receipts_issued')),/sx_training_receipts/);
  assert.match(queries.find(sql=>sql.includes('payment_receipts_issued')),/sx_training_enrollment_events/);
  assert.equal(queries.length,8);
});

test('journey reports reject finance-only roles before database access',async()=>{
  const pool={getConnection(){throw new Error('must not connect')}};
  await assert.rejects(getJourneyReport({pool,uid:'synthetic',role:'accountant'}),{status:403});
});

test('finance report summary remains owner-only and presents exact bilingual Qatar currency totals',()=>{
  const fs=require('node:fs'),path=require('node:path'),ui=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/reports.js'),'utf8'),pipelineUi=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/pipeline.js'),'utf8'),screen=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/index.html'),'utf8');
  assert.match(screen,/\/pipeline\/reports\.js\?v=19/);
  assert.match(screen,/\/pipeline\/pipeline\.js\?v=20261009-registration1/);
  assert.match(ui,/Sales credited at conversion/);
  assert.match(ui,/مبيعات منسوبة وقت التحويل/);
  assert.match(ui,/Training journey/);
  assert.match(ui,/رحلة التدريب/);
  assert.match(pipelineUi,/training_certificate_issued:'صدرت الشهادة'/);
  assert.match(ui,/report\.finance/);assert.match(ui,/BigInt\(String\(value\|\|'0'\)\)/);
  assert.match(ui,/Payments received this period/);assert.match(ui,/المدفوعات المستلمة خلال الفترة/);
  assert.match(ui,/Period activity is separate from the current receivables position/);assert.match(ui,/نشاط الفترة منفصل عن الذمم المدينة الحالية/);
  assert.match(ui,/journeyTitle:'Lead journey overview'/);assert.match(ui,/journeyTitle:'نظرة عامة على رحلة العميل'/);assert.match(ui,/journey\.agents/);assert.match(ui,/periodPaymentReceipts:'Payment receipts issued'/);assert.match(ui,/periodPaymentReceipts:'إيصالات الدفع الصادرة'/);
});
