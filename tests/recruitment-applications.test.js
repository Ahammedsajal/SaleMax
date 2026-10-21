'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {getCategory}=require('../modules/platform/categories');
const recruitment=require('../modules/platform/recruitment-applications');
const {decision}=require('../modules/platform/policy');

const owner={audience:'tenant',tenant:{id:'11111111-1111-4111-8111-111111111111',status:'active',categoryKey:'7network_sales',categoryVersion:1},membership:{id:'22222222-2222-4222-8222-222222222222',tenantId:'11111111-1111-4111-8111-111111111111',role:'owner',status:'active'},category:getCategory('7network_sales',1),subscription:{status:'active',capabilities:['hr.recruitment']}};
const valid={submissionToken:'33333333-3333-4333-8333-333333333333',fullName:'Asha Candidate',mobile:'+91 98765 43210',email:'asha@example.in',englishLevel:'proficient',hindiLevel:'conversational',experienceYears:'4',crmSaasExperience:'Four years in SaaS and CRM sales.',availability:'either',consent:'on'};

test('recruitment form validates and normalizes applicant details',()=>{
  const result=recruitment.cleanApplication(valid);
  assert.equal(result.fullName,'Asha Candidate');assert.equal(result.normalizedMobile,'+919876543210');assert.equal(result.email,'asha@example.in');assert.equal(result.experienceYears,4);assert.equal(result.sourceChannel,'public_form');
});
test('application stores the requested pre-screen answers and keeps WhatsApp separate from contact number',()=>{
  const result=recruitment.cleanApplication({...valid,mobile:'+919876543210',contactMobile:'+919876500000',currentWorkStatus:'yes',totalExperienceRange:'3+',salesExperienceYears:'1-2',hasComputerAndInternet:'yes',comfortableWithSalesCalls:'yes'});
  assert.equal(result.mobile,'+919876543210');assert.equal(result.contactMobile,'+919876500000');assert.equal(result.currentWorkStatus,'yes');assert.equal(result.totalExperienceRange,'3+');assert.equal(result.salesExperienceYears,'1-2');assert.equal(result.hasComputerAndInternet,'yes');assert.equal(result.comfortableWithSalesCalls,'yes');
  assert.throws(()=>recruitment.cleanApplication({...valid,comfortableWithSalesCalls:'maybe'}),{code:'INVALID_APPLICATION'});
});
test('prefill links use opaque expiring tokens and return only consented candidate screening fields',async()=>{
  let inserted;const db={query:async(sql,params)=>{inserted={sql,params};return [{affectedRows:1}];}};
  const token=await recruitment.issuePrefillToken(db,{tenantId:owner.tenant.id,answers:{fullName:'Asha',email:'asha@example.in',whatsappNumber:'+919876543210',privateNote:'do not retain'}});
  assert.match(token,/^[A-Za-z0-9_-]{40,60}$/);assert.match(inserted.sql,/INTERVAL 14 DAY/);assert.doesNotMatch(JSON.stringify(inserted.params),/privateNote/);
  const dbRead={query:async(sql,params)=>{assert.match(sql,/expires_at>UTC_TIMESTAMP/);assert.match(sql,/t\.category_key IN \(\?,\?\)/);assert.deepEqual(params,['salemax-sales','7network_sales','salemax_sales',require('node:crypto').createHash('sha256').update(token).digest()]);return [[{answers:JSON.stringify({fullName:'Asha'})}]];}};
  assert.deepEqual(await recruitment.getPrefill(dbRead,{tenantSlug:'salemax-sales',token}),{fullName:'Asha'});
  await assert.rejects(recruitment.getPrefill(dbRead,{tenantSlug:'salemax-sales',token:'bad'}),{code:'PREFILL_NOT_FOUND'});
});
test('public hiring consent names 7Network as the hiring company',()=>{
  assert.match(recruitment.CONSENT,/save my WhatsApp application answers and CV in its private Applications & CVs area/);
  assert.doesNotMatch(recruitment.CONSENT,/Sitta Arbaa Sitta/i);
});
test('recruitment requires explicit consent and valid English/Hindi levels',()=>{
  assert.throws(()=>recruitment.cleanApplication({...valid,consent:''}),{code:'CONSENT_REQUIRED'});
  assert.throws(()=>recruitment.cleanApplication({...valid,englishLevel:'fluent'}),{code:'INVALID_ENGLISH_LEVEL'});
  assert.throws(()=>recruitment.cleanApplication({...valid,hindiLevel:'native'}),{code:'INVALID_HINDI_LEVEL'});
  assert.throws(()=>recruitment.cleanApplication({...valid,mobile:'123'}),{code:'INVALID_MOBILE'});
});
test('recruitment CV signature is checked rather than trusting the file extension',()=>{
  assert.deepEqual(recruitment.detectCv(Buffer.from('%PDF-1.7')), {mime:'application/pdf',ext:'pdf'});
  assert.deepEqual(recruitment.detectCv(Buffer.from([0x50,0x4b,0x03,0x04])), {mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ext:'docx'});
  assert.equal(recruitment.detectCv(Buffer.from('not a pdf')),null);
});
test('WhatsApp answers map to a repeat-safe application and CV links are same-origin files',async()=>{
  const answers={fullName:'Asha Candidate',email:'asha@example.in',currentlyWorking:'yes',whatsappNumber:'+919876543210',contactNumber:'+919876543210',totalExperienceRange:'3+',salesExperienceYears:'1-2',hasComputerAndInternet:'yes',comfortableWithSalesCalls:'yes',englishLevel:'proficient',hindiLevel:'none',availability:'full_time'};
  const base={answers,mobile:'+919876543210',channelKind:'whatsapp_qr',channelRef:'qr-instance',conversationId:'chat-1'};
  const body=recruitment.whatsappApplicationBody(base);
  assert.equal(body.source,'whatsapp');assert.equal(body.currentWorkStatus,'yes');assert.equal(body.experienceYears,'3');assert.equal(body.contactMobile,'+919876543210');
  assert.equal(body.submissionToken,recruitment.whatsappApplicationBody(base).submissionToken);
  assert.throws(()=>recruitment.whatsappApplicationBody({...base,answers:{...answers,email:''}}),{code:'SCREENING_INCOMPLETE'});
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'salemax-cv-'));
  try{
    await fs.writeFile(path.join(root,'candidate.bin'),Buffer.from('%PDF-1.7 test'));
    const cv=await recruitment.resolveWhatsAppCv({mediaUrl:'https://crm.salemax.qa/meta-media/candidate.bin',fileName:'candidate.docx',frontendUri:'https://crm.salemax.qa',mediaRoot:root});
    assert.equal(cv.name,'candidate.pdf');assert.equal(cv.size,13);
    await assert.rejects(recruitment.resolveWhatsAppCv({mediaUrl:'https://evil.example/meta-media/candidate.bin',frontendUri:'https://crm.salemax.qa',mediaRoot:root}),{code:'INVALID_CV_FILE'});
    await fs.writeFile(path.join(root,'bad.pdf'),'not a CV');
    await assert.rejects(recruitment.resolveWhatsAppCv({mediaUrl:'https://crm.salemax.qa/meta-media/bad.pdf',frontendUri:'https://crm.salemax.qa',mediaRoot:root}),{code:'CV_TYPE_NOT_ALLOWED'});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('only an active 7Network Sales owner can review hiring records',()=>{
  assert.equal(recruitment.authorize(owner),owner);
  assert.equal(recruitment.authorize({...owner,tenant:{...owner.tenant,categoryKey:'salemax_sales'},subscription:{...owner.subscription,categoryKey:'salemax_sales',categoryVersion:1}}).tenant.categoryKey,'salemax_sales');
  assert.throws(()=>recruitment.authorize({...owner,membership:{...owner.membership,role:'manager'}}),{code:'PERMISSION_DENIED'});
  assert.throws(()=>recruitment.authorize({...owner,tenant:{...owner.tenant,categoryKey:'training_center'},category:getCategory('training_center',1)}),{code:'CATEGORY_UNAVAILABLE'});
});

test('recruitment queries retain the active legacy Sales category as a compatible identity alias',()=>{
  assert.deepEqual(recruitment.SALES_CATEGORY_KEYS,['7network_sales','salemax_sales']);
});
test('recruitment CV storage requires a private absolute path',()=>{
  assert.equal(recruitment.storageRoot({SALEMAX_RECRUITMENT_CV_ROOT:'/private/salemax/cv'}),'/private/salemax/cv');
  assert.throws(()=>recruitment.storageRoot({}),{code:'RECRUITMENT_STORAGE_NOT_CONFIGURED'});
});

test('application notification queue failures do not block a submitted application',async()=>{
  const warnings=[],originalWarn=console.warn;
  console.warn=(...args)=>warnings.push(args);
  try{
    const result=await recruitment.queueApplicationNotification({}, {tenantId:owner.tenant.id,application:{id:'application-1'}}, async()=>{throw Object.assign(new Error('database details are private'),{code:'ER_NO_SUCH_TABLE'});});
    assert.deepEqual(result,{queued:false,reason:'ER_NO_SUCH_TABLE'});
    assert.equal(warnings.length,1);
    assert.deepEqual(warnings[0],['[recruitment] Founder notification was not queued','ER_NO_SUCH_TABLE']);
    assert.doesNotMatch(JSON.stringify(warnings),/database details are private/);
  }finally{console.warn=originalWarn;}
});

test('pre-screen answers are saved only with explicit consent and stay tied to the WhatsApp conversation',async()=>{
  const calls=[],db={query:async(sql,params)=>{calls.push({sql,params});return [{affectedRows:1}];}};
  const input={tenantId:owner.tenant.id,channelKind:'whatsapp_meta',channelRef:'meta-channel',conversationId:'candidate-chat',mobile:'+91 98765 43210',senderName:'Asha',answers:{location:'india',englishLevel:'proficient',privateNote:'discard'},complete:false,consent:false};
  assert.equal(await recruitment.saveScreening(db,input),false);
  assert.equal(calls.length,0);
  assert.deepEqual(await recruitment.saveScreening(db,{...input,consent:true}),{saved:true,applicationId:null,referenceCode:null});
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/ON DUPLICATE KEY UPDATE/);
  assert.equal(calls[0].params[1],owner.tenant.id);
  assert.deepEqual(JSON.parse(calls[0].params[9]),{location:'india',englishLevel:'proficient'});
  assert.equal(calls[0].params[10],recruitment.SCREENING_CONSENT);
  assert.equal(calls[0].params[11],0);
});

