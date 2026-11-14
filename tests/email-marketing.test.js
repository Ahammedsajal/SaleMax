'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const email=require('../modules/platform/email-marketing');
const ses=require('../modules/platform/email-marketing-ses');
const worker=require('../modules/platform/email-marketing-worker');
const policy=require('../modules/platform/policy');
const navigation=require('../modules/platform/navigation');
const providerSettings=require('../modules/platform/email-marketing-provider-settings');
const emailEvents=require('../modules/platform/email-marketing-events');
const sns=require('../modules/platform/email-marketing-sns');

test('email normalization and domain inputs are bounded',()=>{
  assert.equal(email.normalizeEmail(' Sales@Example.COM '),'sales@example.com');
  assert.equal(email.validEmail('sales@example.com'),true);
  assert.equal(email.validEmail('not-an-email'),false);
  assert.equal(email.cleanDomain(' Example.COM. '),'example.com');
  assert.throws(()=>email.cleanDomain('example..com'),{code:'INVALID_EMAIL_DOMAIN'});
  assert.throws(()=>email.cleanDomain('https://example.com'),{code:'INVALID_EMAIL_DOMAIN'});
  assert.equal(email.cleanRegion('me-south-1'),'me-south-1');
  assert.equal(email.cleanRegion('eu-central-1'),'eu-central-1');
  assert.equal(email.cleanRegion('eu-north-1'),'eu-north-1');
  assert.throws(()=>email.cleanRegion('unknown-1'),{code:'INVALID_SES_REGION'});
});

test('one-click tokens bind to UUID tenant, campaign and recipient scopes',()=>{
  const key=Buffer.alloc(32,7),ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
  const token=email.tokenFor(key,...ids);
  assert.deepEqual(email.decodeToken(key,token),{tenantId:ids[0],campaignId:ids[1],recipientId:ids[2]});
  assert.throws(()=>email.decodeToken(Buffer.alloc(32,8),token),{code:'INVALID_UNSUBSCRIBE_TOKEN'});
  assert.throws(()=>email.decodeToken(key,token.slice(0,-1)+'A'),{code:'INVALID_UNSUBSCRIBE_TOKEN'});
  const malformed=Buffer.from(JSON.stringify(['not-a-uuid',ids[1],ids[2]])).toString('base64url')+'.'+require('node:crypto').createHmac('sha256',key).update(Buffer.from(JSON.stringify(['not-a-uuid',ids[1],ids[2]])).toString('base64url')).digest('base64url');
  assert.throws(()=>email.decodeToken(key,malformed),{code:'INVALID_UNSUBSCRIBE_TOKEN'});
});

test('audience preview requires valid address and explicit consent',()=>{
  const result=email.summarizeAudience([
    {id:1,email:'Sales@Example.com',email_marketing_consent:1},
    {id:2,email:'sales@example.com',email_marketing_consent:1},
    {id:3,email:'',email_marketing_consent:1},
    {id:4,email:'invalid',email_marketing_consent:1},
    {id:5,email:'none@example.com',email_marketing_consent:0},
    {id:6,email:'stop@example.com',email_marketing_consent:1,email_unsubscribed_at:'2026-01-01'},
    {id:7,email:'bounce@example.com',email_marketing_consent:1,suppressed_email:'bounce@example.com'}
  ]);
  assert.deepEqual(result.summary,{total:7,eligible:1,missingEmail:1,invalidEmail:1,noConsent:1,unsubscribed:1,suppressed:1,duplicate:1});
  assert.deepEqual(result.eligible.map(row=>row.normalizedEmail),['sales@example.com']);
  const changed=email.fingerprint([{id:1,email:'sales@example.com',email_marketing_consent:1}])!==email.fingerprint([{id:1,email:'sales@example.com',email_marketing_consent:0}]);
  assert.equal(changed,true);
});

test('attachment validation checks signatures and plain text restrictions',()=>{
  const pdf=email.sniffAttachment('offer.pdf',Buffer.from('%PDF-1.7\n'));
  assert.equal(pdf.contentType,'application/pdf');
  assert.throws(()=>email.sniffAttachment('offer.pdf',Buffer.from('not a pdf')),{code:'ATTACHMENT_CONTENT_INVALID'});
  assert.throws(()=>email.safeFilename('payload.exe'),{code:'ATTACHMENT_TYPE_NOT_ALLOWED'});
  assert.throws(()=>email.sniffAttachment('bad.csv',Buffer.from([0,1,2])),{code:'ATTACHMENT_CONTENT_INVALID'});
});

test('campaign personalization supports only approved Phonebook fields',()=>{
  const text=worker.personalize('Hi {{ name }}, email {{email}}, {{var2}} {{unknown}}',{name:'Mona',email:'mona@example.com',var2:'Doha'});
  assert.equal(text,'Hi Mona, email mona@example.com, Doha {{unknown}}');
});

test('SES quota and account pause failures are retryable provider states',()=>{
  assert.equal(ses.publicCode({name:'DailyMessageQuotaExceeded'}),'SES_DAILY_QUOTA_REACHED');
  assert.equal(ses.publicCode({name:'AccountSendingPausedException'}),'SES_SENDING_DISABLED');
  assert.equal(ses.publicCode({name:'TooManyRequestsException'}),'SES_THROTTLED');
});

