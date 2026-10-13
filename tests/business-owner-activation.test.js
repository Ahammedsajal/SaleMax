'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const activation=require('../modules/platform/business-owner-activation');

test('business owner invitation requires platform category and tenant provisioning authority before storage access',async()=>{
  const db={query(){throw new Error('storage must not be read')}};
  await assert.rejects(activation.create(db,{audience:'tenant',identity:{id:'00000000-0000-4000-8000-000000000001'},membership:{role:'owner'}},1),{code:'PERMISSION_DENIED'});
  await assert.rejects(activation.create(db,{audience:'platform',identity:{id:'00000000-0000-4000-8000-000000000001'},membership:{role:'staff',delegatedPermissions:[]}},1),{code:'PERMISSION_DENIED'});
});

test('business owner activation rejects malformed links and weak or oversized passwords before database access',async()=>{
  const db={query(){throw new Error('storage must not be read')}};
  await assert.rejects(activation.accept(db,{token:'bad',name:'SaleMaX Owner',password:'long-enough-password'}),{code:'INVITE_INVALID'});
  await assert.rejects(activation.accept(db,{token:'A'.repeat(43),name:'SaleMaX Owner',password:'short'}),{code:'INVALID_PASSWORD'});
  await assert.rejects(activation.accept(db,{token:'A'.repeat(43),name:'SaleMaX Owner',password:'🙂'.repeat(20)}),{code:'INVALID_PASSWORD'});
  await assert.rejects(activation.accept(db,{token:'A'.repeat(43),name:'x',password:'long-enough-password'}),{code:'INVALID_DISPLAY_NAME'});
});

test('owner activation stores a token digest and activates the same owner identity and legacy login atomically',async()=>{
  const actor={audience:'platform',identity:{id:'00000000-0000-4000-8000-000000000001'},membership:{role:'super_admin',status:'active'},mfaVerified:true,recentlyAuthenticated:true};
  const tables=['sx_business_owner_invites','sx_tenants','sx_identities','sx_memberships','sx_legacy_ownership','sx_audit_events','user'];
  const writes=[];let transaction=false;
  const db={
    async beginTransaction(){transaction=true;},async commit(){transaction=false;},async rollback(){transaction=false;},
    async query(sql,args=[]){
      if(sql.includes('information_schema.TABLES'))return [tables.map(TABLE_NAME=>({TABLE_NAME,ENGINE:'InnoDB'}))];
      if(sql.includes('SELECT u.id AS userId'))return [[{userId:27,email:'admin@salemax.qa',uid:'legacy-owner-uid',tenantId:'tenant-1',membershipId:'membership-1',identityId:'identity-1',role:'owner',membershipStatus:'active',identityStatus:'active',passwordHash:null,tenantStatus:'active',categoryKey:'salemax_sales'}]];
      if(sql.includes('SELECT id,uid FROM user'))return [[{id:27,uid:'legacy-owner-uid'}]];
      if(sql.includes('SELECT id FROM user WHERE uid='))return [[{id:27}]];
      if(sql.includes('SELECT v.id,v.tenant_id AS tenantId'))return [[{id:'invite-1',tenantId:'tenant-1',identityId:'identity-1',legacyUserId:27,status:'pending',email:'admin@salemax.qa',legacyEmail:'admin@salemax.qa',currentPasswordHash:null,identityStatus:'active',membershipStatus:'active',role:'owner',tenantStatus:'active',categoryKey:'salemax_sales',uid:'legacy-owner-uid'}]];
      writes.push({sql,args});
      if(sql.startsWith('UPDATE user SET name=?,password=?'))return [{affectedRows:1}];
      if(sql.startsWith("UPDATE sx_identities SET display_name=?"))return [{affectedRows:1}];
      return [{affectedRows:1,insertId:1}];
    }
  };
  const created=await activation.create(db,actor,27);
  assert.match(created.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(created.email,'admin@salemax.qa');assert.equal(created.expiresInHours,72);assert.equal(transaction,false);
  const inviteInsert=writes.find(item=>item.sql.includes('INSERT INTO sx_business_owner_invites'));
  assert.ok(inviteInsert);assert.notEqual(inviteInsert.args[4],created.token);assert.match(inviteInsert.args[4],/^[a-f0-9]{64}$/);
  writes.length=0;
  const accepted=await activation.accept(db,{token:created.token,name:'SaleMaX Owner',password:'private-owner-password'});
  assert.equal(accepted.status,'accepted');assert.equal(accepted.email,'admin@salemax.qa');assert.equal(accepted.loginPath,'/user/login');assert.equal(transaction,false);
  assert.ok(writes.some(item=>item.sql.startsWith('UPDATE user SET name=?,password=?')));
  assert.ok(writes.some(item=>item.sql.startsWith('UPDATE sx_identities SET display_name=?')));
  assert.ok(writes.some(item=>item.sql.includes("status='accepted'")));
  assert.ok(writes.some(item=>item.args[2]==='business.owner-invite-accepted'));
});

test('owner activation is integrated in existing Manage Users and business sign-in flows',()=>{
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'client/public/index.html'),'utf8');
  const capture=fs.readFileSync(path.join(root,'client/public/team-invite-capture.js'),'utf8');
  const team=fs.readFileSync(path.join(root,'client/public/team-invitations.js'),'utf8');
  const users=fs.readFileSync(path.join(root,'client/public/admin-user-plans.js'),'utf8');
  const router=fs.readFileSync(path.join(root,'modules/platform/existing-business-router.js'),'utf8');
  const service=fs.readFileSync(path.join(root,'modules/platform/business-owner-activation.js'),'utf8');
  const migration=fs.readFileSync(path.join(root,'database/migrations/20261117_sales_owner_activation.sql'),'utf8');
  assert.match(html,/team-invite-capture\.js\?v=20261013-owner-setup1/);
  assert.match(capture,/business-owner-setup/);
  assert.match(team,/business-owner\/accept/);
  assert.match(team,/\/user\/login/);
  assert.match(users,/owner-activation/);
  assert.match(router,/ownerActivation\.create/);
  assert.match(service,/admin@salemax\.qa/);
  assert.match(service,/token_hash/);
  assert.match(migration,/UNIQUE KEY uq_sx_business_owner_invite_token/);
  assert.doesNotMatch(migration,/token\s+VARCHAR/i);
});