test('pre-screen review is tenant-scoped and returns a direct conversation link',async()=>{
  const item={id:'screen-1',mobile:'+919876543210',senderName:'Asha',answers:JSON.stringify({location:'india'}),channelKind:'whatsapp_meta',linkedChatId:'chat-1',channelRef:'meta-1',consentedAt:new Date(),completedAt:null,updatedAt:new Date()};
  const db={query:async(sql,params)=>{
    if(sql.startsWith('SELECT COUNT')){assert.match(sql,/tenant_id=\?/);assert.deepEqual(params,[owner.tenant.id]);return [[{total:1}]];}
    assert.match(sql,/FROM sx_recruitment_screenings/);assert.deepEqual(params,[owner.tenant.id,25,0]);return [[item]];
  }};
  const result=await recruitment.listScreenings(db,owner,{});
  assert.equal(result.total,1);assert.equal(result.items[0].chatOrigin,'meta');assert.deepEqual(result.items[0].answers,{location:'india'});
});

test('application phone match links only the unique owner workspace contact and lead',async()=>{
  const calls=[];
  const db={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('FROM sx_legacy_ownership'))return [[{uidHash:'owner-hash',uid:'sales-owner'}]];
    if(sql.includes('FROM pipeline_contacts'))return [[{id:'contact-1'}]];
    if(sql.includes('FROM pipeline_leads'))return [[{id:'lead-1'}]];
    if(sql.includes('FROM beta_chats'))return [[{chatId:'chat-1',chatOrigin:'meta'}]];
    throw new Error('Unexpected recruitment matching query');
  }};
  const linked=await recruitment.matchExistingLead(db,{tenant:{id:owner.tenant.id}},'+919876543210');
  assert.deepEqual(linked,{contactId:'contact-1',leadId:'lead-1',chatId:'chat-1',chatOrigin:'meta',uid:'sales-owner'});
  assert.deepEqual(calls[0].params,[owner.tenant.id]);
  assert.deepEqual(calls[1].params,['owner-hash','+919876543210']);
  assert.deepEqual(calls[2].params,['sales-owner','+919876543210','919876543210']);
  assert.deepEqual(calls[3].params,['owner-hash','contact-1']);
});

