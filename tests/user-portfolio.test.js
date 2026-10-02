'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const portfolio=require('../modules/platform/user-portfolio');
const owner={audience:'platform',identity:{id:'owner-id'},membership:{role:'super_admin',status:'active'}};
const admin={audience:'platform',identity:{id:'admin-a'},membership:{role:'platform_admin',status:'active'}};
const staff={audience:'platform',identity:{id:'staff-a'},membership:{role:'staff',status:'active',reportsToIdentityId:'admin-a'}};
test('Super Admin sees every customer while delegated Admins see only explicitly managed customers',async()=>{
  const db={query:async(sql,args)=>sql.includes('SELECT legacy_user_id')?[[{id:10}],[]]:args[1]==='admin-a'&&Number(args[0])===10?[[{allowed:1}],[]]:[[],[]]};
  assert.equal(await portfolio.canAccess(db,owner,999),true);
  assert.equal(await portfolio.canAccess(db,admin,10),true);
  assert.equal(await portfolio.canAccess(db,admin,11),false);
  assert.deepEqual(await portfolio.accessibleUserIds(db,admin),[10]);
  await assert.rejects(portfolio.requireAccess(db,admin,11),{code:'PORTFOLIO_ACCESS_DENIED'});
});
test('Staff inherit their Admin portfolio; standalone staff use only their directly assigned portfolio',()=>{
  assert.equal(portfolio.portfolioIdentity(staff),'admin-a');
  assert.equal(portfolio.portfolioIdentity({...staff,membership:{role:'staff',status:'active'}}),'staff-a');
});
test('Super Admin-created customers are private until assigned',async()=>{
  const calls=[];const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM sx_platform_user_portfolios'))return [[],[]];return [[],[]];}};
  await portfolio.recordCreated(db,owner,44);
  assert.deepEqual(calls[0].args,[44,null,'owner-id','super_admin_created']);
  assert.equal(await portfolio.canAccess(db,admin,44),false);
});
test('portfolio reassignment is Super Admin-only and audited without customer PII',async()=>{
  const calls=[];const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM sx_platform_memberships p'))return [[{role:'platform_admin',status:'active',identity_status:'active'}],[]];if(sql.includes('FROM user WHERE'))return [[{id:10}],[]];if(sql.includes('FOR UPDATE'))return [[{managed_by_identity_id:'admin-old',source:'admin_created'}],[]];return [{affectedRows:1},[]];}};
  const result=await portfolio.assign(db,owner,10,'admin-new');
  assert.deepEqual(result,{userId:10,managedByIdentityId:'admin-new'});
  const audit=calls.find(call=>call.sql.includes("'platform.user-assigned'"));
  assert.ok(audit);assert.equal(audit.args[2],'10');assert.deepEqual(JSON.parse(audit.args[3]),{fromAdminIdentityId:'admin-old',toAdminIdentityId:'admin-new'});
  await assert.rejects(portfolio.assign(db,admin,10,'admin-new'),{code:'PERMISSION_DENIED'});
});
test('existing Manage Users rows expose the audited Super Admin portfolio assignment control',()=>{
  const screen=fs.readFileSync(path.join(__dirname,'../client/public/admin-user-plans.js'),'utf8');
  assert.match(screen,/Assign Admin/);
  assert.match(screen,/platform-access\/portfolios/);
  assert.match(screen,/method:'PUT'/);
  assert.match(screen,/Private to Super Admin/);
});
