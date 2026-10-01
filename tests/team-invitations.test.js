'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const team=require('../modules/platform/team-invitations');
test('team invitation inputs are bounded and only agents can be onboarded',()=>{
  assert.equal(team.email('  Agent@Example.QA '),'agent@example.qa');
  for(const value of ['',null,'bad','a'.repeat(250)+'@example.qa'])assert.throws(()=>team.email(value),{code:'INVALID_EMAIL'});
  assert.equal(team.role('agent'),'agent');
  for(const value of ['owner','accountant','manager',null])assert.throws(()=>team.role(value),{code:'ROLE_ONBOARDING_UNAVAILABLE'});
});
test('invalid invitation requests fail before acquiring a database connection',async()=>{
  const pool={getConnection(){throw new Error('must not connect')}};
  await assert.rejects(team.create(pool,'owner',{email:'bad',role:'agent',requestKey:'not-a-uuid'}),{code:'INVALID_EMAIL'});
  await assert.rejects(team.create(pool,'owner',{email:'agent@example.qa',role:'manager',requestKey:'00000000-0000-4000-8000-000000000000'}),{code:'ROLE_ONBOARDING_UNAVAILABLE'});
  await assert.rejects(team.accept(pool,{token:'bad'}),{code:'INVITE_INVALID'});
  await assert.rejects(team.accept(pool,{token:'A'.repeat(43),displayName:'Agent',mobile:'+97450123456',password:'short'}),{code:'INVALID_PASSWORD'});
});
test('agent invitation UI is integrated into the existing single SaleMaX app shell',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../client/public/team-invitations.js'),'utf8');
  assert.match(html,/team-invitations\.js\?v=/);assert.ok(html.indexOf('team-invite-capture.js')<html.indexOf('main.73648acf.js'));assert.match(html,/team-invite-capture\.js\?v=/);
  assert.match(js,/\/user\?page=team-invitations/);
  assert.match(js,/\/user\?page=team-invitations#team-invite=/);assert.match(js,/dataset\.accept='1'/);
  assert.match(js,/\/api\/user\/team-invitations\//);
  assert.match(js,/\/api\/agent\/invitations\/accept/);
  assert.match(js,/Team invitations/);assert.match(js,/دعوات الفريق/);
  assert.match(js,/Copy link/);assert.match(js,/Rotate|Create new link/);
});
