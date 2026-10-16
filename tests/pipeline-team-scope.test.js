'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const pipeline=require('../helper/pipeline/leadPipeline');
const reports=require('../helper/pipeline/reports');

function mockDb(){
  const calls=[];
  const connection={
    async beginTransaction(){},async commit(){},async rollback(){},release(){},
    async query(sql,args=[]){
      calls.push({sql,args});
      if(sql.startsWith('SELECT * FROM pipeline_settings'))return [[{enabled:1,auto_capture_qr:0,auto_capture_meta:0,interest_keywords:'[]'}]];
      if(sql.startsWith('SELECT stage_key'))return [[]];
      if(sql.startsWith('SELECT l.id'))return [[]];
      if(sql.startsWith('SELECT COUNT(*) AS total FROM pipeline_leads'))return [[{total:0}]];
      if(sql.startsWith('SELECT id, name, email, is_active FROM agents'))return [[]];
      if(sql.startsWith('SELECT l.*, a.name AS owner_name'))return [[]];
      if(sql.startsWith('SELECT COUNT(*) AS total,'))return [[{total:0,overdue:0,upcoming:0}]];
      if(sql.startsWith('SELECT l.id AS lead_id'))return [[]];
      return [{affectedRows:1}];
    }
  };
  return {calls,connection,pool:{getConnection:async()=>connection,query:(...args)=>connection.query(...args)}};
}

test('sales manager pipeline queries are restricted to their active reporting agents',async()=>{
  const f=mockDb();
  await pipeline.getBoard({uid:'sales-owner',role:'manager',scopeAgentIds:[4,9],pool:f.pool});
  const leadQuery=f.calls.find(item=>item.sql.startsWith('SELECT l.id'));
  assert.match(leadQuery.sql,/l\.owner_agent_id IN \(\?\)/);
  assert.ok(leadQuery.args.some(value=>Array.isArray(value)&&value.join(',')==='4,9'));
  const agentQuery=f.calls.find(item=>item.sql.startsWith('SELECT id, name, email, is_active FROM agents'));
  assert.match(agentQuery.sql,/id IN \(\?\)/);
  assert.ok(agentQuery.args.some(value=>Array.isArray(value)&&value.join(',')==='4,9'));
});

test('pipeline today summary is calculated server-side in the requested timezone and assignment scope',async()=>{
  const f=mockDb();
  await pipeline.getBoard({uid:'sales-owner',role:'manager',scopeAgentIds:[4,9],timezone:'Asia/Kolkata',pool:f.pool});
  const query=f.calls.find(item=>item.sql.startsWith('SELECT COUNT(*) AS total, COALESCE(SUM(l.created_at'));
  assert.ok(query);
  assert.match(query.sql,/l\.owner_agent_id IN \(\?\)/);
  assert.equal(query.args.length,4);
  assert.deepEqual(query.args.slice(2),[require('crypto').createHash('sha256').update('sales-owner').digest('hex'),[4,9]]);
  assert.equal(new Date(query.args[1])-new Date(query.args[0]),24*60*60*1000);
});

test('team leaders cannot receive tenant-wide leads or follow-ups when no agent is assigned',async()=>{
  const f=mockDb();
  await pipeline.getBoard({uid:'sales-owner',role:'team_leader',scopeAgentIds:[],pool:f.pool});
  const leadQuery=f.calls.find(item=>item.sql.startsWith('SELECT l.id'));
  assert.match(leadQuery.sql,/AND 1=0/);
  await pipeline.getFollowUps({uid:'sales-owner',role:'team_leader',scopeAgentIds:[],pool:f.pool});
  const followupCount=f.calls.find(item=>item.sql.startsWith('SELECT COUNT(*) AS total FROM pipeline_leads'));
  assert.match(followupCount.sql,/AND 1=0/);
});

test('direct lead detail queries use the manager team scope',async()=>{
  const f=mockDb();
  assert.equal(await pipeline.getLead('sales-owner','foreign-lead',{role:'manager',scopeAgentIds:[4],pool:f.pool}),null);
  const detail=f.calls.find(item=>item.sql.startsWith('SELECT l.*, a.name AS owner_name'));
  assert.match(detail.sql,/l\.owner_agent_id IN \(\?\)/);
  assert.ok(detail.args.some(value=>Array.isArray(value)&&value[0]===4));
});

test('activity report aggregates and event rows stay inside a manager reporting team',async()=>{
  const calls=[];
  const connection={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,args=[]){
    calls.push({sql,args});
    if(sql.includes('AS n FROM pipeline_leads'))return [[{n:0}]];
    if(sql.includes('AS outcomes'))return [[{outcomes:0,notes:0,agent_replies:0,leads_touched:0}]];
    if(sql.includes('AS contacted'))return [[{contacted:0}]];
    if(sql.startsWith('SELECT JSON_UNQUOTE'))return [[]];
    if(sql.startsWith('SELECT pa.id'))return [[]];
    return [[{n:0}]];
  }};
  await reports.getActivityReport({pool:{getConnection:async()=>connection},uid:'sales-owner',role:'manager',scopeAgentIds:[4,9],at:'2026-10-13',timezone:'Asia/Kolkata'});
  const scoped=calls.filter(item=>item.sql.includes('pipeline_leads'));
  assert.ok(scoped.length>=5);
  for(const query of scoped){
    assert.match(query.sql,/owner_agent_id IN \(\?\)/,query.sql);
    assert.ok(query.args.some(value=>Array.isArray(value)&&value.join(',')==='4,9'));
  }
});

test('SaleMaX Sales journey report aggregates team performance within current agent assignments',async()=>{
  const calls=[];
  const connection={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,args=[]){calls.push({sql,args});
    if(sql.includes('FROM pipeline_stages'))return [[{stageKey:'new',title:'New',stageType:'open',position:0,total:5,cohortTotal:2}]];
    if(sql.includes('GROUP BY l.source_type'))return [[{sourceType:'manual',origin:'manual',total:2}]];
    if(sql.includes('AS leads_attended'))return [[{new_leads:2,stage_changes:3,sales_converted:1,sales_closed_by_agents:1,leads_attended:2}]];
    if(sql.includes('FROM agents a'))return [[{agentId:4,agentName:'Agent Four',active:1,assignedLeads:3,newLeads:2,attendedLeads:2,agentReplies:1,followUpsDue:1,followUpsOverdue:0,salesAttributed:1,salesClosedByAgent:1}]];
    if(sql.includes("JSON_EXTRACT(pa.details,'$.stageTo')"))return [[{stageKey:'won',total:1}]];
    throw new Error(`Unexpected team journey query: ${sql}`);
  }};
  const report=await reports.getJourneyReport({pool:{getConnection:async()=>connection},uid:'sales-owner',role:'manager',scopeAgentIds:[4],categoryKey:'salemax_sales',at:'2026-10-13',timezone:'Asia/Kolkata'});
  assert.equal(report.categoryKey,'salemax_sales');assert.equal(report.summary.newLeads,2);assert.equal(report.agents[0].agentId,4);assert.equal(report.agents[0].salesClosedByAgent,1);
  for(const {sql,args} of calls.filter(item=>item.sql.includes('pipeline_leads')||item.sql.includes('FROM agents a'))){
    assert.match(sql,/owner_agent_id IN \(\?\)|a\.id IN \(\?\)/,sql);
    assert.ok(args.some(value=>Array.isArray(value)&&value.join(',')==='4'));
  }
  assert.equal(calls.some(item=>item.sql.includes('sx_training_')),false,'the private sales workspace report does not query training finance or enrollment data');
});
