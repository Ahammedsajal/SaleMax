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

test('real estate is private, internally assignable and excluded from public signup',()=>{
  assert.equal(category.realEstate.key,'real_estate');assert.equal(category.realEstate.version,1);
  assert.equal(category.realEstate.public,false);assert.equal(category.realEstate.planable,true);
  assert.ok(category.realEstate.capabilities.includes('realestate.listings'));
  assert.equal(Object.isFrozen(category.realEstate),true);
  assert.equal(category.listCategories().find(item=>item.key==='real_estate').planable,true);
  assert.equal(category.supportsBusinessCapability(category.realEstate,'realestate.listings'),false);
  assert.deepEqual(require('../modules/platform/plans').definition({categoryKey:'real_estate',categoryVersion:1,capabilities:['realestate.listings'],roleLimits:{owner:1,manager:2,team_leader:2,agent:10}}).category,category.realEstate);
});

test('listing validation rejects malformed domain values and normalizes accepted data',()=>{
  assert.deepEqual(properties.clean(listing),{...listing,assignedMembershipId:null});
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
  assert.equal(require('../modules/platform/policy').scopeFor({role:'agent',customPermissions:['properties.read']},'properties.read'),'assigned');
  assert.equal(require('../modules/platform/policy').scopeFor({role:'team_leader',customPermissions:['properties.read']},'properties.read'),'team');
  assert.equal(require('../modules/platform/policy').scopeFor({role:'team_leader',customPermissions:['properties.assign']},'properties.assign'),null);
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
  const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT COUNT'))return [[{total:1}]];if(sql.startsWith('SELECT p.id'))return [[{id:'property-1'}]];if(sql.startsWith('INSERT INTO'))return [{affectedRows:1}];if(sql.startsWith('SELECT unit_id'))return [[{unitId:'44444444-4444-4444-8444-444444444444'}]];if(sql.startsWith('SELECT availability'))return [[{availability:'available'}]];if(sql.startsWith('SELECT status,transaction_type'))return [[{status:'draft',transactionType:'sale',revision:3}]];if(sql.startsWith('SELECT a.id,a.parent_agreement_id')&&args[1]==='99999999-9999-4999-8999-999999999999')return [[{id:'99999999-9999-4999-8999-999999999999',parentAgreementId:null,agreementType:'owner_mandate',status:'active',startsOn:'2025-01-01',endsOn:'2031-01-01',mayAdvertise:1,mayConductViewings:1,mayReferAgents:1,mediaApproved:1,descriptionApproved:1,permittedChannels:'["website"]',contactType:'owner',contactStatus:'active'}]];if(sql.startsWith('SELECT a.id,a.parent_agreement_id'))return [[{id:'agreement-1',parentAgreementId:'99999999-9999-4999-8999-999999999999',agreementType:'brokerage',permittedChannels:['website'],startsOn:'2026-01-01',endsOn:'2030-01-01',mayConductViewings:1,mayReferAgents:1}]];if(sql.startsWith('SELECT a.agreement_type AS agreementType'))return [[{agreementType:'owner_mandate',status:'active',contactType:'owner',startsOn:'2025-01-01',endsOn:'2031-01-01',mayAdvertise:1,mayConductViewings:1,mayReferAgents:1,mediaApproved:1,descriptionApproved:1,permittedChannels:'["website"]',contactStatus:'active'}]];if(sql.startsWith('UPDATE'))return [{affectedRows:1}];throw Error('unexpected query');},beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{}};
  const listed=await properties.list(db,base,{status:'active',search:'Doha%_'});
  assert.equal(listed.total,1);assert.ok(calls[0].sql.includes('tenant_id=?'));assert.equal(calls[0].args[0],tenantId);
  assert.match(calls[0].sql,/LIKE \? ESCAPE '!'/);assert.ok(calls[0].args.slice(2,6).every(value=>value==='%Doha!%!_%'));
  const created=await properties.create(db,base,listing);assert.equal(created.revision,1);assert.ok(calls[2].sql.includes('tenant_id'));
  const updated=await properties.update(db,base,'44444444-4444-4444-8444-444444444444',{status:'active',expectedRevision:3});
  assert.equal(updated.revision,4);const locked=calls.find(call=>call.sql.startsWith('SELECT availability'));assert.match(locked.sql,/tenant_id=\? AND id=\? FOR UPDATE/);assert.equal(locked.args[0],tenantId);
  const updatedRow=calls.find(call=>call.sql.startsWith('UPDATE sx_real_estate_properties'));assert.match(updatedRow.sql,/WHERE tenant_id=\? AND id=\?/);assert.equal(updatedRow.args.at(-2),tenantId);
  const auditUpdate=calls.find(call=>call.sql.includes('real-estate.property-updated'));assert.equal(auditUpdate.args[1],tenantId);
});

