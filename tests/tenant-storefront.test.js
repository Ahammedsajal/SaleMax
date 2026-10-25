'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const storefront=require('../modules/platform/tenant-storefront');
const branches=require('../modules/platform/tenant-branches');

test('tenant storefront accepts only bounded typed content and excludes executable properties',()=>{
  const content=storefront.normalize({headline:'Courses',headlineAr:'الدورات',description:'Learn safely',primaryColor:'#1768D4',sections:[{type:'about',title:'About',body:'A center'},{type:'script',body:'alert(1)'},{type:'about',title:'x'.repeat(150),body:'y'.repeat(1500)}],script:'alert(1)',html:'<script>alert(1)</script>'});
  assert.equal(content.version,1);
  assert.equal(content.primaryColor,'#1768d4');
  assert.equal(content.sections.length,2);
  assert.equal(content.sections[1].title.length,100);
  assert.equal(content.sections[1].body.length,1000);
  const bounded=storefront.normalize({sections:[...Array.from({length:10},(_,index)=>({type:'faq',title:`Q${index}`,items:Array.from({length:14},(_,item)=>({title:`Q${item}`,body:'A'}))})),{type:'unknown',title:'ignored'}]});
  assert.equal(bounded.sections.length,8);
  assert.equal(bounded.sections[0].items.length,12);
  assert.equal(Object.hasOwn(content,'script'),false);
  assert.equal(Object.hasOwn(content,'html'),false);
});
test('tenant storefront rejects malformed colors, contact addresses, and phone numbers',()=>{
  assert.throws(()=>storefront.normalize({primaryColor:'red'}),{code:'INVALID_BRAND_COLOR'});
  assert.throws(()=>storefront.normalize({contactEmail:'not-an-email'}),{code:'INVALID_EMAIL'});
  assert.throws(()=>storefront.normalize({whatsappNumber:'555-1234'}),{code:'INVALID_WHATSAPP_NUMBER'});
  assert.equal(storefront.normalize({publicFormSlug:'course-enquiry'}).publicFormSlug,'course-enquiry');
  assert.throws(()=>storefront.normalize({publicFormSlug:'../private'}),{code:'INVALID_PUBLIC_FORM'});
  assert.equal(storefront.normalize({showCourseCatalog:true}).showCourseCatalog,true);
  assert.equal(storefront.normalize({}).showCourseCatalog,false);
  assert.equal(storefront.normalize({showProductCatalog:true}).showProductCatalog,true);
  assert.equal(storefront.normalize({showRestaurantMenu:true}).showRestaurantMenu,true);
  assert.equal(storefront.normalize({}).showRestaurantMenu,false);
  assert.throws(()=>storefront.normalize({showCourseCatalog:'true'}),{code:'INVALID_COURSE_CATALOG_SETTING'});
  assert.throws(()=>storefront.normalize({showProductCatalog:'true'}),{code:'INVALID_PRODUCT_CATALOG_SETTING'});
  assert.throws(()=>storefront.normalize({showRestaurantMenu:'true'}),{code:'INVALID_RESTAURANT_MENU_SETTING'});
});

test('restaurant menu storefront drafts are category-gated and cannot publish while the category remains private',async()=>{
  const ctx={audience:'tenant',identity:{id:'restaurant-owner'},tenant:{id:'restaurant-tenant',categoryKey:'restaurant_cafe',categoryVersion:1},membership:{tenantId:'restaurant-tenant',role:'owner',status:'active'}};
  let updated=false,rolledBack=false;
  const db={async beginTransaction(){},async commit(){},async rollback(){rolledBack=true;},async query(sql){if(sql.startsWith('SELECT revision FROM sx_tenant_storefronts'))return [[{revision:0}]];if(sql.startsWith('INSERT INTO sx_tenant_storefronts'))return [{affectedRows:1}];if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];if(sql.startsWith('SELECT draft_json AS draft'))return [[{draft:JSON.stringify({headline:'Menu',showRestaurantMenu:true}),published:null,publishedRevision:null,revision:1}]];if(sql.startsWith('UPDATE sx_tenant_storefronts SET published_json')){updated=true;return [{affectedRows:1}];}throw new Error(`Unexpected storefront query: ${sql}`);}};
  const saved=await storefront.saveDraft(db,ctx,{expectedRevision:0,content:{headline:'Menu',showRestaurantMenu:true}});
  assert.equal(saved.draft.showRestaurantMenu,true);
  await assert.rejects(storefront.saveDraft(db,{...ctx,tenant:{...ctx.tenant,categoryKey:'salon_spa'}},{expectedRevision:1,content:{headline:'Salon',showRestaurantMenu:true}}),{code:'CATEGORY_CATALOG_UNAVAILABLE'});
  await assert.rejects(storefront.publish(db,ctx,{expectedRevision:1}),{code:'CATEGORY_CATALOG_UNAVAILABLE'});
  assert.equal(updated,false);assert.equal(rolledBack,true);
});

