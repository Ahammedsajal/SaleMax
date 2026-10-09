'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const delivery=require('../modules/platform/training-report-delivery');
const worker=require('../modules/platform/training-report-delivery-worker');
const {trainingCenter}=require('../modules/platform/categories');
const scheduleId='00000000-0000-4000-8000-000000000001';
const challengeId='00000000-0000-4000-8000-000000000002';
const requestKey='00000000-0000-4000-8000-000000000003';
const verificationEnv={SALEMAX_REPORT_VERIFICATION_KEY:'synthetic-test-key-at-least-thirty-two-bytes',SALEMAX_REPORT_EMAIL_ENABLED:'true',SALEMAX_SMTP_HOST:'smtp.example.invalid',SALEMAX_SMTP_PORT:'587',SALEMAX_SMTP_USER:'mailer@example.invalid',SALEMAX_SMTP_PASS:'synthetic-password',SALEMAX_REPORT_FROM:'reports@example.invalid'};
function context(role='owner'){return {audience:'tenant',identity:{id:'identity-a'},tenant:{id:'tenant-a',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'membership-a',tenantId:'tenant-a',role,status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['reports.read','reports.schedule']}};}
function schedule(){return {id:scheduleId,revision:1,email_enabled:1,email_destination:'Owner@Example.qa',email_verified_at:null,whatsapp_enabled:0,whatsapp_destination:null,whatsapp_verified_at:null};}
class VerificationDb{
  constructor({challenge=null,replay=null}={}){this.schedule=schedule();this.challenge=challenge;this.replay=replay;this.calls=[];this.transactions=0;}
  async beginTransaction(){this.transactions++;}
  async commit(){}
  async rollback(){}
  async query(sql,params=[]){this.calls.push({sql,params});
    if(sql.includes('FROM sx_training_report_schedules WHERE tenant_id=? AND id=?'))return [[{...this.schedule}]];
    if(sql.includes('FROM sx_training_report_verifications WHERE tenant_id=? AND request_key=?'))return [[this.replay]];
    if(sql.includes('COUNT(*) AS sends'))return [[{sends:0,last_created:null}]];
    if(sql.startsWith('INSERT INTO sx_training_report_verifications')){this.challenge={id:params[0],tenant_id:params[1],schedule_id:params[2],schedule_revision:params[3],channel:params[4],request_key:params[5],destination_hash:params[6],challenge_hash:params[7],status:'pending',attempt_count:0,expires_at:params[8],sent_at:null,valid:1};this.replay={id:this.challenge.id,channel:this.challenge.channel,schedule_revision:this.challenge.schedule_revision,destination_hash:this.challenge.destination_hash,status:this.challenge.status,sent_at:null,expires_at:this.challenge.expires_at};return [{affectedRows:1}];}
    if(sql.includes('SET sent_at=UTC_TIMESTAMP')){this.challenge.sent_at=new Date();this.replay.sent_at=this.challenge.sent_at;return [{affectedRows:1}];}
    if(sql.includes('FROM sx_training_report_verifications WHERE tenant_id=? AND schedule_id=? AND id=?'))return [[this.challenge]];
    if(sql.startsWith('UPDATE sx_training_report_schedules SET email_verified_at=')){this.schedule.email_verified_at=new Date();this.schedule.revision++;return [{affectedRows:1}];}
    if(sql.includes("SET status='verified'")){this.challenge.status='verified';return [{affectedRows:1}];}
    if(sql.includes('SET attempt_count=')){this.challenge.attempt_count=params[0];if(params[1]>=5)this.challenge.status='locked';return [{affectedRows:1}];}
    if(sql.includes("SET status='expired'")){this.challenge.status='expired';return [{affectedRows:1}];}
    if(sql.includes("SET status='locked'")){this.challenge.status='locked';return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];
    if(sql.includes('SET status=')&&sql.includes('sx_training_report_verifications'))return [{affectedRows:1}];
    return [{affectedRows:1}];
  }
}
test('report destination normalization and provider readiness fail closed',()=>{
  assert.equal(delivery.email(' Owner@Example.qa '),'owner@example.qa');assert.equal(delivery.phone('+974 (5512) 3456'),'+97455123456');assert.equal(delivery.email('not-an-address'),null);assert.equal(delivery.phone('97455123456'),null);
  assert.equal(delivery.verificationCapabilities(verificationEnv).emailReady,true);assert.equal(delivery.verificationCapabilities({}).emailReady,false);assert.throws(()=>delivery.verificationKey({}),{code:'REPORT_VERIFICATION_NOT_CONFIGURED'});
  assert.equal(delivery.timingSafeHex('f'.repeat(64),'f'.repeat(64)),true);assert.equal(delivery.timingSafeHex('invalid','f'.repeat(64)),false);
});
test('provider capability projection separates verification readiness from active delivery readiness',async()=>{
  const env={...verificationEnv,SALEMAX_REPORT_DELIVERY_ENABLED:'true',SALEMAX_REPORT_WHATSAPP_ENABLED:'true',SALEMAX_REPORT_WHATSAPP_VERIFY_TEMPLATE:'salemax_report_verify',SALEMAX_REPORT_WHATSAPP_TEMPLATE:'salemax_owner_report',SALEMAX_REPORT_WHATSAPP_LANGUAGE:'en_US',SALEMAX_META_GRAPH_VERSION:'v24.0'};
  const db={async query(sql){if(sql.includes('FROM sx_legacy_ownership'))return [[{uid:'synthetic-owner',legacy_uid_hash:require('node:crypto').createHash('sha256').update('synthetic-owner').digest('hex')}]];if(sql.includes('FROM meta_api'))return [[{access_token:'synthetic-token-not-used',business_phone_number_id:'1234567890'}]];throw Error('unexpected query');}};
  const result=await delivery.providerCapabilities(db,'tenant-a',env);assert.deepEqual(result,{emailReady:true,whatsappReady:true,reportDeliveryEnabled:true,emailDeliveryReady:true,whatsappDeliveryReady:true});
  const disabled=await delivery.providerCapabilities({query(){throw Error('disabled delivery must not look up credentials');}},'tenant-a',{});assert.deepEqual(disabled,{emailReady:false,whatsappReady:false,reportDeliveryEnabled:false,emailDeliveryReady:false,whatsappDeliveryReady:false});
});
test('email verification stores only a destination digest and supports idempotent request replay',async()=>{
  const db=new VerificationDb(),sent=[];const input={scheduleId,channel:'email',expectedRevision:1,requestKey};
  const first=await delivery.requestVerification(db,context(),input,{env:verificationEnv,now:new Date('2026-10-08T10:00:00Z'),sendEmail:async message=>{sent.push(message);return {accepted:[message.to]};}});
  assert.equal(first.status,'sent');assert.equal(first.repeated,undefined);assert.match(sent[0].text,/\d{10}/);assert.equal(db.challenge.destination_hash,require('node:crypto').createHash('sha256').update('owner@example.qa').digest('hex'));assert.equal(db.challenge.challenge_hash.includes(sent[0].text.match(/\d{10}/)[0]),false);
  const replay=await delivery.requestVerification(db,context(),input,{env:verificationEnv,sendEmail:async()=>{throw Error('idempotent replay must not send twice');}});assert.equal(replay.id,first.id);assert.equal(replay.repeated,true);assert.equal(sent.length,1);
});
test('owner verification confirms a one-time code, is replay-safe and records no recipient PII in audit',async()=>{
  const db=new VerificationDb({challenge:{id:challengeId,tenant_id:'tenant-a',schedule_id:scheduleId,schedule_revision:1,channel:'email',destination_hash:require('node:crypto').createHash('sha256').update('owner@example.qa').digest('hex'),challenge_hash:'',status:'pending',attempt_count:0,expires_at:new Date(Date.now()+600000),sent_at:new Date(),valid:1}}),code='0123456789';
  db.challenge.challenge_hash=delivery.hashCode(verificationEnv.SALEMAX_REPORT_VERIFICATION_KEY,{tenantId:'tenant-a',scheduleId,channel:'email',destination:db.challenge.destination_hash,code});
  const input={scheduleId,challengeId,channel:'email',expectedRevision:1,code};const result=await delivery.confirmVerification(db,context(),input,{env:verificationEnv});assert.equal(result.verified,true);assert.equal(result.revision,2);
  const replay=await delivery.confirmVerification(db,context(),input,{env:verificationEnv});assert.equal(replay.repeated,true);assert.equal(replay.revision,2);
  const audit=db.calls.find(call=>call.sql.startsWith('INSERT INTO sx_audit_events'));assert.ok(audit);assert.equal(JSON.stringify(audit.params).includes('owner@example.qa'),false);
});
test('wrong report verification codes consume bounded attempts and lock the challenge',async()=>{
  const db=new VerificationDb({challenge:{id:challengeId,schedule_revision:1,destination_hash:require('node:crypto').createHash('sha256').update('owner@example.qa').digest('hex'),challenge_hash:'a'.repeat(64),status:'pending',attempt_count:0,expires_at:new Date(Date.now()+600000),sent_at:new Date(),valid:1}}),input={scheduleId,challengeId,channel:'email',expectedRevision:1,code:'9999999999'};
  for(let attempt=1;attempt<=5;attempt++)await assert.rejects(delivery.confirmVerification(db,context(),input,{env:verificationEnv}),{code:attempt===5?'REPORT_VERIFICATION_LOCKED':'REPORT_VERIFICATION_CODE_INVALID'});
  assert.equal(db.challenge.attempt_count,5);assert.equal(db.challenge.status,'locked');
});
test('verification refuses non-owner contexts before database access',async()=>{
  const db={beginTransaction(){throw Error('must be denied before database access');}};await assert.rejects(delivery.requestVerification(db,context('manager'),{scheduleId,channel:'email',expectedRevision:1,requestKey},{env:verificationEnv}),{code:'PERMISSION_DENIED'});
});
test('report email and WhatsApp summaries separate cash from invoices and omit customer details',()=>{
  const snapshot={period:'daily',from:'2026-10-07T21:00:00Z',to:'2026-10-08T20:00:00Z',activityCount:4,timezone:'Asia/Qatar',summary:{leadsCreated:2,newLeadsContacted:1,newLeadsUntouched:1,followUpsDue:1,followUpsOverdue:1,agentReplies:3,outcomes:2},journey:{summary:{salesConverted:1},sources:[{sourceType:'whatsapp',total:2}],stages:[{title:'Interested',total:1}],agents:[{agentName:'Agent 1',agentReplies:3,salesClosedByAgent:1}],cohortFunnel:{newLeads:2,attended:1,salesConverted:1,invoicesIssued:1,paymentReceived:1},learnerJourney:{enrolled:1,courseStarted:1,courseCompleted:0,certificatesIssued:0}},finance:{currency:'QAR',issuedInvoiceCount:1,billedMinor:10000,cashReceivedMinor:5000,paymentsReceivedCount:1,refundsPaidMinor:0,creditsIssuedMinor:0,netCollectionsMinor:5000,allOutstandingMinor:5000,overdueReceivablesMinor:2500,disputesReportedCount:0,openDisputesCount:0,reconciliation:{status:'clear'}},comparisons:{yesterday:{summary:{leadsCreated:1},journey:{summary:{salesConverted:0}},finance:{cashReceivedMinor:2500}}},actionItems:[{key:'overdue_followups',count:1,priority:'high'}],customerDetailsIncluded:false,privateCustomerValue:'should-not-appear'};
  const message=worker.emailContent(snapshot,{to:'owner@example.qa'});assert.match(message.text,/New leads 2 \(1 contacted, 1 untouched\)/);assert.match(message.text,/Cash received 50\.00 QAR/);assert.match(message.text,/yesterday: leads 2 vs 1/);assert.match(message.text,/HIGH: overdue followups/);assert.equal(message.text.includes('should-not-appear'),false);assert.deepEqual(worker.whatsappParameters(snapshot),['daily','2026-10-07 - 2026-10-08','Leads 2 (1 untouched); due/late 1/1; cash 50.00 QAR; overdue AR 25.00']);
  const verification=delivery.verificationEmail({code:'0012345678',from:'reports@example.qa',to:'owner@example.qa'});assert.match(verification.html,/0012345678/);
});
test('email worker requires explicit acceptance from the configured recipient',async()=>{
  const env={...verificationEnv,SALEMAX_REPORT_DELIVERY_ENABLED:'true'},message=worker.emailContent({period:'daily',from:'2026-10-07',to:'2026-10-08',activityCount:2,summary:{}},{to:'owner@example.invalid'}),calls=[];
  const accepted=await worker.sendEmail(message,{env,sendEmail:async payload=>{calls.push(payload);return {accepted:[payload.to],providerMessageId:'synthetic-smtp-id'};}});
  assert.equal(accepted.status,'accepted');assert.equal(accepted.providerMessageId,'synthetic-smtp-id');assert.equal(calls.length,1);assert.equal(calls[0].to,'owner@example.invalid');assert.match(calls[0].text,/customer details are excluded/);
  const ambiguous=await worker.sendEmail(message,{env,sendEmail:async()=>({accepted:[]})});assert.equal(ambiguous.status,'unknown');
});
test('WhatsApp delivery worker uses tenant credentials and an injected template adapter',async()=>{
  const env={SALEMAX_REPORT_DELIVERY_ENABLED:'true',SALEMAX_REPORT_WHATSAPP_ENABLED:'true',SALEMAX_REPORT_WHATSAPP_TEMPLATE:'salemax_owner_report',SALEMAX_REPORT_WHATSAPP_LANGUAGE:'en_US',SALEMAX_META_GRAPH_VERSION:'v24.0'},calls=[];
  const db={async query(sql){if(sql.includes('FROM sx_legacy_ownership'))return [[{uid:'synthetic-owner',legacy_uid_hash:require('node:crypto').createHash('sha256').update('synthetic-owner').digest('hex')}]];if(sql.includes('FROM meta_api'))return [[{access_token:'synthetic-token-not-used',business_phone_number_id:'1234567890'}]];throw Error('unexpected query');}};
  const result=await worker.sendWhatsapp(db,{tenantId:'tenant-a',to:'+97455123456',env,snapshot:{period:'weekly',from:'2026-10-01',to:'2026-10-07',activityCount:3,summary:{leadsCreated:1,followUpsDue:2}},sendWhatsapp:async input=>{calls.push(input);return {providerMessageId:'synthetic-wa-id'};}});
  assert.equal(result.status,'accepted');assert.equal(result.providerMessageId,'synthetic-wa-id');assert.equal(calls.length,1);assert.equal(calls[0].message.messaging_product,'whatsapp');assert.equal(calls[0].message.to,'97455123456');assert.equal(calls[0].message.template.name,'salemax_owner_report');assert.equal(calls[0].message.template.components[0].parameters.length,3);
});
test('delivery worker remains inert when the global delivery gate is off',async()=>{
  const pool={getConnection(){throw Error('disabled delivery must not acquire a connection');}};
  assert.deepEqual(await worker.tick(pool,{env:{},workerId:'delivery-disabled'}),{claimed:0,accepted:0,failed:0,retrying:0,unknown:0,externalWrites:false});
});
