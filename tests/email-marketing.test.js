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
const bouncePrivacy=require('../modules/platform/email-marketing-bounce-privacy');
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

test('audience preview requires valid addresses and excludes suppressed or unsubscribed contacts',()=>{
  const result=email.summarizeAudience([
    {id:1,email:'Sales@Example.com',email_marketing_consent:1},
    {id:2,email:'sales@example.com',email_marketing_consent:1},
    {id:3,email:'',email_marketing_consent:1},
    {id:4,email:'invalid',email_marketing_consent:1},
    {id:5,email:'none@example.com',email_marketing_consent:0},
    {id:6,email:'stop@example.com',email_marketing_consent:1,email_unsubscribed_at:'2026-01-01'},
    {id:7,email:'bounce@example.com',email_marketing_consent:1,suppressed_email:'bounce@example.com'}
  ]);
  assert.deepEqual(result.summary,{total:7,eligible:2,missingEmail:1,invalidEmail:1,noConsent:1,unsubscribed:1,suppressed:1,duplicate:1});
  assert.deepEqual(result.eligible.map(row=>row.normalizedEmail),['sales@example.com','none@example.com']);
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

test('bounce suppression stores a tenant-scoped keyed fingerprint instead of the address',()=>{
  const key=Buffer.alloc(32,9),address='Bounced.Person@example.com';
  const a=bouncePrivacy.emailFingerprint(key,'tenant-a',address);
  assert.match(a,/^[a-f0-9]{64}$/);
  assert.equal(a,bouncePrivacy.emailFingerprint(key,'tenant-a','bounced.person@example.com'));
  assert.notEqual(a,bouncePrivacy.emailFingerprint(key,'tenant-b',address));
  assert.notEqual(a,bouncePrivacy.emailFingerprint(Buffer.alloc(32,8),'tenant-a',address));
  assert.ok(!a.includes('bounced.person@example.com'));
  assert.equal(bouncePrivacy.redactAddress('Contact BOUNCED.person@example.com now','bounced.person@example.com'),'Contact [email removed after bounce] now');
});

test('email analytics scopes every aggregate and campaign join to the current tenant',async()=>{
  const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const context={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'7network_sales',categoryVersion:1},membership:{id:'member',tenantId,role:'owner',status:'active'},category:{key:'7network_sales',version:1,capabilities:['email.marketing']},subscription:{status:'active',capabilities:[]}};
  const calls=[];const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM sx_email_campaigns WHERE'))return [[{campaigns:1,recipients:3,accepted:3,failed:0,suppressed:0}]];if(sql.includes('FROM sx_email_campaign_recipients'))return [[{accepted:3,failed:0,suppressed:0,unknownCount:0}]];if(sql.includes('FROM sx_email_provider_events WHERE'))return [[{delivered:2,bounced:1,complained:0,opened:1,clicked:1,rejected:0,delayed:0}]];if(sql.startsWith('SELECT COUNT(DISTINCT t.recipient_id) AS replied'))return [[{replied:1}]];return [[{id:'campaign',name:'Synthetic',recipients:3,delivered:2,opened:1,clicked:1,replied:1}]];}};
  const result=await email.analytics(db,{context,tenantId},30);
  assert.equal(result.days,30);assert.equal(result.totals.delivered,2);assert.equal(result.totals.replied,1);assert.equal(result.campaigns[0].name,'Synthetic');
  assert.equal(calls.length,7);for(const call of calls){assert.ok(call.args.includes(tenantId));assert.match(call.sql,/tenant_id/);}
  assert.deepEqual(calls[6].args,[30,tenantId,30]);assert.match(calls[6].sql,/reply_stats\.tenant_id=c\.tenant_id/);
});

test('campaign report joins scoped recipient events and paginates searchable reply statuses',async()=>{
  const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const campaignId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const context={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'7network_sales',categoryVersion:1},membership:{id:'member',tenantId,role:'owner',status:'active'},category:{key:'7network_sales',version:1,capabilities:['email.marketing']},subscription:{status:'active',capabilities:[]}};
  const calls=[];const db={query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('FROM sx_email_campaigns c JOIN sx_email_senders'))return [[{id:campaignId,name:'Synthetic',subject:'Hello',text:'Message',senderEmail:'sender@example.com'}]];
    if(sql.includes('SELECT COUNT(*) AS recipients'))return [[{recipients:51,sent:50,delivered:42,opened:20,clicked:5,replied:2,bounced:3,failed:1,suppressed:0,inProgress:5,outcomeBounced:3,outcomeFailed:1,outcomeSuppressed:0,outcomeDelivered:42,outcomeSent:3,outcomeInProgress:2}]];
    if(sql.includes('SELECT COUNT(*) AS total'))return [[{total:26}]];
    if(sql.includes('FROM sx_email_campaign_recipients r')&&sql.includes('LIMIT ? OFFSET ?'))return [[{id:'recipient-1',email:'alice@example.com',name:'Alice',status:'delivered',sendStatus:'accepted',delivered:1,opened:1,clicked:0,replyCount:1}]];
    if(sql.includes('FROM sx_email_campaign_attachments'))return [[]];
    throw new Error('Unexpected campaign report query');
  }};
  const result=await email.campaignDetail(db,{context,tenantId},campaignId,{status:'replied',search:'Alice',page:'2',limit:'25'});
  assert.equal(result.summary.recipients,51);assert.equal(result.summary.replied,2);
  assert.deepEqual(result.pagination,{page:2,limit:25,total:26,pages:2});
  assert.deepEqual(result.filters,{search:'Alice',status:'replied'});assert.equal(result.recipients[0].email,'alice@example.com');
  assert.ok(calls.every(call=>call.args.includes(tenantId)&&call.args.includes(campaignId)));
  assert.match(calls.find(call=>call.sql.includes('SELECT COUNT(*) AS total')).sql,/rep\.replyCount/);
  assert.match(calls.find(call=>call.sql.includes('SELECT COUNT(*) AS total')).sql,/recipient_email LIKE/);
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
