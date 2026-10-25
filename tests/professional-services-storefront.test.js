'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const domains=require('../modules/platform/tenant-crm-domains');
const branches=require('../modules/platform/tenant-storefront-branches');
const plans=require('../modules/platform/plans');
const enquiries=require('../modules/web/website-enquiries');
const {sendTenantStorefront,mountPublicWebsite}=require('../modules/web/public-website');

test('Professional Services storefront offers bilingual guest consultation and quote requests only with an active entitlement',async()=>{
  const oldBrand=domains.publicBrand,oldBranches=branches.publicBranches,oldEntitlements=plans.loadEntitlements;
  domains.publicBrand=async()=>({name:'Synthetic Advisory',slug:'synthetic-advisory',tenantId:'tenant-professional',categoryKey:'professional_services',categoryVersion:1,content:{headline:'Advisory services',headlineAr:'الخدمات الاستشارية',sections:[{type:'services',title:'Services',titleAr:'الخدمات',items:[{title:'Strategy session',titleAr:'جلسة استراتيجية',body:'Discuss your business goals.',bodyAr:'ناقش أهداف عملك.'}]}]},revision:2,primaryHostname:'advisory.example.qa'});
  branches.publicBranches=async()=>[{slug:'west',nameEn:'West branch',nameAr:'الفرع الغربي',routingMembershipId:'private-membership',routedAgentId:73}];
  plans.loadEntitlements=async()=>({status:'active',categoryKey:'professional_services',capabilities:['crm.leads']});
  try{
    for(const [language,cta,heading,service] of [['en','Request a consultation or quote','Request a consultation or quote','Strategy session'],['ar','طلب استشارة أو عرض سعر','طلب استشارة أو عرض سعر','جلسة استراتيجية']]){
      const response={headers:{},setHeader(name,value){this.headers[name]=value;},type(){return this;},send(body){this.body=body;return this;}};
      await sendTenantStorefront({path:'/',crmTenantDomain:{hostname:'advisory.example.qa'},query:{},get(name){return name.toLowerCase()==='accept-language'?language:'';}},response,{async getConnection(){return {release(){}};}});
      assert.match(response.body,new RegExp(heading));assert.match(response.body,new RegExp(service));assert.match(response.body,/method="post" action="\/api\/public\/website\/enquiries"/);assert.match(response.body,/name="submissionToken"/);assert.match(response.body,/name="consent"/);assert.match(response.body,/name="email"/);assert.match(response.body,/name="mobile"/);assert.match(response.body,/name="service" required/);assert.match(response.body,/value="Strategy session"/);assert.match(response.body,/(Request this service|طلب هذه الخدمة)/);assert.match(response.body,/<option value="quotation"/);assert.match(response.body,/name="branchSlug"/);assert.match(response.body,/value="west"/);assert.doesNotMatch(response.body,/private-membership|routedAgentId|value="73"|Create an account|confirmed appointment/);assert.match(response.headers['Content-Security-Policy'],/form-action 'self'/);assert.equal(response.headers['Cache-Control'],'public, max-age=60, s-maxage=60, stale-while-revalidate=30');
      if(language==='en'){const selected={headers:{},setHeader(name,value){this.headers[name]=value;},type(){return this;},send(body){this.body=body;return this;}};await sendTenantStorefront({path:'/',crmTenantDomain:{hostname:'advisory.example.qa'},query:{service:'Strategy session',branch:'west'},get(){return 'en';}},selected,{async getConnection(){return {release(){}};}});assert.match(selected.body,/<option value="Strategy session" selected>/);assert.match(selected.body,/<option value="west" selected>/);}
    }
    plans.loadEntitlements=async()=>({status:'expired',categoryKey:'professional_services',capabilities:['crm.leads']});
    const response={headers:{},setHeader(name,value){this.headers[name]=value;},type(){return this;},send(body){this.body=body;return this;}};
    await sendTenantStorefront({path:'/',crmTenantDomain:{hostname:'advisory.example.qa'},query:{},get(){return 'en';}},response,{async getConnection(){return {release(){}};}});
    assert.doesNotMatch(response.body,/id="enquiry"|Request a consultation or quote/);
  }finally{domains.publicBrand=oldBrand;branches.publicBranches=oldBranches;plans.loadEntitlements=oldEntitlements;}
});

