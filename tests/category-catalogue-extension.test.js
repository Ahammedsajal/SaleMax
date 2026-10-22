'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCategoryRegistry}=require('../modules/platform/category-registry'),{capabilities}=require('../modules/platform/policy'),categories=require('../modules/platform/categories'),adapter=require('../modules/platform/product-catalog'),storage=require('../modules/platform/catalogue-storage');
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
 const productTables=storage.forContext(ctx);assert.equal(productTables.catalogueTable,'sx_product_catalog');assert.equal(productTables.offersTable,'sx_product_offers');assert.equal(productTables.mediaTable,'sx_product_media');assert.equal(productTables.replyJobsTable,'sx_product_reply_jobs');assert.ok(Object.isFrozen(productTables));
 assert.equal(adapter.kind({...ctx,tenant:{...ctx.tenant,categoryVersion:2}}),null);assert.equal(adapter.kind({...ctx,tenant:{...ctx.tenant,categoryKey:'foreign'}}),null);assert.equal(storage.forContext({...ctx,tenant:{...ctx.tenant,categoryKey:'foreign'}}),null);assert.equal(storage.forKind('request_table_name'),null);
 const training=context(categories.trainingCenter);assert.equal(adapter.kind(training),'courses');assert.equal(storage.forContext(training).catalogueTable,'sx_training_courses');assert.equal(adapter.kind(context(categories.salemaxSales)),'products');
 const media=require('../modules/platform/training-course-media'),queries=[],db={query:async(sql,args)=>{queries.push({sql,args});return sql.startsWith('SELECT id FROM ') ? [[{id:args[1]}]] : [[]];}};
 for(const owner of [ctx,training])await media.list(db,owner,'11111111-1111-4111-8111-111111111111');
 assert.match(queries[0].sql,/FROM sx_product_catalog/);assert.match(queries[1].sql,/FROM sx_product_media/);assert.match(queries[2].sql,/FROM sx_training_courses/);assert.match(queries[3].sql,/FROM sx_training_course_media/);assert.deepEqual(queries.map(row=>row.args[0]),['tenant-a','tenant-a','tenant-a','tenant-a']);
});
test('Sales product lifecycle uses its own service and product-only fields',async()=>{
 const category=createCategoryRegistry([manifest],capabilities).get(manifest.key,1),ctx=context(category),calls=[];
 const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('SELECT id,status,category_key'))return [[{id:'tenant-a',status:'active',category_key:category.key,category_version:1}]];return [{affectedRows:1}];}};
 const products=require('../modules/platform/product-catalog-service');
 const result=await products.create(db,ctx,{sku:'RETAIL-01',itemKind:'product',nameEn:'Retail item',nameAr:'منتج متجر',descriptionEn:'Product details',descriptionAr:'تفاصيل المنتج',tags:['popular'],offer:{priceMinor:12500,currency:'QAR'}});
 assert.ok(result.id);assert.equal(result.offerVersion,1);
 assert.ok(calls.some(c=>c.sql.includes('INSERT INTO sx_product_catalog')&&c.sql.includes('item_kind')));
 assert.ok(calls.some(c=>c.sql.includes('INSERT INTO sx_product_offers')));
 assert.ok(calls.some(c=>c.sql.includes('INSERT INTO sx_audit_events')&&c.args.includes('sales.product-created')));
 assert.ok(calls.every(c=>!c.sql.includes('sx_training_courses')&&!c.sql.includes('sx_training_offers')));
 assert.throws(()=>products.productInput({sku:'bad',itemKind:'course',nameEn:'x',nameAr:'y'}),{code:'INVALID_PRODUCT_KIND'});
 await assert.rejects(products.list(db,{...ctx,category:{...category,catalogue:undefined}},{}),{code:'CATEGORY_UNAVAILABLE'});
});
test('legacy product rows stay unclassified until an explicit owner review',async()=>{
 const category=createCategoryRegistry([manifest],capabilities).get(manifest.key,1),ctx=context(category),updates=[];let reads=0,rolledBack=false;
 const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack=true;},query:async(sql,args)=>{if(sql.includes('SELECT revision,status,item_kind')){reads++;return [[{revision:reads===1?1:2,status:'draft',itemKind:'unclassified',tagsJson:'[]'}]];}if(sql.startsWith('UPDATE sx_product_catalog SET code=')){updates.push(args);return [{affectedRows:1}];}return [{affectedRows:1}];}};
 const products=require('../modules/platform/product-catalog-service'),id='11111111-1111-4111-8111-111111111111',details={code:'LEGACY-01',nameEn:'Old item',nameAr:'عنصر قديم',descriptionEn:'',descriptionAr:''};
 await products.update(db,ctx,id,1,details);assert.equal(updates[0][1],'unclassified');
 await assert.rejects(products.publish(db,ctx,id,2),{code:'PRODUCT_TYPE_REVIEW_REQUIRED'});assert.equal(reads,2);assert.equal(rolledBack,true);
 await assert.rejects(products.create(db,ctx,{...details,itemKind:'unclassified'}),{code:'INVALID_PRODUCT_KIND'});
});
