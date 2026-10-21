'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {routerInventory}=require('../scripts/audit-upgraded-route-factories.cjs');
const {ownershipForInventory}=require('../modules/platform/upgraded-route-ownership');
const categoryRegistry=require('../modules/platform/categories');

test('every discovered upgraded route has an explicit source-owned module or platform owner',()=>{
  const inventory=routerInventory();
  const ownership=ownershipForInventory(inventory,{moduleRegistry:categoryRegistry.moduleRegistry,categories:{list:categoryRegistry.listCategories,get:categoryRegistry.getCategory}});
  assert.equal(ownership.contractCount,ownership.stale.length+new Set(ownership.routes.map(route=>`${route.module}|${route.mount}`)).size);
  assert.deepEqual(ownership.unowned,[]);
  assert.deepEqual(ownership.stale,[]);
  assert.ok(ownership.routes.every(route=>route.ownership&&route.ownershipStatus==='mapped_policy_unverified'));
  assert.ok(ownership.routes.every(route=>route.reviewStatus==='review_required'));
});

test('vertical route ownership follows category module contracts without merging catalogues',()=>{
  const ownership=ownershipForInventory(routerInventory(),{moduleRegistry:categoryRegistry.moduleRegistry,categories:{list:categoryRegistry.listCategories,get:categoryRegistry.getCategory}});
  const route=(mount)=>ownership.routes.find(item=>item.mount===mount);
  assert.deepEqual(route('/api/workspace/courses').ownership.categoryModules,{training_center:['training.core']});
  assert.deepEqual(route('/api/workspace/products-services').ownership.categoryModules,{'7network_sales':['sales.products-services']});
  assert.deepEqual(route('/api/workspace/properties').ownership.categoryModules,{real_estate:['real-estate.properties']});
  assert.deepEqual(route('/api/workspace/finance').ownership.categoryModules,{training_center:['training.finance','training.report-schedules']});
  assert.deepEqual(route('/api/admin/plan-contracts').ownership.modules,[]);
  assert.equal(Object.hasOwn(route('/api/crm').ownership.categoryModules,'restaurant_fixture'),false);
  assert.equal(route('/api/workspace/properties').ownership.moduleContracts['real-estate.properties'].dataBoundary,'tenant_scoped');
  assert.equal(route('/api/workspace/properties').ownership.moduleContracts['real-estate.properties'].primaryService,'modules/platform/real-estate-properties-router.js');
  assert.equal(route('/api/workspace/courses').ownership.moduleContracts['training.core'].dataBoundary,'mixed_legacy_and_tenant');
});

test('Real Estate route ownership resolves to its tenant-owned table and scoped shared references',()=>{
  const ownership=ownershipForInventory(routerInventory(),{moduleRegistry:categoryRegistry.moduleRegistry,categories:{list:categoryRegistry.listCategories,get:categoryRegistry.getCategory}});
  const route=ownership.routes.find(item=>item.mount==='/api/workspace/properties');
  const module=route.ownership.moduleContracts['real-estate.properties'];
  assert.equal(route.ownership.service,'modules/platform/real-estate-properties.js');
  assert.equal(module.dataOwnership.status,'reviewed');
  assert.deepEqual(module.dataOwnership.ownedTables,['sx_real_estate_properties']);
  const service=fs.readFileSync(path.join(root,route.ownership.service),'utf8');
  const router=fs.readFileSync(path.join(root,module.primaryService),'utf8');
  assert.match(router,/require\('\.\/real-estate-properties'\)/);
  assert.match(router,/properties\.(list|listAssignees|create|update)\(/);
  const referenced=new Set([...service.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(sx_[a-z0-9_]+)/gi)].map(match=>match[1]));
  const declared=new Set([...module.dataOwnership.ownedTables,...module.dataOwnership.referencedTables.map(item=>item.name)]);
  assert.deepEqual([...referenced].sort(),[...declared].sort(),'every queried sx_ table must have a reviewed owner/reference classification');
  for(const item of module.dataOwnership.referencedTables)assert.ok(['tenant_qualified','tenant_qualified_through_membership'].includes(item.scope));
  const migration=fs.readFileSync(path.join(root,'database/migrations/20261222_real_estate_properties.sql'),'utf8');
  assert.match(migration,/CREATE TABLE sx_real_estate_properties/);
  assert.match(migration,/tenant_id CHAR\(36\)/);
});

