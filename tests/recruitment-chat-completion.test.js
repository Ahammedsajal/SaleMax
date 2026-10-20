'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,actionFor,mayFinish}=require('../modules/platform/recruitment-chat-completion');
const pending={application:{cvFileName:null},control:{mode:'paused',updatedByKind:'system',reason:'recruitment-awaiting-cv'}};
test('finished questions accept only CV and recruiter, never obsolete Skip CV or new questionnaire commands',()=>{
  for(const text of ['Skip CV','Apply now','hello','s','quick questions'])assert.equal(actionFor(pending,{type:'text'},text),'silent');
  assert.equal(actionFor(pending,{type:'document'},''),'cv');
  assert.equal(actionFor(pending,{type:'interactive'},'Talk to recruiter'),'recruiter');
  assert.equal(actionFor({...pending,application:{cvFileName:'CV.pdf'}},{type:'document'},''),'silent');
});
test('manual and unrelated automatic pauses are never bypassed by CV completion',()=>{
  for(const control of [{mode:'paused',updatedByKind:'identity',reason:'recruitment-awaiting-cv'},{mode:'paused',updatedByKind:'system',reason:'human-review'}]){
    assert.equal(mayFinish(control),false);assert.equal(actionFor({...pending,control},{type:'document'},''),'silent');
  }
  assert.equal(mayFinish({mode:'paused',updatedByKind:'system',reason:'recruitment-recruiter-requested'}),true);
});
test('completion is loaded from durable application details, scoped to tenant and exact channel chat, beyond session expiry',async()=>{
  const calls=[];const db={query:async(sql,args)=>{calls.push({sql,args});return calls.length===1?[[{id:'app',fullName:'Asha',mobile:'+919876543210',contactMobile:'+919876543211',cvFileName:null}]]:[[]]}};
  const result=await load(db,{tenantId:'tenant',channelKind:'whatsapp_meta',channelRef:'number',conversationId:'chat'});
  assert.equal(result.answers.fullName,'Asha');assert.equal(result.answers.whatsappNumber,'+919876543210');assert.equal(result.answers.contactNumber,'+919876543211');
  assert.deepEqual(calls[0].args,['tenant','chat','meta']);assert.deepEqual(calls[1].args,['tenant','whatsapp_meta','number','chat']);assert.doesNotMatch(calls[0].sql,/expires_at/);
});
