'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const categories=require('../modules/platform/categories');
const viewings=require('../modules/platform/real-estate-viewings');
const tenantId='11111111-1111-4111-8111-111111111111',identityId='22222222-2222-4222-8222-222222222222',membershipId='33333333-3333-4333-8333-333333333333',leadId='44444444-4444-4444-8444-444444444444',propertyId='55555555-5555-4555-8555-555555555555',agentId='66666666-6666-4666-8666-666666666666',uidHash='a'.repeat(64);
const context={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'real_estate',categoryVersion:3},membership:{id:membershipId,tenantId,role:'owner',status:'active'},category:categories.realEstateV3,subscription:{status:'active',categoryKey:'real_estate',categoryVersion:3,capabilities:[...categories.realEstateV3.capabilities]},identity:{id:identityId},legacyUidHash:uidHash};
const input={leadId,propertyId,startsAt:'2026-11-10T09:00:00+03:00',endsAt:'2026-11-10T10:00:00+03:00',assignedMembershipId:agentId,notes:'Synthetic visit'};

test('Real Estate v3 is a private immutable successor and keeps prior versions intact',()=>{
  assert.equal(categories.realEstate.version,1);assert.equal(categories.realEstateV2.version,2);assert.equal(categories.getCategory('real_estate',3),categories.realEstateV3);
  assert.equal(categories.realEstateV3.planable,false);assert.equal(categories.realEstateV3.public,false);assert.ok(Object.isFrozen(categories.realEstateV3));
  assert.ok(categories.realEstateV3.capabilities.includes('realestate.viewings'));assert.ok(!categories.realEstateV2.capabilities.includes('realestate.viewings'));
});
test('viewing validation requires explicit timezone offsets, bounded duration and known fields',()=>{
  const normalized=viewings.clean(input);assert.equal(normalized.startsAt.toISOString(),'2026-11-10T06:00:00.000Z');assert.equal(normalized.endsAt.toISOString(),'2026-11-10T07:00:00.000Z');
  assert.throws(()=>viewings.clean({...input,startsAt:'2026-11-10T09:00'}),{code:'INVALID_VIEWING_TIME'});
  assert.throws(()=>viewings.clean({...input,endsAt:'2026-11-10T09:10:00Z'}),{code:'INVALID_VIEWING_DURATION'});
  assert.throws(()=>viewings.clean({...input,tenantId:'other'}),{code:'INVALID_VIEWING'});
  assert.throws(()=>viewings.clean({...input,notes:'x'.repeat(501)}),{code:'INVALID_VIEWING_NOTES'});
});
test('browser local booking time converts with the tenant zone and rejects nonexistent or ambiguous DST times',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../client/public/workspace-time.js'),'utf8'),window={};vm.runInNewContext(source,{window,Intl,Date,Error});
  assert.equal(window.SaleMaxWorkspaceTime.fromTenantLocal('2026-11-10T09:00','Asia/Qatar'),'2026-11-10T06:00:00.000Z');
  assert.throws(()=>window.SaleMaxWorkspaceTime.fromTenantLocal('2026-03-29T01:30','Europe/London'),{message:'INVALID_VIEWING_TIME'});
  assert.throws(()=>window.SaleMaxWorkspaceTime.fromTenantLocal('2026-10-25T01:30','Europe/London'),{message:'INVALID_VIEWING_TIME_AMBIGUOUS'});
});
test('viewings reject older category contracts and categories before database access',()=>{
  for(const version of [1,2]){const category=categories.getCategory('real_estate',version);assert.throws(()=>viewings.authorize({...context,tenant:{...context.tenant,categoryVersion:version},category,subscription:{...context.subscription,categoryVersion:version,capabilities:[...category.capabilities]}},'viewings.read'),{code:'CATEGORY_UNAVAILABLE'});}
  assert.throws(()=>viewings.authorize({...context,tenant:{...context.tenant,categoryKey:'7network_sales'},category:categories.sevenNetworkSales},'viewings.read'),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>viewings.authorize({...context,subscription:{...context.subscription,capabilities:[]}},'viewings.read'),{code:'FEATURE_UNAVAILABLE'});
});
test('viewing creation locks tenant lead/property scope, prevents overlaps and writes an audit event',async()=>{
  const calls=[];let committed=false;
  const db={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM pipeline_leads l LEFT JOIN sx_legacy_ownership'))return [[{id:leadId,owner_agent_id:7,assignedMembershipId:agentId}]];if(sql.includes('FROM sx_real_estate_properties p WHERE'))return [[{id:propertyId,status:'active',assignedMembershipId:null}]];if(sql.startsWith('SELECT id FROM sx_real_estate_viewings'))return [[]];if(sql.startsWith('SELECT m.id'))return [[{id:agentId}]];if(sql.startsWith('INSERT INTO sx_real_estate_viewings'))return [{affectedRows:1}];if(sql.includes('real-estate.viewing-created'))return [{affectedRows:1}];throw Error(`UNEXPECTED_QUERY ${sql}`);}};
  const result=await viewings.create(db,context,input);assert.equal(result.status,'scheduled');assert.equal(result.assignedMembershipId,agentId);assert.equal(committed,true);
  const lead=calls.find(item=>item.sql.includes('FROM pipeline_leads l LEFT JOIN sx_legacy_ownership'));assert.ok(lead.sql.includes('l.uid_hash=?'));assert.ok(lead.args.includes(uidHash));assert.ok(lead.args.includes(tenantId));
  const property=calls.find(item=>item.sql.includes('FROM sx_real_estate_properties p WHERE'));assert.ok(property.sql.includes('p.tenant_id=?'));assert.equal(property.args[0],tenantId);
  const overlap=calls.find(item=>item.sql.startsWith('SELECT id FROM sx_real_estate_viewings'));assert.deepEqual(overlap.args.slice(0,2),[tenantId,propertyId]);assert.deepEqual(overlap.args.slice(2),['2026-11-10 07:00:00.000','2026-11-10 06:00:00.000']);assert.match(overlap.sql,/starts_at_utc<\? AND ends_at_utc>\? LIMIT 1 FOR UPDATE/);
  const insert=calls.find(item=>item.sql.startsWith('INSERT INTO sx_real_estate_viewings'));assert.ok(insert.sql.includes('tenant_id'));assert.ok(insert.args.includes(uidHash));assert.ok(insert.args.includes(propertyId));assert.ok(insert.args.includes(agentId));
  assert.ok(calls.some(item=>item.sql.includes('real-estate.viewing-created')));
});
test('viewing updates lock lead then property then viewing to match create and closure lock order',async()=>{
  const calls=[];let committed=false;
  const db={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT lead_id AS leadId,property_id AS propertyId FROM sx_real_estate_viewings'))return [[{leadId,propertyId}]];if(sql.includes('FROM pipeline_leads l LEFT JOIN sx_legacy_ownership'))return [[{id:leadId,owner_agent_id:null,assignedMembershipId:null}]];if(sql.includes('FROM sx_real_estate_properties p WHERE'))return [[{id:propertyId,status:'active',assignedMembershipId:null}]];if(sql.startsWith('SELECT v.id'))return [[{id:'77777777-7777-4777-8777-777777777777',propertyId,leadId,status:'scheduled',revision:1,startsAt:'2026-11-10T06:00:00.000Z',endsAt:'2026-11-10T07:00:00.000Z',assignedMembershipId:agentId}]];if(sql.startsWith('UPDATE sx_real_estate_viewings'))return [{affectedRows:1}];if(sql.includes('real-estate.viewing-updated'))return [{affectedRows:1}];throw Error(`UNEXPECTED_QUERY ${sql}`);}};
  const result=await viewings.update(db,context,'77777777-7777-4777-8777-777777777777',{expectedRevision:1,status:'completed',outcome:'interested'});
  const leadLock=calls.findIndex(item=>item.sql.includes('FROM pipeline_leads l LEFT JOIN sx_legacy_ownership'));
  const propertyLock=calls.findIndex(item=>item.sql.includes('FROM sx_real_estate_properties p WHERE'));
  const viewingLock=calls.findIndex(item=>item.sql.startsWith('SELECT v.id'));
  assert.ok(leadLock<propertyLock&&propertyLock<viewingLock);assert.match(calls[viewingLock].sql,/v\.property_id=\?/);assert.equal(result.revision,2);assert.equal(committed,true);
});
test('overlapping scheduled viewing fails atomically without inserting or auditing',async()=>{
  let inserts=0,rollbacks=0;
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rollbacks++;},query:async sql=>{if(sql.includes('FROM pipeline_leads l LEFT JOIN sx_legacy_ownership'))return [[{id:leadId,owner_agent_id:null,assignedMembershipId:null}]];if(sql.includes('FROM sx_real_estate_properties p WHERE'))return [[{id:propertyId,status:'active',assignedMembershipId:null}]];if(sql.startsWith('SELECT m.id'))return [[{id:agentId}]];if(sql.startsWith('SELECT id FROM sx_real_estate_viewings'))return [[{id:'existing'}]];if(sql.startsWith('INSERT'))inserts++;throw Error('UNEXPECTED_QUERY');}};
  await assert.rejects(viewings.create(db,context,input),{code:'VIEWING_SLOT_UNAVAILABLE'});assert.equal(rollbacks,1);assert.equal(inserts,0);
});
test('agents cannot see or schedule a different member property or lead',()=>{
  const agent={...context,membership:{...context.membership,id:agentId,role:'agent',customPermissions:['viewings.assign','requirements.assign','requirements.manage']}};const policy=require('../modules/platform/policy');assert.equal(viewings.teamMember(agent).args[0],agentId);assert.deepEqual(viewings.propertyScope(agent).args,[agentId]);assert.ok(viewings.leadScope(agent).sql.includes('own.membership_id=?'));for(const permission of ['viewings.assign','requirements.assign','requirements.manage'])assert.equal(policy.scopeFor(agent.membership,permission),null);assert.throws(()=>viewings.authorize({...agent,category:categories.realEstateV2,tenant:{...agent.tenant,categoryVersion:2}},'viewings.assign'),{code:'CATEGORY_UNAVAILABLE'});
});
test('migration and existing property screen integration preserve tenant ownership',()=>{
  const migration=fs.readFileSync(path.join(__dirname,'../database/migrations/20261231_real_estate_viewings.sql'),'utf8');
  const discovered=require('../database/migration-runner').discover(path.join(__dirname,'../database/migrations')).find(item=>item.file==='20261231_real_estate_viewings.sql');assert.ok(discovered);assert.equal(discovered.statements.length,1);
  assert.match(migration,/FOREIGN KEY \(tenant_id,property_id\) REFERENCES sx_real_estate_properties\(tenant_id,id\)/);assert.match(migration,/FOREIGN KEY \(tenant_id,requirement_id\) REFERENCES sx_real_estate_requirements\(tenant_id,id\)/);assert.match(migration,/FOREIGN KEY \(tenant_id,assigned_membership_id\) REFERENCES sx_memberships\(tenant_id,id\)/);assert.match(migration,/ck_sx_real_estate_viewing_duration/);assert.doesNotMatch(migration,/ON DELETE CASCADE/i);
  const mount=fs.readFileSync(path.join(__dirname,'../modules/platform/mount-existing-upgrade.js'),'utf8'),router=fs.readFileSync(path.join(__dirname,'../modules/platform/real-estate-viewings-router.js'),'utf8'),api=fs.readFileSync(path.join(__dirname,'../client/public/workspace-api.js'),'utf8'),ui=fs.readFileSync(path.join(__dirname,'../client/public/property-listings/properties.js'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../client/public/property-listings/index.html'),'utf8');
  const time=fs.readFileSync(path.join(__dirname,'../client/public/workspace-time.js'),'utf8');assert.match(mount,/real-estate\/viewings/);assert.match(mount,/featureSession\.guard/);assert.match(router,/viewings\.manage/);assert.match(api,/viewings:'\/api\/workspace\/real-estate\/viewings'/);assert.match(ui,/Schedule viewing/);assert.match(ui,/SaleMaxWorkspaceTime\.fromTenantLocal/);assert.match(ui,/VIEWING_SLOT_UNAVAILABLE/);assert.match(html,/workspace-time\.js\?v=20261022-realestate-v3/);assert.match(time,/INVALID_VIEWING_TIME_AMBIGUOUS/);
});
