'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const test=require('node:test');
const {createExistingCatalogueRouter}=require('../modules/platform/existing-catalogue-router');
const {salemaxSales}=require('../modules/platform/categories');

async function serverFor(context){
  const app=express(),queries=[];
  const db={async query(sql,params){
    queries.push({sql,params});
    if(sql.includes('FROM sx_legacy_plan_contracts c JOIN sx_plan_versions'))return [[]];
    if(sql.includes('FROM sx_legacy_admin_identities'))return [[{legacy_uid:'synthetic-admin',identity_id:context.identity.id,status:'active'}]];
    return [{affectedRows:1},[]];
  }};
  app.use('/api/admin/plan-contracts',createExistingCatalogueRouter({pool:{getConnection:async()=>({...db,release(){}})},legacyGuard:(req,res,next)=>{req.legacyAdminId=1;req.decode={uid:'synthetic-admin'};next();},canonicalGuard:(req,res,next)=>{req.businessContext=context;next();}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  return {queries,base:`http://127.0.0.1:${server.address().port}/api/admin/plan-contracts`,close:()=>new Promise(resolve=>server.close(resolve))};
}
const base={audience:'platform',identity:{id:'11111111-1111-4111-8111-111111111111'},mfaVerified:true,membership:{status:'active',delegatedPermissions:['plans.read','plans.draft','plans.publish']}};

test('Manage Plans context offers internal Sales features only to platform category administrators',async()=>{
  const admin=await serverFor({...base,membership:{...base.membership,role:'super_admin'}});
  const staff=await serverFor({...base,membership:{...base.membership,role:'staff'}});
  try{
    const adminContext=await (await fetch(admin.base+'/context')).json();
    assert.deepEqual(adminContext.categories.map(item=>item.key),['training_center','professional_services','salon_spa','home_services','fitness_coaching','events_venues','retail_boutique','restaurant_cafe','7network_sales','base_crm']);
    const restaurant=adminContext.categories.find(item=>item.key==='restaurant_cafe');
    assert.deepEqual(restaurant.seatRoles,['owner','accountant','manager','agent']);
    const sales=adminContext.categories.find(item=>item.key==='7network_sales');
    assert.deepEqual(sales.seatRoles,['owner','accountant','manager','team_leader','agent']);
    assert.ok(sales.features.some(item=>item.key==='sales.deals'));
    assert.ok(sales.features.some(item=>item.key==='telephony.call-center'));
    assert.equal(sales.features.find(item=>item.key==='team.members').label.en,'People and roles');
    const staffContext=await (await fetch(staff.base+'/context')).json();
    assert.deepEqual(staffContext.categories.map(item=>item.key),['training_center','professional_services','salon_spa','home_services','fitness_coaching','events_venues','retail_boutique']);
  }finally{await admin.close();await staff.close();}
});

test('delegated plan staff cannot enumerate or draft private 7Network Sales contracts',async()=>{
  const staff=await serverFor({...base,membership:{...base.membership,role:'staff'}});
  try{
    const versions=await fetch(staff.base+'/1/versions?categoryKey=7network_sales');
    assert.equal(versions.status,403);
    assert.equal((await versions.json()).code,'PERMISSION_DENIED');
    const draft=await fetch(staff.base+'/1/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({legacyPlanId:1,requestId:'11111111-1111-4111-8111-111111111111',categoryKey:salemaxSales.key,categoryVersion:salemaxSales.version,capabilities:[...salemaxSales.capabilities],roleLimits:{owner:1,accountant:2,manager:5,team_leader:10,agent:50}})});
    assert.equal(draft.status,403);
    assert.equal((await draft.json()).code,'PERMISSION_DENIED');
  }finally{await staff.close();}
});


test('version listing pins requested category revision and rejects malformed or unavailable revisions',async()=>{
  const admin=await serverFor({...base,membership:{...base.membership,role:'super_admin'}});
  try{
    for(const query of ['', '&categoryVersion=1']){
      const response=await fetch(admin.base+'/7/versions?categoryKey=training_center'+query);
      assert.equal(response.status,200);
      assert.deepEqual((await response.json()).items,[]);
      const lookup=admin.queries.filter(row=>row.sql.includes('FROM sx_legacy_plan_contracts c JOIN sx_plan_versions')).at(-1);
      assert.deepEqual(lookup.params,[7,'training_center',1]);
    }
    for(const value of ['0','-1','1.5','abc','01','9007199254740992','1&categoryVersion=2']){
      const response=await fetch(admin.base+'/7/versions?categoryKey=training_center&categoryVersion='+value);
      assert.equal(response.status,400);
      assert.equal((await response.json()).code,'INVALID_CATEGORY_VERSION');
    }
    const missing=await fetch(admin.base+'/7/versions?categoryKey=training_center&categoryVersion=2');
    assert.equal(missing.status,400);
    assert.equal((await missing.json()).code,'CATEGORY_UNAVAILABLE');
    assert.equal(admin.queries.filter(row=>row.sql.includes('FROM sx_legacy_plan_contracts c JOIN sx_plan_versions')).length,2);
  }finally{await admin.close();}
});
