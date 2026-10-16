'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const dashboard=require('../modules/platform/training-finance-dashboard');
const qr=require('../modules/platform/training-report-qr');
test('dashboard validates real dates, pagination, detail views and aging buckets',()=>{
  assert.equal(dashboard.filters({view:'receipts',from:'2026-10-01',to:'2026-10-16'}).view,'receipts');
  for(const raw of [{view:'sql'},{from:'2026-02-30'},{from:'2026-10-17',to:'2026-10-16'},{limit:101},{bucket:'other'}])assert.throws(()=>dashboard.filters(raw));
});
test('dashboard refuses unauthorized roles and tenants before querying',async()=>{
  for(const ctx of [{},{audience:'platform'},{audience:'tenant',tenant:{id:'one'},membership:{role:'agent',tenantId:'two'}}])await assert.rejects(dashboard.report({query(){throw Error('database must not be touched');}},ctx));
});
const env={SALEMAX_REPORT_WHATSAPP_ENABLED:'true',SALEMAX_REPORT_WHATSAPP_TRANSPORT:'qr',CRM_INTERNAL_SECRET:'synthetic-test-secret',PORT:'3010'};
const owner={uid:'synthetic-owner',legacy_uid_hash:require('crypto').createHash('sha256').update('synthetic-owner').digest('hex'),number:'97400000000'};
test('QR report transport is explicit and disabled in local-only mode',()=>{
  assert.equal(qr.config(env).url,'http://127.0.0.1:3010/api/internal/qr/send-text');
  assert.throws(()=>qr.config({...env,LOCAL_ONLY_MODE:'true'}));assert.throws(()=>qr.config({...env,CRM_INTERNAL_SECRET:''}));
  assert.equal(qr.config({...env,SALEMAX_REPORT_QR_INTERNAL_ORIGIN:'http://app:3010'}).url,'http://app:3010/api/internal/qr/send-text');
  assert.throws(()=>qr.config({...env,SALEMAX_REPORT_QR_INTERNAL_ORIGIN:'https://external.example'}));
});
test('manager finance access remains read-only',()=>{
  const ctx={audience:'tenant',identity:{id:'identity'},tenant:{id:'tenant',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{tenantId:'tenant',role:'manager',status:'active'},category:{key:'training_center',version:1,capabilities:['finance.invoices']},subscription:{status:'active',capabilities:['finance.invoices']}};
  const generator=require('../modules/platform/invoice-generator');
  assert.doesNotThrow(()=>generator.requireRole(ctx));assert.throws(()=>generator.requireRole(ctx,true));
});
test('QR report verifies tenant sender and recipient and requires provider message id',async()=>{
  let calls=0;const db={async query(sql){return sql.includes('sx_legacy_ownership')?[[owner]]:[[{id:'verified-recipient'}]];}};
  const result=await qr.send(db,{tenantId:'synthetic',to:'+97400000001',text:'Synthetic report',env,http:{async post(url,body){calls++;assert.equal(body.uid,owner.uid);assert.equal(body.to,'97400000001');return {data:{success:true,data:{messageId:'synthetic-id'}}};}}});
  assert.equal(result.status,'accepted');assert.equal(calls,1);
  const blocked=await qr.send({async query(sql){return sql.includes('sx_legacy_ownership')?[[owner]]:[[]];}},{tenantId:'synthetic',to:'+97400000001',text:'Synthetic',env,http:{post(){throw Error('must not send');}}});assert.equal(blocked.errorCode,'REPORT_DESTINATION_NOT_VERIFIED');
  const unknown=await qr.send(db,{tenantId:'synthetic',to:'+97400000001',text:'Synthetic',env,http:{async post(){throw Error('timeout');}}});assert.equal(unknown.status,'unknown');
});
test('QR does not select an ambiguous sender or an ownership mismatch',async()=>{
  assert.equal(await qr.sender({async query(){return [[owner,owner]];}},'tenant'),null);
  assert.equal(await qr.sender({async query(){return [[{...owner,legacy_uid_hash:'incorrect'}]];}},'tenant'),null);
});
