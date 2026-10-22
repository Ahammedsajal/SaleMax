'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const requirements=require('../modules/platform/real-estate-requirements');
const categories=require('../modules/platform/categories');
const migrations=require('../database/migration-runner');
const tenantId='11111111-1111-4111-8111-111111111111';
const leadId='44444444-4444-4444-8444-444444444444';
const memberId='55555555-5555-4555-8555-555555555555';
const uidHash='a'.repeat(64);
const context={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'real_estate',categoryVersion:2},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId,role:'owner',status:'active'},category:categories.realEstateV2,subscription:{status:'active',categoryKey:'real_estate',categoryVersion:2,capabilities:[...categories.realEstateV2.capabilities]},identity:{id:'22222222-2222-4222-8222-222222222222'},legacyUidHash:uidHash};
const input={leadId,transactionType:'sale',propertyType:'apartment',minPriceMinor:50000000,maxPriceMinor:100000000,currency:'QAR',minAreaSqm:70,maxAreaSqm:120,minBedrooms:2,preferredCity:'Doha'};

test('requirements validation is typed, bounded and rejects tenant-controlled fields',()=>{
  assert.deepEqual(requirements.clean(input),{...input,assignedMembershipId:null});
  assert.throws(()=>requirements.clean({...input,minPriceMinor:120,maxPriceMinor:100}),{code:'INVALID_REQUIREMENT_PRICE_RANGE'});
  assert.throws(()=>requirements.clean({...input,tenantId:'foreign'}),{code:'INVALID_REQUIREMENT'});
  assert.throws(()=>requirements.clean({...input,leadId:'other'}),{code:'INVALID_REQUIREMENT_LEAD'});
});

test('requirements are unavailable to v1 and other categories before database access',()=>{
  assert.throws(()=>requirements.authorize({...context,tenant:{...context.tenant,categoryVersion:1},category:categories.realEstate,subscription:{...context.subscription,categoryVersion:1,capabilities:[...categories.realEstate.capabilities]}},'requirements.read'),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>requirements.authorize({...context,tenant:{...context.tenant,categoryKey:'7network_sales'},category:categories.sevenNetworkSales},'requirements.read'),{code:'CATEGORY_UNAVAILABLE'});
});

test('requirements cannot reveal linked Pipeline leads unless the separate lead entitlement remains active',()=>{
  const withoutLeads={...context,subscription:{...context.subscription,capabilities:context.subscription.capabilities.filter(capability=>capability!=='crm.leads')}};
  assert.throws(()=>requirements.authorize(withoutLeads,'requirements.read'),{code:'FEATURE_UNAVAILABLE'});
});

