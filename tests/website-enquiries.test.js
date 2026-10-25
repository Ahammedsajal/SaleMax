"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { clean, cleanTenant, submitTenant } = require("../modules/web/website-enquiries");
function requestHarness(categoryKey,content={}){
  const ownerUid=`synthetic-${categoryKey}-owner`,tenantId=`tenant-${categoryKey}`,hostname=`${categoryKey}.example.qa`,records=new Map(),activities=[],leads=[];
  const db={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,params=[]){
    if(sql.includes('SELECT t.id AS tenantId,u.uid,own.legacy_uid_hash'))return [[{tenantId,uid:ownerUid,uidHash:crypto.createHash('sha256').update(ownerUid).digest('hex')}]];
    if(sql.startsWith('INSERT INTO sx_website_enquiries')){if(!records.has(params[0]))records.set(params[0],{payloadHash:params[1],tenantId:params[2],leadId:null});return [{affectedRows:1}];}
    if(sql.startsWith('SELECT payload_hash,tenant_id AS tenantId,lead_id AS leadId')){const value=records.get(params[0]);return [[{payload_hash:value.payloadHash,tenantId:value.tenantId,leadId:value.leadId}]];}
    if(sql.startsWith('INSERT INTO sx_website_rate_limits'))return [{affectedRows:1}];
    if(sql.startsWith('SELECT requests FROM sx_website_rate_limits'))return [[{requests:1}]];
    if(sql.includes('INSERT INTO pipeline_activity')){activities.push(JSON.parse(params[3]));return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];
    if(sql.startsWith('UPDATE sx_website_enquiries SET lead_id=')){records.get(params[1]).leadId=params[0];return [{affectedRows:1}];}
    if(sql.startsWith('DELETE FROM sx_website_rate_limits'))return [{affectedRows:0}];
    throw new Error(`Unexpected ${categoryKey} request SQL: ${sql}`);
  }};
  const pool={async getConnection(){return db;}},options={loadBrand:async(_db,host)=>({tenantId,hostname:host,revision:1,categoryKey,categoryVersion:1,content}),loadEntitlements:async()=>({status:'active',categoryKey,capabilities:['crm.leads']}),createLead:async request=>{leads.push(request.input);return {id:`synthetic-${categoryKey}-lead-${leads.length}`};}};
  return {pool,options,domain:{tenantId,hostname},visitorHash:'e'.repeat(64),activities,leads};
}
const base = {
  name: "Test Visitor",
  mobile: "+974 5555 0101",
  email: " WEBSITE@EXAMPLE.INVALID ",
  content: "Test business enquiry",
  company: "Synthetic business",
  solution: "crm",
  consent: true,
};
test("website normalizes contact details and bounds every stored field", () => {
  const data = clean(base);
  assert.equal(data.mobile, "+97455550101");
  assert.equal(data.email, "website@example.invalid");
  for (const patch of [
    { name: [] },
    { email: "wrong" },
    { mobile: "123" },
    { mobile: "call me at 12345678" },
    { company: "x".repeat(161) },
    { content: "x".repeat(2001) },
    { solution: "admin" },
    { consent: false },
    { submissionToken: "../secret" },
  ])
    assert.throws(() => clean({ ...base, ...patch }), { status: 400 });
});
test("legacy form payloads stay compatible without accepting a caller-selected tenant", () => {
  const data = clean({
    name: base.name,
    email: base.email,
    mobile: "55550101",
    content: base.content,
    tenantId: "foreign",
    ownerUid: "foreign",
  });
  assert.equal(data.solution, "other");
  assert.equal(data.company, "");
  assert.equal(data.tenantId, undefined);
  assert.equal(data.ownerUid, undefined);
});

