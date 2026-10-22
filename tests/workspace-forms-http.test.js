'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const categories=require('../modules/platform/categories');
const {capabilities}=require('../modules/platform/policy');
const {createCategoryRegistry}=require('../modules/platform/category-registry');
const {createTrainingFormRouter,createPublicTrainingFormRouter}=require('../modules/platform/training-form-router');

const base=categories.baseCrm;
const genericCategory=createCategoryRegistry([{
  ...base,
  capabilities:[...base.capabilities,'portal.forms'],
  formsAdapter:'generic-lead-capture-v1'
}],capabilities).get(base.key,base.version);
const origin='https://workspace.example';

function context(role='owner',tenantId='tenant-a'){
  return {
    audience:'tenant',identity:{id:`identity-${role}`},
    tenant:{id:tenantId,status:'active',categoryKey:genericCategory.key,categoryVersion:genericCategory.version},
    membership:{id:`membership-${role}`,tenantId,role,status:'active'},category:genericCategory,
    subscription:{status:'active',categoryKey:genericCategory.key,categoryVersion:genericCategory.version,capabilities:[...genericCategory.capabilities]}
  };
}

function listen(app){return new Promise((resolve,reject)=>{
  const server=app.listen(0,'127.0.0.1',()=>resolve(server));
  server.once('error',reject);
});}
function close(server){return new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
async function json(response){return response.json();}

test('authenticated Forms router serves canonical and legacy alias with server tenant scope',async t=>{
  const calls=[];let acquired=0;
  const workspaceForms=require('../modules/platform/workspace-forms');
  const originalStaffForm=workspaceForms.staffForm;
  workspaceForms.staffForm=async(_db,session,formSlug)=>({adapter:'generic-lead-capture-v1',captureMode:'staff',staff:{role:session.context.membership.role},form:{slug:formSlug},tenant:{slug:'tenant-a'},courses:[]});
  const db={async query(sql,params){calls.push({sql,params});return [[{
    id:'form-a',slug:'service-contact',publishedSlug:'service-contact',nameEn:'Service contact',nameAr:'تواصل الخدمات',
    schemaJson:JSON.stringify({titleEn:'Contact',titleAr:'تواصل',consentTextEn:'Agree',consentTextAr:'موافق',templateKey:null,fields:[]}),
    draftRevision:1,publishedVersion:1,publishedDraftRevision:1,status:'published',updatedAt:'2026-10-22T00:00:00Z',tenantSlug:'tenant-a'
  }],[]];}};
  const pool={async getConnection(){acquired++;return {...db,release(){}};}};
  const guard=(req,res,next)=>{
    const token=req.get('Authorization')||'';
    const role=token==='Bearer owner'?'owner':token==='Bearer agent'?'agent':null;
    if(!role)return res.status(401).json({success:false,code:'AUTH_REQUIRED'});
    req.featureSession={context:context(role),ownerUid:'synthetic-owner-uid',...(role==='agent'?{agent:{},actor:{id:17,uid:'synthetic-agent'}}:{})};
    next();
  };
  const app=express();
  app.use('/api/workspace/forms',createTrainingFormRouter({pool,origin,sessionGuard:guard}));
  app.use('/api/user/training/forms',createTrainingFormRouter({pool,origin,sessionGuard:guard}));
  const server=await listen(app);t.after(async()=>{await close(server);workspaceForms.staffForm=originalStaffForm;});
  const root=`http://127.0.0.1:${server.address().port}`;

  for(const route of ['/api/workspace/forms/','/api/user/training/forms/']){
    const response=await fetch(`${root}${route}?tenantId=tenant-b`,{headers:{Authorization:'Bearer owner'}});
    assert.equal(response.status,200);
    const body=await json(response);
    assert.equal(body.data[0].id,'form-a');
    assert.equal(calls.at(-1).params[0],'tenant-a','tenant selector query must not change server-derived scope');
  }

  const beforeDenied=acquired;
  const denied=await fetch(`${root}/api/workspace/forms/`,{headers:{Authorization:'Bearer agent'}});
  assert.equal(denied.status,403);
  assert.equal((await json(denied)).code,'PERMISSION_DENIED');
  assert.equal(acquired,beforeDenied,'denied role must be rejected before database access');

  const staff=await fetch(`${root}/api/workspace/forms/staff/service-contact`,{headers:{Authorization:'Bearer agent'}});
  assert.equal(staff.status,200,'an Agent with forms.capture must pass the staff route gate');
  assert.equal((await json(staff)).data.staff.role,'agent');
  assert.equal(acquired,beforeDenied+1);

  const missing=await fetch(`${root}/api/workspace/forms/`);
  assert.equal(missing.status,401);
  const beforeOrigin=acquired;
  const foreignOrigin=await fetch(`${root}/api/workspace/forms/`,{
    method:'POST',headers:{Authorization:'Bearer owner',Origin:'https://attacker.example','Content-Type':'application/json'},body:JSON.stringify({})
  });
  assert.equal(foreignOrigin.status,403);
  assert.equal((await json(foreignOrigin)).code,'ORIGIN_DENIED');
  assert.equal(acquired,beforeOrigin,'foreign-origin write must be rejected before database access');
});

test('public Forms HTTP route scopes lookup and forwards versioned idempotent submissions',async t=>{
  const workspaceForms=require('../modules/platform/workspace-forms');
  const trainingForms=require('../modules/platform/training-forms');
  const original={publicForm:workspaceForms.publicForm,submitPublic:workspaceForms.submitPublic,trainingPublicForm:trainingForms.publicForm};
  const submissions=[];
  workspaceForms.publicForm=async(_pool,tenantSlug,formSlug)=>tenantSlug==='tenant-a'&&formSlug==='service-contact'?{
    adapter:'generic-lead-capture-v1',tenant:{slug:tenantSlug},form:{slug:formSlug,version:4,schema:{fields:[]}},courses:[]
  }:null;
  workspaceForms.submitPublic=async(_pool,input)=>{submissions.push(input);return {referenceCode:'FORMREF001',repeated:false};};
  trainingForms.publicForm=async()=>null;
  const app=express();
  const turnstile={enabled:false,publicConfig:{enabled:false}};
  app.use('/api/public/training/forms',createPublicTrainingFormRouter({app,pool:{async query(){return [[]];}},rateKey:'synthetic-http-test-key',origin,turnstile}));
  const server=await listen(app);t.after(async()=>{await close(server);workspaceForms.publicForm=original.publicForm;workspaceForms.submitPublic=original.submitPublic;trainingForms.publicForm=original.trainingPublicForm;});
  const root=`http://127.0.0.1:${server.address().port}/api/public/training/forms`;

  const lookup=await fetch(`${root}/tenant-a/service-contact`);
  assert.equal(lookup.status,200);
  const lookedUp=await json(lookup);
  assert.equal(lookedUp.data.adapter,'generic-lead-capture-v1');
  assert.equal(lookedUp.data.botChallenge.enabled,false);
  const missing=await fetch(`${root}/tenant-b/service-contact`);
  assert.equal(missing.status,404);

  const body={submissionToken:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',expectedFormVersion:4,values:{contact_name:'Synthetic visitor',phone:'+12025550123',consent:true}};
  const denied=await fetch(`${root}/tenant-a/service-contact/submissions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(denied.status,403);
  assert.equal((await json(denied)).code,'ORIGIN_DENIED');
  assert.equal(submissions.length,0);

  const accepted=await fetch(`${root}/tenant-a/service-contact/submissions`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(accepted.status,201);
  assert.deepEqual((await json(accepted)).data,{referenceCode:'FORMREF001',repeated:false});
  assert.equal(submissions.length,1);
  assert.equal(submissions[0].tenantSlug,'tenant-a');
  assert.equal(submissions[0].formSlug,'service-contact');
  assert.equal(submissions[0].expectedFormVersion,4);
  assert.equal(typeof submissions[0].visitorHash,'string');
});