test('create binds an existing lead to the tenant owner hash and commits its audit atomically',async()=>{
  const calls=[];let committed=false,rolledBack=false;
  const db={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{rolledBack=true;},query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM pipeline_leads l'))return [[{id:leadId,owner_agent_id:null,leadAssignee:null}]];if(sql.startsWith('INSERT INTO sx_real_estate_requirements'))return [{affectedRows:1}];if(sql.includes('real-estate.requirement-created'))return [{affectedRows:1}];throw Error('UNEXPECTED_QUERY');}};
  const created=await requirements.create(db,context,input);
  assert.equal(created.status,'open');assert.equal(created.revision,1);assert.equal(committed,true);assert.equal(rolledBack,false);
  const leadQuery=calls.find(call=>call.sql.includes('FROM pipeline_leads l'));
  assert.ok(leadQuery.sql.includes('l.uid_hash=? AND l.id=?'));assert.deepEqual(leadQuery.args,[tenantId,uidHash,leadId]);
  const insert=calls.find(call=>call.sql.startsWith('INSERT INTO sx_real_estate_requirements'));
  assert.ok(insert.args.includes(tenantId));assert.ok(insert.args.includes(uidHash));assert.ok(insert.args.includes(leadId));
  assert.ok(calls.some(call=>call.sql.includes('real-estate.requirement-created')));
});

test('requirement list pins tenant, legacy identity and assigned-member scope',async()=>{
  const calls=[],agent={...context,membership:{...context.membership,id:memberId,role:'agent'}};
  const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT COUNT'))return [[{total:0}]];if(sql.startsWith('SELECT r.id'))return [[]];throw Error('UNEXPECTED_QUERY');}};
  const result=await requirements.list(db,agent);
  assert.equal(result.total,0);assert.equal(calls.length,2);
  for(const call of calls){assert.match(call.sql,/r\.tenant_id=\?/);assert.match(call.sql,/r\.legacy_uid_hash=\?/);assert.match(call.sql,/r\.assigned_membership_id=\?/);assert.ok(call.args.includes(tenantId));assert.ok(call.args.includes(uidHash));assert.ok(call.args.includes(memberId));}
});

test('manager requirement reads are limited to the manager team and its legacy leads',async()=>{
  const calls=[],managerId='66666666-6666-4666-8666-666666666666',manager={...context,membership:{...context.membership,id:managerId,role:'manager'}};
  const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT COUNT'))return [[{total:0}]];if(sql.startsWith('SELECT r.id'))return [[]];throw Error('UNEXPECTED_QUERY');}};
  await requirements.list(db,manager);
  for(const call of calls){assert.match(call.sql,/r\.assigned_membership_id=\?/);assert.match(call.sql,/org\.manager_membership_id=\?/);assert.ok(call.args.includes(managerId));assert.ok(call.args.includes(tenantId));}
});

test('manager updates lock only requirements and leads inside the manager team',async()=>{
  const managerId='66666666-6666-4666-8666-666666666666',manager={...context,membership:{...context.membership,id:managerId,role:'manager'}},calls=[];
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT r.status'))return [[{status:'open',revision:1}]];if(sql.startsWith('UPDATE sx_real_estate_requirements'))return [{affectedRows:1}];if(sql.includes('real-estate.requirement-updated'))return [{affectedRows:1}];throw Error('UNEXPECTED_QUERY');}};
  await requirements.update(db,manager,leadId,{status:'closed',expectedRevision:1});
  assert.match(calls[0].sql,/org\.manager_membership_id=\?/);assert.ok(calls[0].args.includes(managerId));assert.ok(calls[0].args.includes(tenantId));
});

test('requirement matching stays inside tenant and listing assignment scope',async()=>{
  const calls=[],agent={...context,membership:{...context.membership,id:memberId,role:'agent'}};
  const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT r.*'))return [[{id:leadId}]];if(sql.startsWith('SELECT p.id'))return [[]];throw Error('UNEXPECTED_QUERY');}};
  const result=await requirements.matches(db,agent,leadId);assert.deepEqual(result,{items:[],limit:50});
  assert.match(calls[0].sql,/r\.tenant_id=\?.*r\.legacy_uid_hash=\?.*r\.assigned_membership_id=\?/);assert.ok(calls[0].args.includes(memberId));
  assert.match(calls[1].sql,/p\.tenant_id=\?.*p\.status IN/);assert.match(calls[1].sql,/p\.assigned_membership_id=\?/);assert.match(calls[1].sql,/r\.legacy_uid_hash=\?/);
  assert.ok(calls[1].args.includes(tenantId));assert.ok(calls[1].args.includes(uidHash));
});

test('successor manifest and additive migration keep v1 immutable and tenant constrained',()=>{
  assert.equal(categories.realEstate.capabilities.includes('realestate.requirements'),false);
  assert.equal(categories.getCategory('real_estate',2),categories.realEstateV2);
  assert.equal(categories.realEstateV2.planable,false);assert.equal(categories.realEstateV2.public,false);
  const file='20261223_real_estate_requirements.sql',sql=fs.readFileSync(path.join(__dirname,'../database/migrations',file),'utf8');
  assert.ok(migrations.discover(path.join(__dirname,'../database/migrations')).some(item=>item.file===file));
  assert.match(sql,/UNIQUE KEY uq_sx_real_estate_requirement_tenant_id \(tenant_id,id\)/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,assigned_membership_id\) REFERENCES sx_memberships\(tenant_id,id\)/);
  assert.match(sql,/legacy_uid_hash/);assert.doesNotMatch(sql,/ON DELETE CASCADE/i);
  const mount=fs.readFileSync(path.join(__dirname,'../modules/platform/mount-existing-upgrade.js'),'utf8');
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/real-estate-requirements-router.js'),'utf8');
  assert.match(mount,/\/api\/workspace\/real-estate\/requirements/);
  assert.match(router,/featureSession\?\.ownerUid/);assert.match(router,/router\.use\(authenticate\)/);
});
