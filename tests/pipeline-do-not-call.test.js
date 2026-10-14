'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pipeline=require('../helper/pipeline/leadPipeline');

const lead={id:'lead-1',title:'Demo lead',contact_name:'Lead One',mobile:'+919876543210',stage_key:'new',owner_agent_id:9,status:'open',priority:'normal',expected_value:100,currency:'INR',last_activity_at:'2026-10-14T00:00:00.000Z',created_at:'2026-10-13T00:00:00.000Z'};
function fixture({categoryKey='salemax_sales',suppressed=true}={}){
  const calls=[];
  const connection={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,args=[]){
    calls.push({sql,args});
    if(sql.startsWith('SELECT * FROM pipeline_settings'))return [[{enabled:1}]];
    if(sql.startsWith('SELECT stage_key'))return [[]];
    if(sql.startsWith('SELECT l.id,'))return [[{...lead}]];
    if(sql.startsWith('SELECT DISTINCT lead_id'))return [suppressed?[{leadId:'lead-1'}]:[]];
    if(sql.startsWith('SELECT COUNT(*) AS total FROM pipeline_leads'))return [[{total:1}]];
    if(sql.startsWith('SELECT id, name, email, is_active FROM agents'))return [[]];
    return [{affectedRows:1}];
  }};
  return {calls,pool:{getConnection:async()=>connection},categoryKey};
}

test('Sales Pipeline marks opted-out leads using activity rows scoped to the tenant and visible page',async()=>{
  const f=fixture();
  const result=await pipeline.getBoard({uid:'sales-owner',role:'manager',scopeAgentIds:[9],categoryKey:f.categoryKey,pool:f.pool});
  assert.equal(result.leads[0].doNotCall,true);
  const query=f.calls.find(call=>call.sql.startsWith('SELECT DISTINCT lead_id'));
  assert.match(query.sql,/uid_hash=\? AND lead_id IN \(\?\).*activity_type='contact_outcome'.*summary='Contact outcome: do_not_call'/);
  assert.deepEqual(query.args[1],['lead-1']);
});

test('other categories do not run the Sales suppression lookup',async()=>{
  const f=fixture({categoryKey:'training_center',suppressed:true});
  const result=await pipeline.getBoard({uid:'training-owner',role:'owner',categoryKey:f.categoryKey,pool:f.pool});
  assert.equal(result.leads[0].doNotCall,false);
  assert.equal(f.calls.some(call=>call.sql.startsWith('SELECT DISTINCT lead_id')),false);
});

test('Pipeline displays bilingual do-not-call status and only offers the disposition in SaleMaX Sales',()=>{
  const root=path.join(__dirname,'..');
  const screen=fs.readFileSync(path.join(root,'client/public/pipeline/pipeline.js'),'utf8');
  const router=fs.readFileSync(path.join(root,'routes/pipeline.js'),'utf8');
  assert.match(screen,/doNotCall:'Do not call'/);assert.match(screen,/doNotCall:'ممنوع الاتصال'/);
  assert.match(screen,/lead\.doNotCall/);assert.match(screen,/x\.doNotCall/);assert.match(screen,/state\.data\.categoryKey==='salemax_sales'/);
  assert.match(router,/categoryKey: req\.pipelineActor\.categoryKey/);assert.match(router,/categoryKey:req\.pipelineActor\.categoryKey/);
});
