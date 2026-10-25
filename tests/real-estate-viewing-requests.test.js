'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const requests=require('../modules/platform/real-estate-viewing-requests');
const realEstate=require('../modules/platform/categories').realEstate;

const valid={contactName:'Guest Example',phone:'+97455551234',email:'guest@example.qa',preferredDate:'2027-02-14',message:'After 4pm if possible',consent:true,submissionToken:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};

test('viewing request input is bounded, consented, idempotent and guest-contactable',()=>{
  const normalized=requests.normalize(valid);
  assert.equal(normalized.contactName,'Guest Example');assert.equal(normalized.email,'guest@example.qa');assert.equal(normalized.preferredDate,'2027-02-14');
  assert.throws(()=>requests.normalize({...valid,consent:false}),{code:'VIEWING_CONSENT_REQUIRED'});
  assert.throws(()=>requests.normalize({...valid,email:'',phone:''}),{code:'VIEWING_CONTACT_REQUIRED'});
  assert.throws(()=>requests.normalize({...valid,preferredDate:'2027-02-30'}),{code:'INVALID_VIEWING_DATE'});assert.throws(()=>requests.normalize({...valid,preferredDate:'2020-01-01'}),{code:'VIEWING_DATE_IN_PAST'});
  assert.throws(()=>requests.normalize({...valid,extra:'forged'}),{code:'INVALID_VIEWING_REQUEST'});
});

