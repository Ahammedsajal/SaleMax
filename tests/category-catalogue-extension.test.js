'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCategoryRegistry}=require('../modules/platform/category-registry'),{capabilities}=require('../modules/platform/policy'),categories=require('../modules/platform/categories'),adapter=require('../modules/platform/product-catalog');
const manifest={key:'future_retail',version:1,title:{en:'Retail fixture',ar:'متجر تجريبي'},public:false,planable:false,seatRoles:['owner','manager','agent'],capabilities:['messaging.inbox','products.catalog'],catalogue:'products',migration:'20261001_platform_identity.sql'};
function context(category){return {audience:'tenant',identity:{id:'identity-a'},tenant:{id:'tenant-a',status:'active',categoryKey:category.key,categoryVersion:category.version},membership:{id:'member-a',tenantId:'tenant-a',role:'owner',status:'active'},category,subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:category.capabilities}};}
test('reviewed catalogue adapters are explicit, capability-validated, copied and frozen per version',()=>{
 const input={...manifest},registry=createCategoryRegistry([input,{...input,version:2,catalogue:null}],capabilities);input.catalogue='courses';
 assert.equal(registry.get('future_retail',1).catalogue,'products');assert.equal(registry.get('future_retail',2).catalogue,null);assert.throws(()=>{registry.get('future_retail',1).catalogue='courses';},TypeError);
 for(const patch of [{catalogue:'arbitrary_table'},{catalogue:'courses'},{catalogue:'products',capabilities:['messaging.inbox']},{catalogue:{sql:'SELECT'}}])assert.throws(()=>createCategoryRegistry([{...manifest,...patch}],capabilities),{code:'INVALID_CATEGORY_MANIFEST'});
 const undeclared=createCategoryRegistry([{...manifest,catalogue:undefined}],capabilities).get(manifest.key,1);assert.equal(adapter.kind(context(undeclared)),null);
});
test('shared session metadata and fixed storage adapters do not depend on a business brand',async()=>{
 const category=createCategoryRegistry([manifest],capabilities).get(manifest.key,1),ctx=context(category);assert.equal(adapter.kind(ctx),'products');assert.equal(require('../modules/platform/feature-contract').describe({context:ctx}).quickReplyCatalog,'products');
 const queries=[],db={query:async(sql,args)=>{queries.push({sql,args});return [[]];}},mapped=adapter.forContext(db,ctx);await mapped.query('SELECT id FROM sx_training_courses WHERE tenant_id=?',['tenant-a']);assert.match(queries[0].sql,/FROM sx_product_catalog/);assert.deepEqual(queries[0].args,['tenant-a']);assert.equal(adapter.forContext(mapped,ctx),mapped);
 assert.equal(adapter.kind({...ctx,tenant:{...ctx.tenant,categoryVersion:2}}),null);assert.equal(adapter.kind({...ctx,tenant:{...ctx.tenant,categoryKey:'foreign'}}),null);
 const training=context(categories.trainingCenter);assert.equal(adapter.kind(training),'courses');assert.equal(adapter.forContext(db,training),db);assert.equal(adapter.kind(context(categories.salemaxSales)),'products');
});
test('catalogue service rejects missing adapter and binds creation to the actual category version',async()=>{
 const category=createCategoryRegistry([manifest],capabilities).get(manifest.key,1),ctx=context(category),calls=[];
 const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('SELECT id,status,category_key'))return [[{id:'tenant-a',status:'active',category_key:category.key,category_version:1}]];return [{affectedRows:1}];}};
 const courses=require('../modules/platform/training-courses');const result=await courses.create(adapter.forContext(db,ctx),ctx,{code:'SYNTHETIC',nameEn:'Item',nameAr:'منتج',descriptionEn:'Description',descriptionAr:'وصف',durationValue:1,durationUnit:'hours',deliveryMode:'online'});assert.ok(result.id);assert.ok(calls.some(c=>c.sql.includes('INSERT INTO sx_product_catalog')));
 await assert.rejects(courses.list(db,{...ctx,category:{...category,catalogue:undefined}},{}),{code:'CATEGORY_UNAVAILABLE'});
});
