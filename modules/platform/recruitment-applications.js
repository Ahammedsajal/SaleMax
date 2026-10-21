'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {decision}=require('./policy');
const {categoryKeysFor,categoryKeyMatches,canonicalCategoryKey,getCategory}=require('./categories');

const SALES_CATEGORY_KEYS=categoryKeysFor('7network_sales');
const SALES_CATEGORY_FILTER=`(${SALES_CATEGORY_KEYS.map(()=>'?').join(',')})`;

const MAX_CV_BYTES=8*1024*1024;
const CONSENT='I agree that 7Network may save my WhatsApp application answers and CV in its private Applications & CVs area, assess me for the 7Network sales associate role, and contact me about recruitment.';
const SCREENING_CONSENT='Candidate agreed to save WhatsApp application answers in the private Applications & CVs area for recruitment review and follow-up; a CV is optional and is saved only if submitted.';
const STATUSES=new Set(['new','reviewing','shortlisted','interview','rejected','hired','archived']);
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const hash=value=>crypto.createHash('sha256').update(String(value)).digest();
const uuid=()=>crypto.randomUUID();

function authorize(ctx){
  if(!ctx||ctx.audience!=='tenant'||!categoryKeyMatches(ctx.tenant?.categoryKey,'7network_sales'))fail('CATEGORY_UNAVAILABLE',404);
  const normalized={...ctx,tenant:{...ctx.tenant,categoryKey:canonicalCategoryKey(ctx.tenant.categoryKey)},category:getCategory('7network_sales',ctx.tenant.categoryVersion)};
  if(normalized.subscription&&Object.hasOwn(normalized.subscription,'categoryKey'))normalized.subscription={...normalized.subscription,categoryKey:canonicalCategoryKey(normalized.subscription.categoryKey)};
  const result=decision(normalized,{capability:'hr.recruitment',permission:'recruitment.manage'});
  if(!result.allowed)fail(result.code,result.code==='PERMISSION_DENIED'?403:409);
  if(ctx.membership.role!=='owner')fail('PERMISSION_DENIED',403);
  return ctx;
}
function storageRoot(env=process.env){const root=String(env.SALEMAX_RECRUITMENT_CV_ROOT||'').trim();if(!root||!path.isAbsolute(root))fail('RECRUITMENT_STORAGE_NOT_CONFIGURED',503);return path.resolve(root);}
function detectCv(bytes){
  if(!Buffer.isBuffer(bytes))return null;
  if(bytes.length>=5&&bytes.subarray(0,5).toString('ascii')==='%PDF-')return {mime:'application/pdf',ext:'pdf'};
  if(bytes.length>=4&&bytes[0]===0x50&&bytes[1]===0x4b&&[0x03,0x05,0x07].includes(bytes[2]))return {mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ext:'docx'};
  return null;
}
function normalizeMobile(value){const digits=String(value||'').replace(/[^0-9]/g,'');if(digits.length<8||digits.length>15)fail('INVALID_MOBILE');return digits;}
function cleanApplication(body){
  const b=body&&typeof body==='object'&&!Array.isArray(body)?body:{};
  const text=(key,max,required=true)=>{const value=b[key];if(!required&&(value===undefined||value===null||value===''))return '';if(typeof value!=='string'||value.trim().length>(max)||required&&!value.trim())fail('INVALID_APPLICATION');return value.trim();};
  const fullName=text('fullName',160),mobile=text('mobile',40),normalizedMobile='+'+normalizeMobile(mobile),contactMobile=text('contactMobile',40,false),email=text('email',254,false).toLowerCase();
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('INVALID_EMAIL');
  const englishLevel=text('englishLevel',20),hindiLevel=text('hindiLevel',20),years=Number(b.experienceYears);
  if(!['proficient','native','intermediate','basic'].includes(englishLevel))fail('INVALID_ENGLISH_LEVEL');
  if(!['fluent','conversational','basic','none'].includes(hindiLevel))fail('INVALID_HINDI_LEVEL');
  if(!Number.isInteger(years)||years<0||years>50)fail('INVALID_EXPERIENCE_YEARS');
  const experience=text('crmSaasExperience',2000,false),availability=text('availability',20);
  if(!['part_time','full_time','either'].includes(availability))fail('INVALID_AVAILABILITY');
  const currentWorkStatus=text('currentWorkStatus',3,false),totalExperienceRange=text('totalExperienceRange',12,false),salesExperienceYears=text('salesExperienceYears',12,false),hasComputerAndInternet=text('hasComputerAndInternet',3,false),comfortableWithSalesCalls=text('comfortableWithSalesCalls',3,false);
  if(currentWorkStatus&&!['yes','no'].includes(currentWorkStatus)||hasComputerAndInternet&&!['yes','no'].includes(hasComputerAndInternet)||comfortableWithSalesCalls&&!['yes','no'].includes(comfortableWithSalesCalls))fail('INVALID_APPLICATION');
  if(totalExperienceRange&&!['0','1-2','3+'].includes(totalExperienceRange)||salesExperienceYears&&!['0','1-2','3+'].includes(salesExperienceYears))fail('INVALID_APPLICATION');
  if(![true,'true','on','1'].includes(b.consent))fail('CONSENT_REQUIRED');
  const source=String(b.source||'').trim().toLowerCase();
  return {fullName,mobile,normalizedMobile,contactMobile:contactMobile||mobile,email:email||null,currentWorkStatus:currentWorkStatus||null,englishLevel,hindiLevel,experienceYears:years,totalExperienceRange:totalExperienceRange||null,salesExperienceYears:salesExperienceYears||null,hasComputerAndInternet:hasComputerAndInternet||null,comfortableWithSalesCalls:comfortableWithSalesCalls||null,crmSaasExperience:experience,availability,sourceChannel:source==='whatsapp'?'whatsapp':'public_form',sourceReference:typeof b.sourceReference==='string'?b.sourceReference.slice(0,160):null};
}
function cleanScreeningAnswers(answers={}){const keys=['fullName','email','whatsappNumber','contactNumber','currentlyWorking','contactNumberSame','totalExperienceRange','salesExperienceYears','hasComputerAndInternet','comfortableWithSalesCalls','englishLevel','hindiLevel','availability'];return Object.fromEntries(keys.filter(key=>typeof answers[key]==='string').map(key=>[key,answers[key].slice(0,254)]));}
async function queueApplicationNotification(db,{tenantId,application},enqueue=require('./recruitment-founder-notifications').enqueueApplication){
  let result;
  try{result=await enqueue(db,{tenantId,application});}
  catch(error){result={queued:false,reason:/^[A-Z0-9_]{2,80}$/.test(error?.code||'')?error.code:'QUEUE_UNAVAILABLE'};}
  if(!result?.queued)console.warn('[recruitment] Founder notification was not queued',result?.reason||'QUEUE_UNAVAILABLE');
  return result||{queued:false,reason:'QUEUE_UNAVAILABLE'};
}
async function issuePrefillToken(db,{tenantId,applicationId,answers}){const token=crypto.randomBytes(32).toString('base64url');await db.query('INSERT INTO sx_recruitment_prefill_tokens(id,tenant_id,application_id,token_hash,answers,expires_at) VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 14 DAY))',[uuid(),tenantId,applicationId||null,hash(token),JSON.stringify(cleanScreeningAnswers(answers))]);return token;}
async function getPrefill(pool,{tenantSlug,token}){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{40,60}$/.test(token))fail('PREFILL_NOT_FOUND',404);const [rows]=await pool.query(`SELECT p.answers FROM sx_recruitment_prefill_tokens p JOIN sx_tenants t ON t.id=p.tenant_id WHERE t.slug=? AND t.category_key IN ${SALES_CATEGORY_FILTER} AND t.status='active' AND p.token_hash=? AND p.expires_at>UTC_TIMESTAMP(3) AND p.consumed_at IS NULL LIMIT 1`,[tenantSlug,...SALES_CATEGORY_KEYS,hash(token)]);if(!rows.length)fail('PREFILL_NOT_FOUND',404);return typeof rows[0].answers==='string'?JSON.parse(rows[0].answers):rows[0].answers;}
function cleanFileName(value){const name=path.basename(String(value||'CV').replace(/[\r\n\0]/g,'')).trim();return (name||'CV').slice(0,180);}
function stableSubmissionToken(value){const bytes=crypto.createHash('sha256').update(String(value)).digest().subarray(0,16);bytes[6]=(bytes[6]&0x0f)|0x50;bytes[8]=(bytes[8]&0x3f)|0x80;const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
function whatsappApplicationBody({answers,mobile,tenantId,channelKind,channelRef,conversationId}){
  if(!answers||typeof answers!=='object'||Array.isArray(answers)||!answers.fullName||!answers.email||!answers.currentlyWorking||!answers.totalExperienceRange||!answers.salesExperienceYears||!answers.hasComputerAndInternet||!answers.comfortableWithSalesCalls||!answers.englishLevel||!answers.hindiLevel||!answers.availability)fail('SCREENING_INCOMPLETE');
  if(!['whatsapp_meta','whatsapp_qr'].includes(channelKind)||typeof channelRef!=='string'||!channelRef||typeof conversationId!=='string'||!conversationId)fail('INVALID_WHATSAPP_APPLICATION');
  const years=answers.totalExperienceRange==='0'?0:answers.totalExperienceRange==='1-2'?1:answers.totalExperienceRange==='3+'?3:NaN;
  const sourceReference=`whatsapp:${crypto.createHash('sha256').update(`${channelKind}\0${channelRef}\0${conversationId}`).digest('hex')}`;
  return {submissionToken:stableSubmissionToken(sourceReference),fullName:String(answers.fullName),mobile:String(mobile||answers.whatsappNumber||''),contactMobile:String(answers.contactNumber||mobile||answers.whatsappNumber||''),email:String(answers.email),currentWorkStatus:String(answers.currentlyWorking),englishLevel:String(answers.englishLevel),hindiLevel:String(answers.hindiLevel),experienceYears:String(years),totalExperienceRange:String(answers.totalExperienceRange),salesExperienceYears:String(answers.salesExperienceYears),hasComputerAndInternet:String(answers.hasComputerAndInternet),comfortableWithSalesCalls:String(answers.comfortableWithSalesCalls),crmSaasExperience:String(answers.crmSaasExperience||''),availability:String(answers.availability),consent:'on',source:'whatsapp',sourceReference,website:''};
}
async function resolveWhatsAppCv({mediaUrl,fileName,frontendUri=process.env.FRONTENDURI,mediaRoot=path.resolve(__dirname,'../../client/public/meta-media')}){
  let target,base;try{target=new URL(String(mediaUrl||''));base=new URL(String(frontendUri||''));}catch{fail('INVALID_CV_FILE',415);}
  if(target.origin!==base.origin||target.search||target.hash||!/^\/meta-media\/[A-Za-z0-9._-]+$/.test(target.pathname))fail('INVALID_CV_FILE',415);
  const name=decodeURIComponent(target.pathname.slice('/meta-media/'.length));if(name!==path.basename(name)||name==='.'||name==='..')fail('INVALID_CV_FILE',415);
  const root=path.resolve(mediaRoot),filePath=path.resolve(root,name);if(!filePath.startsWith(root+path.sep))fail('INVALID_CV_FILE',415);
  const stat=await fs.lstat(filePath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>MAX_CV_BYTES)fail('INVALID_CV_FILE',413);
  const bytes=await fs.readFile(filePath);if(bytes.length!==stat.size||!detectCv(bytes))fail('CV_TYPE_NOT_ALLOWED',415);
  const detected=detectCv(bytes),provided=cleanFileName(fileName),parsedName=path.parse(provided),extension=parsedName.ext.toLowerCase()===`.${detected.ext}`?parsedName.ext:`.${detected.ext}`;const finalName=`${parsedName.name||'candidate-cv'}${extension}`;
  return {tempFilePath:filePath,size:bytes.length,name:finalName,sourcePath:filePath};
}
async function storePrivateCv(file,{tenantId,applicationId,env=process.env}){
  if(!file||file.truncated||!file.tempFilePath||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_CV_BYTES)fail('INVALID_CV_FILE',413);
  const bytes=await fs.readFile(file.tempFilePath);if(bytes.length!==file.size)fail('INVALID_CV_FILE');const detected=detectCv(bytes);if(!detected)fail('CV_TYPE_NOT_ALLOWED',415);
  const root=storageRoot(env),storedName=`${crypto.randomBytes(18).toString('hex')}.${detected.ext}`,storageKey=`${tenantId}/${applicationId}/${storedName}`,filePath=path.join(root,storageKey);
  await fs.mkdir(root,{recursive:true,mode:0o700});const rootStat=await fs.lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||(rootStat.mode&0o077)!==0)fail('RECRUITMENT_STORAGE_UNAVAILABLE',503);
  await fs.mkdir(path.dirname(filePath),{recursive:true,mode:0o700});const dirStat=await fs.lstat(path.dirname(filePath));if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||(dirStat.mode&0o077)!==0)fail('RECRUITMENT_STORAGE_UNAVAILABLE',503);
  const handle=await fs.open(filePath,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  return {bytes,detected,storageKey,fileName:cleanFileName(file.name),filePath};
}
async function list(db,ctx,query={}){
  authorize(ctx);const page=Math.max(1,Math.min(100000,Number.parseInt(query.page,10)||1)),limit=Math.min(50,Math.max(1,Number.parseInt(query.limit,10)||25));
  const status=String(query.status||'').trim(),search=String(query.search||'').trim().slice(0,100),clauses=['a.tenant_id=?'],params=[ctx.tenant.id];
  if(status&&status!=='all'){if(!STATUSES.has(status))fail('INVALID_STATUS');clauses.push('a.status=?');params.push(status);}
  if(search){const term=`%${search.replace(/[\\%_]/g,'\\$&')}%`;clauses.push('(a.reference_code LIKE ? OR a.full_name LIKE ? OR a.normalized_mobile LIKE ? OR a.email LIKE ?)');params.push(term,term,term,term);}
  const where=clauses.join(' AND '),[[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_recruitment_applications a WHERE ${where}`,params);
  const [items]=await db.query(`SELECT a.id,a.reference_code AS referenceCode,a.full_name AS fullName,a.mobile,a.contact_mobile AS contactMobile,a.email,a.current_work_status AS currentWorkStatus,a.has_computer_and_internet AS hasComputerAndInternet,a.comfortable_with_sales_calls AS comfortableWithSalesCalls,a.total_experience_range AS totalExperienceRange,a.sales_experience_years AS salesExperienceYears,a.english_level AS englishLevel,a.hindi_level AS hindiLevel,a.experience_years AS experienceYears,a.crm_saas_experience AS crmSaasExperience,a.availability,a.cv_file_name AS cvFileName,a.cv_mime_type AS cvMimeType,a.cv_bytes AS cvBytes,a.linked_contact_id AS linkedContactId,a.linked_lead_id AS linkedLeadId,COALESCE(a.linked_chat_id,(SELECT pc.chat_id FROM pipeline_conversations pc WHERE pc.uid_hash=(SELECT legacy_uid_hash FROM sx_legacy_ownership WHERE tenant_id=a.tenant_id AND source_table='user' LIMIT 1) AND pc.lead_id=a.linked_lead_id ORDER BY pc.last_inbound_at DESC LIMIT 1)) AS linkedChatId,COALESCE(a.linked_chat_origin,(SELECT pc.origin FROM pipeline_conversations pc WHERE pc.uid_hash=(SELECT legacy_uid_hash FROM sx_legacy_ownership WHERE tenant_id=a.tenant_id AND source_table='user' LIMIT 1) AND pc.lead_id=a.linked_lead_id ORDER BY pc.last_inbound_at DESC LIMIT 1)) AS linkedChatOrigin,a.source_channel AS sourceChannel,a.source_reference AS sourceReference,a.status,a.revision,a.consented_at AS consentedAt,a.created_at AS createdAt,a.updated_at AS updatedAt FROM sx_recruitment_applications a WHERE ${where} ORDER BY a.created_at DESC,a.id LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
  return {items:items.map(item=>({...item,experienceYears:Number(item.experienceYears),cvBytes:Number(item.cvBytes),revision:Number(item.revision)})),page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit)};
}
async function saveScreening(db,{tenantId,channelKind,channelRef,conversationId,mobile,senderName,answers,complete,consent}){
  if(consent!==true||!answers||!Object.keys(answers).length||!['whatsapp_meta','whatsapp_qr'].includes(channelKind))return false;
  let normalizedMobile;try{normalizedMobile='+'+normalizeMobile(mobile);}catch{return false;}
  if(typeof conversationId!=='string'||!conversationId||typeof channelRef!=='string'||!channelRef)return false;
  const allowed=['location','fullName','email','whatsappNumber','contactNumber','currentlyWorking','contactNumberSame','totalExperienceRange','salesExperienceYears','hasComputerAndInternet','comfortableWithSalesCalls','englishLevel','hindiLevel','salesExperience','availability'];
  const safeAnswers=Object.fromEntries(allowed.filter(key=>typeof answers[key]==='string').map(key=>[key,answers[key]]));
  if(!Object.keys(safeAnswers).length)return false;
  await db.query(`INSERT INTO sx_recruitment_screenings(id,tenant_id,channel_kind,channel_ref,conversation_id,conversation_hash,mobile,normalized_mobile,sender_name,answers,consent_text,consented_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),IF(?,UTC_TIMESTAMP(3),NULL))
    ON DUPLICATE KEY UPDATE mobile=VALUES(mobile),sender_name=COALESCE(VALUES(sender_name),sender_name),answers=VALUES(answers),completed_at=IF(VALUES(completed_at) IS NULL,completed_at,VALUES(completed_at))`,
  [uuid(),tenantId,channelKind,channelRef,conversationId,hash(conversationId),String(mobile).slice(0,40),normalizedMobile,typeof senderName==='string'?senderName.trim().slice(0,160)||null:null,JSON.stringify(safeAnswers),SCREENING_CONSENT,complete?1:0]);
  if(!complete)return {saved:true,applicationId:null,referenceCode:null};
  const body=cleanApplication(whatsappApplicationBody({answers:safeAnswers,mobile,channelKind,channelRef,conversationId}));
  const match=await matchExistingLead(db,{tenant:{id:tenantId}},body.normalizedMobile);
  const id=uuid(),referenceCode=`SMX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  await db.query(`INSERT INTO sx_recruitment_applications(id,tenant_id,submission_hash,reference_code,full_name,mobile,normalized_mobile,email,current_work_status,contact_mobile,english_level,hindi_level,experience_years,total_experience_range,sales_experience_years,has_computer_and_internet,comfortable_with_sales_calls,crm_saas_experience,availability,cv_storage_key,cv_file_name,cv_mime_type,cv_bytes,cv_sha256,linked_contact_id,linked_lead_id,linked_chat_id,linked_chat_origin,source_channel,source_reference,consent_text,consented_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE full_name=VALUES(full_name),mobile=VALUES(mobile),normalized_mobile=VALUES(normalized_mobile),email=VALUES(email),current_work_status=VALUES(current_work_status),contact_mobile=VALUES(contact_mobile),english_level=VALUES(english_level),hindi_level=VALUES(hindi_level),experience_years=VALUES(experience_years),total_experience_range=VALUES(total_experience_range),sales_experience_years=VALUES(sales_experience_years),has_computer_and_internet=VALUES(has_computer_and_internet),comfortable_with_sales_calls=VALUES(comfortable_with_sales_calls),crm_saas_experience=VALUES(crm_saas_experience),availability=VALUES(availability),linked_contact_id=COALESCE(VALUES(linked_contact_id),linked_contact_id),linked_lead_id=COALESCE(VALUES(linked_lead_id),linked_lead_id),linked_chat_id=VALUES(linked_chat_id),linked_chat_origin=VALUES(linked_chat_origin),revision=revision+1`,
  [id,tenantId,hash(body.submissionToken),referenceCode,body.fullName,body.mobile,body.normalizedMobile,body.email,body.currentWorkStatus,body.contactMobile,body.englishLevel,body.hindiLevel,body.experienceYears,body.totalExperienceRange,body.salesExperienceYears,body.hasComputerAndInternet,body.comfortableWithSalesCalls,body.crmSaasExperience,body.availability,null,null,null,null,null,match.contactId,match.leadId,conversationId,channelKind==='whatsapp_meta'?'meta':'qr','whatsapp',body.sourceReference,SCREENING_CONSENT]);
  const [[application]]=await db.query('SELECT id,reference_code AS referenceCode FROM sx_recruitment_applications WHERE tenant_id=? AND submission_hash=?',[tenantId,hash(body.submissionToken)]);
  if(application){
    await queueApplicationNotification(db,{tenantId,application:{id:application.id,referenceCode:application.referenceCode,...body,normalizedMobile:body.normalizedMobile,cvFileName:null}});
  }
  return {saved:true,applicationId:application?.id||null,referenceCode:application?.referenceCode||null};
}
async function listScreenings(db,ctx,query={}){
  authorize(ctx);
  const page=Math.max(1,Math.min(100000,Number.parseInt(query.page,10)||1)),limit=Math.min(50,Math.max(1,Number.parseInt(query.limit,10)||25)),search=String(query.search||'').trim().slice(0,100);
  const clauses=['s.tenant_id=?'],params=[ctx.tenant.id];
  if(search){const term=`%${search.replace(/[\\%_]/g,'\\$&')}%`;clauses.push('(s.sender_name LIKE ? OR s.mobile LIKE ?)');params.push(term,term);}
  const where=clauses.join(' AND '),[[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_recruitment_screenings s WHERE ${where}`,params);
  const [items]=await db.query(`SELECT s.id,s.mobile,s.sender_name AS senderName,s.answers,s.channel_kind AS channelKind,s.conversation_id AS linkedChatId,s.channel_ref AS channelRef,s.consented_at AS consentedAt,s.completed_at AS completedAt,s.updated_at AS updatedAt,
    (SELECT a.id FROM sx_recruitment_applications a WHERE a.tenant_id=s.tenant_id AND (a.linked_chat_id=s.conversation_id OR (a.normalized_mobile=s.normalized_mobile AND a.source_channel='whatsapp')) ORDER BY (a.linked_chat_id=s.conversation_id) DESC,a.created_at DESC LIMIT 1) AS applicationId,
    (SELECT a.reference_code FROM sx_recruitment_applications a WHERE a.tenant_id=s.tenant_id AND (a.linked_chat_id=s.conversation_id OR (a.normalized_mobile=s.normalized_mobile AND a.source_channel='whatsapp')) ORDER BY (a.linked_chat_id=s.conversation_id) DESC,a.created_at DESC LIMIT 1) AS applicationReferenceCode,
    (SELECT a.cv_file_name FROM sx_recruitment_applications a WHERE a.tenant_id=s.tenant_id AND (a.linked_chat_id=s.conversation_id OR (a.normalized_mobile=s.normalized_mobile AND a.source_channel='whatsapp')) ORDER BY (a.linked_chat_id=s.conversation_id) DESC,a.created_at DESC LIMIT 1) AS applicationCvFileName,
    (SELECT l.id FROM sx_recruitment_applications a JOIN pipeline_leads l ON l.id=a.linked_lead_id WHERE a.tenant_id=s.tenant_id AND a.normalized_mobile=s.normalized_mobile ORDER BY a.created_at DESC LIMIT 1) AS linkedLeadId
    FROM sx_recruitment_screenings s WHERE ${where} ORDER BY s.updated_at DESC,s.id LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
  return {items:items.map(item=>({...item,answers:typeof item.answers==='string'?JSON.parse(item.answers):item.answers,chatOrigin:item.channelKind==='whatsapp_meta'?'meta':'qr'})),page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit)};
}
async function matchExistingLead(db,ctx,normalizedMobile){
  const [owners]=await db.query(`SELECT o.legacy_uid_hash AS uidHash,u.uid FROM sx_legacy_ownership o JOIN user u ON CAST(u.id AS CHAR)=o.source_id WHERE o.tenant_id=? AND o.source_table='user' LIMIT 2`,[ctx.tenant.id]);
  if(owners.length!==1)return {contactId:null,leadId:null,chatId:null,chatOrigin:null};
  const {uidHash,uid}=owners[0];const [contacts]=await db.query('SELECT id FROM pipeline_contacts WHERE uid_hash=? AND normalized_phone=? ORDER BY updated_at DESC,id LIMIT 2',[uidHash,normalizedMobile]);
  const [chats]=await db.query(`SELECT chat_id AS chatId,origin AS chatOrigin FROM beta_chats WHERE uid=? AND sender_mobile IN (?,?) AND origin IN ('qr','meta') ORDER BY updatedAt DESC,id DESC LIMIT 1`,[uid,normalizedMobile,normalizedMobile.replace(/^\+/,'')]);
  if(contacts.length!==1)return {contactId:null,leadId:null,chatId:chats[0]?.chatId||null,chatOrigin:chats[0]?.chatOrigin||null,uid};
  const [leads]=await db.query('SELECT id FROM pipeline_leads WHERE uid_hash=? AND contact_id=? ORDER BY updated_at DESC,id LIMIT 1',[uidHash,contacts[0].id]);
  return {contactId:contacts[0].id,leadId:leads[0]?.id||null,chatId:chats[0]?.chatId||null,chatOrigin:chats[0]?.chatOrigin||null,uid};
}
async function createPublic(pool,{tenantSlug,body,file,visitorHash,conversation=null,env=process.env}){
  if(typeof tenantSlug!=='string'||!/^[-a-z0-9]{1,80}$/.test(tenantSlug))fail('TENANT_NOT_FOUND',404);
  const data=cleanApplication(body),token=String(body.submissionToken||'');if(!/^[0-9a-f-]{36}$/i.test(token))fail('INVALID_SUBMISSION_TOKEN');
  if(typeof body.website==='string'&&body.website.trim())return {repeated:true,referenceCode:'IGNORED'};
  if(typeof visitorHash!=='string'||!/^[0-9a-f]{64}$/.test(visitorHash))fail('INVALID_VISITOR');
  if(!file)fail('CV_FILE_REQUIRED');
  if(file.truncated||!file.tempFilePath||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_CV_BYTES)fail('INVALID_CV_FILE',413);
  const bytes=await fs.readFile(file.tempFilePath);if(bytes.length!==file.size)fail('INVALID_CV_FILE');const detected=detectCv(bytes);if(!detected)fail('CV_TYPE_NOT_ALLOWED',415);
  const db=await pool.getConnection();let storedPath=null,begun=false;
  try{
    await db.beginTransaction();begun=true;
    const [[tenant]]=await db.query(`SELECT t.id,t.slug,t.status,t.category_key AS categoryKey,t.category_version AS categoryVersion,u.uid,o.legacy_uid_hash AS uidHash
      FROM sx_tenants t JOIN sx_legacy_ownership o ON o.tenant_id=t.id AND o.source_table='user' JOIN user u ON CAST(u.id AS CHAR)=o.source_id
      WHERE t.slug=? AND t.category_key IN ${SALES_CATEGORY_FILTER} AND t.status='active' LIMIT 1 FOR UPDATE`,[tenantSlug,...SALES_CATEGORY_KEYS]);
    if(!tenant)fail('TENANT_NOT_FOUND',404);
    const prefillToken=String(body.prefillToken||'');
    if(prefillToken){
      if(!/^[A-Za-z0-9_-]{40,60}$/.test(prefillToken))fail('PREFILL_NOT_FOUND',404);
      const [[prefill]]=await db.query('SELECT application_id AS applicationId,consumed_at AS consumedAt FROM sx_recruitment_prefill_tokens WHERE tenant_id=? AND token_hash=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE',[tenant.id,hash(prefillToken)]);
      if(!prefill?.applicationId)fail('PREFILL_NOT_FOUND',404);
      const [[application]]=await db.query('SELECT id,reference_code AS referenceCode FROM sx_recruitment_applications WHERE tenant_id=? AND id=? FOR UPDATE',[tenant.id,prefill.applicationId]);if(!application)fail('PREFILL_NOT_FOUND',404);
      if(prefill.consumedAt){await db.commit();begun=false;return {repeated:true,referenceCode:application.referenceCode,cvUploaded:!!file};}
      const match=await matchExistingLead(db,{tenant:{id:tenant.id},uidHash:tenant.uidHash},data.normalizedMobile);
      const stored=await storePrivateCv(file,{tenantId:tenant.id,applicationId:application.id,env});storedPath=stored.filePath;
      await db.query(`UPDATE sx_recruitment_applications SET full_name=?,mobile=?,normalized_mobile=?,email=?,current_work_status=?,contact_mobile=?,english_level=?,hindi_level=?,experience_years=?,total_experience_range=?,sales_experience_years=?,has_computer_and_internet=?,comfortable_with_sales_calls=?,crm_saas_experience=?,availability=?,cv_storage_key=?,cv_file_name=?,cv_mime_type=?,cv_bytes=?,cv_sha256=?,linked_contact_id=COALESCE(?,linked_contact_id),linked_lead_id=COALESCE(?,linked_lead_id),revision=revision+1 WHERE tenant_id=? AND id=?`,[data.fullName,data.mobile,data.normalizedMobile,data.email,data.currentWorkStatus,data.contactMobile,data.englishLevel,data.hindiLevel,data.experienceYears,data.totalExperienceRange,data.salesExperienceYears,data.hasComputerAndInternet,data.comfortableWithSalesCalls,data.crmSaasExperience,data.availability,stored.storageKey,stored.fileName,stored.detected.mime,stored.bytes.length,hash(stored.bytes),match.contactId,match.leadId,tenant.id,application.id]);
      await db.query('UPDATE sx_recruitment_prefill_tokens SET consumed_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND token_hash=? AND consumed_at IS NULL',[tenant.id,hash(prefillToken)]);
      await db.commit();begun=false;storedPath=null;return {repeated:false,referenceCode:application.referenceCode,cvUploaded:true,updated:true};
    }
    const [[prior]]=await db.query('SELECT id,reference_code AS referenceCode,cv_storage_key AS cvStorageKey FROM sx_recruitment_applications WHERE tenant_id=? AND submission_hash=? FOR UPDATE',[tenant.id,hash(token)]);
    if(prior){
      if(file){const stored=await storePrivateCv(file,{tenantId:tenant.id,applicationId:prior.id,env});storedPath=stored.filePath;await db.query('UPDATE sx_recruitment_applications SET cv_storage_key=?,cv_file_name=?,cv_mime_type=?,cv_bytes=?,cv_sha256=?,revision=revision+1 WHERE tenant_id=? AND id=?',[stored.storageKey,stored.fileName,stored.detected.mime,stored.bytes.length,hash(stored.bytes),tenant.id,prior.id]);}
      await db.commit();begun=false;storedPath=null;return {repeated:true,referenceCode:prior.referenceCode,cvUploaded:!!file};
    }
    const [rateRows]=await db.query(`INSERT INTO sx_recruitment_rate_limits(tenant_id,visitor_hash,window_started_at,attempts) VALUES (?,?,UTC_TIMESTAMP(3),1)
      ON DUPLICATE KEY UPDATE attempts=IF(window_started_at<TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(3)),1,attempts+1),window_started_at=IF(window_started_at<TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(3)),UTC_TIMESTAMP(3),window_started_at)`,[tenant.id,Buffer.from(visitorHash,'hex')]);
    const [[rate]]=await db.query('SELECT attempts FROM sx_recruitment_rate_limits WHERE tenant_id=? AND visitor_hash=? FOR UPDATE',[tenant.id,Buffer.from(visitorHash,'hex')]);if(Number(rate.attempts)>8)fail('APPLICATION_RATE_LIMITED',429);
    const match=await matchExistingLead(db,{tenant:{id:tenant.id},uidHash:tenant.uidHash},data.normalizedMobile);
    const linkedChatId=conversation&&['whatsapp_meta','whatsapp_qr'].includes(conversation.channelKind)&&typeof conversation.conversationId==='string'?conversation.conversationId:match.chatId;
    const linkedChatOrigin=conversation?.channelKind==='whatsapp_meta'?'meta':conversation?.channelKind==='whatsapp_qr'?'qr':match.chatOrigin;
    const id=uuid(),referenceCode='SMX-'+crypto.randomBytes(4).toString('hex').toUpperCase(),root=storageRoot(env),fileName=`${crypto.randomBytes(18).toString('hex')}.${detected.ext}`,storageKey=`${tenant.id}/${id}/${fileName}`;storedPath=path.join(root,storageKey);
    await fs.mkdir(root,{recursive:true,mode:0o700});const rootStat=await fs.lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||(rootStat.mode&0o077)!==0)fail('RECRUITMENT_STORAGE_UNAVAILABLE',503);
    await fs.mkdir(path.dirname(storedPath),{recursive:true,mode:0o700});const dirStat=await fs.lstat(path.dirname(storedPath));if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||(dirStat.mode&0o077)!==0)fail('RECRUITMENT_STORAGE_UNAVAILABLE',503);
    const handle=await fs.open(storedPath,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    const [idempotent]=await db.query(`INSERT IGNORE INTO sx_recruitment_applications(id,tenant_id,submission_hash,reference_code,full_name,mobile,normalized_mobile,email,current_work_status,contact_mobile,english_level,hindi_level,experience_years,total_experience_range,sales_experience_years,has_computer_and_internet,comfortable_with_sales_calls,crm_saas_experience,availability,cv_storage_key,cv_file_name,cv_mime_type,cv_bytes,cv_sha256,linked_contact_id,linked_lead_id,linked_chat_id,linked_chat_origin,source_channel,source_reference,consent_text,consented_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,[id,tenant.id,hash(token),referenceCode,data.fullName,data.mobile,data.normalizedMobile,data.email,data.currentWorkStatus,data.contactMobile,data.englishLevel,data.hindiLevel,data.experienceYears,data.totalExperienceRange,data.salesExperienceYears,data.hasComputerAndInternet,data.comfortableWithSalesCalls,data.crmSaasExperience,data.availability,storageKey,cleanFileName(file.name),detected.mime,bytes.length,hash(bytes),match.contactId,match.leadId,linkedChatId,linkedChatOrigin,data.sourceChannel,data.sourceReference,CONSENT]);
    if(!idempotent.affectedRows){await db.rollback();begun=false;await fs.rm(storedPath,{force:true});storedPath=null;const [[duplicate]]=await db.query('SELECT reference_code AS referenceCode FROM sx_recruitment_applications WHERE tenant_id=? AND submission_hash=?',[tenant.id,hash(token)]);return {repeated:true,referenceCode:duplicate?.referenceCode||referenceCode};}
    const [[owner]]=await db.query(`SELECT identity_id AS identityId FROM sx_memberships WHERE tenant_id=? AND role='owner' AND status='active' LIMIT 1`,[tenant.id]);
    if(!owner?.identityId)fail('RECRUITMENT_OWNER_UNAVAILABLE',503);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','recruitment.application-submitted','recruitment-application',?,?,?)`,[uuid(),tenant.id,owner.identityId,id,JSON.stringify({referenceCode,sourceChannel:data.sourceChannel,cvMimeType:detected.mime,cvBytes:bytes.length,linkedContact:!!match.contactId,linkedLead:!!match.leadId,linkedChat:!!linkedChatId}),uuid()]);
    await queueApplicationNotification(db,{tenantId:tenant.id,application:{id,referenceCode,fullName:data.fullName,mobile:data.mobile,normalizedMobile:data.normalizedMobile,contactMobile:data.contactMobile,currentWorkStatus:data.currentWorkStatus,email:data.email,englishLevel:data.englishLevel,hindiLevel:data.hindiLevel,experienceYears:data.experienceYears,totalExperienceRange:data.totalExperienceRange,salesExperienceYears:data.salesExperienceYears,hasComputerAndInternet:data.hasComputerAndInternet,comfortableWithSalesCalls:data.comfortableWithSalesCalls,crmSaasExperience:data.crmSaasExperience,availability:data.availability,cvFileName:cleanFileName(file.name)}});
    await db.commit();begun=false;storedPath=null;return {repeated:false,referenceCode,leadLinked:!!match.leadId,contactLinked:!!match.contactId,chatLinked:!!linkedChatId};
  }catch(error){if(begun)try{await db.rollback();}catch{}if(storedPath)await fs.rm(storedPath,{force:true}).catch(()=>{});throw error;}finally{db.release();}
}
async function createFromWhatsApp(pool,{tenantSlug,answers,mobile,channelKind,channelRef,conversationId,senderName,mediaUrl,fileName,env=process.env}){
  const body=whatsappApplicationBody({answers,mobile,tenantId:null,channelKind,channelRef,conversationId});
  const file=await resolveWhatsAppCv({mediaUrl,fileName,frontendUri:env.FRONTENDURI,mediaRoot:path.resolve(__dirname,'../../client/public/meta-media')});
  const visitorHash=crypto.createHash('sha256').update(`${tenantSlug}\0${channelKind}\0${channelRef}\0${conversationId}`).digest('hex');
  const result=await createPublic(pool,{tenantSlug,body,file,visitorHash,conversation:{channelKind,channelRef,conversationId,senderName},env});
  await fs.rm(file.sourcePath,{force:true}).catch(()=>{});
  return result;
}
async function updateStatus(db,ctx,id,expectedRevision,status){
  authorize(ctx);if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1||!STATUSES.has(status))fail('INVALID_APPLICATION_UPDATE');
  await db.beginTransaction();try{const [[row]]=await db.query('SELECT status,revision FROM sx_recruitment_applications WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);if(!row)fail('APPLICATION_NOT_FOUND',404);if(Number(row.revision)!==expectedRevision)fail('STALE_REVISION',409);await db.query('UPDATE sx_recruitment_applications SET status=?,revision=revision+1 WHERE tenant_id=? AND id=?',[status,ctx.tenant.id,id]);await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','recruitment.application-status-updated','recruitment-application',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({from:row.status,to:status,revision:expectedRevision+1}),uuid()]);await db.commit();return {id,status,revision:expectedRevision+1};}catch(error){await db.rollback();throw error;}
}
async function getCv(db,ctx,id,{env=process.env}={}){
  authorize(ctx);if(!/^[0-9a-f-]{36}$/i.test(id))fail('APPLICATION_NOT_FOUND',404);const [[row]]=await db.query('SELECT cv_storage_key AS storageKey,cv_file_name AS fileName,cv_mime_type AS mimeType,cv_bytes AS bytes FROM sx_recruitment_applications WHERE tenant_id=? AND id=?',[ctx.tenant.id,id]);if(!row)fail('APPLICATION_NOT_FOUND',404);if(!row.storageKey)fail('CV_NOT_FOUND',404);const root=storageRoot(env);if(!row.storageKey.startsWith(`${ctx.tenant.id}/${id}/`)||row.storageKey.includes('..'))fail('CV_NOT_FOUND',404);const filePath=path.resolve(root,row.storageKey);if(!filePath.startsWith(root+path.sep))fail('CV_NOT_FOUND',404);await fs.access(filePath);return {...row,filePath,bytes:Number(row.bytes)};
}
module.exports={MAX_CV_BYTES,CONSENT,SCREENING_CONSENT,STATUSES,SALES_CATEGORY_KEYS,authorize,storageRoot,detectCv,normalizeMobile,cleanApplication,cleanScreeningAnswers,whatsappApplicationBody,resolveWhatsAppCv,createFromWhatsApp,issuePrefillToken,getPrefill,createPublic,list,listScreenings,saveScreening,updateStatus,getCv,matchExistingLead,queueApplicationNotification};
