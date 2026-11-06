'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const consent=require('../modules/platform/retail-notice-consent');
const notifications=require('../modules/platform/business-notifications');
const commerce=require('../modules/platform/retail-commerce');

const tenant='11111111-1111-4111-8111-111111111111';
const orderId='22222222-2222-4222-8222-222222222222';
const env={SALEMAX_PLATFORM_KEY_BASE64:Buffer.alloc(32,7).toString('base64')};

test('consent revocation capability is random, encrypted, tenant/order bound and recoverable',()=>{
 const row=consent.create(tenant,orderId,env);
 assert.match(row.token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(consent.matches(row.token,row,tenant,orderId,env),true);
 assert.equal(consent.matches(row.token,row,'33333333-3333-4333-8333-333333333333',orderId,env),false);
 assert.equal(consent.matches(row.token,row,tenant,'33333333-3333-4333-8333-333333333333',env),false);
 assert.equal(consent.reveal({token_hash:row.tokenHash,token_ciphertext:row.ciphertext,token_iv:row.iv,token_auth_tag:row.authTag},tenant,orderId,env),row.token);
 assert.notEqual(consent.create(tenant,orderId,env).token,row.token);
});

test('customer order notice preparation creates only the consented order recipient and omits contact data from event snapshots',async()=>{
 const inserted=[];let preparedPayload;const order={id:orderId,status:'placed',deliveryState:'unassigned',buyerPhone:'+97450000001',storeTitle:'Synthetic shop',timezone:'Asia/Qatar'};
 const destinationHash=require('../modules/platform/business-whatsapp').hash('97450000001');
 const db={query:async(sql,args)=>{
  if(sql.includes('FROM sx_retail_orders o JOIN sx_retail_store'))return [[order]];
  if(sql.includes('FROM sx_retail_customer_notification_consents'))return [[{status:'granted',destinationHash}]];
  if(sql.includes('INSERT INTO sx_business_notification_deliveries')){inserted.push(args);return [{affectedRows:1}];}
  if(sql.includes('UPDATE sx_business_notification_events SET status=\'prepared\'')){preparedPayload=JSON.parse(args[0]);return [{affectedRows:1}];}
  assert.fail('Unexpected SQL: '+sql);
 }};
 await notifications.prepare(db,{id:'event-id',tenant_id:tenant,kind:'retail_customer_order_event',source_type:'retail_order',source_id:orderId,payload_json:JSON.stringify({event:'new_order'})},{id:tenant,name:'Synthetic tenant',timezone:'Asia/Qatar'});
 assert.equal(inserted.length,1);
 assert.equal(inserted[0][2],'customer');
 assert.equal(inserted[0][3],orderId);
 assert.equal(inserted[0][4],destinationHash);
 assert.equal(preparedPayload.snapshot.buyerPhone,undefined);
 assert.equal(preparedPayload.snapshot.destinationHash,undefined);
 assert.equal(preparedPayload.snapshot.storeTitle,'Synthetic shop');
});

test('customer dispatch rechecks current consent and sends only short order status',async()=>{
 const destinationHash=require('../modules/platform/business-whatsapp').hash('97450000001');
 const originalKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;process.env.SALEMAX_PLATFORM_KEY_BASE64=env.SALEMAX_PLATFORM_KEY_BASE64;
 const secret=consent.create(tenant,orderId,env);let sent;
 const db={query:async sql=>sql.includes('FROM sx_retail_orders o JOIN sx_tenants')?[[{buyerPhone:'50000001',timezone:'Asia/Qatar',storeSlug:'synthetic-shop'}]]:
   sql.includes('FROM sx_retail_customer_notification_consents')?[[{status:'granted',destinationHash,token_hash:secret.tokenHash,token_ciphertext:secret.ciphertext,token_iv:secret.iv,token_auth_tag:secret.authTag}]]:assert.fail('Unexpected SQL: '+sql)};
 try{
  const result=await notifications.dispatch(db,{tenant_id:tenant,timezone:'Asia/Qatar',kind:'retail_customer_order_event',source_id:orderId,payload_json:JSON.stringify({snapshot:{storeTitle:'Synthetic shop',orderRef:'22222222',event:'status_ready',status:'ready',deliveryState:'assigned'}}),recipient_kind:'customer',recipient_id:orderId,destination_hash:destinationHash,part:'text'},{authorize:async()=>true,send:async(_db,payload)=>{sent=payload;return {status:'accepted',providerMessageId:'synthetic-message'};}});
  assert.equal(result.status,'accepted',JSON.stringify(result));
  assert.equal(sent.to,'97450000001');
  assert.match(sent.text,/Synthetic shop: order 22222222 status ready/);
  assert.match(sent.text,/no marketing messages/i);
  assert.match(sent.text,/https:\/\/7network\.live\/business\/synthetic-shop\/shop\/notifications\/consent\/revoke#stop=22222222-2222-4222-8222-222222222222\./);
  assert.match(sent.text,new RegExp(secret.token));
  assert.doesNotMatch(sent.text,/50000001|address|tenant_id|\+974/);
 }finally{if(originalKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalKey;}
});

test('customer dispatch suppresses revoked or changed consent before WhatsApp send',async()=>{
 const destinationHash=require('../modules/platform/business-whatsapp').hash('97450000001');
 for(const consentRow of [{status:'withdrawn',destinationHash},{status:'granted',destinationHash:'0'.repeat(64)}]){
  const db={query:async sql=>sql.includes('FROM sx_retail_orders o JOIN sx_tenants')?[[{buyerPhone:'50000001',timezone:'Asia/Qatar'}]]:
    sql.includes('FROM sx_retail_customer_notification_consents')?[[consentRow]]:assert.fail('Unexpected SQL: '+sql)};
  const result=await notifications.dispatch(db,{tenant_id:tenant,timezone:'Asia/Qatar',kind:'retail_customer_order_event',source_id:orderId,payload_json:'{}',recipient_kind:'customer',recipient_id:orderId,destination_hash:destinationHash},{authorize:async()=>true,send:async()=>assert.fail('Suppressed notices must never call the provider')});
  assert.equal(result.status,'suppressed');
 }
});

test('customer revocation is tenant scoped, auditable and suppresses queued deliveries',async()=>{
 const previous=process.env.SALEMAX_PLATFORM_KEY_BASE64;process.env.SALEMAX_PLATFORM_KEY_BASE64=env.SALEMAX_PLATFORM_KEY_BASE64;
 const created=consent.create(tenant,orderId),state={status:'granted',token_hash:created.tokenHash,destination_hash:'a'.repeat(64),audit:0,suppressed:0};
 const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},query:async(sql)=>{
  if(sql.includes('SELECT tenant_id FROM sx_retail_store'))return [[{tenant_id:tenant}]];
  if(sql.includes('FROM sx_retail_customer_notification_consents')&&sql.includes('FOR UPDATE'))return [[state]];
  if(sql.startsWith("UPDATE sx_retail_customer_notification_consents SET status='withdrawn'")){state.status='withdrawn';return [{affectedRows:1}];}
  if(sql.includes('INSERT INTO sx_retail_customer_notification_consent_events')){state.audit++;return [{affectedRows:1}];}
  if(sql.includes('UPDATE sx_business_notification_deliveries d JOIN')){state.suppressed++;return [{affectedRows:1}];}
  assert.fail('Unexpected SQL: '+sql);
 }};
 const pool={getConnection:async()=>db};
 try{
  await assert.rejects(()=>commerce.revokeCustomerNotificationConsent(pool,null,tenant,{orderId,token:'A'.repeat(43)}),{code:'CONSENT_NOT_FOUND'});
  assert.equal(state.status,'granted');
  assert.deepEqual(await commerce.revokeCustomerNotificationConsent(pool,null,tenant,{orderId,token:created.token}),{withdrawn:true,replayed:false});
  assert.equal(state.status,'withdrawn');assert.equal(state.audit,1);assert.equal(state.suppressed,1);
  assert.deepEqual(await commerce.revokeCustomerNotificationConsent(pool,null,tenant,{orderId,token:created.token}),{withdrawn:true,replayed:true});
 }finally{if(previous===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=previous;}
});

test('accounting source CSV is tenant-filtered, period bounded and clearly distinguishes return estimates from refunds',async()=>{
 const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},query:async(sql,args)=>{
  assert.equal(args[0],tenant);assert.equal(args[1],'2026-11-01');assert.equal(args[2],'2026-11-30');
  if(sql.includes('FROM sx_retail_cash_receipts'))return [[{recordId:'receipt-1',orderId,amountMinor:2500,occurredAt:'2026-11-03T10:00:00.000000Z',status:'completed',fulfillment:'pickup',totalMinor:2500,deliveryFee:0,locationCode:'=2+2',settlementStatus:'unsettled'}]];
  if(sql.includes('FROM sx_retail_returns'))return [[{recordId:'return-1',orderId,occurredAt:'2026-11-05T10:00:00.000000Z',status:'partially_returned',fulfillment:'pickup',totalMinor:2500,deliveryFee:0,orderLines:JSON.stringify([{id:'item-1',quantity:2,priceMinor:1250}]),productId:'item-1',quantity:1}]];
  assert.fail('Unexpected SQL: '+sql);
 }};
 const result=await commerce.accountingSourceCsv({getConnection:async()=>db},tenant,'2026-11-01','2026-11-30');
 assert.equal(result.rowCount,2);
 assert.match(result.csv,/cash_receipt,receipt-1/);
 assert.match(result.csv,/return_items,return-1/);
 assert.match(result.csv,/,1,1250,\r?$/m);
 assert.match(result.csv,/location_code/);
 assert.match(result.csv,/,'=2\+2,/);
 assert.match(result.csv,/refund_paid_minor/);
 assert.equal(result.csv.includes(orderId),true);
 assert.equal(result.csv.includes('buyerPhone'),false);
 await assert.rejects(()=>commerce.accountingSourceCsv({getConnection:async()=>db},tenant,'2026-10-01','2027-01-02'),{code:'ACCOUNTING_EXPORT_RANGE_TOO_LARGE'});
 await assert.rejects(()=>commerce.accountingSourceCsv({getConnection:async()=>db},tenant,'2026-11-30','2026-11-01'),{code:'INVALID_ACCOUNTING_EXPORT_RANGE'});
});

test('consent migration adds explicit transactional scope and leaves storefront activation unchanged',()=>{
 const fs=require('node:fs'),sql=fs.readFileSync(require.resolve('../database/migrations/20270131_retail_customer_notice_consent.sql'),'utf8');
 assert.match(sql,/retail_customer_order_event/);
 assert.match(sql,/purpose ENUM\('transactional_order_updates'\)/);
 assert.match(sql,/source ENUM\('storefront_checkout','customer_revocation'\)/);
 assert.doesNotMatch(sql,/UPDATE sx_retail_store SET enabled/);
});

test('storefront PWA shell caches are isolated by registration scope',()=>{
 const fs=require('node:fs'),worker=fs.readFileSync(require.resolve('../client/public/retail-shop-sw.js'),'utf8');
 assert.match(worker,/encodeURIComponent\(scope\.pathname\)/);
 assert.match(worker,/keys\.filter\(key=>key\.startsWith\(CACHE_PREFIX\)&&key!==CACHE\)/);
 assert.doesNotMatch(worker,/key\.startsWith\('7network-storefront-shell-'\)/);
 assert.match(worker,/if\(!isShellPage&&!isStaticAsset\)return/);
 assert.match(worker,/ec07-consented-notices1/);
});
