'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const navigation=require('../modules/platform/navigation');
const service=require('../modules/platform/sales-icp');
const {decision}=require('../modules/platform/policy');
const {sevenNetworkSales,baseCrm}=require('../modules/platform/categories');

function context(role,category=sevenNetworkSales,capabilities=category.capabilities){
  return {audience:'tenant',tenant:{id:'tenant-1',status:'active',categoryKey:category.key,categoryVersion:category.version},
    category,subscription:{status:'active',capabilities:[...capabilities]},
    membership:{id:`${role}-1`,tenantId:'tenant-1',role,status:'active'},identity:{id:`identity-${role}`}};
}

test('ICP capability is limited to the private 7Network Sales category and readable Sales roles',()=>{
  for(const role of ['owner','manager','team_leader','agent']){
    const ctx=context(role);
    assert.equal(decision(ctx,{capability:'sales.icp',permission:'icp.read'}).allowed,true,role);
    assert.ok(navigation.navigationFor(ctx).some(item=>item.key==='icp'),role);
  }
  const accountant=context('accountant');
  assert.equal(decision(accountant,{capability:'sales.icp',permission:'icp.read'}).allowed,false);
  assert.ok(!navigation.navigationFor(accountant).some(item=>item.key==='icp'));
  const otherCategory=context('owner',baseCrm);
  assert.equal(decision(otherCategory,{capability:'sales.icp',permission:'icp.read'}).allowed,false);
  assert.ok(!navigation.navigationFor(otherCategory).some(item=>item.key==='icp'));
});

test('only the Sales owner can manage ICP profiles',()=>{
  assert.equal(decision(context('owner'),{capability:'sales.icp',permission:'icp.manage'}).allowed,true);
  for(const role of ['manager','team_leader','agent','accountant'])
    assert.equal(decision(context(role),{capability:'sales.icp',permission:'icp.manage'}).allowed,false,role);
});

test('the internal Sales pilot does not require adding ICP to customer plan entitlements',()=>{
  const ctx=context('owner',sevenNetworkSales,sevenNetworkSales.capabilities.filter(capability=>capability!=='sales.icp'));
  assert.equal(decision(ctx,{capability:'sales.icp',permission:'icp.read'}).allowed,true);
});

test('ICP documents are typed, bounded and normalized',()=>{
  const doc=service.cleanDocument({industries:['  Retail ','Retail',''],geographies:['Qatar'],confidence:'validated',ignored:'value'});
  assert.deepEqual(doc.industries,['Retail']);
  assert.deepEqual(doc.geographies,['Qatar']);
  assert.equal(doc.confidence,'validated');
  assert.equal(Object.hasOwn(doc,'ignored'),false);
  assert.throws(()=>service.cleanDocument({industries:Array(13).fill('Retail')}),{code:'INVALID_ICP_DOCUMENT'});
  assert.throws(()=>service.cleanDocument({confidence:'certain'}),{code:'INVALID_ICP_DOCUMENT'});
});

test('profile list always scopes by the authenticated tenant',async()=>{
  let captured;
  const db={query:async(sql,params)=>{captured={sql,params};return [[{id:'profile-1',title:'Qatar clinics',summary:'',document:'{}',revision:1,createdAt:null,updatedAt:null}]];}};
  const result=await service.list(db,context('agent'));
  assert.deepEqual(captured.params,['tenant-1']);
  assert.match(captured.sql,/WHERE tenant_id=\?/);
  assert.equal(result.items[0].id,'profile-1');
  assert.equal(result.permissions.canManage,false);
});

test('profile creation and audit are committed together with tenant and identity attribution',async()=>{
  const calls=[];let committed=false,rolledBack=false;
  const row={id:'profile-id',title:'Qatar clinics',summary:'Private clinics growing',document:JSON.stringify(service.cleanDocument({industries:['Healthcare']})),revision:1,createdAt:'2026-10-22',updatedAt:'2026-10-22'};
  const db={beginTransaction:async()=>calls.push('begin'),commit:async()=>{committed=true;},rollback:async()=>{rolledBack=true;},query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.startsWith('SELECT'))return [[row]];
    return [{affectedRows:1}];
  }};
  const saved=await service.create(db,context('owner'),{title:'Qatar clinics',summary:'Private clinics growing',document:{industries:['Healthcare']}});
  assert.equal(saved.title,'Qatar clinics');
  assert.equal(committed,true);assert.equal(rolledBack,false);
  const inserts=calls.filter(call=>typeof call==='object');
  assert.equal(inserts.length,3);
  assert.ok(inserts[0].sql.includes('INSERT INTO sx_sales_icp_profiles'));
  assert.equal(inserts[0].params[1],'tenant-1');
  assert.equal(inserts[0].params[5],'identity-owner');
  assert.ok(inserts[1].sql.includes('sales.icp.created'));
  assert.equal(inserts[1].params[1],'tenant-1');
});

test('revision-guarded updates reject stale writers and roll back',async()=>{
  const calls=[];let rolledBack=false;
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack=true;},query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.startsWith('UPDATE'))return [{affectedRows:0}];
    if(sql.startsWith('SELECT'))return [[{revision:3}]];
    return [[]];
  }};
  await assert.rejects(service.update(db,context('owner'),'123e4567-e89b-12d3-a456-426614174000',{
    title:'Qatar clinics',summary:'',document:{},revision:2
  }),{code:'STALE_ICP_PROFILE'});
  assert.match(calls[0].sql,/tenant_id=\? AND id=\? AND revision=\?/);
  assert.deepEqual(calls[0].params.slice(-3),['tenant-1','123e4567-e89b-12d3-a456-426614174000',2]);
  assert.equal(rolledBack,true);
});