test('agent and team-leader listing reads are restricted to their persisted assignment scope',async()=>{
  for(const [role,sqlFragment] of [['agent','p.assigned_membership_id=?'],['team_leader','org.team_leader_membership_id=?']]){
    const calls=[],membershipId='55555555-5555-4555-8555-555555555555',context={...base,membership:{...base.membership,id:membershipId,role}};
    const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT COUNT'))return [[{total:0}]];if(sql.startsWith('SELECT p.id'))return [[]];throw Error('unexpected query');}};
    const result=await properties.list(db,context);
    assert.equal(result.total,0);assert.ok(calls[0].sql.includes(sqlFragment));assert.ok(calls[0].sql.includes('p.tenant_id=?'));assert.ok(calls[0].args.includes(membershipId));
  }
});

test('manager assignments are limited to active agents in that manager team and audited',async()=>{
  const managerId='66666666-6666-4666-8666-666666666666',agentId='77777777-7777-4777-8777-777777777777',calls=[];
  const context={...base,membership:{...base.membership,id:managerId,role:'manager'}};
  const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT m.id FROM sx_memberships'))return [[{id:agentId}]];if(sql.startsWith('INSERT INTO sx_real_estate_units')||sql.startsWith('INSERT INTO sx_real_estate_properties'))return [{affectedRows:1}];if(sql.includes('real-estate.property-created'))return [{affectedRows:1}];throw Error('unexpected query');},beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{}};
  const created=await properties.create(db,context,{...listing,assignedMembershipId:agentId});
  assert.equal(created.assignedMembershipId,agentId);
  assert.deepEqual(calls[0].args,[tenantId,agentId,managerId]);assert.match(calls[0].sql,/m\.role='agent'.*m\.status='active'.*org\.manager_membership_id=\?/);
  const insert=calls.find(call=>call.sql.startsWith('INSERT INTO sx_real_estate_properties'));
  assert.ok(insert.args.includes(agentId));
  const audit=calls.find(call=>call.sql.includes('real-estate.property-created'));
  assert.match(audit.args[4],new RegExp(agentId));
});

test('assignee lookup stays tenant and manager scoped',async()=>{
  const managerId='66666666-6666-4666-8666-666666666666',calls=[],context={...base,membership:{...base.membership,id:managerId,role:'manager'}};
  const db={query:async(sql,args)=>{calls.push({sql,args});return [[{membershipId:'77777777-7777-4777-8777-777777777777',name:'Agent'}]];}};
  const result=await properties.listAssignees(db,context);
  assert.equal(result.scope,'tenant');assert.equal(result.items.length,1);
  assert.deepEqual(calls[0].args,[tenantId,managerId]);assert.match(calls[0].sql,/m\.tenant_id=\?.*m\.role='agent'.*org\.manager_membership_id=\?/);
});

test('stale and invalid transitions cannot mutate a listing',async()=>{
  let updates=0,rollbacks=0;
  const db={query:async(sql)=>{if(sql.startsWith('SELECT unit_id'))return [[{unitId:'44444444-4444-4444-8444-444444444444'}]];if(sql.startsWith('SELECT availability'))return [[{availability:'available'}]];if(sql.startsWith('SELECT a.id,a.parent_agreement_id')&&sql.includes('JOIN sx_real_estate_contacts c'))return [[{id:'99999999-9999-4999-8999-999999999999',parentAgreementId:null,agreementType:'owner_mandate',status:'active',contactType:'owner',startsOn:'2025-01-01',endsOn:'2031-01-01',mayAdvertise:1,mayConductViewings:1,mayReferAgents:1,mediaApproved:1,descriptionApproved:1,permittedChannels:'["website"]',contactStatus:'active'}]];if(sql.startsWith('SELECT a.id,a.parent_agreement_id'))return [[{id:'88888888-8888-4888-8888-888888888888',parentAgreementId:'99999999-9999-4999-8999-999999999999',agreementType:'brokerage',permittedChannels:'["website"]',startsOn:'2026-01-01',endsOn:'2030-01-01',mayConductViewings:1,mayReferAgents:1}]];if(sql.startsWith('SELECT status,transaction_type'))return [[{status:'sold',transactionType:'sale',revision:2}]];if(sql.startsWith('UPDATE'))updates++;return [{affectedRows:1}];},beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rollbacks++;}};
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
  assert.match(migration,/FOREIGN KEY \(tenant_id,assigned_membership_id\) REFERENCES sx_memberships\(tenant_id,id\)/);
  assert.doesNotMatch(migration,/ON DELETE CASCADE/i);
  assert.match(migration,/idx_sx_real_estate_inventory \(tenant_id,status,transaction_type,property_type,updated_at\)/);
  const shell=fs.readFileSync(path.join(__dirname,'../client/public/training-sidebar.js'),'utf8');
  assert.match(shell,/membershipCategoryKey==='real_estate'/);assert.match(shell,/properties:'properties'/);
  const entry=fs.readFileSync(path.join(__dirname,'../client/public/pipeline-entry.js'),'utf8');
  assert.match(entry,/salemax-properties-workspace/);assert.match(entry,/\/property-listings\//);
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/property-listings/properties.js'),'utf8');
  assert.match(ui,/aria-modal="true"/);assert.match(ui,/statusLabels/);assert.match(ui,/data-save-assignee/);assert.match(ui,/assignedMembershipId/);assert.doesNotMatch(ui,/prompt\(/);
});
