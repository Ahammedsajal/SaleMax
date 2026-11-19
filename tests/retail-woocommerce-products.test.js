'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const express=require('express');
const connector=require('../modules/platform/retail-connected-stores');
const category=require('../modules/platform/categories').getCategory('retail_boutique',1);
const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const connectionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fixture(role='manager',pilotTenants=tenantId){
  const secret=Buffer.alloc(32,51).toString('base64'),calls=[];
  const product={id:'100',title:'Linen fabric',sku:'LINEN',productType:'variable',status:'publish',currency:'QAR',price:'0.000000',priceUnavailable:true,imageUrl:'https://store.example.com/linen.jpg',
    sourceStock:{managed:false,managementMode:'unmanaged',quantity:null,status:'instock'},
    details:{slug:'linen-fabric',description:'<p>Natural linen</p>',shortDescription:'<p>Soft fabric</p>',regularPrice:'25.000000',salePrice:'20.000000',onSale:true,
      categories:[{id:'2',name:'Fabric',slug:'fabric'}],tags:[{id:'5',name:'Linen',slug:'linen'}],attributes:[{id:'1',name:'Colour',options:['Blue','Natural']}],
      images:[{src:'https://store.example.com/linen.jpg',alt:'Linen'}],metadata:[{key:'composition',value:'100% linen'}]}};
  const variant={id:'101',productId:'100',title:'Linen - Blue / 2 yards',sku:'LINEN-BLUE-2Y',status:'publish',purchasable:true,currency:'QAR',price:'20.000000',
    attributes:[{id:'1',name:'Colour',option:'Blue'},{id:'2',name:'Length',option:'2 yards'}],details:{regularPrice:'25.000000',salePrice:'20.000000',onSale:true,description:'Blue linen',image:'https://store.example.com/linen-blue.jpg',metadata:[]},
    sourceStock:{managed:true,managementMode:'managed',quantity:'8.000000',status:'instock'}};
  const productEncrypted=connector.seal(product,tenantId,connectionId,'product:100',{SALEMAX_PLATFORM_KEY_BASE64:secret});
  const variantEncrypted=connector.seal(variant,tenantId,connectionId,'product-variant:101',{SALEMAX_PLATFORM_KEY_BASE64:secret});
  const productRow={connectionId,storeName:'Essentials by D',connectionStatus:'active',externalProductId:'100',status:'publish',sku:'LINEN',currency:'QAR',price:'0.000000',
    ...productEncrypted,sourceUpdatedAt:'2026-11-18T10:00:00.000Z'};
  const variantRow={externalVariantId:'101',sku:'LINEN-BLUE-2Y',variantStatus:'publish',currency:'QAR',price:'20.000000',...variantEncrypted,
    sourceStockManagement:'managed',sourceStockQuantity:'8.000000',sourceStockStatus:'instock',sourceUpdatedAt:'2026-11-18T10:00:00.000Z'};
  const pool={async query(sql,params){
    calls.push({sql,params});
    if(sql.includes('COUNT(*) AS total FROM sx_retail_external_products'))return [[{total:1}],[]];
    if(sql.includes('FROM sx_retail_external_product_variants')&&sql.includes('COUNT(*) AS total'))return [[{total:1}],[]];
    if(sql.includes('SELECT p.connection_id AS connectionId'))return [[productRow],[]];
    if(sql.includes('SELECT external_variant_id AS externalVariantId'))return [[variantRow],[]];
    throw new Error('Unexpected query: '+sql);
  }};
  const app=express();
  app.use('/api/workspace/products-services',require('../modules/platform/training-course-router').createTrainingCourseRouter({pool,origin:'https://7network.test',products:true,
    env:{SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS:pilotTenants},
    userGuard(_req,_res,next){next();},canonicalGuard(req,_res,next){req.businessContext={audience:'tenant',identity:{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},category,
      tenant:{id:tenantId,status:'active',categoryKey:category.key,categoryVersion:category.version},membership:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',tenantId,status:'active',role},
      subscription:{status:'active',capabilities:category.capabilities}};next();}}));
  return {app,calls,secret,productRow,variantRow};
}

async function start(t,app){const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return `http://127.0.0.1:${server.address().port}`;}

test('existing Products screen API returns Woo product, variation and stock snapshots without write operations',async t=>{
  const originalKey=process.env.SALEMAX_PLATFORM_KEY_BASE64,service=fixture();process.env.SALEMAX_PLATFORM_KEY_BASE64=service.secret;
  t.after(()=>{if(originalKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalKey;});
  const base=await start(t,service.app);
  const listResponse=await fetch(base+'/api/workspace/products-services/woocommerce?page=1&search=LINEN');
  const list=await listResponse.json();
  assert.equal(listResponse.status,200);
  assert.equal(list.data.items[0].externalProductId,'100');
  assert.equal(list.data.items[0].sku,'LINEN');
  assert.equal(list.data.items[0].priceUnavailable,true);
  assert.equal(list.data.items[0].sourceStock.managementMode,'unmanaged');
  const detailResponse=await fetch(base+'/api/workspace/products-services/woocommerce/100?connectionId='+connectionId+'&page=1');
  const detail=await detailResponse.json();
  assert.equal(detailResponse.status,200);
  assert.equal(detail.data.externalProductId,'100');
  assert.equal(detail.data.details.categories[0].name,'Fabric');
  assert.equal(detail.data.details.description,'<p>Natural linen</p>');
  assert.equal(detail.data.variations[0].externalVariantId,'101');
  assert.equal(detail.data.variations[0].sku,'LINEN-BLUE-2Y');
  assert.equal(detail.data.variations[0].attributes[1].option,'2 yards');
  assert.equal(detail.data.variations[0].sourceStock.quantity,'8.000000');
  assert.equal(detail.data.variationsHasMore,false);
  assert.equal(service.calls.every(call=>call.sql.startsWith('SELECT')),true);
  assert.ok(service.calls.every(call=>call.params.includes(tenantId)));
});

test('Retail accountant cannot read imported Woo catalog before database access',async t=>{
  const service=fixture('accountant'),base=await start(t,service.app);
  const response=await fetch(base+'/api/workspace/products-services/woocommerce');
  const body=await response.json();
  assert.equal(response.status,403);
  assert.equal(body.code,'PERMISSION_DENIED');
  assert.equal(service.calls.length,0);
});

test('Woo product snapshots remain hidden when the tenant is outside the connector pilot',async t=>{
  const service=fixture('manager','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),base=await start(t,service.app);
  const response=await fetch(base+'/api/workspace/products-services/woocommerce');
  const body=await response.json();
  assert.equal(response.status,403);
  assert.equal(body.code,'RETAIL_CONNECTOR_PILOT_DISABLED');
  assert.equal(service.calls.length,0);
});