test('7Network Sales Targets owns only its target table and scopes cross-module reads',()=>{
  const ownership=ownershipForInventory(routerInventory(),{moduleRegistry:categoryRegistry.moduleRegistry,categories:{list:categoryRegistry.listCategories,get:categoryRegistry.getCategory}});
  const route=ownership.routes.find(item=>item.mount==='/api/user/sales-targets');
  const module=route.ownership.moduleContracts['sales.targets'];
  assert.deepEqual(route.ownership.categoryModules,{'7network_sales':['sales.targets']});
  assert.equal(route.ownership.service,'modules/platform/sales-targets.js');
  assert.equal(module.dataOwnership.status,'reviewed');
  assert.deepEqual(module.dataOwnership.ownedTables,['sx_sales_targets']);
  const service=fs.readFileSync(path.join(root,route.ownership.service),'utf8');
  const router=fs.readFileSync(path.join(root,module.primaryService),'utf8');
  assert.match(router,/require\('\.\/sales-targets'\)/);
  assert.match(router,/targets\.(list|save)\(/);
  const referenced=new Set([...service.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(sx_[a-z0-9_]+)/gi)].map(match=>match[1]));
  const declared=new Set([...module.dataOwnership.ownedTables,...module.dataOwnership.referencedTables.map(item=>item.name)]);
  assert.deepEqual([...referenced].sort(),[...declared].sort(),'every queried sx_ table must have a reviewed owner/reference classification');
  const migration=fs.readFileSync(path.join(root,'database/migrations/20261116_sales_targets.sql'),'utf8');
  assert.match(migration,/CREATE TABLE sx_sales_targets/);
  assert.match(migration,/UNIQUE KEY uq_sx_sales_target_scope \(tenant_id,membership_id,period_start,metric,currency\)/);
  assert.match(service,/FROM sx_sales_commissions c JOIN sx_sales_deals d ON d\.tenant_id=c\.tenant_id/);
  assert.match(service,/commissionReportEnabled=decision\(ctx,\{capability:'sales\.commissions'/);
});

test('Sales products use a separate physical catalogue from Training courses and replies',()=>{
  const ownership=ownershipForInventory(routerInventory(),{moduleRegistry:categoryRegistry.moduleRegistry,categories:{list:categoryRegistry.listCategories,get:categoryRegistry.getCategory}});
  const route=ownership.routes.find(item=>item.mount==='/api/workspace/products-services');
  const module=route.ownership.moduleContracts['sales.products-services'];
  const catalog=require('../modules/platform/product-catalog');
  assert.deepEqual(route.ownership.categoryModules,{'7network_sales':['sales.products-services']});
  assert.equal(route.ownership.service,'modules/platform/product-catalog.js');
  assert.deepEqual([...Object.values(catalog.tables)].sort(),[...module.dataOwnership.ownedTables].sort());
  const productAdapter=fs.readFileSync(path.join(root,route.ownership.service),'utf8');
  const courseRouter=fs.readFileSync(path.join(root,'modules/platform/training-course-router.js'),'utf8');
  assert.match(courseRouter,/if\(products\)pool=require\('\.\/product-catalog'\)\.database\(pool\)/);
  assert.match(courseRouter,/expected=products\?'products':'courses'/);
  assert.match(courseRouter,/if\(products\)router\.use\(.*\/enrollments/s);
  assert.match(productAdapter,/sql\.replace\(\/\\b\(\?:sx_training_courses\|sx_training_offers\|sx_training_course_media\|sx_training_batches\|sx_course_reply_jobs\)\\b\/g,name=>tables\[name\]\)/);
  const physicalTables=new Set();
  for(const file of ['modules/platform/training-courses.js','modules/platform/training-course-media.js','modules/platform/course-quick-replies.js']){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const [,table] of source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(sx_[a-z0-9_]+)/gi))physicalTables.add(catalog.tables[table]||table);
  }
  const declared=new Set([...module.dataOwnership.ownedTables,...module.dataOwnership.referencedTables.map(item=>item.name)]);
  assert.deepEqual([...physicalTables].sort(),[...declared].sort(),'all mapped shared catalogue queries must resolve to Sales-owned tables or declared shared references');
  const migration=fs.readFileSync(path.join(root,'database/migrations/20261215_category_product_catalog.sql'),'utf8');
  const created=new Set([...migration.matchAll(/CREATE TABLE (sx_product_[a-z_]+)/g)].map(match=>match[1]));
  assert.deepEqual([...created].sort(),[...module.dataOwnership.ownedTables].sort());
  const replyRoute=ownership.routes.find(item=>item.mount==='/api/workspace/inbox/course-replies');
  assert.deepEqual(replyRoute.ownership.categoryModules,{training_center:['training.core'],'7network_sales':['sales.products-services']});
});

test('Training course route owns its course workflow tables and classifies Finance and legacy references',()=>{
  const ownership=ownershipForInventory(routerInventory(),{moduleRegistry:categoryRegistry.moduleRegistry,categories:{list:categoryRegistry.listCategories,get:categoryRegistry.getCategory}});
  const route=ownership.routes.find(item=>item.mount==='/api/workspace/courses');
  const module=route.ownership.moduleContracts['training.core'];
  assert.deepEqual(route.ownership.categoryModules,{training_center:['training.core']});
  assert.equal(route.ownership.service,'modules/platform/training-courses.js');
  const accessedTables=new Set();
  for(const file of route.ownership.services){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const [,table] of source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z][a-z0-9_]*)/gi))if(table.startsWith('sx_')||['pipeline_leads','user'].includes(table))accessedTables.add(table);
  }
  const declared=new Set([...module.dataOwnership.ownedTables,...module.dataOwnership.referencedTables.map(item=>item.name)]);
  assert.deepEqual([...accessedTables].sort(),[...declared].sort(),'course route SQL and module ownership declaration must remain synchronized');
  const references=new Map(module.dataOwnership.referencedTables.map(item=>[item.name,item.scope]));
  assert.equal(references.get('sx_training_invoices'),'tenant_qualified');
  assert.equal(references.get('pipeline_leads'),'tenant_qualified_through_enrollment');
  assert.equal(references.get('user'),'tenant_qualified_through_legacy_mapping');
  const migrations=fs.readdirSync(path.join(root,'database/migrations')).filter(file=>file.endsWith('.sql')).map(file=>fs.readFileSync(path.join(root,'database/migrations',file),'utf8')).join('\n');
  const created=new Set([...migrations.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z][a-z0-9_]*)/gi)].map(match=>match[1]));
  for(const table of module.dataOwnership.ownedTables)assert.ok(created.has(table),`${table} must have a tracked migration`);
  const productRoute=ownership.routes.find(item=>item.mount==='/api/workspace/products-services');
  assert.deepEqual(productRoute.ownership.categoryModules,{'7network_sales':['sales.products-services']});
});

