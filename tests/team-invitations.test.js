'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const team=require('../modules/platform/team-invitations');

test('team invitation inputs are bounded to tenant staff roles',()=>{
  assert.equal(team.email('  Agent@Example.QA '),'agent@example.qa');
  for(const value of ['',null,'bad','a'.repeat(250)+'@example.qa'])assert.throws(()=>team.email(value),{code:'INVALID_EMAIL'});
  for(const value of ['agent','accountant','manager'])assert.equal(team.role(value),value);
  for(const value of ['owner','super_admin',null])assert.throws(()=>team.role(value),{code:'INVALID_ROLE'});
  const plan={capabilities:['messaging.inbox','team.members']};
  const category={capabilities:['messaging.inbox','team.members']};
  const allowed=team.permissionsFor('agent',category,plan);
  assert.ok(allowed.includes('conversations.read'));
  assert.ok(!allowed.includes('channels.configure'));
  assert.throws(()=>team.rolePermissions(['tenant.manage'],'agent',allowed),{code:'INVALID_ROLE_PERMISSIONS'});
});

test('Team Access route honors granted role and member navigation without category redirects',()=>{
  const sidebar=fs.readFileSync(path.join(__dirname,'../client/public/training-sidebar.js'),'utf8');
  assert.match(sidebar,/if\(\(assignedNavigation!==null&&required&&!assignedNavigation\.has\(required\)\)\|\|\(roleNavigation!==null&&required&&!roleNavigation\.has\(required\)\)\)location\.replace/);
  assert.doesNotMatch(sidebar,/page==='team-invitations'.*membershipRole/);
});

test('member role assignment only accepts an active role profile for the member seat',()=>{
  assert.equal(team.memberRoleProfileId('agent',null),null);
  assert.equal(team.memberRoleProfileId('agent',{id:'role-agent',seatRole:'agent',status:'active'}),'role-agent');
  assert.throws(()=>team.memberRoleProfileId('agent',{id:'role-manager',seatRole:'manager',status:'active'}),{code:'INVALID_ROLE'});
  assert.throws(()=>team.memberRoleProfileId('agent',{id:'role-agent',seatRole:'agent',status:'archived'}),{code:'ROLE_NOT_FOUND'});
});

test('invalid invitation requests fail before acquiring a database connection',async()=>{
  const pool={getConnection(){throw new Error('must not connect')}};
  await assert.rejects(team.create(pool,'owner',{email:'bad',role:'agent',requestKey:'not-a-uuid'}),{code:'INVALID_EMAIL'});
  await assert.rejects(team.create(pool,'owner',{email:'agent@example.qa',role:'super_admin',requestKey:'00000000-0000-4000-8000-000000000000'}),{code:'INVALID_ROLE'});
  await assert.rejects(team.accept(pool,{token:'bad'}),{code:'INVITE_INVALID'});
  await assert.rejects(team.accept(pool,{token:'A'.repeat(43),displayName:'Agent',mobile:'+97450123456',password:'short'}),{code:'INVALID_PASSWORD'});
  const direct={email:'staff@example.qa',role:'manager',requestKey:'00000000-0000-4000-8000-000000000000',displayName:'Staff'};
  for(const temporaryPassword of ['short','🙂'.repeat(20),null])await assert.rejects(team.create(pool,'owner',{...direct,temporaryPassword}),{code:'INVALID_PASSWORD'});
  await assert.rejects(team.create(pool,'owner',{...direct,temporaryPassword:'Initial-password-73',displayName:''}),{code:'INVALID_DISPLAY_NAME'});
  await assert.rejects(team.create(pool,'owner',{...direct,temporaryPassword:'Initial-password-73',mobile:'123'}),{code:'INVALID_MOBILE'});
});

test('direct account mobile validation accepts presentation formatting and rejects invalid numbers',async()=>{
  const pool={getConnection(){throw Object.assign(new Error('VALIDATED_INPUT'),{code:'VALIDATED_INPUT'});}};
  const input={email:'staff@example.invalid',role:'manager',requestKey:'00000000-0000-4000-8000-000000000000',displayName:'Synthetic staff',temporaryPassword:'Synthetic-Password-123'};
  for(const mobile of ['+97450123456','+974 5012 3456','+974 (5012)-3456','+974.5012.3456'])await assert.rejects(team.create(pool,'owner',{...input,mobile}),{code:'VALIDATED_INPUT'});
  for(const mobile of ['97450123456','+974abc50123456','+00012345678','+974/50123456'])await assert.rejects(team.create(pool,'owner',{...input,mobile}),{code:'INVALID_MOBILE'});
});

test('staff invitation UI is integrated into the existing single SaleMaX app shell',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../client/public/team-invitations.js'),'utf8');
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/team-invitation-router.js'),'utf8');
  assert.match(html,/team-invitations\.js\?v=/);assert.ok(html.indexOf('team-invite-capture.js')<html.indexOf('main.73648acf.js'));
  assert.match(html,/team-invite-capture\.js\?v=/);assert.match(js,/\/user\?page=team-invitations/);
  assert.match(js,/\/user\?page=team-invitations#team-invite=/);assert.match(js,/dataset\.accept = '1'/);
  assert.match(js,/\/api\/user\/team-invitations\//);assert.match(js,/\/api\/agent\/invitations\/accept/);
  assert.match(js,/\/api\/agent\/invitations\/preview\//);assert.match(js,/Team access/);assert.match(js,/إدارة وصول الفريق/);
  assert.match(js,/accountant/);assert.match(js,/manager/);assert.match(js,/seat-grid/);assert.match(js,/business sign in/);
  assert.match(js,/Copy link/);assert.match(js,/Create new link/);assert.match(js,/Agent seats/);assert.match(js,/مقاعد الوكلاء/);
  assert.match(js,/Pending/);assert.match(js,/معلق/);
  assert.match(js,/Roles & permissions/);assert.match(js,/الأدوار والصلاحيات/);assert.match(js,/Sidebar screens and actions/);
  assert.match(js,/<details class="permission-category"/);assert.match(js,/data-permission-count/);assert.match(js,/target\.onchange=event=>/);
  assert.match(js,/<details class="nav-category">/);assert.match(js,/data-nav-count/);assert.match(js,/element\.onchange=event=>/);
  assert.match(js,/localStorage\.getItem\('salemax-language'\)/);assert.match(js,/\.startsWith\('ar'\)/);
  assert.match(js,/roleProfileId/);assert.match(js,/Permissions are enforced by the server/);
  assert.match(js,/<button type="submit" class="primary" disabled>/);assert.match(js,/button\.disabled = false/);
  assert.match(html,/team-invitations\.js\?v=[^" ]+/);
  assert.match(html,/team-access\.css\?v=[^" ]+/);
  assert.match(html,/training-sidebar\.js\?v=[^" ]+/);
  assert.match(js,/new MutationObserver\(addNav\)/);
  assert.match(js,/data-member-role/);assert.match(js,/members\/.*\/role/);assert.match(router,/owner\.put\('\/members\/:id\/role'/);
  assert.match(js,/permissionCatalog/);assert.match(js,/name="permission"/);
  assert.match(js,/data-qr-recipient/);assert.match(js,/recipientMembershipIds/);assert.match(js,/active accountants and agents/);
  for(const feature of ['data-team-tab','data-team-panel','sx-team-stats','sx-member-search','sx-role-filter','Organisation hierarchy','sx-invite-dialog','sx-role-dialog','data-edit-member'])assert.ok(js.includes(feature),`missing redesigned Team Access feature ${feature}`);
  assert.match(router,/qrChannels\.saveAccess/);
});
