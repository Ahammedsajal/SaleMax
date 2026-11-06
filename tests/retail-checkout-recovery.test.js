'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const commerce=require('../modules/platform/retail-commerce');
const proofCrypto=require('../modules/platform/retail-delivery-proof');

const tenant='11111111-1111-4111-8111-111111111111';
const order='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const env={SALEMAX_PLATFORM_KEY_BASE64:Buffer.alloc(32,9).toString('base64')};
process.env.SALEMAX_PLATFORM_KEY_BASE64=env.SALEMAX_PLATFORM_KEY_BASE64;

test('checkout recovery returns only the tenant order reference and its retry-safe handoff code',async()=>{
  const created=proofCrypto.create(tenant,order,env);
  const pool={query:async(sql,args)=>{
    if(sql.includes('FROM sx_retail_store s JOIN sx_tenants'))return [[{tenantId:tenant,slug:'demo-shop',title:'Demo Shop',about:'',contact:'',deliveryFee:1500,deliveryZones:[]}]];
    if(sql.includes('FROM sx_retail_orders WHERE tenant_id=? AND request_id=?')){assert.deepEqual(args,[tenant,requestId]);return [[{id:order,totalMinor:2500,proofRequired:1}]];}
    if(sql.includes('FROM sx_retail_delivery_proofs'))return [[{code_hash:created.hash,code_ciphertext:created.ciphertext,code_iv:created.iv,code_auth_tag:created.authTag}]];
    throw new Error('UNEXPECTED_RECOVERY_QUERY');
  }};
  assert.deepEqual(await commerce.recoverCheckout(pool,'demo-shop',requestId),
    {reference:order,totalMinor:2500,deliveryProofCode:created.code,recovered:true});
});

test('checkout recovery cannot reveal another tenant order and rejects unknown request keys',async()=>{
  const pool={query:async(sql)=>sql.includes('FROM sx_retail_store s JOIN sx_tenants')
    ?[[{tenantId:tenant,slug:'demo-shop',title:'Demo Shop',about:'',contact:'',deliveryFee:null,deliveryZones:[]}]]:[[]]};
  await assert.rejects(commerce.recoverCheckout(pool,'demo-shop',requestId),{code:'CHECKOUT_NOT_FOUND'});
  await assert.rejects(commerce.recoverCheckout(pool,'demo-shop','not-a-uuid'),{code:'CHECKOUT_NOT_FOUND'});
});