test('application phone match refuses ambiguous workspace ownership and leaves unmatched applicants unlinked',async()=>{
  let queries=0;
  const ambiguous={query:async()=>{queries++;return [[{uidHash:'owner-a',uid:'owner-a'},{uidHash:'owner-b',uid:'owner-b'}]];}};
  assert.deepEqual(await recruitment.matchExistingLead(ambiguous,{tenant:{id:owner.tenant.id}},'+919876543210'),{contactId:null,leadId:null,chatId:null,chatOrigin:null});
  assert.equal(queries,1,'ambiguous ownership never queries contacts or leads');

  const unmatched={query:async(sql)=>{
    if(sql.includes('FROM sx_legacy_ownership'))return [[{uidHash:'owner-hash',uid:'sales-owner'}]];
    if(sql.includes('FROM pipeline_contacts'))return [[]];
    if(sql.includes('FROM beta_chats'))return [[]];
    throw new Error('An unmatched phone must not query or create a lead');
  }};
  assert.deepEqual(await recruitment.matchExistingLead(unmatched,{tenant:{id:owner.tenant.id}},'+919876543210'),{contactId:null,leadId:null,chatId:null,chatOrigin:null,uid:'sales-owner'});
});

test('application phone match links an existing WhatsApp chat even when no Phonebook contact or lead exists',async()=>{
  const calls=[];
  const db={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('FROM sx_legacy_ownership'))return [[{uidHash:'owner-hash',uid:'sales-owner'}]];
    if(sql.includes('FROM pipeline_contacts'))return [[]];
    if(sql.includes('FROM beta_chats'))return [[{chatId:'chat-only-1',chatOrigin:'qr'}]];
    throw new Error('A chat-only match must not invent a phonebook contact or lead');
  }};
  const linked=await recruitment.matchExistingLead(db,{tenant:{id:owner.tenant.id}},'+919876543210');
  assert.deepEqual(linked,{contactId:null,leadId:null,chatId:'chat-only-1',chatOrigin:'qr',uid:'sales-owner'});
  assert.deepEqual(calls[2].params,['sales-owner','+919876543210','919876543210']);
});

