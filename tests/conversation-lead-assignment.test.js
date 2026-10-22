'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const service=require('../modules/platform/conversation-lead-assignment');
const pipeline=require('../helper/pipeline/leadPipeline');
const {trainingCenter}=require('../modules/platform/categories');
const input={ctx:{tenant:{id:'tenant',categoryKey:'training_center',categoryVersion:1},category:trainingCenter,identity:{id:'actor'}},uid:'owner',chatId:'chat',chat:{origin:'qr',sender_name:'Contact',sender_mobile:'97455555555'},agentId:8,agentName:'Agent Eight'};
function fixture({linked=null,legacy=null,current=null}={}){
 const calls=[];const db={query:async(sql,args)=>{calls.push({sql,args});
 if(sql.startsWith('SELECT current_lead_id'))return [[{current_lead_id:current?.id||null}]];
 if(sql.includes('FROM pipeline_conversations c'))return [linked?[linked]:[]];
 if(sql.includes('primary_origin=? ORDER'))return [legacy?[legacy]:[]];
 if(sql.startsWith('SELECT id,owner_agent_id'))return [current?[current]:[]];
 return [{affectedRows:1}];
 }};return {db,calls};
}
test('existing lead is reassigned in its original owner workspace without resetting its stage or creating a duplicate',async t=>{
 t.mock.method(pipeline,'prepareWorkspace',async()=>{});t.mock.method(pipeline,'createManualLead',()=>{throw Error('duplicate');});
 const f=fixture({linked:{id:'existing',owner_agent_id:7}}),result=await service.assign(f.db,input);
 assert.deepEqual(result,{id:'existing',created:false,ownerAgentId:8});
 const update=f.calls.find(x=>x.sql.startsWith('UPDATE pipeline_leads'));assert.deepEqual(update.args.slice(0,1),[8]);assert.equal(update.args[2],'existing');assert.doesNotMatch(update.sql,/stage_key|status=|uid=/);
 assert.ok(f.calls.some(x=>x.sql.includes('pipeline_activity')));assert.ok(!f.calls.some(x=>x.sql.includes('DELETE')));
});
test('missing lead is created once in the same transaction and linked to inbound identity locking',async t=>{
 t.mock.method(pipeline,'prepareWorkspace',async()=>{});const f=fixture();let createInput;
 t.mock.method(pipeline,'createManualLead',async args=>{createInput=args;return {id:'new-lead'};});
 const result=await service.assign(f.db,input);assert.equal(result.created,true);assert.equal(createInput.connection,f.db);assert.equal(createInput.uid,'owner');assert.equal(createInput.input.ownerAgentId,8);
 assert.ok(f.calls.some(x=>x.sql.includes('pipeline_conversations')&&x.sql.startsWith('INSERT')));assert.ok(f.calls.some(x=>x.sql.startsWith('UPDATE pipeline_identity_locks')));
});
test('retry preserves lead identity and avoids duplicate reassignment history',async t=>{
 t.mock.method(pipeline,'prepareWorkspace',async()=>{});const f=fixture({linked:{id:'same',owner_agent_id:8},current:{id:'same',owner_agent_id:8}});
 await service.assign(f.db,input);assert.ok(!f.calls.some(x=>x.sql.startsWith('UPDATE pipeline_leads')||x.sql.includes('pipeline_activity')));
});
test('current inbound or legacy conversation lead is reused and unsupported categories remain unchanged',async t=>{
 t.mock.method(pipeline,'prepareWorkspace',async()=>{});
 for(const option of [{legacy:{id:'old-link',owner_agent_id:null}},{current:{id:'inbound',owner_agent_id:null}}]){const f=fixture(option);const result=await service.assign(f.db,input);assert.equal(result.created,false);}
 const f=fixture();assert.equal(await service.assign(f.db,{...input,ctx:{tenant:{id:'tenant',categoryKey:'7network_sales',categoryVersion:1},identity:{id:'actor'}}}),null);assert.equal(f.calls.length,0);
});