test('restaurant publication requires public category, live capabilities and an active public menu item',async()=>{
  const categories=require('../modules/platform/categories'),plans=require('../modules/platform/plans'),oldCategory=categories.getCategory,oldEntitlements=plans.loadEntitlements;
  const ctx={audience:'tenant',identity:{id:'restaurant-owner'},tenant:{id:'restaurant-tenant',categoryKey:'restaurant_cafe',categoryVersion:1},membership:{tenantId:'restaurant-tenant',role:'owner',status:'active'}};
  categories.getCategory=()=>({key:'restaurant_cafe',public:true,capabilities:['restaurant.orders']});plans.loadEntitlements=async()=>({status:'active',categoryKey:'restaurant_cafe',capabilities:['restaurant.orders','restaurant.menu','products.catalog']});
  const run=async(available)=>{let published=false,rolledBack=false;const db={async beginTransaction(){},async commit(){},async rollback(){rolledBack=true;},async query(sql){if(sql.startsWith('SELECT draft_json AS draft'))return [[{draft:JSON.stringify({headline:'Menu',showRestaurantMenu:true}),published:null,publishedRevision:null,revision:1}]];if(sql.startsWith('SELECT COUNT(*) AS total FROM sx_restaurant_menu_items'))return [[{total:available}]];if(sql.startsWith('UPDATE sx_tenant_storefronts SET published_json')){published=true;return [{affectedRows:1}];}if(sql.startsWith('INSERT INTO sx_tenant_storefront_revisions')||sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];throw new Error(`Unexpected publication query: ${sql}`);}};try{return await storefront.publish(db,ctx,{expectedRevision:1}).then(result=>({result,published,rolledBack}));}catch(error){assert.equal(rolledBack,true);assert.equal(published,false);throw error;}};
  try{await assert.rejects(run(0),{code:'STOREFRONT_RESTAURANT_MENU_REQUIRED'});const outcome=await run(1);assert.equal(outcome.result.published,true);assert.equal(outcome.published,true);}
  finally{categories.getCategory=oldCategory;plans.loadEntitlements=oldEntitlements;}
});

test('updates and event entries accept validated expiry dates without changing other section types',()=>{
  const content=storefront.normalize({sections:[{type:'updates',items:[{title:'Notice',body:'Details',expiresOn:'2099-06-01'}]},{type:'events',items:[{title:'Open day',body:'Visit us',startsOn:'2099-05-01',expiresOn:'2099-05-01'}]},{type:'faq',items:[{title:'Question',body:'Answer',expiresOn:'not-a-date'}]}]});
  assert.equal(content.sections[0].items[0].expiresOn,'2099-06-01');
  assert.equal(content.sections[1].items[0].startsOn,'2099-05-01');
  assert.equal(Object.hasOwn(content.sections[2].items[0],'expiresOn'),false);
  assert.throws(()=>storefront.normalize({sections:[{type:'updates',items:[{title:'Bad date',expiresOn:'2099-02-30'}]}]}),{code:'INVALID_STOREFRONT_CONTENT_DATE'});
  assert.throws(()=>storefront.normalize({sections:[{type:'events',items:[{startsOn:'2099-06-01',expiresOn:'2099-05-31'}]}]}),{code:'INVALID_STOREFRONT_CONTENT_DATE_RANGE'});
});