test('Training Finance route separates accounting data from scheduled report ownership',()=>{
  const ownership=ownershipForInventory(routerInventory(),{moduleRegistry:categoryRegistry.moduleRegistry,categories:{list:categoryRegistry.listCategories,get:categoryRegistry.getCategory}});
  const route=ownership.routes.find(item=>item.mount==='/api/workspace/finance');
  assert.deepEqual(route.ownership.modules,['training.finance','training.report-schedules']);
  assert.deepEqual(route.ownership.categoryModules,{training_center:['training.finance','training.report-schedules']});
  const accessedTables=new Set();
  for(const file of route.ownership.services){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const [,table] of source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z][a-z0-9_]*)/gi))if(table.startsWith('sx_')||['pipeline_leads','user'].includes(table))accessedTables.add(table);
  }
  const declared=new Set();
  for(const id of route.ownership.modules){
    const module=route.ownership.moduleContracts[id];
    assert.equal(module.dataOwnership.status,'reviewed');
    for(const table of module.dataOwnership.ownedTables)assert.ok(!declared.has(table),`${table} must have exactly one module owner`);
    for(const table of [...module.dataOwnership.ownedTables,...module.dataOwnership.referencedTables.map(item=>item.name)])declared.add(table);
  }
  assert.deepEqual([...accessedTables].sort(),[...declared].sort(),'finance route SQL must be fully classified as owned or referenced');
  const finance=route.ownership.moduleContracts['training.finance'].dataOwnership;
  const reports=route.ownership.moduleContracts['training.report-schedules'].dataOwnership;
  assert.ok(finance.ownedTables.includes('sx_training_invoices'));
  assert.ok(!finance.ownedTables.some(table=>table.startsWith('sx_training_report_')));
  assert.deepEqual(reports.ownedTables,['sx_training_report_deliveries','sx_training_report_recipient_challenges','sx_training_report_recipients','sx_training_report_runs','sx_training_report_schedules','sx_training_report_verifications']);
  const migrations=fs.readdirSync(path.join(root,'database/migrations')).filter(file=>file.endsWith('.sql')).map(file=>fs.readFileSync(path.join(root,'database/migrations',file),'utf8')).join('\n');
  const created=new Set([...migrations.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z][a-z0-9_]*)/gi)].map(match=>match[1]));
  for(const id of route.ownership.modules)for(const table of route.ownership.moduleContracts[id].dataOwnership.ownedTables)assert.ok(created.has(table),`${table} must have a tracked migration`);
});

