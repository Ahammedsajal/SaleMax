'use strict';
require('dotenv').config({quiet:true});
const os=require('node:os');
const delivery=require('../modules/platform/training-receipt-delivery');
const receiptsEnabled=delivery.enabled(process.env),remindersEnabled=delivery.reminderEmailEnabled(process.env);
if(!receiptsEnabled&&!remindersEnabled)throw new Error('TRAINING_EMAIL_WORKER_DISABLED');
const settings=delivery.smtpConfig(process.env);
const nodemailer=require('nodemailer');
const plans=require('../modules/platform/plans');
const outbox=require('../modules/platform/training-outbox');
const reminders=require('../modules/platform/training-installment-reminders');
const {trainingCenter}=require('../modules/platform/categories');
const pool=require('../database/config').promise();
const workerId=process.env.SALEMAX_RECEIPT_WORKER_ID||`training-email-${os.hostname().replace(/[^A-Za-z0-9._:-]/g,'-').slice(0,45)}-${process.pid}`;
const once=process.argv.includes('--once'),interval=Number(process.env.SALEMAX_RECEIPT_WORKER_INTERVAL_MS||10000);
if(!Number.isSafeInteger(interval)||interval<5000||interval>300000)throw new Error('INVALID_RECEIPT_WORKER_INTERVAL');
const transport=nodemailer.createTransport({host:settings.host,port:settings.port,secure:settings.secure,requireTLS:!settings.secure,auth:settings.auth,tls:{minVersion:'TLSv1.2'},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});
let stopping=false,timer=null;
async function tenantContexts(){
  const [rows]=await pool.query(`SELECT DISTINCT t.id AS tenantId,m.id AS membershipId,m.identity_id AS identityId,t.status AS tenantStatus
    FROM sx_tenants t JOIN sx_memberships m ON m.tenant_id=t.id AND m.role='owner' AND m.status='active'
    JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
    WHERE t.status='active' AND t.category_key='training_center' AND t.category_version=1 AND (
      ${remindersEnabled?`EXISTS(SELECT 1 FROM sx_training_reminder_settings s WHERE s.tenant_id=t.id AND s.enabled=1)`:'FALSE'}
      OR EXISTS(SELECT 1 FROM sx_training_outbox_events e WHERE e.tenant_id=t.id AND e.event_type IN (?) AND ((e.status='ready' AND e.available_at<=UTC_TIMESTAMP(3)) OR (e.status='leased' AND e.lease_expires_at<=UTC_TIMESTAMP(3))))
    ) ORDER BY t.id LIMIT 100`,[enabledEventTypes()]);
  const contexts=[];
  for(const row of rows){const subscription=await plans.loadEntitlements(pool,row.tenantId);if(!subscription||subscription.status!=='active'||subscription.categoryKey!=='training_center'||Number(subscription.categoryVersion)!==1||!subscription.capabilities.includes('finance.invoices'))continue;contexts.push({audience:'tenant',identity:{id:row.identityId},tenant:{id:row.tenantId,status:row.tenantStatus,categoryKey:'training_center',categoryVersion:1},membership:{id:row.membershipId,tenantId:row.tenantId,role:'owner',status:'active'},category:trainingCenter,subscription,runtimeReady:{}});}
  return contexts;
}
function enabledEventTypes(){return [...(receiptsEnabled?['finance.receipt.issued']:[]),...(remindersEnabled?['finance.installment.reminder']:[])];}
async function processTenant(ctx){
  const db=await pool.getConnection();let claimed;
  try{if(remindersEnabled)await reminders.scheduleDue(db,ctx);claimed=await outbox.claim(db,ctx,{workerId,limit:10,leaseSeconds:300,eventTypes:enabledEventTypes()});}
  finally{db.release();}
  let completed=0,failed=0,suppressed=0;
  for(const event of claimed.items){const current=await pool.getConnection();try{
    if(event.eventType==='finance.receipt.issued'){
      if(event.payload.resourceType!=='receipt'||!event.payload.resourceId)throw Object.assign(new Error(),{code:'INVALID_RECEIPT_EVENT'});
      await delivery.sendPending(current,{tenantId:ctx.tenant.id,receiptId:event.payload.resourceId,workerId,transport,from:settings.from});
      const done=await outbox.finish(current,ctx,{eventId:event.id,workerId,leaseVersion:event.leaseVersion,outcome:'delivered'});if(done.status!=='delivered')throw Object.assign(new Error(),{code:'OUTBOX_ACK_FAILED'});completed++;
    }else if(event.eventType==='finance.installment.reminder'){
      const offset=reminders.parseResourceOffset(event.payload.resourceType);
      const result=await reminders.dispatch(current,{tenantId:ctx.tenant.id,installmentId:event.payload.resourceId,scheduleVersion:event.payload.revision,offset,transport,from:settings.from});
      const done=result.status==='suppressed'?await outbox.finish(current,ctx,{eventId:event.id,workerId,leaseVersion:event.leaseVersion,outcome:'suppressed',errorCode:result.reason}):await outbox.finish(current,ctx,{eventId:event.id,workerId,leaseVersion:event.leaseVersion,outcome:'delivered'});
      if(done.status==='suppressed')suppressed++;else if(done.status==='delivered')completed++;else throw Object.assign(new Error(),{code:'OUTBOX_ACK_FAILED'});
    }else throw Object.assign(new Error(),{code:'UNKNOWN_TRAINING_EMAIL_EVENT'});
  }catch(error){failed++;const code=/^[A-Z0-9_]{2,100}$/.test(error.code||'')?error.code:'TRAINING_EMAIL_DELIVERY_FAILED';try{await outbox.finish(current,ctx,{eventId:event.id,workerId,leaseVersion:event.leaseVersion,outcome:'retry',errorCode:code});}catch(ackError){if(ackError.code!=='OUTBOX_LEASE_REQUIRED')throw ackError;}}
    finally{current.release();}
  }
  return {claimed:claimed.items.length,completed,failed,suppressed};
}
async function tick(){const contexts=await tenantContexts();let totals={tenants:contexts.length,claimed:0,completed:0,failed:0,suppressed:0};for(const ctx of contexts){const result=await processTenant(ctx);for(const key of ['claimed','completed','failed','suppressed'])totals[key]+=result[key];}if(totals.claimed)console.log(JSON.stringify(totals));return totals;}
async function stop(){if(stopping)return;stopping=true;if(timer)clearTimeout(timer);await transport.close();await pool.end();}
async function loop(){if(stopping)return;try{await tick();}catch(error){console.error(JSON.stringify({workerError:/^[A-Z0-9_]{2,100}$/.test(error.code||'')?error.code:'TRAINING_EMAIL_WORKER_FAILED'}));}if(!once&&!stopping)timer=setTimeout(loop,interval);else await stop();}
process.once('SIGINT',()=>stop().then(()=>process.exit(0)));
process.once('SIGTERM',()=>stop().then(()=>process.exit(0)));
loop().catch(async error=>{console.error(/^[A-Z0-9_]{2,100}$/.test(error.code||'')?error.code:'TRAINING_EMAIL_WORKER_FAILED');await stop();process.exitCode=1;});
