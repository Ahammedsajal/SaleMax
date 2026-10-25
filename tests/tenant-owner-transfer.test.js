'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const transfer=require('../modules/platform/tenant-owner-transfer');

const actor={audience:'platform',identity:{id:'00000000-0000-4000-8000-000000000001'},membership:{role:'super_admin',status:'active'},mfaVerified:true,recentlyAuthenticated:true};
const tenantId='00000000-0000-4000-8000-000000000002';
const owner={legacyUserId:29,uid:'stable-business-root-uid',membershipId:'00000000-0000-4000-8000-000000000003',identityId:'00000000-0000-4000-8000-000000000004'};
const tables=['sx_tenants','sx_identities','sx_memberships','sx_legacy_ownership','sx_sessions','sx_audit_events','sx_tenant_owner_transfers','user','agents'];
const digest=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');

test('tenant owner transfer requires a recent MFA-authenticated Super Admin and bounded reason',async()=>{
  const db={query(){throw new Error('must reject before storage access');}};
  await assert.rejects(transfer.create(db,{...actor,membership:{role:'platform_admin',status:'active'}},tenantId,{email:'new@example.invalid',reason:'Owner retirement'}),{code:'PERMISSION_DENIED'});
  await assert.rejects(transfer.create(db,{...actor,recentlyAuthenticated:false},tenantId,{email:'new@example.invalid',reason:'Owner retirement'}),{code:'RECENT_MFA_REQUIRED'});
  await assert.rejects(transfer.create(db,actor,tenantId,{email:'new@example.invalid',reason:'short'}),{code:'INVALID_REASON'});
  await assert.rejects(transfer.create(db,actor,tenantId,{email:'new@example.invalid',reason:'Owner transfer for business continuity',tenantId:'attacker'}),{code:'INVALID_OWNER_TRANSFER'});
  await assert.rejects(transfer.accept(db,{token:'bad',name:'New Owner',password:'very-long-password'}),{code:'TRANSFER_INVALID'});
});

