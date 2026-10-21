'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const category=require('../modules/platform/categories');
const properties=require('../modules/platform/real-estate-properties');
const migrations=require('../database/migration-runner');

const tenantId='11111111-1111-4111-8111-111111111111';
const identityId='22222222-2222-4222-8222-222222222222';
const base={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'real_estate',categoryVersion:1},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId,role:'owner',status:'active'},category:category.realEstate,subscription:{status:'active',categoryKey:'real_estate',categoryVersion:1,capabilities:['realestate.listings']},identity:{id:identityId}};
const listing={titleEn:'Two bedroom apartment',titleAr:'شقة بغرفتي نوم',propertyType:'apartment',transactionType:'sale',status:'draft',priceMinor:125000000,currency:'QAR',areaSqm:120.5,bedrooms:2,bathrooms:2,city:'Doha',descriptionEn:'Near transit',descriptionAr:'بالقرب من المواصلات'};

test('real estate contract is isolated, immutable, private and excluded from plan assignment',()=>{
  assert.equal(category.realEstate.key,'real_estate');assert.equal(category.realEstate.version,1);
  assert.equal(category.realEstate.public,false);assert.equal(category.realEstate.planable,false);
  assert.ok(category.realEstate.capabilities.includes('realestate.listings'));
  assert.equal(Object.isFrozen(category.realEstate),true);
  assert.equal(category.listCategories().find(item=>item.key==='real_estate').planable,false);
});

test('listing validation rejects malformed domain values and normalizes accepted data',()=>{
  assert.deepEqual(properties.clean(listing),listing);
  assert.throws(()=>properties.clean({...listing,priceMinor:-1}),{code:'INVALID_PROPERTY_PRICE'});
  assert.throws(()=>properties.clean({...listing,propertyType:'course'}),{code:'INVALID_PROPERTY_TYPE'});
  assert.throws(()=>properties.clean({...listing,transactionType:'lease'}),{code:'INVALID_TRANSACTION_TYPE'});
  assert.throws(()=>properties.clean({...listing,currency:'QAR;'}),{code:'INVALID_PROPERTY_CURRENCY'});
  assert.throws(()=>properties.clean({...listing,areaSqm:0}),{code:'INVALID_PROPERTY_AREA'});
  assert.throws(()=>properties.clean({...listing,unexpectedTenantId:tenantId}),{code:'INVALID_PROPERTY'});
});

test('real estate access requires the exact category, version, plan, membership and permission',()=>{
  assert.equal(properties.authorize(base,'properties.manage'),base);
  assert.throws(()=>properties.authorize({...base,tenant:{...base.tenant,categoryKey:'training_center'},category:category.trainingCenter},'properties.read'),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>properties.authorize({...base,tenant:{...base.tenant,categoryVersion:2}},'properties.read'),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>properties.authorize({...base,subscription:{...base.subscription,capabilities:[]}},'properties.read'),{code:'FEATURE_UNAVAILABLE'});
  for(const role of ['agent','team_leader'])assert.throws(()=>properties.authorize({...base,membership:{...base.membership,role,customPermissions:['properties.read','properties.manage']}},'properties.read'),{code:'PERMISSION_DENIED'});
  assert.throws(()=>properties.authorize({...base,membership:{...base.membership,role:'agent',customPermissions:['properties.manage']}},'properties.manage'),{code:'PERMISSION_DENIED'});
  assert.equal(properties.authorize({...base,membership:{...base.membership,role:'manager'}},'properties.read').tenant.id,tenantId);
});

test('property lifecycle disallows reopening sold or rented listings',()=>{
  assert.equal(properties.transitionAllowed('draft','active'),true);
  assert.equal(properties.transitionAllowed('active','under_offer'),true);
  assert.equal(properties.transitionAllowed('under_offer','sold'),true);
  assert.equal(properties.transitionAllowed('sold','active'),false);
  assert.equal(properties.transitionAllowed('rented','draft'),false);
  assert.equal(properties.transitionAllowed('withdrawn','active'),true);
});

