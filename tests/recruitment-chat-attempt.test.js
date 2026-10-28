'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const attempt=require('../modules/platform/recruitment-chat-attempt'),completion=require('../modules/platform/recruitment-chat-completion');
const scope={tenantId:'tenant-a',channelKind:'whatsapp_meta',channelRef:'channel-a',conversationId:'chat-a'};
test('restart lookup is bounded to the exact tenant, conversation, and channel',async()=>{
 const found={id:'attempt-1',startedAt:'2026-10-28 07:00:00.000000'};
 const db={query:async(sql,params)=>{assert.deepEqual(params,['tenant-a','chat-a','whatsapp_meta','channel-a']);assert.match(sql,/action='recruitment.chat-restarted'/);assert.match(sql,/ORDER BY occurred_at DESC,id DESC LIMIT 1/);return [[found]];}};
 assert.equal(await attempt.current(db,scope),found);assert.equal(attempt.submissionToken('original',found),'attempt-1');assert.equal(attempt.submissionToken('original',null),'original');
});
test('completion ignores applications preceding an explicit restart without changing their rows',async()=>{
 const calls=[],db={query:async(sql,params)=>{calls.push({sql,params});return calls.length===1?[[{id:'new-attempt',startedAt:'2026-10-28 07:00:00.000000'}]]:[[]];}};
 assert.equal(await completion.load(db,scope),null);assert.equal(calls.length,2);assert.match(calls[1].sql,/created_at>=\?/);assert.deepEqual(calls[1].params.slice(-2),['2026-10-28 07:00:00.000000','2026-10-28 07:00:00.000000']);assert.ok(calls.every(c=>c.sql.startsWith('SELECT')));
});
test('without restart the legacy application and staff pause behavior are preserved',async()=>{
 let count=0;const application={id:'old',cvFileName:null,mobile:'12345678'};
 const db={query:async()=>++count===1?[[]]:count===2?[[application]]:[[{mode:'paused',updatedByKind:'identity',reason:'Staff follow-up'}]]};
 const result=await completion.load(db,scope);assert.equal(result.application,application);assert.equal(completion.actionFor(result,{type:'text'},'hi'),'silent');assert.equal(completion.actionFor(result,{type:'document'},''),'silent');
});
test('completed screening keeps candidates separate and a restart preserves the original application',async()=>{
 const recruitment=require('../modules/platform/recruitment-applications'),crypto=require('node:crypto');
 const applications=new Map();let reset=null;
 const db={query:async(sql,p)=>{
   if(sql.includes('FROM sx_audit_events'))return [reset?[reset]:[]];
   if(sql.includes('INSERT INTO sx_recruitment_applications')){const key=p[2].toString('hex');const row=applications.get(key)||{id:p[0],referenceCode:p[3]};row.fullName=p[4];applications.set(key,row);return [{affectedRows:1}];}
   if(sql.startsWith('SELECT id,reference_code AS referenceCode FROM sx_recruitment_applications'))return [[applications.get(p[1].toString('hex'))]];
   if(sql.startsWith('SELECT'))return [[]];
   return [{affectedRows:1}];
 }};
 const base={...scope,mobile:'97450000001',senderName:'Synthetic',complete:true,consent:true,answers:{fullName:'Original applicant',email:'synthetic@example.test',currentlyWorking:'no',totalExperienceRange:'0',salesExperienceYears:'0',hasComputerAndInternet:'yes',comfortableWithSalesCalls:'yes',englishLevel:'proficient',hindiLevel:'conversational',availability:'either'}};
 const first=await recruitment.saveScreening(db,base),original=JSON.stringify([...applications.values()]);
 await recruitment.saveScreening(db,{...base,conversationId:'chat-b',mobile:'97450000002'});assert.equal(applications.size,2);
 reset={id:'11111111-1111-4111-8111-111111111111',startedAt:'2026-10-28 07:00:00.000000'};
 const next={...base,answers:{...base.answers,fullName:'Restarted applicant'}};
 const restarted=await recruitment.saveScreening(db,next);const retry=await recruitment.saveScreening(db,next);
 assert.notEqual(first.applicationId,restarted.applicationId);assert.equal(retry.applicationId,restarted.applicationId);assert.equal(applications.size,3);
 assert.equal(JSON.stringify([...applications.values()].slice(0,1)),original);
 assert.equal(applications.get(crypto.createHash('sha256').update(reset.id).digest('hex')).fullName,'Restarted applicant');
});