test('tenant enquiry POST accepts only the exact tenant origin and canonical endpoint, preserving the platform endpoint',async()=>{
  const previousLocalOnlyMode=process.env.LOCAL_ONLY_MODE;process.env.LOCAL_ONLY_MODE='true';
  const express=require('express'),app=express(),calls=[];
  const oldBrand=require('../modules/platform/tenant-crm-domains').publicBrand,oldBranches=branches.publicBranches,oldEntitlements=plans.loadEntitlements;
  require('../modules/platform/tenant-crm-domains').publicBrand=async()=>({name:'Synthetic Advisory',slug:'synthetic-advisory',tenantId:'tenant-professional',categoryKey:'professional_services',categoryVersion:1,content:{},revision:1,primaryHostname:'advisory.example.qa'});
  branches.publicBranches=async()=>[];plans.loadEntitlements=async()=>({status:'active',categoryKey:'professional_services',capabilities:['crm.leads']});
  app.use((req,_res,next)=>{req.crmTenantDomain={hostname:'advisory.example.qa',tenantId:'tenant-professional'};next();});
  const original=enquiries.submitTenant;enquiries.submitTenant=async(_pool,input,visitorHash,domain)=>{calls.push({input,visitorHash,domain});if(input.content==='force failure')throw Object.assign(new Error('rate limited'),{code:'ENQUIRY_RATE_LIMITED',status:429});return {reference:input.submissionToken,repeated:false};};
  mountPublicWebsite(app,{pool:{async getConnection(){return {release(){}};}},key:Buffer.alloc(32,1),origin:'http://127.0.0.1'});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const port=server.address().port,body=new URLSearchParams({name:'Guest',email:'guest@example.invalid',mobile:'',content:'Please contact me about a consultation.',intent:'consultation',consent:'on',submissionToken:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',website:''}).toString();
  const post=async(path,origin)=>fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{Host:'advisory.example.qa',Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body,redirect:'manual'});
  try{
    let response=await post('/api/public/website/enquiries','https://advisory.example.qa');assert.equal(response.status,303,await response.clone().text());assert.equal(response.headers.get('location'),'/?enquiry=sent#enquiry');assert.equal(calls.length,1);assert.equal(calls[0].domain.tenantId,'tenant-professional');assert.equal(calls[0].input.intent,'consultation');assert.match(calls[0].visitorHash,/^[a-f0-9]{64}$/);
    response=await post('/api/public/website/enquiries','https://attacker.example');assert.equal(response.status,403);assert.equal(calls.length,1);
    response=await post('/api/web/submit_contact_form','https://advisory.example.qa');assert.equal(response.status,403);assert.equal(calls.length,1);
    const failedBody=new URLSearchParams({name:'<img src=x>',email:'guest@example.invalid',mobile:'',content:'force failure',intent:'quotation',consent:'on',submissionToken:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',website:''}).toString();
    response=await fetch(`http://127.0.0.1:${port}/api/public/website/enquiries`,{method:'POST',headers:{Origin:'https://advisory.example.qa','Content-Type':'application/x-www-form-urlencoded'},body:failedBody,redirect:'manual'});
    const failedHtml=await response.text();assert.equal(response.status,200);assert.match(failedHtml,/role="alert"/);assert.match(failedHtml,/&lt;img src=x&gt;/);assert.doesNotMatch(failedHtml,/<img src=x>/);assert.equal(response.headers.get('cache-control'),'no-store');
  }finally{enquiries.submitTenant=original;require('../modules/platform/tenant-crm-domains').publicBrand=oldBrand;branches.publicBranches=oldBranches;plans.loadEntitlements=oldEntitlements;if(previousLocalOnlyMode===undefined)delete process.env.LOCAL_ONLY_MODE;else process.env.LOCAL_ONLY_MODE=previousLocalOnlyMode;await new Promise(resolve=>server.close(resolve));}
});
