'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {importBatch,normalizeRows}=require('../modules/platform/sales-lead-import');

const pipeline={
  normalizePhone:value=>typeof value==='string'&&/^\+\d{8,15}$/.test(value.replaceAll(' ',''))?value.replaceAll(' ',''):null,
  normalizeEmail:value=>typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())?value.trim().toLowerCase():null,
  createManualLead:async input=>({id:`lead-${input.input.title}`,contactId:`contact-${input.input.title}`}),
};
const actor={uid:'internal-owner-1',actorType:'user',actorId:'identity-1',categoryKey:'salemax_sales',tenantId:'tenant-1',role:'owner'};
const prospect=(overrides={})=>({name:'Asha Rao',phone:'+91 9876543210',title:'Business account',email:'asha@example.in',expected_value:'1250.50',currency:'INR',agent_email:'agent@example.in',...overrides});
function fixture({duplicate=false,agent={id:7,uid:'agent-uid',legacyUidHash:crypto.createHash('sha256').update('agent-uid').digest('hex')},createError=null}={}){
  const calls={begin:0,commit:0,rollback:0,release:0,creates:[],queries:[]};
  const db={beginTransaction:async()=>{calls.begin++;},commit:async()=>{calls.commit++;},rollback:async()=>{calls.rollback++;},release:()=>{calls.release++;},query:async(sql,params)=>{calls.queries.push(sql);if(sql.startsWith('SELECT id FROM pipeline_leads'))return [duplicate?[{id:'existing'}]:[],[]];if(sql.startsWith('SELECT a.id,a.uid'))return [agent?[agent]:[],[]];return [[{uid_hash:'hash'}],[]];}};
  const pool={getConnection:async()=>db};
  const service={...pipeline,createManualLead:async input=>{calls.creates.push(input);if(createError)throw createError;return {id:`lead-${calls.creates.length}`,contactId:`contact-${calls.creates.length}`};}};
  return {calls,pool,service};
}

test('import validates bounded required fields, international phones, amounts and currencies',()=>{
  const rows=normalizeRows([prospect()],pipeline);assert.equal(rows.length,1);assert.equal(rows[0].mobile,'+919876543210');assert.equal(rows[0].email,'asha@example.in');assert.equal(rows[0].expectedValue,1250.5);
  assert.throws(()=>normalizeRows([prospect({phone:'9876543210'})],pipeline),{code:'INVALID_IMPORT_ROW',row:1});
  assert.throws(()=>normalizeRows([prospect({email:'not-an-email'})],pipeline),{code:'INVALID_IMPORT_ROW',row:1});
  assert.throws(()=>normalizeRows([prospect({expected_value:'12.999'})],pipeline),{code:'INVALID_IMPORT_ROW',row:1});
  assert.throws(()=>normalizeRows([prospect({currency:'rupees'})],pipeline),{code:'INVALID_IMPORT_ROW',row:1});
  assert.throws(()=>normalizeRows(Array.from({length:101},(_,index)=>prospect({phone:`+9198765432${String(index).padStart(2,'0')}`})),pipeline),{code:'INVALID_IMPORT_ROWS'});
});

test('import rejects non-owner and non-SaleMaX-Sales actors before opening a connection',async()=>{
  const {pool}=fixture();await assert.rejects(importBatch({pool,pipeline,actor:{...actor,role:'manager'},rows:[prospect()]}),{code:'PERMISSION_DENIED'});
  await assert.rejects(importBatch({pool,pipeline,actor:{...actor,categoryKey:'training_center'},rows:[prospect()]}),{code:'PERMISSION_DENIED'});
});

test('import rejects duplicate people in one file before writing',async()=>{
  const {calls,pool,service}=fixture();await assert.rejects(importBatch({pool,pipeline:service,actor,rows:[prospect(),prospect({name:'Different name'})]}),{code:'DUPLICATE_IMPORT_ROW',row:2});
  assert.equal(calls.begin,0);assert.equal(calls.creates.length,0);assert.equal(calls.release,0);
});

test('import atomically creates assigned leads and retains the per-owner lock',async()=>{
  const {calls,pool,service}=fixture();const result=await importBatch({pool,pipeline:service,actor,rows:[prospect()]});
  assert.equal(result.created,1);assert.equal(result.rows[0].ownerAgentId,7);assert.equal(calls.begin,1);assert.equal(calls.commit,1);assert.equal(calls.rollback,0);assert.equal(calls.release,1);
  assert.ok(calls.queries.some(sql=>sql.includes('pipeline_settings')&&sql.includes('FOR UPDATE')));
  assert.equal(calls.creates[0].input.currency,'INR');assert.equal(calls.creates[0].input.expectedValue,1250.5);assert.equal(calls.creates[0].input.ownerAgentId,7);
});

test('existing duplicates, inactive agents and write failures roll back the whole batch',async()=>{
  const existing=fixture({duplicate:true});await assert.rejects(importBatch({pool:existing.pool,pipeline:existing.service,actor,rows:[prospect()]}),{code:'DUPLICATE_EXISTING_LEAD',row:1});assert.equal(existing.calls.rollback,1);assert.equal(existing.calls.commit,0);
  const inactive=fixture({agent:null});await assert.rejects(importBatch({pool:inactive.pool,pipeline:inactive.service,actor,rows:[prospect()]}),{code:'IMPORT_AGENT_NOT_FOUND',row:1});assert.equal(inactive.calls.rollback,1);assert.equal(inactive.calls.commit,0);
  const failed=fixture({createError:Object.assign(new Error('write failed'),{code:'DB_FAILURE'})});await assert.rejects(importBatch({pool:failed.pool,pipeline:failed.service,actor,rows:[prospect()]}),{code:'DB_FAILURE'});assert.equal(failed.calls.rollback,1);assert.equal(failed.calls.commit,0);assert.equal(failed.calls.release,1);
});