test('application review exposes the latest chat linked to its matched lead',async()=>{
  const item={id:'application-1',referenceCode:'SMX-ABC12345',fullName:'Asha Candidate',mobile:'+91 98765 43210',email:null,englishLevel:'proficient',hindiLevel:'none',experienceYears:4,crmSaasExperience:'SaaS sales',availability:'either',cvFileName:'asha.pdf',cvMimeType:'application/pdf',cvBytes:123,linkedContactId:'contact-1',linkedLeadId:'lead-1',linkedChatId:'chat-1',linkedChatOrigin:'meta',sourceChannel:'whatsapp',sourceReference:null,status:'new',revision:1,consentedAt:new Date(),createdAt:new Date(),updatedAt:new Date()};
  const db={query:async(sql,params)=>{
    if(sql.startsWith('SELECT COUNT')){assert.deepEqual(params,[owner.tenant.id]);return [[{total:1}]];}
    assert.match(sql,/COALESCE\(a\.linked_chat_id/,'review query must prioritize an exact existing chat linked at submission');
    assert.match(sql,/pipeline_conversations pc/,'legacy applications must still resolve chats through their matched lead');
    assert.deepEqual(params,[owner.tenant.id,25,0]);return [[item]];
  }};
  const result=await recruitment.list(db,owner,{status:'all'});
  assert.equal(result.total,1);
  assert.equal(result.items[0].linkedContactId,'contact-1');
  assert.equal(result.items[0].linkedLeadId,'lead-1');
  assert.equal(result.items[0].linkedChatId,'chat-1');
  assert.equal(result.items[0].linkedChatOrigin,'meta');
});

test('internal 7Network owner recruitment does not change the published plan entitlement',()=>{
  const withoutFeature={...owner,subscription:{status:'active',capabilities:[]}};
  assert.equal(decision(withoutFeature,{capability:'hr.recruitment',permission:'recruitment.manage'}).allowed,true);
  assert.equal(decision({...withoutFeature,membership:{...owner.membership,role:'manager'}},{capability:'hr.recruitment',permission:'recruitment.manage'}).allowed,false);
});
