'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const tasks=require('../modules/platform/task-management');
const ctx={tenantId:'11111111-1111-4111-8111-111111111111',uidHash:'a'.repeat(64),uid:'owner-uid',role:'agent',actorType:'agent',actorId:'7',agentId:7,tenant:{categoryKey:'training_center'}};
function fixture(){
 const calls=[];let foreign=false;
 const db={beginTransaction:async()=>calls.push(['BEGIN']),commit:async()=>calls.push(['COMMIT']),rollback:async()=>calls.push(['ROLLBACK']),query:async(sql,args)=>{
  calls.push([sql,args]);
  if(sql.startsWith('SELECT id,COALESCE'))return [[{id:7,label:'Current Agent'},{id:8,label:'Second Agent'}]];
  if(sql.startsWith('SELECT m.identity_id'))return [[{actorId:'owner-identity',role:'owner',label:'Main User'},{actorId:'manager-identity',role:'manager',label:'Manager'},{actorId:'accountant-identity',role:'accountant',label:'Accountant'}]];
  if(sql.startsWith('SELECT id FROM agents'))return [foreign&&args[0]===99?[]:[{id:args[0]}]];
  if(sql.startsWith('SELECT id FROM sx_memberships'))return [foreign&&args[1]==='foreign-identity'?[]:[{id:'member'}]];
  if(sql.startsWith('INSERT'))return [{affectedRows:1,insertId:1}];
  throw Error('Unexpected query: '+sql);
 }};return {db,calls,foreign:()=>{foreign=true;}};
}
test('Training Center agent selector lists the main user and all active workspace roles',async()=>{
 const f=fixture(),people=await tasks.listParticipants(f.db,ctx);
 assert.deepEqual(people.map(p=>p.label),['Main User','Manager','Accountant','Current Agent','Second Agent']);
 assert.deepEqual(f.calls[0][1],[ctx.uid]);assert.match(f.calls[0][0],/owner_uid=\?.*is_active=1/);
 assert.deepEqual(f.calls[1][1],[ctx.tenantId]);assert.match(f.calls[1][0],/m.tenant_id=\? AND m.status='active'/);
 assert.ok(people.every(p=>!Object.hasOwn(p,'email')&&!Object.hasOwn(p,'password')));
});
test('agent can save main user, manager and other agent selections and remains an observer',async()=>{
 const f=fixture(),result=await tasks.create(f.db,ctx,{title:'Coordinate schedule',taskType:'general',participants:[{actorType:'identity',actorId:'owner-identity',role:'assignee'},{actorType:'identity',actorId:'manager-identity',role:'observer'},{actorType:'agent',actorId:'8',role:'assignee'}]});
 assert.equal(result.participants.length,4);assert.deepEqual(result.participants.at(-1),{actorType:'agent',actorId:'7',role:'observer'});
 assert.ok(f.calls.some(([sql])=>sql==='COMMIT'));
 assert.ok(f.calls.filter(([sql])=>sql.startsWith('INSERT INTO sx_task_participants')).every(([,args])=>args[0]===ctx.tenantId));
});
test('foreign or inactive recipients are rejected before any task is written',async()=>{
 for(const person of [{actorType:'identity',actorId:'foreign-identity',role:'assignee'},{actorType:'agent',actorId:'99',role:'assignee'}]){
  const f=fixture();f.foreign();await assert.rejects(tasks.create(f.db,ctx,{title:'Invalid recipient',participants:[person]}),{code:'TASK_PARTICIPANT_NOT_FOUND'});
  assert.ok(!f.calls.some(([sql])=>sql==='BEGIN'||sql.startsWith('INSERT')));
 }
});
test('Sales agent restrictions and Training Center team-queue denial remain unchanged',async()=>{
 const f=fixture(),sales={...ctx,tenant:{categoryKey:'salemax_sales'}};
 assert.deepEqual(await tasks.listParticipants(f.db,sales),[{actorType:'agent',actorId:'7',role:'agent',label:'Me'}]);
 await assert.rejects(tasks.create(f.db,sales,{title:'Sales role boundary',participants:[{actorType:'agent',actorId:'8',role:'assignee'}]}),{code:'PERMISSION_DENIED'});
 await assert.rejects(tasks.list(f.db,ctx,{scope:'team'}),{code:'PERMISSION_DENIED'});
});
