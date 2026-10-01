'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const outbox=require('../modules/platform/training-outbox');
test('outbox accepts only bounded identifier-only tenant events',()=>{
  const value={idempotencyKey:'invoice-event-001',eventType:'finance.invoice.issued',resourceType:'invoice',resourceId:crypto.randomUUID(),revision:1,correlationId:crypto.randomUUID()};
  const event=outbox.normalizeEvent(value);assert.equal(event.eventType,value.eventType);assert.deepEqual(Object.keys(event.payload).sort(),['correlationId','resourceId','resourceType','revision']);assert.equal(event.payloadSha256.length,64);
  for(const bad of [{...value,revision:0},{...value,eventType:'invoice'},{...value,idempotencyKey:'x'},{...value,resourceType:'invoice',email:'person@example.qa'},{...value,resourceId:'not-a-uuid'}])assert.throws(()=>outbox.normalizeEvent(bad),{code:'INVALID_OUTBOX_EVENT'});
});
test('claiming outbox events requires an active tenant accountant/owner and bounded leases',async()=>{
  const ctx={audience:'tenant',tenant:{id:crypto.randomUUID(),status:'active'},membership:{tenantId:null,role:'owner',status:'active'},subscription:{capabilities:['finance.invoices']}};ctx.membership.tenantId=ctx.tenant.id;
  await assert.rejects(outbox.claim({beginTransaction(){throw Error('db touched before validation')}}, {...ctx,membership:{...ctx.membership,role:'agent'}},{workerId:'worker-1',limit:1,leaseSeconds:60}),{code:'PERMISSION_DENIED'});
  await assert.rejects(outbox.claim({},ctx,{workerId:'x',limit:1,leaseSeconds:60}),{code:'INVALID_OUTBOX_WORKER'});
  await assert.rejects(outbox.claim({},ctx,{workerId:'worker-1',limit:51,leaseSeconds:60}),{code:'INVALID_OUTBOX_WORKER'});
  assert.throws(()=>outbox.normalizeEvent({}),{code:'INVALID_OUTBOX_EVENT'});
});
test('durable outbox stays explicitly disconnected from external delivery',()=>{
  const fs=require('node:fs'),path=require('node:path'),read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  assert.match(read('database/migrations/20261011_training_outbox.sql'),/uq_training_outbox_idempotency/);assert.match(read('database/migrations/20261011_training_outbox.sql'),/lease_expires_at/);
  assert.match(read('docs/API_DOCUMENTATION.md'),/Durable training notification outbox/);assert.match(read('docs/IMPLEMENTATION_STATUS.md'),/external dispatch disabled/);
});
