'use strict';
const crypto=require('node:crypto');
const fail=code=>{const status=code==='OUTBOX_EVENT_NOT_FOUND'?404:code==='OUTBOX_LEASE_REQUIRED'?409:code==='PERMISSION_DENIED'?403:400;throw Object.assign(new Error(code),{code,status});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function identity(ctx){if(ctx?.audience!=='tenant'||!uuid(ctx?.tenant?.id)||ctx.tenant.status!=='active'||ctx.membership?.tenantId!==ctx.tenant.id||ctx.membership.status!=='active')fail('TENANT_CONTEXT_REQUIRED');return ctx.tenant.id;}
function normalizeEvent(input){
  const keys=['idempotencyKey','eventType','resourceType','resourceId','revision','correlationId'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key))||typeof input.idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{8,160}$/.test(input.idempotencyKey)||typeof input.eventType!=='string'||!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(input.eventType)||typeof input.resourceType!=='string'||!/^[a-z][a-z0-9-]{1,49}$/.test(input.resourceType)||!uuid(input.resourceId)||!uuid(input.correlationId)||!Number.isSafeInteger(input.revision)||input.revision<1)fail('INVALID_OUTBOX_EVENT');
  const payload={resourceType:input.resourceType,resourceId:input.resourceId,revision:input.revision,correlationId:input.correlationId};
  const serialized=JSON.stringify(payload);
  return {idempotencyKey:input.idempotencyKey,eventType:input.eventType,payload,payloadSha256:crypto.createHash('sha256').update(serialized).digest('hex')};
}
function workerInput(workerId,limit,leaseSeconds){if(typeof workerId!=='string'||!/^[A-Za-z0-9._:-]{3,100}$/.test(workerId)||!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(leaseSeconds)||leaseSeconds<10||leaseSeconds>300)fail('INVALID_OUTBOX_WORKER');}
function authorize(ctx){identity(ctx);if(!['owner','accountant'].includes(ctx.membership.role))fail('PERMISSION_DENIED');if(!ctx.subscription?.capabilities?.includes('finance.invoices'))fail('FEATURE_UNAVAILABLE');}
async function enqueue(db,ctx,input){
  const tenantId=identity(ctx),event=normalizeEvent(input);
  const id=crypto.randomUUID();
  try{await db.query(`INSERT INTO sx_training_outbox_events(id,tenant_id,idempotency_key,event_type,payload_json,payload_sha256,available_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))`,[id,tenantId,event.idempotencyKey,event.eventType,JSON.stringify(event.payload),event.payloadSha256]);return {id,tenantId,...event,status:'ready',repeated:false,externalDispatch:false};}
  catch(error){if(error.code!=='ER_DUP_ENTRY')throw error;const [[existing]]=await db.query('SELECT id,event_type,payload_sha256,status FROM sx_training_outbox_events WHERE tenant_id=? AND idempotency_key=?',[tenantId,event.idempotencyKey]);if(!existing)throw error;if(existing.event_type!==event.eventType||existing.payload_sha256!==event.payloadSha256)fail('OUTBOX_IDEMPOTENCY_CONFLICT');return {id:existing.id,tenantId,eventType:existing.event_type,status:existing.status,repeated:true,externalDispatch:false};}
}
async function claim(db,ctx,{workerId,limit=10,leaseSeconds=60}={}){
  authorize(ctx);workerInput(workerId,limit,leaseSeconds);await db.beginTransaction();
  try{
    const [rows]=await db.query(`SELECT id,tenant_id,idempotency_key,event_type,payload_json,attempts,status FROM sx_training_outbox_events WHERE tenant_id=? AND ((status='ready' AND available_at<=UTC_TIMESTAMP(3)) OR (status='leased' AND lease_expires_at<=UTC_TIMESTAMP(3))) ORDER BY available_at,created_at,id LIMIT ? FOR UPDATE SKIP LOCKED`,[ctx.tenant.id,limit]);
    const claimed=[];
    for(const row of rows){const expired=row.status==='leased';if(Number(row.attempts)>=8){await db.query("UPDATE sx_training_outbox_events SET status='dead',lease_owner=NULL,lease_expires_at=NULL,last_error_code='MAX_ATTEMPTS_EXCEEDED' WHERE tenant_id=? AND id=?",[ctx.tenant.id,row.id]);if(expired)await db.query("UPDATE sx_training_outbox_attempts SET outcome='dead',error_code='MAX_ATTEMPTS_EXCEEDED',finished_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND event_id=? AND attempt_number=? AND outcome='leased'",[ctx.tenant.id,row.id,Number(row.attempts)]);continue;}if(expired)await db.query("UPDATE sx_training_outbox_attempts SET outcome='lease_expired',error_code='WORKER_LEASE_EXPIRED',finished_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND event_id=? AND attempt_number=? AND outcome='leased'",[ctx.tenant.id,row.id,Number(row.attempts)]);
      const attempt=Number(row.attempts)+1;await db.query("UPDATE sx_training_outbox_events SET status='leased',attempts=?,lease_owner=?,lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND) WHERE tenant_id=? AND id=?",[attempt,workerId,leaseSeconds,ctx.tenant.id,row.id]);
      await db.query("INSERT INTO sx_training_outbox_attempts(tenant_id,event_id,attempt_number,worker_id,outcome) VALUES (?,?,?,?,'leased')",[ctx.tenant.id,row.id,attempt,workerId]);
      claimed.push({id:row.id,idempotencyKey:row.idempotency_key,eventType:row.event_type,payload:typeof row.payload_json==='string'?JSON.parse(row.payload_json):row.payload_json,attempt,leaseSeconds});
    }
    await db.commit();return {items:claimed,externalDispatch:false};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function finish(db,ctx,{eventId,workerId,outcome,errorCode,maxAttempts=8}={}){
  authorize(ctx);if(!uuid(eventId)||typeof workerId!=='string'||!/^[A-Za-z0-9._:-]{3,100}$/.test(workerId)||!['delivered','retry'].includes(outcome)||!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>20||(outcome==='retry'&&(typeof errorCode!=='string'||!/^[A-Z0-9_]{2,100}$/.test(errorCode))))fail('INVALID_OUTBOX_RESULT');
  await db.beginTransaction();try{
    const [[row]]=await db.query('SELECT attempts,status,lease_owner,(lease_expires_at>UTC_TIMESTAMP(3)) AS lease_valid FROM sx_training_outbox_events WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,eventId]);if(!row)fail('OUTBOX_EVENT_NOT_FOUND');if(row.status==='delivered'&&outcome==='delivered'){await db.commit();return {eventId,status:'delivered',repeated:true};}if(row.status!=='leased'||row.lease_owner!==workerId||Number(row.lease_valid)!==1)fail('OUTBOX_LEASE_REQUIRED');
    const attempt=Number(row.attempts),dead=outcome==='retry'&&attempt>=maxAttempts;
    if(outcome==='delivered'){
      await db.query("UPDATE sx_training_outbox_events SET status='delivered',lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,delivered_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",[ctx.tenant.id,eventId]);
      await db.query("UPDATE sx_training_outbox_attempts SET outcome='delivered',finished_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND event_id=? AND attempt_number=? AND worker_id=? AND outcome='leased'",[ctx.tenant.id,eventId,attempt,workerId]);
    }else{
      const delaySeconds=Math.min(3600,15*Math.pow(2,Math.min(attempt-1,8)));
      await db.query(`UPDATE sx_training_outbox_events SET status=?,available_at=IF(?='dead',available_at,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND)),lease_owner=NULL,lease_expires_at=NULL,last_error_code=? WHERE tenant_id=? AND id=?`,[dead?'dead':'ready',dead?'dead':'ready',delaySeconds,errorCode,ctx.tenant.id,eventId]);
      await db.query('UPDATE sx_training_outbox_attempts SET outcome=?,error_code=?,finished_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND event_id=? AND attempt_number=? AND worker_id=? AND outcome=\'leased\'',[dead?'dead':'retry',errorCode,ctx.tenant.id,eventId,attempt,workerId]);
    }
    await db.commit();return {eventId,status:outcome==='delivered'?'delivered':dead?'dead':'ready',attempt,retryInSeconds:outcome==='retry'&&!dead?Math.min(3600,15*Math.pow(2,Math.min(attempt-1,8))):null,externalDispatch:false};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
module.exports={normalizeEvent,enqueue,claim,finish};