test('listing reads, creates and revision updates stay tenant-scoped',async()=>{
  const calls=[];
  const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT COUNT'))return [[{total:1}]];if(sql.startsWith('SELECT id,reference_code'))return [[{id:'property-1'}]];if(sql.startsWith('INSERT INTO'))return [{affectedRows:1}];if(sql.startsWith('SELECT status,transaction_type'))return [[{status:'draft',transactionType:'sale',revision:3}]];if(sql.startsWith('UPDATE'))return [{affectedRows:1}];throw Error('unexpected query');},beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{}};
  const listed=await properties.list(db,base,{status:'active',search:'Doha%_'});
  assert.equal(listed.total,1);assert.ok(calls[0].sql.includes('tenant_id=?'));assert.equal(calls[0].args[0],tenantId);
  assert.match(calls[0].sql,/LIKE \? ESCAPE '!'/);assert.ok(calls[0].args.slice(2,6).every(value=>value==='%Doha!%!_%'));
  const created=await properties.create(db,base,listing);assert.equal(created.revision,1);assert.ok(calls[2].sql.includes('tenant_id'));
  const updated=await properties.update(db,base,'44444444-4444-4444-8444-444444444444',{status:'active',expectedRevision:3});
  assert.equal(updated.revision,4);assert.match(calls[4].sql,/tenant_id=\? AND id=\? FOR UPDATE/);assert.equal(calls[4].args[0],tenantId);
  assert.match(calls[5].sql,/WHERE tenant_id=\? AND id=\?/);assert.equal(calls[5].args.at(-2),tenantId);
  assert.match(calls[6].sql,/real-estate\.property-updated/);assert.equal(calls[6].args[1],tenantId);
});

test('stale and invalid transitions cannot mutate a listing',async()=>{
  let updates=0,rollbacks=0;
  const db={query:async(sql)=>{if(sql.startsWith('SELECT status,transaction_type'))return [[{status:'sold',transactionType:'sale',revision:2}]];if(sql.startsWith('UPDATE'))updates++;return [{affectedRows:1}];},beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rollbacks++;}};
  await assert.rejects(properties.update(db,base,'44444444-4444-4444-8444-444444444444',{status:'active',expectedRevision:1}),{code:'STALE_REVISION'});
  await assert.rejects(properties.update(db,base,'44444444-4444-4444-8444-444444444444',{status:'active',expectedRevision:2}),{code:'INVALID_PROPERTY_TRANSITION'});
  await assert.rejects(properties.update(db,base,'44444444-4444-4444-8444-444444444444',{priceMinor:100,expectedRevision:2}),{code:'INVALID_PROPERTY_TRANSITION'});
  assert.equal(updates,0);assert.equal(rollbacks,3);
});

test('real estate storage keys and current-panel entry are registered without a duplicate app shell',()=>{
  const migrationPath=path.join(__dirname,'../database/migrations/20261222_real_estate_properties.sql');
  const migration=fs.readFileSync(migrationPath,'utf8');
  const discovered=migrations.discover(path.join(__dirname,'../database/migrations')).find(item=>item.file==='20261222_real_estate_properties.sql');
  assert.ok(discovered);assert.equal(discovered.statements.length,1);
  assert.match(migration,/UNIQUE KEY uq_sx_real_estate_tenant_id \(tenant_id,id\)/);
  assert.match(migration,/FOREIGN KEY \(tenant_id\) REFERENCES sx_tenants\(id\)/);
  assert.match(migration,/FOREIGN KEY \(tenant_id,created_by_identity_id\) REFERENCES sx_memberships\(tenant_id,identity_id\)/);
  assert.doesNotMatch(migration,/ON DELETE CASCADE/i);
  assert.match(migration,/idx_sx_real_estate_inventory \(tenant_id,status,transaction_type,property_type,updated_at\)/);
  const shell=fs.readFileSync(path.join(__dirname,'../client/public/training-sidebar.js'),'utf8');
  assert.match(shell,/membershipCategoryKey==='real_estate'/);assert.match(shell,/properties:'properties'/);
  const entry=fs.readFileSync(path.join(__dirname,'../client/public/pipeline-entry.js'),'utf8');
  assert.match(entry,/salemax-properties-workspace/);assert.match(entry,/\/property-listings\//);
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/property-listings/properties.js'),'utf8');
  assert.match(ui,/aria-modal="true"/);assert.match(ui,/statusLabels/);assert.doesNotMatch(ui,/prompt\(/);
});
