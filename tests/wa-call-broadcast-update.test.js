'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {sanitizeUpdates,updateBroadcastContact}=require('../modules/platform/wa-call-broadcast-update');

test('call callback accepts only bounded provider fields and known state values',()=>{
  assert.deepEqual(sanitizeUpdates({permission_status:'granted',call_status:'completed',call_duration:45}),{permission_status:'granted',call_status:'completed',call_duration:45});
  assert.throws(()=>sanitizeUpdates({permission_status:'granted',uid:'other-tenant'}),{code:'INVALID_CALLBACK'});
  assert.throws(()=>sanitizeUpdates({call_status:'sent'}),{code:'INVALID_CALLBACK'});
  assert.throws(()=>sanitizeUpdates({error_message:'x'.repeat(256)}),{code:'INVALID_CALLBACK'});
});

test('call callback writes only to the campaign owner and does not double-count duplicate status events',async()=>{
  const row={campaign_id:'campaign-1',uid:'legacy-owner-1',contacts:JSON.stringify([{mobile:'+97450000000',permission_status:'requested',call_status:'pending'}]),permission_granted:0,calls_completed:0};
  const calls=[];
  let transactionCount=0;
  const pool={getConnection:async()=>({
    beginTransaction:async()=>{transactionCount++;},
    query:async(sql,params)=>{
      calls.push({sql,params});
      if(sql.startsWith('SELECT')){
        assert.match(sql,/WHERE campaign_id = \? AND uid = \? LIMIT 1 FOR UPDATE$/);
        return [params[0]===row.campaign_id&&params[1]===row.uid?[row]:[]];
      }
      if(sql.startsWith('UPDATE')){
        assert.match(sql,/WHERE campaign_id = \? AND uid = \?$/);
        assert.deepEqual(params.slice(-2),['campaign-1','legacy-owner-1']);
        const assignments=sql.slice(sql.indexOf(' SET ')+5,sql.indexOf(' WHERE ')).split(',').map(item=>item.split('=')[0].trim());
        assignments.forEach((column,index)=>{row[column]=params[index];});
        return [{affectedRows:1}];
      }
      throw new Error('UNEXPECTED_QUERY');
    },
    commit:async()=>{},rollback:async()=>{},release:()=>{},
  })};
  const input={campaignId:'campaign-1',uid:'legacy-owner-1',contactMobile:'+97450000000',updates:{permission_status:'granted',call_status:'completed'}};
  assert.deepEqual(await updateBroadcastContact(pool,input),{updated:true});
  assert.equal(row.permission_granted,1);
  assert.equal(row.calls_completed,1);
  const firstUpdate=calls.find(call=>call.sql.startsWith('UPDATE'));
  assert.deepEqual(await updateBroadcastContact(pool,input),{updated:true});
  assert.equal(row.permission_granted,1);
  assert.equal(row.calls_completed,1);
  const secondUpdate=calls.filter(call=>call.sql.startsWith('UPDATE'))[1];
  assert.match(firstUpdate.sql,/campaign_id = \? AND uid = \?/);
  assert.doesNotMatch(secondUpdate.sql,/permission_granted = \?/);
  assert.doesNotMatch(secondUpdate.sql,/calls_completed = \?/);
  assert.equal(transactionCount,2);
});

test('unknown campaigns and contacts do not create a cross-owner write',async()=>{
  const poolFor=row=>({getConnection:async()=>({beginTransaction:async()=>{},query:async(sql,params)=>sql.startsWith('SELECT')?[(row&&params[1]===row.uid?[row]:[])]:[{affectedRows:0}],commit:async()=>{},rollback:async()=>{},release:()=>{}})});
  assert.deepEqual(await updateBroadcastContact(poolFor(null),{campaignId:'missing',uid:'owner-1',contactMobile:'123',updates:{call_status:'failed'}}),{updated:false,code:'BROADCAST_NOT_FOUND'});
  const row={uid:'owner-1',contacts:'[]'};
  assert.deepEqual(await updateBroadcastContact(poolFor(row),{campaignId:'campaign-1',uid:'owner-1',contactMobile:'123',updates:{call_status:'failed'}}),{updated:false,code:'CONTACT_NOT_FOUND'});
  const otherOwner=await updateBroadcastContact(poolFor(row),{campaignId:'campaign-1',uid:'another-owner',contactMobile:'123',updates:{call_status:'failed'}});
  assert.deepEqual(otherOwner,{updated:false,code:'BROADCAST_NOT_FOUND'});
});

test('wa call callback route requires internal authentication',()=>{
  const fs=require('node:fs');
  const source=fs.readFileSync(require.resolve('../routes/waCall'),'utf8');
  assert.match(source,/router\.post\("\/update_broadcast_contact",\s*requireInternalAuth,/);
  assert.doesNotMatch(source,/contacts\[contactIndex\]\s*=\s*\{\s*\.\.\.contacts\[contactIndex\],\s*\.\.\.updates/);
});
