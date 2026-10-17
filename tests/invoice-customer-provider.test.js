'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),provider=require('../modules/platform/invoice-customer-provider');
const message={tenantId:'synthetic-tenant',channel:'email',recipient:'payer@example.invalid',subject:'Invoice ready',text:'<img src=x onerror=alert(1)> & invoice'},env={LOCAL_ONLY_MODE:'true'};
test('local-only mode blocks real providers even if send is called directly',async()=>{
  const db={query(){throw Error('No database or provider call expected');}};
  assert.equal((await provider.readiness(db,message.tenantId,'email',{env})).ready,false);
  assert.equal((await provider.send(db,message,{env})).status,'blocked');
  assert.equal((await provider.send(db,{...message,channel:'whatsapp'},{env})).status,'blocked');
});
test('email acceptance requires the exact recipient and a provider message id',async()=>{
  const send=result=>provider.send(null,message,{env,emailSend:async()=>result});
  assert.equal((await send({accepted:[message.recipient],messageId:'synthetic-id'})).status,'accepted');
  assert.equal((await send({accepted:['other@example.invalid'],messageId:'synthetic-id'})).status,'unknown');
  assert.equal((await send({accepted:[message.recipient]})).status,'unknown');
  assert.equal((await send({rejected:[message.recipient]})).status,'failed');
});
test('SMTP definitive rejection, temporary refusal and ambiguous outcomes stay distinct',async()=>{
  const send=error=>provider.send(null,message,{env,emailSend:async()=>{throw error;}});
  assert.equal((await send({responseCode:450})).status,'retry');
  assert.equal((await send({responseCode:550})).status,'failed');
  assert.equal((await send({code:'ECONNREFUSED'})).status,'retry');
  assert.equal((await send({code:'ETIMEDOUT'})).status,'unknown');
  assert.equal((await send({code:'ECONNRESET'})).status,'unknown');
});
test('HTML email escapes invoice and customer-controlled content',async()=>{
  let rendered;await provider.send(null,message,{env,emailSend:async value=>{rendered=value;return {accepted:[value.to],messageId:'synthetic-id'};}});
  assert.equal(rendered.text,message.text);assert.match(rendered.html,/&lt;img/);assert.doesNotMatch(rendered.html,/<img/);
  const link='https://crm.example.invalid/customer-invoice#'+Buffer.alloc(32,4).toString('base64url');assert.ok(provider.content({...message,text:link}).html.includes('<a href="'+link+'">'));assert.doesNotMatch(provider.content({...message,text:'javascript:alert(1)'}).html,/<a /);
});
test('QR acceptance requires both success and a message id',async()=>{
  const send=result=>provider.send(null,{...message,channel:'whatsapp',recipient:'+97450313785'},{env,whatsappSend:async()=>result});
  assert.equal((await send({success:true,data:{messageId:'synthetic-qr-id'}})).status,'accepted');
  assert.equal((await send({success:true})).status,'unknown');
  assert.equal((await send({success:false,data:{messageId:'synthetic-qr-id'}})).status,'unknown');
});
test('known disconnected QR sessions block safely while timeouts remain unknown',async()=>{
  const send=error=>provider.send(null,{...message,channel:'whatsapp',recipient:'+97450313785'},{env,whatsappSend:async()=>{throw error;}});
  assert.equal((await send({response:{status:500,data:{msg:'Session is not active for this instance'}}})).status,'blocked');
  assert.equal((await send({response:{status:401}})).status,'blocked');
  assert.equal((await send({code:'ECONNREFUSED'})).status,'retry');
  assert.equal((await send({code:'ETIMEDOUT'})).status,'unknown');
  assert.equal((await send({response:{status:500,data:{msg:'Some other failure'}}})).status,'unknown');
});
