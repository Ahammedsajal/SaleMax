'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createTaskRouter}=require('../modules/platform/task-router');
const {trainingCenter}=require('../modules/platform/categories');

async function fixture(){
  const contexts=[],connections=[];
  const tenantId='11111111-1111-4111-8111-111111111111';
  const ctx={audience:'tenant',identity:{id:'identity-a'},tenantId,tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member-a',tenantId,role:'owner',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:[...trainingCenter.capabilities]},enabledTaskTypes:['general'],uid:'owner-a',uidHash:'a'.repeat(64),role:'owner',actorType:'identity',actorId:'identity-a'};
  const pool={getConnection:async()=>{const db={query:async()=>[[],[]],release(){connections.push('released');}};return db;}};
  const app=express();app.use(createTaskRouter({pool,contextFor:async(_req,permission,options)=>{contexts.push({permission,options});return ctx;}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  return {base:`http://127.0.0.1:${server.address().port}`,contexts,connections,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}

test('existing Tasks API returns this tenant category and owner enabled type contract',async()=>{
  const app=await fixture();try{
    const response=await fetch(app.base+'/');assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.data.taskTypes.find(item=>item.key==='general').enabled,true);
    assert.equal(result.data.taskTypes.find(item=>item.key==='enrollment').enabled,false);
    assert.ok(!result.data.taskTypes.some(item=>item.key==='sales_call'));
    assert.deepEqual(app.contexts[0],{permission:'tasks.read',options:{includeCustomization:true}});
    assert.match(response.headers.get('cache-control'),/no-store/);
  }finally{await app.close();}
});

test('existing Tasks API rejects an owner-disabled type before starting a write transaction',async()=>{
  const app=await fixture();try{
    const response=await fetch(app.base+'/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Enroll new learner',taskType:'enrollment',participants:[{actorType:'identity',actorId:'identity-a',role:'assignee'}]})});
    assert.equal(response.status,409);assert.deepEqual(await response.json(),{success:false,code:'TASK_TYPE_NOT_ENABLED'});
    assert.deepEqual(app.contexts[0],{permission:'tasks.manage',options:undefined});
  }finally{await app.close();}
});
