'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const test=require('node:test');
const {createExistingCatalogueRouter}=require('../modules/platform/existing-catalogue-router');
const {salemaxSales}=require('../modules/platform/categories');

async function serverFor(context){
  const app=express();
  const db={async query(sql){
    if(sql.includes('FROM sx_legacy_admin_identities'))return [[{legacy_uid:'synthetic-admin',identity_id:context.identity.id,status:'active'}]];
    return [{affectedRows:1},[]];
  }};
  app.use('/api/admin/plan-contracts',createExistingCatalogueRouter({pool:{getConnection:async()=>({...db,release(){}})},legacyGuard:(req,res,next)=>{req.legacyAdminId=1;req.decode={uid:'synthetic-admin'};next();},canonicalGuard:(req,res,next)=>{req.businessContext=context;next();}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  return {base:`http://127.0.0.1:${server.address().port}/api/admin/plan-contracts`,close:()=>new Promise(resolve=>server.close(resolve))};
}
const base={audience:'platform',identity:{id:'synthetic-identity'},mfaVerified:true,membership:{status:'active',delegatedPermissions:['plans.read','plans.draft','plans.publish']}};

test('Manage Plans context offers internal Sales features only to platform category administrators',async()=>{
  const admin=await serverFor({...base,membership:{...base.membership,role:'super_admin'}});
  const staff=await serverFor({...base,membership:{...base.membership,role:'staff'}});
  try{
    const adminContext=await (await fetch(admin.base+'/context')).json();
    assert.deepEqual(adminContext.categories.map(item=>item.key),['training_center','salemax_sales']);
    const sales=adminContext.categories.find(item=>item.key==='salemax_sales');
    assert.deepEqual(sales.seatRoles,['owner','accountant','manager','team_leader','agent']);
    assert.ok(sales.features.some(item=>item.key==='sales.deals'));
    assert.ok(sales.features.some(item=>item.key==='telephony.call-center'));
    assert.equal(sales.features.find(item=>item.key==='team.members').label.en,'People and roles');
    const staffContext=await (await fetch(staff.base+'/context')).json();
    assert.deepEqual(staffContext.categories.map(item=>item.key),['training_center']);
  }finally{await admin.close();await staff.close();}
});

test('delegated plan staff cannot enumerate or draft private SaleMaX Sales contracts',async()=>{
  const staff=await serverFor({...base,membership:{...base.membership,role:'staff'}});
  try{
    const versions=await fetch(staff.base+'/1/versions?categoryKey=salemax_sales');
    assert.equal(versions.status,403);
    assert.equal((await versions.json()).code,'PERMISSION_DENIED');
    const draft=await fetch(staff.base+'/1/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({legacyPlanId:1,requestId:'11111111-1111-4111-8111-111111111111',categoryKey:salemaxSales.key,categoryVersion:salemaxSales.version,capabilities:[...salemaxSales.capabilities],roleLimits:{owner:1,accountant:2,manager:5,team_leader:10,agent:50}})});
    assert.equal(draft.status,403);
    assert.equal((await draft.json()).code,'PERMISSION_DENIED');
  }finally{await staff.close();}
});
