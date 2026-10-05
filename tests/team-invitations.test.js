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
});

test('invalid invitation requests fail before acquiring a database connection',async()=>{
  const pool={getConnection(){throw new Error('must not connect')}};
  await assert.rejects(team.create(pool,'owner',{email:'bad',role:'agent',requestKey:'not-a-uuid'}),{code:'INVALID_EMAIL'});
  await assert.rejects(team.create(pool,'owner',{email:'agent@example.qa',role:'super_admin',requestKey:'00000000-0000-4000-8000-000000000000'}),{code:'INVALID_ROLE'});
  await assert.rejects(team.accept(pool,{token:'bad'}),{code:'INVITE_INVALID'});
  await assert.rejects(team.accept(pool,{token:'A'.repeat(43),displayName:'Agent',mobile:'+97450123456',password:'short'}),{code:'INVALID_PASSWORD'});
});

test('staff invitation UI is integrated into the existing single SaleMaX app shell',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../client/public/team-invitations.js'),'utf8');
  assert.match(html,/team-invitations\.js\?v=/);assert.ok(html.indexOf('team-invite-capture.js')<html.indexOf('main.73648acf.js'));
  assert.match(html,/team-invite-capture\.js\?v=/);assert.match(js,/\/user\?page=team-invitations/);
  assert.match(js,/\/user\?page=team-invitations#team-invite=/);assert.match(js,/dataset\.accept = '1'/);
  assert.match(js,/\/api\/user\/team-invitations\//);assert.match(js,/\/api\/agent\/invitations\/accept/);
  assert.match(js,/\/api\/agent\/invitations\/preview\//);assert.match(js,/Team access/);assert.match(js,/إدارة وصول الفريق/);
  assert.match(js,/accountant/);assert.match(js,/manager/);assert.match(js,/seat-grid/);assert.match(js,/business sign in/);
  assert.match(js,/Copy link/);assert.match(js,/Create new link/);assert.match(js,/Agent seats/);assert.match(js,/مقاعد الوكلاء/);
  assert.match(js,/Pending/);assert.match(js,/معلق/);assert.match(js,/available\.size === 0/);
  assert.match(js,/<button type="submit" class="primary" disabled>/);assert.match(js,/button\.disabled = false/);
  assert.match(html,/team-invitations\.js\?v=20261102-navigation1/);
  assert.match(js,/new MutationObserver\(addNav\)/);
});
