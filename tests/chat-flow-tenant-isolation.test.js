'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const express=require('express');

async function withFlowRouter(run){
  const state={beta:[{id:1,uid:'owner-b',flow_id:'shared-id',name:'Owner B flow',source:'wa_chatbot',data:'{}'}],flows:[{id:4,uid:'owner-b',flow_id:'legacy-id',title:'Owner B legacy flow'}],sessions:[{id:9,uid:'owner-b',flow_id:'shared-id',sender_mobile:'+10000000002',data:'{}'}],queries:[]};
  const fakeQuery=async(sql,args=[])=>{
    state.queries.push({sql,args});
    if(sql.includes('SELECT * FROM beta_flows WHERE uid = ? AND flow_id = ?'))return state.beta.filter(row=>row.uid===args[0]&&row.flow_id===args[1]);
    if(sql.startsWith('INSERT INTO beta_flows')){state.beta.push({id:state.beta.length+1,uid:args[0],flow_id:args[1],source:args[2],name:args[3],data:args[4]});return {affectedRows:1};}
    if(sql.includes('UPDATE beta_flows')){for(const row of state.beta.filter(row=>row.uid===args[3]&&row.flow_id===args[4]))Object.assign(row,{name:args[0],data:args[1],source:args[2]});return {affectedRows:1};}
    if(sql.includes('SELECT * FROM flow WHERE uid = ? AND flow_id = ?'))return state.flows.filter(row=>row.uid===args[0]&&row.flow_id===args[1]);
    if(sql.startsWith('INSERT INTO flow')){state.flows.push({id:state.flows.length+1,uid:args[0],flow_id:args[1],title:args[2]});return {affectedRows:1};}
    if(sql.startsWith('UPDATE flow SET title = ? WHERE uid = ? AND flow_id = ?')){for(const row of state.flows.filter(row=>row.uid===args[1]&&row.flow_id===args[2]))row.title=args[0];return {affectedRows:1};}
    if(sql.includes('UPDATE flow SET ai_list = ? WHERE uid = ? AND flow_id = ?')||sql.includes('UPDATE flow SET prevent_list = ? WHERE uid = ? AND flow_id = ?'))return {affectedRows:0};
    if(sql.startsWith('DELETE FROM flow_session WHERE id = ? AND uid = ?')){state.sessions=state.sessions.filter(row=>row.id!==args[0]||row.uid!==args[1]);return {affectedRows:1};}
    if(sql.includes('SELECT * FROM flow_session WHERE id = ? AND uid = ?'))return state.sessions.filter(row=>row.id===args[0]&&row.uid===args[1]);
    if(sql.includes('UPDATE flow_session SET data = ? WHERE id = ? AND uid = ?')){for(const row of state.sessions.filter(row=>row.id===args[1]&&row.uid===args[2]))row.data=args[0];return {affectedRows:1};}
    if(sql.includes('SELECT id FROM flow WHERE uid = ? AND flow_id = ?'))return [];
    throw new Error(`Unexpected test query: ${sql}`);
  };
  const stubs={
    '../database/dbpromise.js':{query:fakeQuery},
    '../middlewares/user.js':(req,res,next)=>{req.decode={uid:'owner-a'};next();},
    '../middlewares/plan.js':{checkPlan:(req,res,next)=>next()},
    '../middlewares/agent.js':(req,res,next)=>{req.owner={uid:'owner-a'};next();},
    '../functions/function.js':{writeJsonToFile:async()=>{},deleteFileIfExists:()=>{},readJsonFromFile:()=>({}),makeRequestBeta:async()=>({}),getFileExtension:()=>'',isValidEmail:()=>true,executeMySQLQuery:async()=>({})},
    '../utils/addons.js':{returnAddons:async()=>[]},
  };
  const cacheKeys=[];
  for(const [specifier,exports] of Object.entries(stubs)){const filename=require.resolve(path.join(__dirname,specifier));cacheKeys.push(filename);require.cache[filename]={id:filename,filename,loaded:true,exports};}
  const routerPath=require.resolve('../routes/chatFlow.js');cacheKeys.push(routerPath);delete require.cache[routerPath];
  const app=express();app.use(express.json());app.use('/flow',require('../routes/chatFlow.js'));
  const server=app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  try{await run({state,base:`http://127.0.0.1:${server.address().port}/flow`});}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const filename of cacheKeys)delete require.cache[filename];}
}