test('Home services cannot publish without a live lead entitlement, public service and covered onsite branch',async()=>{
  const plans=require('../modules/platform/plans'),oldEntitlements=plans.loadEntitlements,ctx={audience:'tenant',identity:{id:'home-owner'},tenant:{id:'home-tenant',categoryKey:'home_services',categoryVersion:1},membership:{tenantId:'home-tenant',role:'owner',status:'active'}};
  plans.loadEntitlements=async()=>({status:'active',categoryKey:'home_services',capabilities:['crm.leads']});
  const run=async(content,branchRows=[])=>{let rolledBack=false,updated=false;const db={async beginTransaction(){},async commit(){},async rollback(){rolledBack=true;},async query(sql){if(sql.startsWith('SELECT draft_json AS draft'))return [[{draft:JSON.stringify(content),published:null,publishedRevision:null,revision:1}]];if(sql.startsWith('SELECT id FROM sx_tenant_branches'))return [branchRows];if(sql.startsWith('UPDATE sx_tenant_storefronts SET published_json')){updated=true;return [{affectedRows:1}];}throw new Error(`Unexpected publication query: ${sql}`);}};try{await storefront.publish(db,ctx,{expectedRevision:1});}catch(error){assert.equal(rolledBack,true);assert.equal(updated,false);throw error;}};
  try{
    const base={headline:'Home repairs',sections:[]};
    await assert.rejects(run(base),{code:'STOREFRONT_SERVICE_REQUIRED'});
    await assert.rejects(run({...base,sections:[{type:'services',items:[{title:'Plumbing',body:'Repairs'}]}]}),{code:'STOREFRONT_SERVICE_BRANCH_REQUIRED'});
  }finally{plans.loadEntitlements=oldEntitlements;}
});

