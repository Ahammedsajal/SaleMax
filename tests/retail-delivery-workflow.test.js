'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const commerce=require('../modules/platform/retail-commerce');
const proofCrypto=require('../modules/platform/retail-delivery-proof');

const tenant='11111111-1111-4111-8111-111111111111';
const orderId='22222222-2222-4222-8222-222222222222';
const driver='33333333-3333-4333-8333-333333333333';
const identity='44444444-4444-4444-8444-444444444444';
const env={SALEMAX_PLATFORM_KEY_BASE64:Buffer.alloc(32,8).toString('base64')};
process.env.SALEMAX_PLATFORM_KEY_BASE64=env.SALEMAX_PLATFORM_KEY_BASE64;

function fixture({proofRequired=false,code='123456'}={}){
  const sealed=proofRequired?proofCrypto.create(tenant,orderId,env):null;
  const state={order:{status:'dispatched',fulfillment:'delivery',deliveryState:'in_transit',proofRequired:Number(proofRequired),driver},
    proof:sealed?{codeHash:sealed.hash,codeCiphertext:sealed.ciphertext,codeIv:sealed.iv,codeAuthTag:sealed.authTag,attempts:0,verifiedAt:null}:null,
    receipts:[],attempts:[],events:[]};
  if(sealed)state.code=sealed.code;
  const db={beginTransaction:async()=>state.events.push('begin'),commit:async()=>state.events.push('commit'),
    rollback:async()=>state.events.push('rollback'),release:()=>{},
    query:async(sql,args=[])=>{
      if(sql.includes('FROM sx_retail_orders WHERE tenant_id=? AND id=? FOR UPDATE'))return [[{...state.order}]];
      if(sql.includes("FROM sx_memberships WHERE tenant_id=? AND id=? AND status='active' AND role='agent'"))return [[{id:args[1]}]];
      if(sql.includes('FROM sx_identities WHERE id=(SELECT identity_id FROM sx_memberships'))return [[{id:identity}]];
      if(sql.includes('FROM sx_retail_delivery_attempts WHERE tenant_id=? AND order_id=? AND request_id=? FOR UPDATE')){
        const row=state.attempts.find(item=>item.requestId===args[2]);return [row?[{hash:row.hash,result:row.result}]:[]];
      }
      if(sql.includes("FROM sx_retail_delivery_attempts WHERE tenant_id=? AND order_id=? AND result='failed'")){
        const count=state.attempts.filter(item=>item.result==='failed').length;
        return [[{attemptNumber:sql.includes('COUNT(*)+1')?count+1:count}]];
      }
      if(sql.includes('FROM sx_retail_delivery_attempts WHERE tenant_id=? AND order_id=?')){
        return [[{attemptNumber:state.attempts.length}]];
      }
      if(sql.includes('FROM sx_retail_delivery_proofs')&&sql.includes('code_hash AS codeHash')){
        return [state.proof?[{codeHash:state.proof.codeHash,codeCiphertext:state.proof.codeCiphertext,
          codeIv:state.proof.codeIv,codeAuthTag:state.proof.codeAuthTag,attempts:state.proof.attempts,verifiedAt:state.proof.verifiedAt}]:[]];
      }
      if(sql.includes('FROM sx_retail_delivery_proofs')&&sql.includes('verified_at AS verifiedAt')){
        return [state.proof?[{verifiedAt:state.proof.verifiedAt}]:[]];
      }
      if(sql.includes('FROM sx_retail_cash_receipts'))return [state.receipts];
      if(sql.startsWith('INSERT INTO sx_retail_delivery_attempts')){
        state.attempts.push({requestId:args[3],hash:args[4],driverId:args[5],identityId:args[6],attemptNumber:Number(args[7]),result:args[8],reason:args[9]});
        return [{affectedRows:1}];
      }
      if(sql.startsWith("UPDATE sx_retail_orders SET delivery_state='failed'")){state.order.deliveryState='failed';return [{affectedRows:1}];}
      if(sql.startsWith("UPDATE sx_retail_orders SET delivery_state='in_transit'")){state.order.deliveryState='in_transit';return [{affectedRows:1}];}
      if(sql.startsWith("UPDATE sx_retail_orders SET driver_id=")){state.order.driver=args[0];state.order.deliveryState=sql.includes("delivery_state='in_transit'")?'in_transit':'assigned';return [{affectedRows:1}];}
      if(sql.startsWith('UPDATE sx_retail_delivery_proofs SET verification_attempts=')){
        state.proof.attempts++;
        if(args[0]){state.proof.verifiedAt=new Date();state.proof.verifiedBy= args[2];}
        return [{affectedRows:1}];
      }
      throw new Error('UNEXPECTED_SQL: '+sql);
    }};
  return {state,pool:{getConnection:async()=>db},actor:{identityId:identity,membershipId:driver}};
}