test('saving a beta flow with another owner’s ID creates an owner-local flow without changing theirs',async()=>{
  await withFlowRouter(async({state,base})=>{
    const response=await fetch(`${base}/insert_flow_beta`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Owner A flow',flow_id:'shared-id',source:'wa_chatbot',data:{nodes:[{id:'a',position:{x:0}},{id:'b',position:{x:1}}],edges:[{source:'a',target:'b'}]}})});
    assert.equal(response.status,200);assert.equal((await response.json()).success,true);
    assert.equal(state.beta.length,2);assert.equal(state.beta[0].name,'Owner B flow');assert.equal(state.beta[0].data,'{}');assert.equal(state.beta[1].uid,'owner-a');
    assert.ok(state.queries.every(({sql})=>!(/UPDATE beta_flows/.test(sql)&&!/WHERE uid = \? AND flow_id = \?/.test(sql))));
  });
});

test('saving a legacy flow with another owner’s ID never changes the other owner’s title',async()=>{
  await withFlowRouter(async({state,base})=>{
    const response=await fetch(`${base}/add_new`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Owner A legacy flow',flowId:'legacy-id',nodes:[{id:'a'}],edges:[]})});
    assert.equal(response.status,200);assert.equal((await response.json()).success,true);
    assert.equal(state.flows.length,2);assert.equal(state.flows[0].title,'Owner B legacy flow');assert.equal(state.flows[1].uid,'owner-a');
  });
});

test('an owner cannot clear another owner’s flow session by supplying its row ID',async()=>{
  await withFlowRouter(async({state,base})=>{
    const response=await fetch(`${base}/enable_chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:9})});
    assert.equal(response.status,200);assert.equal((await response.json()).success,true);
    assert.deepEqual(state.sessions,[{id:9,uid:'owner-b',flow_id:'shared-id',sender_mobile:'+10000000002',data:'{}'}]);
    assert.deepEqual(state.queries[0].args,[9,'owner-a']);
  });
});

test('an owner cannot disable another owner’s flow session by row ID',async()=>{
  await withFlowRouter(async({state,base})=>{
    const response=await fetch(`${base}/disable_chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:9})});
    assert.equal(response.status,200);assert.equal((await response.json()).msg,'Auto reply disabled');
    assert.equal(state.queries.length,1);assert.deepEqual(state.queries[0].args,[9,'owner-a']);
    assert.deepEqual(state.sessions,[{id:9,uid:'owner-b',flow_id:'shared-id',sender_mobile:'+10000000002',data:'{}'}]);
  });
});

test('flow activity updates are scoped by owner even for a known foreign flow ID',async()=>{
  await withFlowRouter(async({state,base})=>{
    const response=await fetch(`${base}/remove_number_from_activity`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'AI',number:'+10000000002',flowId:'legacy-id'})});
    assert.equal(response.status,200);assert.equal((await response.json()).success,true);
    assert.equal(state.flows[0].title,'Owner B legacy flow');
    assert.ok(state.queries.every(({sql,args})=>!sql.includes('FROM flow WHERE flow_id = ?')&&(!sql.includes('UPDATE flow SET ai_list')||args[1]==='owner-a')));
  });
});

test('legacy flow file lookup rejects traversal-shaped IDs before reading files',async()=>{
  await withFlowRouter(async({state,base})=>{
    const response=await fetch(`${base}/get_by_flow_id`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({flowId:'../../server'})});
    assert.equal(response.status,200);assert.equal((await response.json()).success,false);assert.equal(state.queries.length,0);
  });
});