test('owner transfer invitation stores only a token digest and records the stable tenant legacy root',async()=>{
  let committed=false;const writes=[];
  const db={async beginTransaction(){},async commit(){committed=true;},async rollback(){},async query(sql,args=[]){
    if(sql.includes('information_schema.TABLES'))return [tables.map(TABLE_NAME=>({TABLE_NAME,ENGINE:'InnoDB'}))];
    if(sql.startsWith('SELECT id,status FROM sx_tenants'))return [[{id:tenantId,status:'active'}]];
    if(sql.includes("o.source_table='user'"))return [[{...owner,email:'owner@example.invalid',role:'owner',identityStatus:'active',legacyUidHash:digest(owner.uid)}]];
    if(sql.includes('SELECT id FROM sx_identities'))return [[]];
    if(sql.includes('SELECT id FROM user WHERE LOWER(email)'))return [[]];
    if(sql.includes('SELECT id FROM agents'))return [[]];
    writes.push({sql,args});return [{affectedRows:1,insertId:1}];
  }};
  const result=await transfer.create(db,actor,tenantId,{email:' Successor@Example.invalid ',reason:'Owner retirement and approved handover.'});
  assert.equal(committed,true);assert.equal(result.email,'successor@example.invalid');assert.match(result.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(result.status,'pending');
  assert.ok(writes.some(item=>item.sql.includes("SET status='expired'")&&item.sql.includes('expires_at<=UTC_TIMESTAMP(3)')));
  const insert=writes.find(item=>item.sql.includes('INSERT INTO sx_tenant_owner_transfers'));
  assert.ok(insert);assert.equal(insert.args[2],owner.legacyUserId);assert.equal(insert.args[3],digest(owner.uid));assert.notEqual(insert.args[7],result.token);assert.equal(insert.args[7],digest(result.token));
  assert.ok(writes.some(item=>item.args[3]==='tenant.owner-transfer.invited'));
});

test('acceptance swaps only the owner membership and legacy credentials while preserving the business UID',async()=>{
  const token=crypto.randomBytes(32).toString('base64url'),writes=[];let committed=false;
  const db={async beginTransaction(){},async commit(){committed=true;},async rollback(){},async query(sql,args=[]){
    if(sql.includes('information_schema.TABLES'))return [tables.map(TABLE_NAME=>({TABLE_NAME,ENGINE:'InnoDB'}))];
    if(sql.includes('FROM sx_tenant_owner_transfers WHERE token_hash'))return [[{id:'00000000-0000-4000-8000-000000000005',tenantId,legacyUserId:owner.legacyUserId,legacyUidHash:digest(owner.uid),priorIdentityId:owner.identityId,priorMembershipId:owner.membershipId,recipientEmail:'successor@example.invalid',status:'pending',validNow:1,reason:'Owner retirement and approved handover.'}]];
    if(sql.startsWith('SELECT status FROM sx_tenants'))return [[{status:'active'}]];
    if(sql.includes('SELECT id FROM sx_identities'))return [[]];
    if(sql.includes('SELECT id FROM user WHERE LOWER(email)'))return [[]];
    if(sql.includes('SELECT id FROM agents'))return [[]];
    if(sql.includes('FROM user u JOIN sx_legacy_ownership'))return [[{legacyUserId:owner.legacyUserId,uid:owner.uid,membershipId:owner.membershipId,identityId:owner.identityId,role:'owner',membershipStatus:'active',identityStatus:'active',legacyUidHash:digest(owner.uid)}]];
    writes.push({sql,args});
    if(sql.startsWith("UPDATE sx_memberships SET status='inactive'"))return [{affectedRows:1}];
    if(sql.startsWith('UPDATE sx_legacy_ownership SET membership_id='))return [{affectedRows:1}];
    if(sql.startsWith('UPDATE user SET name=?,email=?,password=?'))return [{affectedRows:1}];
    return [{affectedRows:1,insertId:1}];
  }};
  const result=await transfer.accept(db,{token,name:'Successor Owner',password:'private-successor-password-2026'});
  assert.equal(committed,true);assert.equal(result.status,'accepted');assert.equal(result.email,'successor@example.invalid');assert.equal(result.loginPath,'/user/login');
  const oldMember=writes.find(item=>item.sql.startsWith("UPDATE sx_memberships SET status='inactive'"));
  const newMembership=writes.find(item=>item.sql.startsWith("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status)"));
  const rootRemap=writes.find(item=>item.sql.startsWith('UPDATE sx_legacy_ownership SET membership_id='));
  const legacyCredential=writes.find(item=>item.sql.startsWith('UPDATE user SET name=?,email=?,password=?'));
  assert.ok(oldMember&&newMembership&&rootRemap&&legacyCredential);
  assert.equal(rootRemap.args[3],tenantId);assert.equal(rootRemap.args[4],owner.membershipId);assert.equal(rootRemap.args[2],String(owner.legacyUserId));
  assert.equal(legacyCredential.args[3],owner.legacyUserId);assert.equal(legacyCredential.args[4],owner.uid);
  assert.ok(writes.some(item=>item.sql.startsWith('UPDATE sx_sessions SET revoked_at=')));
  assert.ok(writes.some(item=>item.args[3]==='tenant.owner-transfer.accepted'));
  assert.ok(writes.findIndex(item=>item.sql.startsWith("UPDATE sx_memberships SET status='inactive'"))<writes.findIndex(item=>item.sql.startsWith("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status)")));
});

test('owner transfer schema preserves one pending recipient and binds prior and new owners to tenant memberships',()=>{
  const migration=fs.readFileSync(path.join(__dirname,'../database/migrations/20270107_tenant_owner_transfers.sql'),'utf8');
  assert.match(migration,/UNIQUE KEY uq_sx_owner_transfer_token/);
  assert.match(migration,/UNIQUE KEY uq_sx_pending_owner_transfer_email \(tenant_id,reserved_recipient_email\)/);
  assert.match(migration,/FOREIGN KEY \(tenant_id,prior_membership_id,prior_identity_id\) REFERENCES sx_memberships/);
  assert.match(migration,/FOREIGN KEY \(tenant_id,new_membership_id,new_identity_id\) REFERENCES sx_memberships/);
  assert.match(migration,/status ENUM\('pending','accepted','cancelled','expired'\)/);
  assert.doesNotMatch(migration,/token\s+VARCHAR/i);
});

test('acceptance aborts if the prior owner membership changed after invitation validation',async()=>{
  const token=crypto.randomBytes(32).toString('base64url');let rolledBack=false,committed=false;
  const db={async beginTransaction(){},async commit(){committed=true;},async rollback(){rolledBack=true;},async query(sql){
    if(sql.includes('information_schema.TABLES'))return [tables.map(TABLE_NAME=>({TABLE_NAME,ENGINE:'InnoDB'}))];
    if(sql.includes('FROM sx_tenant_owner_transfers WHERE token_hash'))return [[{id:'00000000-0000-4000-8000-000000000005',tenantId,legacyUserId:owner.legacyUserId,legacyUidHash:digest(owner.uid),priorIdentityId:owner.identityId,priorMembershipId:owner.membershipId,recipientEmail:'successor@example.invalid',status:'pending',validNow:1,reason:'Owner retirement and approved handover.'}]];
    if(sql.startsWith('SELECT status FROM sx_tenants'))return [[{status:'active'}]];
    if(sql.includes('SELECT id FROM sx_identities')||sql.includes('SELECT id FROM user WHERE LOWER(email)')||sql.includes('SELECT id FROM agents'))return [[]];
    if(sql.includes('FROM user u JOIN sx_legacy_ownership'))return [[{legacyUserId:owner.legacyUserId,uid:owner.uid,membershipId:owner.membershipId,identityId:owner.identityId,role:'owner',membershipStatus:'active',identityStatus:'active',legacyUidHash:digest(owner.uid)}]];
    if(sql.startsWith("UPDATE sx_memberships SET status='inactive'"))return [{affectedRows:0}];
    throw new Error(`unexpected query: ${sql}`);
  }};
  await assert.rejects(transfer.accept(db,{token,name:'Successor Owner',password:'private-successor-password-2026'}),{code:'TRANSFER_INVALID'});
  assert.equal(rolledBack,true);assert.equal(committed,false);
});