test('guest viewing requests and staff workflow never claim appointment confirmation',async()=>{
  assert.deepEqual([...requests.STATUSES],['requested','contacted','declined','cancelled']);
  assert.equal(requests.STATUSES.has('confirmed'),false);assert.equal(requests.STATUSES.has('reserved'),false);
  assert.match(requests.CONSENT_TEXT,/contact me/);assert.match(requests.CONSENT_TEXT_AR,/تتواصل معي/);
  const db={begun:false,rolledBack:false,released:false,async beginTransaction(){this.begun=true;},async rollback(){this.rolledBack=true;},release(){this.released=true;},async query(sql){if(sql.includes('FROM sx_tenants t JOIN sx_tenant_storefronts'))return [[{tenantId:'tenant-a',slug:'private-office',name:'Private Office',status:'active',categoryKey:'real_estate',categoryVersion:1,uid:'legacy-owner',ownerUidHash:'0'.repeat(64)}]];throw Error('unexpected query before public-category gate');}};
  await assert.rejects(requests.submitPublic({async getConnection(){return db;}},{tenantSlug:'private-office',propertyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',input:valid,visitorHash:'1'.repeat(64)}),{code:'CATEGORY_UNAVAILABLE'});
  assert.equal(db.begun,true);assert.equal(db.rolledBack,true);assert.equal(db.released,true);
});


test('public property detail and guest request are hidden unless the published storefront opts in',async()=>{
  const categories=require('../modules/platform/categories'),plans=require('../modules/platform/plans');
  const oldCategory=categories.getCategory,oldEntitlements=plans.loadEntitlements;
  categories.getCategory=()=>({key:'real_estate',version:1,public:true,capabilities:['realestate.listings']});
  plans.loadEntitlements=async()=>({status:'active',categoryKey:'real_estate',capabilities:['realestate.listings']});
  let showPropertyCatalog=false,propertyQueried=false;
  const db={async query(sql){if(sql.includes('FROM sx_tenants t JOIN sx_tenant_storefronts'))return [[{tenantId:'tenant-a',slug:'realty',name:'Realty',status:'active',categoryKey:'real_estate',categoryVersion:1,publishedContent:{showPropertyCatalog}}]];if(sql.includes('FROM sx_real_estate_properties')){propertyQueried=true;return [[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',referenceCode:'RE-1',titleEn:'Home',titleAr:'منزل',propertyType:'villa',transactionType:'sale',priceMinor:10000,currency:'QAR',areaSqm:120,bedrooms:2,bathrooms:1,city:'Doha'}]];}throw Error('unexpected query');}};
  try{
    const args=['realty','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];
    assert.equal(await requests.publicProperty(db,...args),null);assert.equal(propertyQueried,false);
    showPropertyCatalog=true;const result=await requests.publicProperty(db,...args);assert.equal(result.property.titleEn,'Home');assert.equal(result.bookingMode,'request_only');assert.equal(propertyQueried,true);
  }finally{categories.getCategory=oldCategory;plans.loadEntitlements=oldEntitlements;}
});

test('request storage is tenant/property scoped and staff actions require review-only states',()=>{
  const root=path.join(__dirname,'..'),migration=fs.readFileSync(path.join(root,'database/migrations/20270102_real_estate_viewing_requests.sql'),'utf8');
  const discovered=require('../database/migration-runner').discover(path.join(root,'database/migrations')).find(item=>item.file==='20270102_real_estate_viewing_requests.sql');
  const ui=fs.readFileSync(path.join(root,'client/public/property-listings/properties.js'),'utf8');
  const router=fs.readFileSync(path.join(root,'modules/platform/real-estate-properties-router.js'),'utf8');
  const publicRouter=fs.readFileSync(path.join(root,'modules/platform/real-estate-public-viewing-router.js'),'utf8');
  const mount=fs.readFileSync(path.join(root,'modules/platform/mount-existing-upgrade.js'),'utf8');
  assert.match(migration,/FOREIGN KEY \(tenant_id,property_id\) REFERENCES sx_real_estate_properties\(tenant_id,id\)/);
  assert.match(migration,/UNIQUE KEY uq_sx_re_viewing_request_idempotency \(tenant_id,idempotency_hash\)/);
  assert.match(migration,/ENUM\('requested','contacted','declined','cancelled'\)/);
  assert.ok(discovered);assert.equal(discovered.statements.length,1);
  assert.doesNotMatch(migration,/ENUM\([^)]*confirmed|capacity_reserved/i);
  assert.match(router,/get\('\/viewing-requests'/);assert.match(router,/put\('\/viewing-requests\/:id'/);
  assert.match(publicRouter,/router\.post\('\/:tenantSlug\/:propertyId'/);assert.match(publicRouter,/requests\.submitPublic/);
  assert.match(mount,/\/api\/public\/real-estate\/viewing-requests/);
  assert.match(ui,/No appointment is reserved or confirmed/);assert.match(ui,/Mark contacted/);assert.match(ui,/\/viewing-requests/);
  const assignmentMigration=fs.readFileSync(path.join(root,'database/migrations/20270104_real_estate_viewing_assignment.sql'),'utf8');
  const assignmentDiscovery=require('../database/migration-runner').discover(path.join(root,'database/migrations')).find(item=>item.file==='20270104_real_estate_viewing_assignment.sql');
  assert.match(assignmentMigration,/FOREIGN KEY \(tenant_id,assigned_membership_id\) REFERENCES sx_memberships\(tenant_id,id\)/);assert.ok(assignmentDiscovery);assert.equal(assignmentDiscovery.statements.length,1);assert.match(ui,/properties\.requests\.manage/);assert.match(ui,/Unassigned queue/);
});

test('request review permission lets assigned agents handle only requests assigned at submission',async()=>{
  const tenantId='11111111-1111-4111-8111-111111111111',agentId='22222222-2222-4222-8222-222222222222',otherAgentId='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444',identityId='55555555-5555-4555-8555-555555555555';
  const context={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'real_estate',categoryVersion:1},membership:{id:agentId,tenantId,role:'agent',status:'active',customPermissions:['properties.read','properties.requests.manage']},category:realEstate,subscription:{status:'active',categoryKey:'real_estate',categoryVersion:1,capabilities:['realestate.listings']},identity:{id:identityId}};
  const calls=[];let rollbacks=0;
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rollbacks++;},query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('SELECT r.status,r.revision'))return [[{status:'requested',revision:1,requestAssignedMembershipId:agentId,assignedMembershipId:null,branchId:null}]];if(sql.startsWith('UPDATE sx_real_estate_viewing_requests'))return [{affectedRows:1}];if(sql.includes('real-estate.viewing-request-updated'))return [{affectedRows:1}];throw Error('unexpected query');}};
  const changed=await requests.updateStatus(db,context,requestId,{status:'contacted',expectedRevision:1});assert.deepEqual(changed,{id:requestId,status:'contacted',revision:2,bookingMode:'request_only'});assert.equal(calls[1].args[0],'contacted');assert.equal(calls[1].args.at(-2),tenantId);assert.equal(rollbacks,0);
  const denied={...db,rollback:async()=>{rollbacks++;},query:async(sql,args)=>sql.includes('SELECT r.status,r.revision')?[[{status:'requested',revision:1,requestAssignedMembershipId:otherAgentId,assignedMembershipId:null,branchId:null}]]:db.query(sql,args)};
  await assert.rejects(requests.updateStatus(denied,context,requestId,{status:'contacted',expectedRevision:1}),{code:'VIEWING_REQUEST_NOT_FOUND'});assert.equal(rollbacks,1);
});

test('guest requests snapshot active manager branch routing onto the request',async()=>{
  const categories=require('../modules/platform/categories'),plans=require('../modules/platform/plans'),pipeline=require('../helper/pipeline/leadPipeline'),crypto=require('node:crypto');
  const oldCategory=categories.getCategory,oldEntitlements=plans.loadEntitlements,oldCreate=pipeline.createManualLead;
  const tenantId='11111111-1111-4111-8111-111111111111',propertyId='22222222-2222-4222-8222-222222222222',branchId='33333333-3333-4333-8333-333333333333',managerId='44444444-4444-4444-8444-444444444444',calls=[];
  categories.getCategory=()=>({key:'real_estate',version:1,public:true,capabilities:['realestate.listings']});plans.loadEntitlements=async()=>({status:'active',categoryKey:'real_estate',capabilities:['realestate.listings']});pipeline.createManualLead=async()=>({id:'lead-created'});
  const uid='legacy-owner',uidHash=crypto.createHash('sha256').update(uid).digest('hex');
  const db={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,args){calls.push({sql,args});if(sql.includes('FROM sx_tenants t JOIN sx_tenant_storefronts'))return [[{tenantId,slug:'realty',name:'Realty',status:'active',categoryKey:'real_estate',categoryVersion:1,publishedContent:{showPropertyCatalog:true},uid,ownerUidHash:uidHash}]];if(sql.includes('SELECT property_id AS propertyId'))return [[]];if(sql.includes('FROM sx_real_estate_properties p WHERE'))return [[{id:propertyId,referenceCode:'RE-1',titleEn:'Home',status:'active',assignedMembershipId:null,branchId}]];if(sql.includes('SELECT routing_membership_id AS routingMembershipId'))return [[{routingMembershipId:managerId}]];if(sql.includes('SELECT COUNT(*) AS total FROM sx_real_estate_viewing_requests'))return [[{total:0}]];if(sql.startsWith('SELECT id FROM sx_memberships'))return [[{id:managerId}]];if(sql.startsWith('SELECT a.id FROM sx_legacy_ownership'))return [[]];if(sql.startsWith('INSERT INTO sx_real_estate_viewing_requests'))return [{affectedRows:1}];throw Error(`unexpected query: ${sql}`);}};
  try{
    const result=await requests.submitPublic({async getConnection(){return db;}},{tenantSlug:'realty',propertyId,input:valid,visitorHash:'a'.repeat(64)});
    assert.equal(result.status,'requested');assert.equal(result.bookingMode,'request_only');
    const insert=calls.find(call=>call.sql.startsWith('INSERT INTO sx_real_estate_viewing_requests'));
    assert.match(insert.sql,/assigned_membership_id/);assert.equal(insert.args[4],managerId);
  }finally{categories.getCategory=oldCategory;plans.loadEntitlements=oldEntitlements;pipeline.createManualLead=oldCreate;}
});

test('assigned request queue is scoped by the immutable request assignment first',async()=>{
  const tenantId='11111111-1111-4111-8111-111111111111',agentId='22222222-2222-4222-8222-222222222222';
  const context={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'real_estate',categoryVersion:1},membership:{id:agentId,tenantId,role:'agent',status:'active',customPermissions:['properties.read']},category:realEstate,subscription:{status:'active',categoryKey:'real_estate',categoryVersion:1,capabilities:['realestate.listings']},identity:{id:'55555555-5555-4555-8555-555555555555'}};
  const calls=[],db={async query(sql,args){calls.push({sql,args});if(sql.startsWith('SELECT r.id'))return [[]];return [[{total:0}]];}};
  assert.deepEqual(await requests.list(db,context),[]);assert.match(calls[0].sql,/COALESCE\(r\.assigned_membership_id,p\.assigned_membership_id,b\.routing_membership_id\)=\?/);assert.equal(calls[0].args.at(-2),agentId);assert.match(calls[0].sql,/r\.assigned_membership_id AS assignedMembershipId/);assert.match(calls[0].sql,/assignee\.display_name AS assignedName/);
});
