'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const email=require('../modules/platform/email-marketing');
const migration=require('../database/migration-runner');

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const target='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const domainId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const identity='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ctx={tenantId:owner,identityId:identity,context:{audience:'tenant',tenant:{id:owner,status:'active',categoryKey:'7network_sales',categoryVersion:1},
  membership:{id:'membership',tenantId:owner,role:'owner',status:'active'},category:{key:'7network_sales',version:1,capabilities:['email.marketing']},subscription:{status:'active',capabilities:[]},runtimeReady:{}}};

test('shared sender migration parses into non-destructive statements and relaxes only the domain FK',()=>{
  const sql=fs.readFileSync('database/migrations/20270213_email_sender_domain_shares.sql','utf8');
  const statements=migration.splitSql(sql);
  assert.equal(statements.length,3);
  assert.match(statements[0],/CREATE TABLE sx_email_sender_domain_shares/);
  assert.match(statements[0],/sender_email/);
  assert.match(statements[0],/status ENUM\('active','revoked'\)/);
  assert.match(statements[1],/DROP FOREIGN KEY fk_sx_email_sender_domain/);
  assert.match(statements[2],/FOREIGN KEY \(domain_id\) REFERENCES sx_email_sender_domains\(id\)/);
  assert.doesNotMatch(sql,/\bDROP\s+TABLE\b/i);
});

test('only a verified sender is granted to an active destination workspace owner',async()=>{
  const calls=[];
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('SELECT id,tenant_id,domain FROM sx_email_sender_domains'))return [[{id:domainId,tenant_id:owner,domain:'7network.space'}]];
    if(sql.includes('SELECT id FROM sx_email_senders WHERE tenant_id=? AND domain_id=? AND email=?'))return [[{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}]];
    if(sql.includes('FROM sx_identities i JOIN sx_memberships'))return [[{tenantId:target}]];
    if(sql.includes('SELECT id,domain_id AS domainId FROM sx_email_senders'))return [[]];
    return [{affectedRows:1}];
  }};
  const result=await email.shareSenderDomain(db,ctx,domainId,{workspaceEmail:'sales@7network.live',senderEmail:'connect@7network.space'});
  assert.deepEqual(result,{shared:true,domainId,workspaceEmail:'sales@7network.live',senderEmail:'connect@7network.space'});
  const grant=calls.find(call=>call.sql.includes('INSERT INTO sx_email_sender_domain_shares'));
  assert.ok(grant);assert.deepEqual(grant.params.slice(1,5),[domainId,owner,target,'connect@7network.space']);
  assert.ok(calls.some(call=>call.sql.includes("VALUES(?,?,?,?, 'verified',?)")));
});

test('unverified senders cannot be shared',async()=>{
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async sql=>{
    if(sql.includes('SELECT id,tenant_id,domain FROM sx_email_sender_domains'))return [[{id:domainId,tenant_id:owner,domain:'7network.space'}]];
    if(sql.includes('SELECT id FROM sx_email_senders WHERE tenant_id=? AND domain_id=? AND email=?'))return [[]];
    throw Error('Unexpected query after sender verification check');
  }};
  await assert.rejects(email.shareSenderDomain(db,ctx,domainId,{workspaceEmail:'sales@7network.live',senderEmail:'connect@7network.space'}),{code:'EMAIL_SENDER_NOT_VERIFIED'});
});