test('driver failure, retry and request replay retain separate delivery state',async()=>{
  const {state,pool,actor}=fixture(),failureId=crypto.randomUUID(),retryId=crypto.randomUUID();
  const failed=await commerce.reportDeliveryFailure(pool,tenant,actor,orderId,{requestId:failureId,reason:'customer_unavailable'});
  assert.deepEqual(failed,{status:'failed',attemptNumber:1,replayed:false});
  assert.equal(state.order.status,'dispatched');
  assert.equal(state.order.deliveryState,'failed');
  assert.deepEqual(await commerce.reportDeliveryFailure(pool,tenant,actor,orderId,{requestId:failureId,reason:'customer_unavailable'}),
    {status:'failed',replayed:true});
  assert.deepEqual(await commerce.retryDelivery(pool,tenant,actor,orderId,{requestId:retryId}),{status:'in_transit',replayed:false});
  assert.equal(state.order.deliveryState,'in_transit');
  assert.deepEqual(await commerce.retryDelivery(pool,tenant,actor,orderId,{requestId:retryId}),{status:'retry_started',replayed:true});
  assert.equal(state.attempts.filter(item=>item.result==='failed').length,1);
});

test('delivery proof is recorded once, and wrong codes consume a bounded attempt',async()=>{
  const {state,pool,actor}=fixture({proofRequired:true});
  const bad=await commerce.verifyDeliveryProof(pool,tenant,actor,orderId,{requestId:crypto.randomUUID(),code:'000000'});
  assert.equal(bad.verified,false);
  assert.equal(state.proof.attempts,1);
  const verified=await commerce.verifyDeliveryProof(pool,tenant,actor,orderId,{requestId:crypto.randomUUID(),code:state.code});
  assert.equal(verified.verified,true);
  assert.ok(state.proof.verifiedAt);
  const replay=await commerce.verifyDeliveryProof(pool,tenant,actor,orderId,{requestId:state.attempts.find(row=>row.result==='proof_verified').requestId,code:state.code});
  assert.deepEqual(replay,{verified:true,replayed:true});
});

test('delivery retries reject a different driver and unrecognized failure fields',async()=>{
  const {pool,actor}=fixture();
  await assert.rejects(commerce.reportDeliveryFailure(pool,tenant,{...actor,membershipId:'55555555-5555-4555-8555-555555555555'},orderId,
    {requestId:crypto.randomUUID(),reason:'customer_unavailable'}),{code:'ORDER_NOT_FOUND'});
  await assert.rejects(commerce.reportDeliveryFailure(pool,tenant,actor,orderId,
    {requestId:crypto.randomUUID(),reason:'customer_unavailable',phone:'+97450000000'}),{code:'INVALID_DELIVERY_REQUEST'});
});

test('manager reassignment puts a failed dispatched order back in the replacement driver queue',async()=>{
  const {state,pool}=fixture();
  state.order.deliveryState='failed';
  const replacement='55555555-5555-4555-8555-555555555555';
  const result=await commerce.assignDriver(pool,tenant,{identityId:identity},orderId,replacement);
  assert.deepEqual(result,{driverId:replacement,status:'assigned'});
  assert.equal(state.order.driver,replacement);
  assert.equal(state.order.deliveryState,'in_transit');
});