test('Training Forms route owns its submission and registration workflow without claiming CRM or Finance records',()=>{
  const ownership=ownershipForInventory(routerInventory(),{moduleRegistry:categoryRegistry.moduleRegistry,categories:{list:categoryRegistry.listCategories,get:categoryRegistry.getCategory}});
  const route=ownership.routes.find(item=>item.mount==='/api/workspace/forms');
  const module=route.ownership.moduleContracts['training.forms'];
  assert.deepEqual(route.ownership.categoryModules,{training_center:['training.forms']});
  assert.equal(module.dataOwnership.status,'reviewed');
  const accessedTables=new Set();
  for(const file of route.ownership.services){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const [,table] of source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z][a-z0-9_]*)/gi))if(table.startsWith('sx_')||['pipeline_leads','pipeline_contacts','pipeline_stages','agents','user'].includes(table))accessedTables.add(table);
  }
  const declared=new Set([...module.dataOwnership.ownedTables,...module.dataOwnership.referencedTables.map(item=>item.name)]);
  assert.deepEqual([...accessedTables].sort(),[...declared].sort(),'form route SQL and module ownership declaration must remain synchronized');
  assert.deepEqual(module.dataOwnership.ownedTables,['sx_training_form_rate_limits','sx_training_form_submissions','sx_training_form_versions','sx_training_forms','sx_training_registration_deliveries','sx_training_registrations','sx_training_student_sequences']);
  const references=new Map(module.dataOwnership.referencedTables.map(item=>[item.name,item.scope]));
  assert.equal(references.get('pipeline_leads'),'tenant_qualified_through_legacy_mapping');
  assert.equal(references.get('sx_training_invoices'),'tenant_qualified');
  assert.equal(references.get('user'),'tenant_qualified_through_legacy_mapping');
  const migrations=fs.readdirSync(path.join(root,'database/migrations')).filter(file=>file.endsWith('.sql')).map(file=>fs.readFileSync(path.join(root,'database/migrations',file),'utf8')).join('\n');
  const created=new Set([...migrations.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z][a-z0-9_]*)/gi)].map(match=>match[1]));
  for(const table of module.dataOwnership.ownedTables)assert.ok(created.has(table),`${table} must have a tracked migration`);
  for(const mount of ['/api/public/training/forms','/api/user/training/forms']){
    const formRoute=ownership.routes.find(item=>item.mount===mount);
    assert.deepEqual(formRoute.ownership.modules,['training.forms']);
  }
});