test('SES feedback handlers classify recipient events and restrict SNS URLs to the configured AWS region',()=>{
  assert.equal(emailEvents.eventKind({eventType:'Complaint'}),'Complaint');
  assert.equal(emailEvents.suppressionReason({complaint:{}},'Complaint'),'complaint');
  assert.equal(emailEvents.suppressionReason({bounce:{bounceType:'Permanent'}},'Bounce'),'bounce');
  assert.equal(emailEvents.suppressionReason({bounce:{bounceType:'Transient'}},'Bounce'),null);
  assert.equal(sns.trustedSnsUrl('https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-abcdefgh.pem','arn:aws:sns:eu-central-1:123456789012:events',{certificate:true}).hostname,'sns.eu-central-1.amazonaws.com');
  assert.throws(()=>sns.trustedSnsUrl('https://169.254.169.254/latest/meta-data/','arn:aws:sns:eu-central-1:123456789012:events',{certificate:true}),{code:'SNS_URL_UNTRUSTED'});
});

test('email analytics scopes every aggregate and campaign join to the current tenant',async()=>{
  const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const context={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'7network_sales',categoryVersion:1},membership:{id:'member',tenantId,role:'owner',status:'active'},category:{key:'7network_sales',version:1,capabilities:['email.marketing']},subscription:{status:'active',capabilities:[]}};
  const calls=[];const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM sx_email_campaigns WHERE'))return [[{campaigns:1,recipients:3,accepted:3,failed:0,suppressed:0}]];if(sql.includes('FROM sx_email_campaign_recipients'))return [[{accepted:3,failed:0,suppressed:0,unknownCount:0}]];if(sql.includes('FROM sx_email_provider_events WHERE'))return [[{delivered:2,bounced:1,complained:0,opened:1,clicked:1,rejected:0,delayed:0}]];return [[{id:'campaign',name:'Synthetic',recipients:3,delivered:2,opened:1,clicked:1}]];}};
  const result=await email.analytics(db,{context,tenantId},30);
  assert.equal(result.days,30);assert.equal(result.totals.delivered,2);assert.equal(result.campaigns[0].name,'Synthetic');
  assert.equal(calls.length,4);for(const call of calls){assert.equal(call.args[0],tenantId);assert.match(call.sql,/tenant_id/);}
});

test('platform SES credentials are encrypted, authenticated and never returned by status helpers',()=>{
  const key=Buffer.alloc(32,11),secret='EXAMPLE_SECRET_ACCESS_KEY_VALUE';
  const encrypted=providerSettings.encrypt(secret,key,'secret-access-key');
  assert.notEqual(encrypted.ciphertext.toString('utf8'),secret);
  assert.equal(providerSettings.decrypt(encrypted.ciphertext,encrypted.iv,encrypted.tag,key,'secret-access-key'),secret);
  const changed=Buffer.from(encrypted.ciphertext);changed[0]^=1;
  assert.throws(()=>providerSettings.decrypt(changed,encrypted.iv,encrypted.tag,key,'secret-access-key'));
});

test('only an active MFA-authenticated platform super-admin can manage SES credentials',()=>{
  const base={audience:'platform',mfaVerified:true,identity:{id:'identity-id'},membership:{role:'super_admin',status:'active'}};
  assert.equal(providerSettings.superAdmin(base),'identity-id');
  assert.throws(()=>providerSettings.superAdmin({...base,mfaVerified:false}),{code:'PERMISSION_DENIED'});
  assert.throws(()=>providerSettings.superAdmin({...base,membership:{role:'platform_admin',status:'active'}}),{code:'PERMISSION_DENIED'});
});

test('email access is limited to active, entitled owners and managers; optional category access remains explicit',()=>{
  const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const context=role=>({audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'7network_sales',categoryVersion:1},
    membership:{id:'membership',tenantId,role,status:'active'},category:{key:'7network_sales',version:1,capabilities:['email.marketing']},
    subscription:{status:'active',capabilities:[]},runtimeReady:{}});
  for(const role of ['owner','manager']){
    const actor=context(role);
    assert.equal(policy.decision(actor,{capability:'email.marketing',permission:'email.marketing.manage'}).allowed,true);
    assert.ok(navigation.navigationFor(actor).some(item=>item.key==='email'));
  }
  for(const role of ['accountant','team_leader','agent']){
    const actor=context(role);
    assert.equal(policy.decision(actor,{capability:'email.marketing',permission:'email.marketing.manage'}).allowed,false);
    assert.equal(navigation.navigationFor(actor).some(item=>item.key==='email'),false);
  }
  const unassigned=context('manager');unassigned.membership.assignedNavigation=[];
  assert.equal(policy.decision(unassigned,{capability:'email.marketing',permission:'email.marketing.manage'}).allowed,false);
  const otherCategory=context('owner');otherCategory.tenant.categoryKey='training_center';otherCategory.category.key='training_center';
  assert.equal(policy.decision(otherCategory,{capability:'email.marketing',permission:'email.marketing.manage'}).allowed,false);
  otherCategory.category.capabilities.push('email.marketing');otherCategory.subscription.capabilities.push('email.marketing');
  assert.equal(policy.decision(otherCategory,{capability:'email.marketing',permission:'email.marketing.manage'}).allowed,true);
  const disabled={...otherCategory,category:{...otherCategory.category,capabilities:['email.marketing']},subscription:{...otherCategory.subscription,capabilities:[]}};
  assert.equal(policy.decision(disabled,{capability:'email.marketing',permission:'email.marketing.manage'}).allowed,false);
});
