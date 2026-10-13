'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {resolve}=require('../modules/platform/legacy-pipeline-actor');
const hash=value=>crypto.createHash('sha256').update(String(value),'utf8').digest('hex');

function fixture(role='manager',changes={}){
  const staff={id:42,uid:'staff-uid-42',email:'manager@example.invalid'};
  const mapping={tenantId:'tenant-1',tenantStatus:'active',categoryKey:'training_center',categoryVersion:1,membershipId:'member-manager',identityId:'identity-manager',role,membershipStatus:'active',identityEmail:staff.email,identityStatus:'active',legacyUidHash:hash(staff.uid),assignedNavigation:null,rolePermissions:null,...changes};
  const owner={uid:'business-owner-uid',timezone:'Asia/Qatar',ownerUidHash:hash('business-owner-uid')};
  const calls=[];
  const db={async query(sql,args){calls.push(sql);if(sql.includes('SELECT u.uid,u.timezone'))return [[owner]];if(sql.includes('SELECT a.id,a.uid'))return [[{id:7,uid:'agent-uid-7',legacyUidHash:hash('agent-uid-7')},{id:8,uid:'agent-uid-8',legacyUidHash:'0'.repeat(64)}]];return [[mapping]];},release(){}};
  const pool={async getConnection(){return db;}};
  return {staff,mapping,owner,calls,pool};
}

test('linked manager resolves to the verified tenant owner pipeline with manager actor identity',async()=>{
  const f=fixture();let entitlementTenant;
  const actor=await resolve(f.pool,f.staff,{loadEntitlements:async(_db,tenantId)=>{entitlementTenant=tenantId;return {status:'active',capabilities:['crm.leads']};}});
  assert.equal(entitlementTenant,'tenant-1');
  assert.deepEqual(actor,{uid:'business-owner-uid',role:'manager',actorType:'user',actorId:'identity-manager',identityId:'identity-manager',membershipId:'member-manager',tenantId:'tenant-1',categoryKey:'training_center',legacyUserId:42,legacyUid:'staff-uid-42',timezone:'Asia/Qatar'});
  assert.equal(f.calls.length,2);
});

test('SaleMaX Sales managers and team leaders receive only currently assigned active agent ids',async()=>{
  for(const role of ['manager','team_leader']){
    const f=fixture(role,{categoryKey:'salemax_sales'});
    const actor=await resolve(f.pool,f.staff,{loadEntitlements:async()=>({status:'active',capabilities:['crm.leads']})});
    assert.equal(actor.role,role);
    assert.equal(actor.categoryKey,'salemax_sales');
    assert.deepEqual(actor.scopeAgentIds,[7]);
    assert.match(f.calls[2],role==='manager'?/manager_membership_id/ : /team_leader_membership_id/);
  }
});

test('accountant mappings are denied access to sales notes and pipeline APIs',async()=>{
  const f=fixture('accountant');
  const actor=await resolve(f.pool,f.staff,{loadEntitlements:async()=>{throw new Error('must not load');}});
  assert.deepEqual(actor,{denied:true,code:'PERMISSION_DENIED'});
  assert.equal(f.calls.length,1);
});

test('pipeline actor fails closed on stale links, invalid tenant access and inactive entitlements',async()=>{
  for(const [changes,entitlement,code] of [
    [{legacyUidHash:'0'.repeat(64)},{status:'active',capabilities:['crm.leads']},'BUSINESS_ACCESS_INACTIVE'],
    [{tenantStatus:'suspended'},{status:'active',capabilities:['crm.leads']},'BUSINESS_ACCESS_INACTIVE'],
    [{},{status:'expired',capabilities:['crm.leads']},'FEATURE_UNAVAILABLE'],
    [{},{status:'active',capabilities:['team.members']},'FEATURE_UNAVAILABLE'],
  ]){
    const f=fixture('manager',changes);
    const result=await resolve(f.pool,f.staff,{loadEntitlements:async()=>entitlement});
    assert.deepEqual(result,{denied:true,code});
  }
});

test('owner and unmapped legacy accounts keep the existing pipeline auth path',async()=>{
  const owner=fixture('owner');
  assert.equal(await resolve(owner.pool,owner.staff),null);
  const db={async query(){return [[],[]];},release(){}};
  assert.equal(await resolve({async getConnection(){return db;}},owner.staff),null);
});
