'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {accountSession}=require('../modules/platform/team-invitations');
const {assertDelegatedSession}=require('../modules/platform/delegated-account-session');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const tenant='11111111-1111-4111-8111-111111111111',memberId='22222222-2222-4222-8222-222222222222';
function fixture({ownerRole='owner',target=[]}={}){
  const writes=[];let committed=false,rolledBack=false;
  const db={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{rolledBack=true;},release:()=>{},query:async(sql,args)=>{
    if(sql.includes('FROM user u JOIN sx_legacy_ownership'))return [[{uid:'owner',uidHash:hash('owner'),tenantId:tenant,membershipId:memberId,identityId:'owner-id',role:ownerRole,membershipStatus:'active',identityStatus:'active',tenantStatus:'active',categoryKey:'training_center',categoryVersion:1}]];
    if(sql.includes('SELECT id,status,category_key'))return [[{id:tenant,status:'active'}]];
    if(sql.includes('FROM sx_plan_assignments'))return [[{id:tenant,status:'active',current_period:1,role_limits:JSON.stringify({owner:1,accountant:2,manager:2,agent:3}),capabilities:JSON.stringify(['team.members']),category_key:'training_center',category_version:1}]];
    if(sql.includes('FROM sx_memberships m JOIN sx_identities')){assert.equal(args[0],tenant);return [target];}
    writes.push({sql,args});return [{affectedRows:1}];
  }};
  return {pool:{getConnection:async()=>db},writes,state:()=>({committed,rolledBack})};
}
test('owner login issues short staff credentials and audits without changing passwords',async()=>{
  const f=fixture({target:[{id:memberId,identityId:'staff',role:'manager',uid:'staff',uidHash:hash('staff'),email:'staff@example.test',password:'synthetic-hash',credentialVersion:2}]});
  const result=await accountSession(f.pool,'owner',memberId,{jwtKey:'synthetic-test-key'});
  const claims=require('jsonwebtoken').verify(result.token,'synthetic-test-key');
  assert.equal(claims.uid,'staff');assert.equal(claims.exp-claims.iat,1800);assert.equal(claims.delegatedSessionId,result.sessionId);
  assert.equal(result.expiresInSeconds,1800);assert.equal(f.state().committed,true);
  assert.equal(f.writes.some(x=>/UPDATE.*password/.test(x.sql)),false);
  assert.equal(f.writes.filter(x=>x.sql.includes('INSERT INTO sx_audit_events')).length,1);
});
test('staff cannot impersonate and foreign/inactive/unlinked members fail closed',async()=>{
  for(const opts of [{ownerRole:'manager'},{target:[]},{target:[{role:'owner',uid:'staff',uidHash:hash('staff')}]},{target:[{role:'manager',uid:'staff',uidHash:'wrong'}]}]){
    const f=fixture(opts);await assert.rejects(accountSession(f.pool,'owner',memberId,{jwtKey:'synthetic-test-key'}));
    assert.equal(f.state().rolledBack,true);assert.equal(f.writes.length,0);
  }
});
test('delegated HTTP/socket access rejects expiry, revocation and missing binding',async()=>{
  const claims={delegatedSessionId:memberId,exp:Date.now()/1000+60,uid:'staff',email:'staff@example.test',password:'hash'};
  await assertDelegatedSession(async()=>[{id:memberId}],claims);
  await assert.rejects(assertDelegatedSession(async()=>[],claims));
  await assert.rejects(assertDelegatedSession(async()=>[{id:memberId}],{...claims,exp:1}));
  await assertDelegatedSession(()=>{throw new Error('ordinary sessions must stay unchanged');},{uid:'owner'});
});
test('return revokes only the owner audited delegated session and creates owner session',async()=>{
  const f=fixture({target:[{id:memberId,identityId:'owner-id',role:'owner',uid:'owner',uidHash:hash('owner'),email:'owner@example.test',credentialVersion:1}]});
  const result=await accountSession(f.pool,'owner',null,{jwtKey:'synthetic-test-key',returning:true,sessionId:memberId});
  assert.equal(result.token,null);assert.equal(result.expiresInSeconds,28800);
  const revoke=f.writes.find(x=>x.sql.includes('UPDATE sx_sessions'));
  assert.deepEqual(revoke.args,[memberId,tenant,'owner-id']);assert.match(revoke.sql,/team.account-login/);
});

