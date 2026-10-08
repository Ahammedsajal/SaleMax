'use strict';
const assert=require('node:assert/strict');
const preferences=require('../modules/platform/training-reminder-preferences');
const reminders=require('../modules/platform/training-installment-reminders');
const outbox=require('../modules/platform/training-outbox');

module.exports=async(db,ctx,invoiceId)=>{
  const env={SALEMAX_PLATFORM_KEY_BASE64:Buffer.alloc(32,41).toString('base64'),SALEMAX_PUBLIC_BASE_URL:'https://crm.example.qa'};
  const [[invoice]]=await db.query('SELECT invoice_email FROM sx_training_invoices WHERE tenant_id=? AND id=?',[ctx.tenant.id,invoiceId]);assert.ok(invoice?.invoice_email);
  const originalEmail=invoice.invoice_email,newEmail='new-payer@synthetic.example.invalid';
  const issued=await preferences.issue(db,ctx,invoiceId,{origin:'https://crm.example.qa',env});assert.equal(issued.status,'pending');
  const oldToken=new URL(issued.url).hash.slice(1);assert.equal((await preferences.resolve(db,oldToken)).status,'pending');assert.equal((await preferences.update(db,oldToken,true)).status,'opted_in');
  await db.query('UPDATE sx_training_invoices SET invoice_email=? WHERE tenant_id=? AND id=?',[newEmail,ctx.tenant.id,invoiceId]);
  const rotated=await preferences.issue(db,ctx,invoiceId,{origin:'https://crm.example.qa',env});assert.equal(rotated.status,'pending');const token=new URL(rotated.url).hash.slice(1);
  await assert.rejects(preferences.resolve(db,oldToken),{code:'REMINDER_LINK_UNAVAILABLE'});assert.equal((await preferences.resolve(db,token)).recipient,'n•••@synthetic.example.invalid');assert.equal((await preferences.update(db,token,true)).status,'opted_in');

  const [[installment]]=await db.query("SELECT id,schedule_version,CAST(due_date AS CHAR) AS due_date FROM sx_training_installments WHERE tenant_id=? AND invoice_id=? AND status<>'cancelled' ORDER BY sequence_number LIMIT 1",[ctx.tenant.id,invoiceId]);assert.ok(installment);const originalDueDate=String(installment.due_date).slice(0,10);
  const today=reminders.todayQatar(),[year,month,day]=today.split('-').map(Number),tomorrow=new Date(Date.UTC(year,month-1,day+1)).toISOString().slice(0,10);
  await db.query('UPDATE sx_training_installments SET due_date=? WHERE tenant_id=? AND id=?',[tomorrow,ctx.tenant.id,installment.id]);
  await reminders.saveSettings(db,ctx,{enabled:true,offsetsDays:[-1],expectedRevision:0});
  const scheduled=await reminders.scheduleDue(db,ctx,{now:new Date()});assert.equal(scheduled.scheduled,1);
  const claimed=await outbox.claim(db,ctx,{workerId:'reminder-db-integration',limit:5,leaseSeconds:60,eventTypes:['finance.installment.reminder']});assert.equal(claimed.items.length,1);
  const sentMessages=[];const transport={async sendMail(message){sentMessages.push(message);return {accepted:[message.to]};}};
  const event=claimed.items[0],payload=event.payload;const sent=await reminders.dispatch(db,{tenantId:ctx.tenant.id,installmentId:payload.resourceId,scheduleVersion:payload.revision,offset:reminders.parseResourceOffset(payload.resourceType),transport,from:'reminders@example.invalid',env});assert.equal(sent.status,'sent');assert.equal(sentMessages.length,1);assert.equal(sentMessages[0].to,newEmail);assert.match(sentMessages[0].text,/Manage reminder preferences/);
  assert.equal((await outbox.finish(db,ctx,{eventId:event.id,workerId:'reminder-db-integration',leaseVersion:event.leaseVersion,outcome:'delivered'})).status,'delivered');

  await reminders.saveSettings(db,ctx,{enabled:true,offsetsDays:[0],expectedRevision:1});
  await db.query('UPDATE sx_training_installments SET due_date=? WHERE tenant_id=? AND id=?',[today,ctx.tenant.id,installment.id]);
  assert.equal((await reminders.scheduleDue(db,ctx,{now:new Date()})).scheduled,1);
  const pending=await outbox.claim(db,ctx,{workerId:'reminder-db-integration',limit:5,leaseSeconds:60,eventTypes:['finance.installment.reminder']});assert.equal(pending.items.length,1);
  assert.equal((await preferences.update(db,token,false)).status,'opted_out');const suppressedEvent=pending.items[0];
  const suppressed=await reminders.dispatch(db,{tenantId:ctx.tenant.id,installmentId:suppressedEvent.payload.resourceId,scheduleVersion:suppressedEvent.payload.revision,offset:reminders.parseResourceOffset(suppressedEvent.payload.resourceType),transport,from:'reminders@example.invalid',env});assert.deepEqual(suppressed,{status:'suppressed',reason:'CUSTOMER_OPTED_OUT'});assert.equal(sentMessages.length,1,'opt-out after queueing suppresses before external delivery');
  assert.equal((await outbox.finish(db,ctx,{eventId:suppressedEvent.id,workerId:'reminder-db-integration',leaseVersion:suppressedEvent.leaseVersion,outcome:'suppressed',errorCode:suppressed.reason})).status,'suppressed');
  const [[suppressedRow]]=await db.query('SELECT status,last_error_code FROM sx_training_outbox_events WHERE tenant_id=? AND id=?',[ctx.tenant.id,suppressedEvent.id]);assert.deepEqual([suppressedRow.status,suppressedRow.last_error_code],['suppressed','CUSTOMER_OPTED_OUT']);
  await reminders.saveSettings(db,ctx,{enabled:false,offsetsDays:[0],expectedRevision:2});
  await db.query('UPDATE sx_training_invoices SET invoice_email=? WHERE tenant_id=? AND id=?',[originalEmail,ctx.tenant.id,invoiceId]);
  await db.query('UPDATE sx_training_installments SET due_date=? WHERE tenant_id=? AND id=?',[originalDueDate,ctx.tenant.id,installment.id]);
  return {reminderPreferenceConsentPersistsInMariaDb:true,changedRecipientRequiresNewConsent:true,oldReminderTokenRevoked:true,qatarLocalReminderSchedulingIsIdempotent:true,reminderDispatchUsesCurrentBalanceAndPreferenceLink:true,optOutAfterQueueSuppressesAndAuditsOutbox:true,externalWrites:false};
};