test('tenant guest request validation requires consent, contact and bounded request details',()=>{
  const valid={name:'Guest Visitor',email:'guest@example.invalid',mobile:'',content:'Please advise about your consultation packages.',intent:'consultation',consent:'on',submissionToken:crypto.randomUUID(),website:''};
  assert.deepEqual(cleanTenant(valid),{name:'Guest Visitor',email:'guest@example.invalid',mobile:'',content:valid.content,intent:'consultation',consent:true,token:valid.submissionToken});
  for(const patch of [{consent:''},{email:'',mobile:''},{content:''},{content:'x'.repeat(2001)},{service:'x'.repeat(201)},{service:'bad\nservice'},{event:'x'.repeat(201)},{event:'bad\nevent'},{intent:'confirmed'},{tenantId:'attacker-selected'},{website:'bot'}])assert.throws(()=>cleanTenant({...valid,...patch}),{status:400});
  assert.throws(()=>cleanTenant({...valid,submissionToken:'not-a-uuid'}),{code:'INVALID_SUBMISSION_TOKEN'});
  assert.deepEqual(cleanTenant({...valid,intent:'booking_request',preferredDate:'2030-04-05',preferredTime:'13:45'}),{name:valid.name,email:valid.email,mobile:'',content:valid.content,intent:'booking_request',preferredDate:'2030-04-05',preferredTime:'13:45',consent:true,token:valid.submissionToken});
  for(const patch of [{preferredDate:'2030-02-30'},{preferredDate:42},{preferredTime:'25:90'},{preferredTime:42}])assert.throws(()=>cleanTenant({...valid,intent:'booking_request',...patch}),{status:400});
});

test('tenant guest enquiry is tenant-bound, idempotent and stores the full request in Pipeline activity',async()=>{
  const ownerUid='synthetic-professional-owner',tenantId='tenant-professional-a',hostname='consulting.example.qa',token=crypto.randomUUID(),visitorHash='a'.repeat(64);
  const records=new Map();let leadCreates=0;const activities=[];
  const db={
    async beginTransaction(){},async commit(){},async rollback(){},release(){},
    async query(sql,params=[]){
      if(sql.includes('SELECT t.id AS tenantId,u.uid,own.legacy_uid_hash'))return [[{tenantId,uid:ownerUid,uidHash:crypto.createHash('sha256').update(ownerUid).digest('hex')}]];
      if(sql.startsWith('INSERT INTO sx_website_enquiries')){if(!records.has(params[0]))records.set(params[0],{payloadHash:params[1],tenantId:params[2],leadId:null});return [{affectedRows:1}];}
      if(sql.startsWith('SELECT payload_hash,tenant_id AS tenantId,lead_id AS leadId')){const value=records.get(params[0]);return [[{payload_hash:value.payloadHash,tenantId:value.tenantId,leadId:value.leadId}]];}
      if(sql.startsWith('INSERT INTO sx_website_rate_limits'))return [{affectedRows:1}];
      if(sql.startsWith('SELECT requests FROM sx_website_rate_limits'))return [[{requests:1}]];
      if(sql.includes('INSERT INTO pipeline_activity')){activities.push(JSON.parse(params[3]));return [{affectedRows:1}];}
      if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];
      if(sql.startsWith('UPDATE sx_website_enquiries SET lead_id=')){records.get(params[1]).leadId=params[0];return [{affectedRows:1}];}
      if(sql.startsWith('DELETE FROM sx_website_rate_limits'))return [{affectedRows:0}];
      throw new Error(`Unexpected tenant enquiry SQL: ${sql}`);
    },
  };
  const pool={async getConnection(){return db;}};
  const input={name:'Guest Visitor',email:'guest@example.invalid',mobile:'+97450001234',content:'Please advise about your consultation packages.',intent:'quotation',service:'Strategy session',consent:'on',submissionToken:token};
  const options={loadBrand:async(_db,host)=>({tenantId,hostname:host,revision:1,categoryKey:'professional_services',categoryVersion:1,content:{sections:[{type:'services',items:[{title:'Strategy session',titleAr:'جلسة استراتيجية'}]}]}}),loadEntitlements:async()=>({status:'active',categoryKey:'professional_services',capabilities:['crm.leads']}),createLead:async request=>{leadCreates++;assert.equal(request.uid,ownerUid);assert.equal(request.connection,db);assert.equal(request.input.sourceType,'public_form');assert.equal(request.input.qualificationData.requestedService,'Strategy session');return {id:'synthetic-lead-1'};}};
  const domain={tenantId,hostname};
  const first=await submitTenant(pool,input,visitorHash,domain,options);assert.equal(first.repeated,false);assert.equal(first.reference,token);
  const retry=await submitTenant(pool,input,visitorHash,domain,options);assert.equal(retry.repeated,true);assert.equal(leadCreates,1);assert.equal(records.get(token).tenantId,tenantId);assert.equal(records.get(token).leadId,'synthetic-lead-1');assert.equal(activities[0].content,input.content);assert.equal(activities[0].service,input.service);assert.equal(activities[0].hostname,hostname);
  await assert.rejects(submitTenant(pool,{...input,service:'Unpublished service',submissionToken:crypto.randomUUID()},visitorHash,domain,options),{code:'SERVICE_UNAVAILABLE',status:409});assert.equal(leadCreates,1);
  await assert.rejects(submitTenant(pool,{...input,content:'Changed message'},visitorHash,domain,options),{code:'SUBMISSION_CHANGED',status:409});
  await assert.rejects(submitTenant(pool,input,visitorHash,{...domain,tenantId:'tenant-foreign'},options),{code:'STOREFRONT_NOT_AVAILABLE',status:404});
});

