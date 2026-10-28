'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const pipeline=require('../helper/pipeline/leadPipeline');
function fixture(type){
  const calls=[],db={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,args=[]){
    calls.push({sql,args});
    if(sql.startsWith('SELECT * FROM pipeline_settings'))return [[{}]];
    if(sql.startsWith('SELECT * FROM pipeline_leads'))return [[{id:'lead',status:'open',stage_key:'new',identity_key:'key',close_reason:null}]];
    if(sql.startsWith('SELECT stage_key, position'))return [[{stage_key:type,stage_type:type,position:1}]];
    return [{affectedRows:1}];
  }};return {calls,pool:{getConnection:async()=>db}};
}
test('real estate loss requires and records a reason',async()=>{
  const f=fixture('lost'),input={uid:'owner',id:'lead',role:'owner',stageKey:'lost',categoryKey:'real_estate',pool:f.pool};
  await assert.rejects(pipeline.moveLead(input),{code:'LOSS_REASON_REQUIRED'});
  await pipeline.moveLead({...input,closeReason:'Budget changed'});
  const update=f.calls.find(x=>x.sql.includes('close_reason = ?'));
  assert.ok(update.args.includes('Budget changed'));
});
test('real estate can mark a lead won without the training sale workflow',async()=>{
  const f=fixture('won');
  assert.equal((await pipeline.moveLead({uid:'owner',id:'lead',role:'owner',stageKey:'won',categoryKey:'real_estate',pool:f.pool})).status,'won');
  await assert.rejects(pipeline.moveLead({uid:'owner',id:'lead',role:'owner',stageKey:'won',categoryKey:'training_center',pool:f.pool}),{code:'SALE_CONFIRMATION_REQUIRED'});
});