test('public storefront rendering escapes text, forbids scripts, and separates private CRM caching',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../modules/web/public-website.js'),'utf8');
  assert.match(source,/replace\(\/\[&<>"'\]\/g/);
  assert.match(source,/script-src \$\{retailCatalogue\|\|restaurantCatalogue\?"'self'":"'none'"\}/);
  assert.match(source,/Vary","Host, Accept-Language/);
  const domains=fs.readFileSync(path.join(__dirname,'../modules/platform/tenant-crm-domains.js'),'utf8');
  assert.match(domains,/private, no-store, max-age=0/);
  assert.match(source,/trainingForms\.publicForm/);
  assert.match(source,/Enquire about a course/);
  assert.match(source,/tenant-storefront-catalogue/);
  assert.match(source,/showCourseCatalog/);
  assert.match(source,/showProductCatalog/);
  assert.match(source,/showRestaurantMenu/);
  assert.match(source,/api\/public\/website\/restaurant-orders/);
  assert.match(source,/function branchHours\(/);
  assert.match(source,/\$\{restaurantCatalogue\}/);
  assert.match(source,/\$\{restaurantCheckoutScript\}/);
  assert.match(source,/Order food/);
  assert.match(source,/retail-checkout/);
  assert.match(source,/tenant-retail-checkout\.js/);
  assert.match(source,/retail-orders'\)\.publicCatalog/);
  assert.match(fs.readFileSync(path.join(__dirname,'../modules/platform/retail-public-order-router.js'),'utf8'),/request-origin/);
  assert.match(fs.readFileSync(path.join(__dirname,'../client/public/tenant-retail-checkout.js'),'utf8'),/guestAccessToken/);
  const restaurantCheckout=fs.readFileSync(path.join(__dirname,'../client/public/tenant-restaurant-checkout.js'),'utf8');
  assert.match(restaurantCheckout,/api\/public\/website\/restaurant-orders/);
  assert.match(restaurantCheckout,/awaiting business acceptance/i);
  assert.match(restaurantCheckout,/modifierOptionIds/);
  assert.match(restaurantCheckout,/RESTAURANT_CLOSED/);
  assert.match(source,/course_id=\$\{encodeURIComponent\(course\.publicId\)\}/);
  const publicForm=fs.readFileSync(path.join(__dirname,'../client/public/training-public-form.js'),'utf8');
  assert.match(publicForm,/data\.courses\?\.some\(course=>course\.id===requestedCourseId\)/);
});

test('storefront management uses the shared workspace API and preserves the legacy route as one handler alias',()=>{
  const mount=fs.readFileSync(path.join(__dirname,'../modules/platform/mount-existing-upgrade.js'),'utf8');
  const client=fs.readFileSync(path.join(__dirname,'../client/public/workspace-api.js'),'utf8');
  const settings=fs.readFileSync(path.join(__dirname,'../client/public/tenant-storefront-settings.js'),'utf8');
  assert.match(mount,/createTenantCrmRouter\(\{pool,canonicalGuard:featureSession\.guard\}\)/);
  assert.match(mount,/app\.use\(\['\/api\/workspace\/storefront','\/api\/crm'\],tenantCrm\)/);
  assert.match(client,/storefront:'\/api\/workspace\/storefront'/);
  assert.match(settings,/SaleMaxWorkspace\.request\('storefront'/);
  assert.doesNotMatch(settings,/fetch\(path/);
  assert.match(settings,/showProductCatalog/);
  assert.match(settings,/showRestaurantMenu/);
  assert.match(settings,/request\('forms'\)/);
  assert.match(settings,/does not reserve a course seat/);
  assert.match(settings,/Reusable website sections/);
  assert.match(settings,/sectionBox\.querySelectorAll\('\.sx-storefront-section'\)\.length>=8/);
  assert.match(settings,/fitness_coaching:\{services:\['Packages and coaching programs'/);
  assert.match(settings,/events_venues:\{services:\['Venue packages'/);
  assert.match(settings,/Class schedules/);
  assert.match(settings,/requests do not reserve a venue or attendee place/);
  assert.match(settings,/defaultSectionType\(categoryKey\)/);
  assert.match(settings,/updateSectionItemCopy\(item,type\.value,categoryKey\)/);
  assert.match(settings,/function collect\(\)[\s\S]*data\.sections=/);
  assert.match(settings,/querySelectorAll\(':scope > \.sx-storefront-section'\)/);
  assert.match(settings,/classList\.contains\('sx-storefront-section-item'\)/);
  assert.match(settings,/items\.children\.length>=12/);
  assert.match(settings,/dataset\.sectionField=key/);assert.match(settings,/expiresOn/);assert.match(settings,/Event date/);
  assert.match(settings,/Enter a valid calendar date for this item/);assert.match(settings,/أدخل تاريخًا صحيحًا لهذا العنصر/);assert.match(settings,/must be on or after its event date/);assert.match(settings,/يجب أن يكون تاريخ إخفاء الفعالية في يومها أو بعدها/);
  assert.doesNotMatch(settings,/type\.onchange=\(\)=>\{for\(const item of \[\.\.\.items\.children\]\)item\.remove\(\)/);
});

test('branch configuration validates hours, routes and never claims unimplemented reservation capacity',()=>{
  const branch=branches.normalize({slug:'west-end',nameEn:'West End',openingHours:{monday:[{open:'09:00',close:'12:00'},{open:'13:00',close:'17:00'}]},preparationMinutes:25,serviceAreas:['Doha','Doha'],fulfillmentModes:['in_person','onsite']});
  assert.equal(branch.bookingMode,'request_only');assert.equal(branch.preparationMinutes,25);assert.deepEqual(branch.serviceAreas,['Doha']);assert.equal(branch.openingHours.sunday.length,0);
  assert.equal(branches.normalize({slug:'unset-prep',nameEn:'Unset'}).preparationMinutes,0);
  for(const preparationMinutes of [-1,1.5,241,'not-a-number'])assert.throws(()=>branches.normalize({slug:'invalid-prep',nameEn:'Invalid',preparationMinutes}),{code:'INVALID_PREPARATION_MINUTES'});
  assert.throws(()=>branches.normalize({slug:'x',nameEn:'X',bookingMode:'capacity_reserved'}),{code:'CAPACITY_RESERVATION_NOT_AVAILABLE'});
  assert.throws(()=>branches.normalize({slug:'x',nameEn:'X',openingHours:{monday:[{open:'09:00',close:'12:00'},{open:'11:00',close:'13:00'}]}}),{code:'OVERLAPPING_OPENING_HOURS'});
  assert.throws(()=>branches.normalize({slug:'x',nameEn:'X',timezone:'Not/AZone'}),{code:'INVALID_BRANCH_TIMEZONE'});
});

test('preparation estimates are restricted to the restaurant category',async()=>{
  let touchedDatabase=false;const db={async beginTransaction(){touchedDatabase=true;}};
  await assert.rejects(branches.create(db,{audience:'tenant',identity:{id:'owner'},tenant:{id:'tenant',categoryKey:'retail_boutique'},membership:{tenantId:'tenant',role:'owner',status:'active'}},{slug:'shop',nameEn:'Shop',preparationMinutes:15}),{code:'PREPARATION_ESTIMATE_NOT_AVAILABLE'});
  assert.equal(touchedDatabase,false);
});

test('a Training Center branch with an active or upcoming course batch cannot be deactivated',async()=>{
  const sql=[];let rolledBack=false,committed=false;
  const db={async beginTransaction(){},async commit(){committed=true;},async rollback(){rolledBack=true;},async query(statement){sql.push(statement);if(statement.startsWith('SELECT revision,status FROM sx_tenant_branches'))return [[{revision:4,status:'active'}]];if(statement.startsWith('SELECT COUNT(*) AS total FROM sx_training_batches'))return [[{total:1}]];throw new Error(`Unexpected branch query: ${statement}`);}};
  const ctx={audience:'tenant',identity:{id:'owner-id'},tenant:{id:'tenant-id',categoryKey:'training_center'},membership:{tenantId:'tenant-id',role:'owner',status:'active'}};
  await assert.rejects(branches.update(db,ctx,'7ac38c77-73bd-453a-a404-9feeb2c06c97',{slug:'west-end',nameEn:'West End',status:'inactive',expectedRevision:4}),{code:'BRANCH_HAS_ACTIVE_COURSE_BATCHES',status:409});
  assert.equal(rolledBack,true);assert.equal(committed,false);assert.equal(sql.some(statement=>statement.startsWith('UPDATE sx_tenant_branches')),false);
  assert.match(sql.find(statement=>statement.startsWith('SELECT COUNT(*) AS total FROM sx_training_batches')),/ends_on>=DATE\(CONVERT_TZ\(UTC_TIMESTAMP\(\),'UTC','Asia\/Qatar'\)\)/);
});

test('Retail branch cannot be deactivated while stock or open orders remain',async()=>{
  const ctx={audience:'tenant',identity:{id:'owner-id'},tenant:{id:'tenant-id',categoryKey:'retail_boutique'},membership:{tenantId:'tenant-id',role:'owner',status:'active'}};
  for(const [blockedCode,stockCount,orderCount] of [['BRANCH_HAS_RETAIL_STOCK',1,0],['BRANCH_HAS_OPEN_RETAIL_ORDERS',0,1]]){
    let rolledBack=false,updated=false;
    const db={async beginTransaction(){},async commit(){},async rollback(){rolledBack=true;},async query(sql){if(sql.startsWith('SELECT revision,status FROM sx_tenant_branches'))return [[{revision:1,status:'active'}]];if(sql.startsWith('SELECT COUNT(*) AS total FROM sx_retail_stock'))return [[{total:stockCount}]];if(sql.startsWith('SELECT COUNT(*) AS total FROM sx_retail_orders'))return [[{total:orderCount}]];if(sql.startsWith('UPDATE sx_tenant_branches')){updated=true;return [{affectedRows:1}];}throw new Error(`Unexpected branch query: ${sql}`);}};
    await assert.rejects(branches.update(db,ctx,'7ac38c77-73bd-453a-a404-9feeb2c06c97',{slug:'west-end',nameEn:'West End',status:'inactive',expectedRevision:1}),{code:blockedCode,status:409});
    assert.equal(rolledBack,true);assert.equal(updated,false);
  }
});

test('branch administration stays on the existing owner workspace and shared API',()=>{
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/tenant-crm-router.js'),'utf8');
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/tenant-storefront-settings.js'),'utf8');
  assert.match(router,/router\.get\('\/branches',canonicalGuard/);assert.match(router,/router\.post\('\/branches',canonicalGuard/);assert.match(router,/router\.put\('\/branches\/:id',canonicalGuard/);
  assert.match(ui,/SaleMaxWorkspace\.request\('storefront'/);assert.match(ui,/Request only/);assert.match(ui,/Booking requests are not confirmed reservations/);assert.match(ui,/Opening hours JSON/);assert.match(ui,/Default routing target/);assert.match(ui,/showCourseCatalog/);assert.match(router,/branches\/assignees/);
});