test('tenant guest enquiry resolves the selected public branch and applies only its validated agent route',async()=>{
  const ownerUid='synthetic-professional-owner',tenantId='tenant-professional-a',hostname='consulting.example.qa',token=crypto.randomUUID(),visitorHash='b'.repeat(64);
  const records=new Map(),activities=[];let leadRequest;
  const db={
    async beginTransaction(){},async commit(){},async rollback(){},release(){},
    async query(sql,params=[]){
      if(sql.includes('SELECT t.id AS tenantId,u.uid,own.legacy_uid_hash'))return [[{tenantId,uid:ownerUid,uidHash:crypto.createHash('sha256').update(ownerUid).digest('hex')}]];
      if(sql.includes('FROM sx_tenant_branches b'))return params[1]==='west'?[[{id:'branch-west',slug:'west',routingMembershipId:'membership-agent',role:'agent',routedAgentId:73}]]:[[]];
      if(sql.startsWith('INSERT INTO sx_website_enquiries')){if(!records.has(params[0]))records.set(params[0],{payloadHash:params[1],tenantId:params[2],leadId:null});return [{affectedRows:1}];}
      if(sql.startsWith('SELECT payload_hash,tenant_id AS tenantId,lead_id AS leadId')){const value=records.get(params[0]);return [[{payload_hash:value.payloadHash,tenantId:value.tenantId,leadId:value.leadId}]];}
      if(sql.startsWith('INSERT INTO sx_website_rate_limits'))return [{affectedRows:1}];
      if(sql.startsWith('SELECT requests FROM sx_website_rate_limits'))return [[{requests:1}]];
      if(sql.includes('INSERT INTO pipeline_activity')){activities.push(JSON.parse(params[3]));return [{affectedRows:1}];}
      if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];
      if(sql.startsWith('UPDATE sx_website_enquiries SET lead_id=')){records.get(params[1]).leadId=params[0];return [{affectedRows:1}];}
      if(sql.startsWith('DELETE FROM sx_website_rate_limits'))return [{affectedRows:0}];
      throw new Error(`Unexpected tenant branch enquiry SQL: ${sql}`);
    },
  };
  const pool={async getConnection(){return db;}};
  const input={name:'Guest Visitor',email:'guest@example.invalid',mobile:'',content:'Please contact me about the west branch.',intent:'consultation',service:'Strategy session',branchSlug:'west',consent:'on',submissionToken:token};
  const options={
    loadBrand:async(_db,host)=>({tenantId,hostname:host,revision:1,categoryKey:'professional_services',categoryVersion:1,content:{sections:[{type:'services',items:[{title:'Strategy session'}]}]}}),
    loadEntitlements:async()=>({status:'active',categoryKey:'professional_services',capabilities:['crm.leads']}),
    createLead:async request=>{leadRequest=request;return {id:'synthetic-routed-lead'};},
  };
  await submitTenant(pool,input,visitorHash,{tenantId,hostname},options);
  assert.equal(leadRequest.input.ownerAgentId,73);
  assert.equal(leadRequest.input.qualificationData.requestedBranch,'west');
  assert.equal(leadRequest.input.qualificationData.routedMembershipId,'membership-agent');
  assert.equal(activities[0].branchSlug,'west');
  assert.equal(activities[0].routedAgentId,73);
  assert.equal(activities[0].routingMembershipId,'membership-agent');
  await assert.rejects(submitTenant(pool,{...input,branchSlug:'foreign-branch',submissionToken:crypto.randomUUID()},visitorHash,{tenantId,hostname},options),{code:'BRANCH_UNAVAILABLE',status:409});
  assert.equal(records.size,1,'an invalid branch must not be persisted as an enquiry');
}
);
test("HTTP boundary denies foreign origins and tenant domains before touching the database", async () => {
  const previousLocalOnlyMode = process.env.LOCAL_ONLY_MODE;
  process.env.LOCAL_ONLY_MODE = "true";
  const express = require("express");
  const app = express();
  require("../modules/web/public-website").mountPublicWebsite(app, {
    pool: {
      getConnection() {
        throw new Error("database must not be touched");
      },
    },
    key: Buffer.alloc(32),
    origin: "http://127.0.0.1",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/public/website/enquiries`;
  try {
    let result = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "https://foreign.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(base),
    });
    assert.equal(result.status, 403);
    result = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...base, consent: undefined }),
    });
    assert.equal(result.status, 400);
    result = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ website: "spam" }),
    });
    assert.equal(result.status, 201);
    result = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1",
        "Content-Type": "application/json",
      },
      body: "{",
    });
    assert.equal(result.status, 400);
    result = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "x".repeat(20000) }),
    });
    assert.equal(result.status, 413);
  } finally {
    if (previousLocalOnlyMode === undefined) delete process.env.LOCAL_ONLY_MODE;
    else process.env.LOCAL_ONLY_MODE = previousLocalOnlyMode;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('salon appointment preferences create an unconfirmed service-linked Pipeline request',async()=>{
  const ownerUid='synthetic-salon-owner',tenantId='tenant-salon-a',hostname='salon.example.qa',token=crypto.randomUUID(),visitorHash='c'.repeat(64);
  const records=new Map(),activities=[];let leadInput,leadCreates=0;
  const db={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,params=[]){
    if(sql.includes('SELECT t.id AS tenantId,u.uid,own.legacy_uid_hash'))return [[{tenantId,uid:ownerUid,uidHash:crypto.createHash('sha256').update(ownerUid).digest('hex')}]];
    if(sql.includes('FROM sx_tenant_branches b'))return [[{id:'salon-west',slug:'west',routingMembershipId:'salon-agent-membership',role:'agent',routedAgentId:83}]];
    if(sql.startsWith('INSERT INTO sx_website_enquiries')){if(!records.has(params[0]))records.set(params[0],{payloadHash:params[1],tenantId:params[2],leadId:null});return [{affectedRows:1}];}
    if(sql.startsWith('SELECT payload_hash,tenant_id AS tenantId,lead_id AS leadId')){const value=records.get(params[0]);return [[{payload_hash:value.payloadHash,tenantId:value.tenantId,leadId:value.leadId}]];}
    if(sql.startsWith('INSERT INTO sx_website_rate_limits'))return [{affectedRows:1}];
    if(sql.startsWith('SELECT requests FROM sx_website_rate_limits'))return [[{requests:1}]];
    if(sql.includes('INSERT INTO pipeline_activity')){activities.push(JSON.parse(params[3]));return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];
    if(sql.startsWith('UPDATE sx_website_enquiries SET lead_id=')){records.get(params[1]).leadId=params[0];return [{affectedRows:1}];}
    if(sql.startsWith('DELETE FROM sx_website_rate_limits'))return [{affectedRows:0}];
    throw new Error(`Unexpected salon request SQL: ${sql}`);
  }};
  const pool={async getConnection(){return db;}};
  const input={name:'Salon Guest',email:'guest@example.invalid',mobile:'+97450001234',content:'Please confirm if this preferred appointment is available.',intent:'booking_request',service:'Hair consultation',branchSlug:'west',preferredDate:'2030-04-05',preferredTime:'13:45',consent:'on',submissionToken:token};
  const options={loadBrand:async(_db,host)=>({tenantId,hostname:host,revision:1,categoryKey:'salon_spa',categoryVersion:1,content:{sections:[{type:'services',items:[{title:'Hair consultation',titleAr:'استشارة الشعر'}]}]}}),loadEntitlements:async()=>({status:'active',categoryKey:'salon_spa',capabilities:['crm.leads']}),createLead:async request=>{leadCreates++;leadInput=request.input;return {id:'synthetic-salon-lead'};}};
  await submitTenant(pool,input,visitorHash,{tenantId,hostname},options);
  assert.equal(leadCreates,1);assert.match(leadInput.title,/^Appointment request/);assert.equal(leadInput.qualificationData.requestedService,'Hair consultation');assert.equal(leadInput.qualificationData.requestedDate,'2030-04-05');assert.equal(leadInput.qualificationData.requestedTime,'13:45');assert.equal(activities[0].intent,'booking_request');assert.equal(activities[0].preferredDate,'2030-04-05');assert.equal(activities[0].preferredTime,'13:45');assert.equal(activities[0].confirmed,undefined);assert.equal(activities[0].reserved,undefined);
  await assert.rejects(submitTenant(pool,{...input,intent:'consultation',submissionToken:crypto.randomUUID()},visitorHash,{tenantId,hostname},options),{code:'INVALID_INTENT'});
  await assert.rejects(submitTenant(pool,{...input,preferredDate:'2020-01-01',submissionToken:crypto.randomUUID()},visitorHash,{tenantId,hostname},options),{code:'INVALID_PREFERRED_DATE'});
  assert.equal(leadCreates,1);
});

test('home-service visit requests validate public branch coverage, keep the address private and route the lead',async()=>{
  const ownerUid='synthetic-home-owner',tenantId='tenant-home-a',hostname='repairs.example.qa',token=crypto.randomUUID(),visitorHash='d'.repeat(64);
  const records=new Map(),activities=[];let leadInput,leadCreates=0;
  const db={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,params=[]){
    if(sql.includes('SELECT t.id AS tenantId,u.uid,own.legacy_uid_hash'))return [[{tenantId,uid:ownerUid,uidHash:crypto.createHash('sha256').update(ownerUid).digest('hex')}]];
    if(sql.includes('FROM sx_tenant_branches b'))return [[{id:'home-doha',slug:'doha-west',serviceAreas:['Al Waab','Ain Khaled'],fulfillmentModes:['onsite'],routingMembershipId:'home-agent-membership',role:'agent',routedAgentId:83}]];
    if(sql.startsWith('INSERT INTO sx_website_enquiries')){if(!records.has(params[0]))records.set(params[0],{payloadHash:params[1],tenantId:params[2],leadId:null});return [{affectedRows:1}];}
    if(sql.startsWith('SELECT payload_hash,tenant_id AS tenantId,lead_id AS leadId')){const value=records.get(params[0]);return [[{payload_hash:value.payloadHash,tenantId:value.tenantId,leadId:value.leadId}]];}
    if(sql.startsWith('INSERT INTO sx_website_rate_limits'))return [{affectedRows:1}];
    if(sql.startsWith('SELECT requests FROM sx_website_rate_limits'))return [[{requests:1}]];
    if(sql.includes('INSERT INTO pipeline_activity')){activities.push(JSON.parse(params[3]));return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];
    if(sql.startsWith('UPDATE sx_website_enquiries SET lead_id=')){records.get(params[1]).leadId=params[0];return [{affectedRows:1}];}
    if(sql.startsWith('DELETE FROM sx_website_rate_limits'))return [{affectedRows:0}];
    throw new Error(`Unexpected home-service request SQL: ${sql}`);
  }};
  const pool={async getConnection(){return db;}},input={name:'Home Guest',email:'guest@example.invalid',mobile:'+97450001234',content:'Please inspect the leaking kitchen tap.',intent:'visit_request',service:'Plumbing repair',branchSlug:'doha-west',serviceArea:'Al Waab',serviceAddress:'Villa 14, Street 320, Al Waab',preferredDate:'2030-04-05',preferredTime:'13:45',consent:'on',submissionToken:token};
  const options={loadBrand:async(_db,host)=>({tenantId,hostname:host,revision:1,categoryKey:'home_services',categoryVersion:1,content:{sections:[{type:'services',items:[{title:'Plumbing repair'}]}]}}),loadEntitlements:async()=>({status:'active',categoryKey:'home_services',capabilities:['crm.leads']}),createLead:async request=>{leadCreates++;leadInput=request.input;return {id:'synthetic-home-lead'};}};
  await submitTenant(pool,input,visitorHash,{tenantId,hostname},options);
  assert.equal(leadCreates,1);assert.match(leadInput.title,/^Visit request/);assert.equal(leadInput.ownerAgentId,83);assert.equal(leadInput.qualificationData.requestedService,'Plumbing repair');assert.equal(leadInput.qualificationData.requestedServiceArea,'Al Waab');assert.equal(leadInput.qualificationData.requestedDate,'2030-04-05');assert.equal(activities[0].serviceAddress,input.serviceAddress);assert.equal(activities[0].confirmed,undefined);assert.equal(activities[0].reserved,undefined);
  await assert.rejects(submitTenant(pool,{...input,serviceArea:'West Bay',submissionToken:crypto.randomUUID()},visitorHash,{tenantId,hostname},options),{code:'SERVICE_AREA_UNAVAILABLE'});
  assert.equal(leadCreates,1);
});

test('fitness trial and event registration workflows create requests without reserving coaches, seats or venues',async()=>{
  const fitness=requestHarness('fitness_coaching',{sections:[{type:'services',items:[{title:'Strength coaching'}]}]}),trial={name:'Fitness Guest',email:'guest@example.invalid',mobile:'',content:'I would like to try strength coaching.',intent:'trial_request',service:'Strength coaching',preferredDate:'2030-04-05',preferredTime:'13:45',consent:'on',submissionToken:crypto.randomUUID()};
  await submitTenant(fitness.pool,trial,fitness.visitorHash,fitness.domain,fitness.options);
  assert.match(fitness.leads[0].title,/^Fitness trial request/);assert.equal(fitness.leads[0].qualificationData.requestedService,'Strength coaching');assert.equal(fitness.leads[0].qualificationData.requestedDate,'2030-04-05');assert.equal(fitness.activities[0].intent,'trial_request');assert.equal(fitness.activities[0].reserved,undefined);assert.equal(fitness.activities[0].confirmed,undefined);
  await assert.rejects(submitTenant(fitness.pool,{...trial,intent:'confirmed_booking',submissionToken:crypto.randomUUID()},fitness.visitorHash,fitness.domain,fitness.options),{code:'INVALID_INTENT'});
  const events=requestHarness('events_venues',{sections:[{type:'services',items:[{title:'Garden Hall package'}]},{type:'events',items:[{title:'Open studio demo',titleAr:'عرض الاستوديو المفتوح',expiresOn:'2030-06-20'}]}]}),registration={name:'Event Guest',email:'guest@example.invalid',mobile:'',content:'Please tell me whether registration is open.',intent:'event_registration_request',service:'Garden Hall package',event:'Open studio demo',preferredDate:'2030-06-15',consent:'on',submissionToken:crypto.randomUUID()};
  await submitTenant(events.pool,registration,events.visitorHash,events.domain,events.options);
  assert.match(events.leads[0].title,/^Event registration enquiry/);assert.match(events.leads[0].title,/Open studio demo/);assert.equal(events.leads[0].qualificationData.requestedService,'Garden Hall package');assert.equal(events.leads[0].qualificationData.requestedEvent,'Open studio demo');assert.equal(events.leads[0].qualificationData.requestedEventAr,'عرض الاستوديو المفتوح');assert.equal(events.leads[0].qualificationData.requestedDate,'2030-06-15');assert.equal(events.activities[0].intent,'event_registration_request');assert.equal(events.activities[0].event,'Open studio demo');assert.equal(events.activities[0].reserved,undefined);assert.equal(events.activities[0].confirmed,undefined);
  await assert.rejects(submitTenant(events.pool,{...registration,event:'Unpublished event',submissionToken:crypto.randomUUID()},events.visitorHash,events.domain,events.options),{code:'EVENT_UNAVAILABLE'});
  const expiredEvents=requestHarness('events_venues',{sections:[{type:'services',items:[{title:'Garden Hall package'}]},{type:'events',items:[{title:'Past event',expiresOn:'2020-01-01'}]}]});await assert.rejects(submitTenant(expiredEvents.pool,{...registration,event:'Past event',submissionToken:crypto.randomUUID()},expiredEvents.visitorHash,expiredEvents.domain,expiredEvents.options),{code:'EVENT_UNAVAILABLE'});
  await assert.rejects(submitTenant(events.pool,{...registration,intent:'event_registration_request',preferredDate:'2020-01-01',submissionToken:crypto.randomUUID()},events.visitorHash,events.domain,events.options),{code:'INVALID_PREFERRED_DATE'});
  assert.equal(fitness.leads.length,1);assert.equal(events.leads.length,1);
});

test('fitness and event request intents are rejected for unrelated tenant categories',async()=>{
  const base={name:'Guest',email:'guest@example.invalid',mobile:'',content:'Please contact me.',consent:'on',submissionToken:crypto.randomUUID()};
  const professional=requestHarness('professional_services');
  await assert.rejects(submitTenant(professional.pool,{...base,intent:'trial_request'},professional.visitorHash,professional.domain,professional.options),{code:'INVALID_INTENT'});
  const fitness=requestHarness('fitness_coaching');
  await assert.rejects(submitTenant(fitness.pool,{...base,intent:'availability_request'},fitness.visitorHash,fitness.domain,fitness.options),{code:'INVALID_INTENT'});
  const events=requestHarness('events_venues');
  await assert.rejects(submitTenant(events.pool,{...base,intent:'trial_request'},events.visitorHash,events.domain,events.options),{code:'INVALID_INTENT'});
  await assert.rejects(submitTenant(professional.pool,{...base,intent:'consultation',event:'Open studio demo'},professional.visitorHash,professional.domain,professional.options),{code:'EVENT_UNAVAILABLE'});
  assert.equal(professional.leads.length,0);assert.equal(fitness.leads.length,0);assert.equal(events.leads.length,0);
});
