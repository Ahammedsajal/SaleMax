'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const adminDomains=require('../modules/platform/admin-tenant-domains');
const domainOps=require('../scripts/tenant-crm-domain-ops.cjs');
const tenantDomains=require('../modules/platform/tenant-crm-domains');

test('tenant domain administration requires an authenticated platform super-admin',()=>{
  assert.throws(()=>adminDomains.actor({platformAccess:{role:'platform_admin',identityId:'platform-a'}}),{code:'PERMISSION_DENIED'});
  assert.throws(()=>adminDomains.actor({businessContext:{tenant:{id:'tenant-a'},membership:{role:'owner'}}}),{code:'PERMISSION_DENIED'});
  assert.equal(adminDomains.actor({platformAccess:{role:'super_admin',identityId:'platform-root'}}),'platform-root');
});

test('tenant domain search returns only legacy-linked business workspaces and domain metadata',async()=>{
  const calls=[];
  const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM user u JOIN sx_legacy_ownership'))return [[{userId:11,name:'Business A',email:'a@example.qa',tenantId:'tenant-a',tenantStatus:'active'}]];if(sql.includes('FROM sx_tenant_crm_domains'))return [[{id:'domain-a',tenantId:'tenant-a',hostname:'example.qa',status:'verified',isPrimary:1}]];throw new Error('Unexpected query');}};
  const rows=await adminDomains.list(db,{platformAccess:{role:'super_admin',identityId:'platform-root'},query:{q:'Business A'}});
  assert.equal(rows.length,1);assert.equal(rows[0].domains[0].hostname,'example.qa');
  assert.match(calls[0].sql,/source_table='user'/);assert.deepEqual(calls[0].args,['Business A','%Business A%','%Business A%','Business A']);
});

test('admin domain creation issues 7Network TXT instructions for a root hostname',async()=>{
  const original=tenantDomains.resolveTargetIpv4;
  tenantDomains.resolveTargetIpv4=async()=>['192.0.2.10'];
  const db={
    async query(sql){
      if(sql.includes('FROM user u LEFT JOIN sx_legacy_ownership'))return [[{userId:11,name:'Business A',email:'a@example.qa',tenantId:'tenant-a',tenantStatus:'active'}]];
      if(sql.includes('SELECT COUNT(*) AS total'))return [[{total:0,hasPrimary:0}]];
      if(sql.includes('SELECT id,tenant_id AS tenantId,status FROM sx_tenant_crm_domains WHERE hostname='))return [[]];
      if(sql.includes('INSERT INTO sx_tenant_crm_domains'))return [{affectedRows:1},undefined];
      return [[],undefined];
    },
    async beginTransaction(){},async commit(){},async rollback(){}
  };
  try{
    const result=await adminDomains.create(db,{platformAccess:{role:'super_admin',identityId:'platform-root'},body:{userId:11,hostname:'example.qa',primary:true}});
    assert.equal(result.txtName,'_7network-verification.example.qa');
    assert.match(result.txtValue,/^7network-domain-verification=/);
    assert.equal(result.txtHost,'_7network-verification');
    assert.equal(result.aHost,'@');
    assert.equal(result.apexARecord,true);
    assert.deepEqual(result.aRecordIpv4,['192.0.2.10']);
  }finally{tenantDomains.resolveTargetIpv4=original;}
});

test('verified-domain worker command accepts an empty database scan without a hostname',()=>{
  assert.deepEqual(domainOps.parseArgs(['list-verified']),{mode:'list-verified',hostname:null});
  assert.deepEqual(domainOps.parseArgs(['audit-active-dns']),{mode:'audit-active-dns',hostname:null});
  assert.deepEqual(domainOps.parseArgs(['check','crm.example.qa']),{mode:'check',hostname:'crm.example.qa'});
  assert.throws(()=>domainOps.parseArgs(['list-verified','unexpected.example']),{code:'USAGE'});
});
