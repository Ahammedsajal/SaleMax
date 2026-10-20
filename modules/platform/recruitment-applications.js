'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {decision}=require('./policy');

const MAX_CV_BYTES=8*1024*1024;
const CONSENT='I agree that SaleMaX may use my application and CV to assess me for the SaleMaX sales associate role and contact me about recruitment.';
const SCREENING_CONSENT='Candidate agreed to save WhatsApp pre-screen answers with the recruitment conversation for review by the SaleMaX Sales team.';
const STATUSES=new Set(['new','reviewing','shortlisted','interview','rejected','hired','archived']);
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const hash=value=>crypto.createHash('sha256').update(String(value)).digest();
const uuid=()=>crypto.randomUUID();

function authorize(ctx){
  if(!ctx||ctx.audience!=='tenant'||ctx.tenant?.categoryKey!=='salemax_sales')fail('CATEGORY_UNAVAILABLE',404);
  const result=decision(ctx,{capability:'hr.recruitment',permission:'recruitment.manage'});
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
  const text=(key,max,required=true)=>{const value=b[key];if(typeof value!=='string'||value.trim().length>(max)||required&&!value.trim())fail('INVALID_APPLICATION');return value.trim();};
  const fullName=text('fullName',160),mobile=text('mobile',40),normalizedMobile='+'+normalizeMobile(mobile),email=text('email',254,false).toLowerCase();
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('INVALID_EMAIL');
  const englishLevel=text('englishLevel',20),hindiLevel=text('hindiLevel',20),years=Number(b.experienceYears);
  if(!['proficient','native','intermediate','basic'].includes(englishLevel))fail('INVALID_ENGLISH_LEVEL');
  if(!['fluent','conversational','basic','none'].includes(hindiLevel))fail('INVALID_HINDI_LEVEL');
  if(!Number.isInteger(years)||years<0||years>50)fail('INVALID_EXPERIENCE_YEARS');
  const experience=text('crmSaasExperience',2000),availability=text('availability',20);
  if(!['part_time','full_time','either'].includes(availability))fail('INVALID_AVAILABILITY');
  if(![true,'true','on','1'].includes(b.consent))fail('CONSENT_REQUIRED');
  const source=String(b.source||'').trim().toLowerCase();
  return {fullName,mobile,normalizedMobile,email:email||null,englishLevel,hindiLevel,experienceYears:years,crmSaasExperience:experience,availability,sourceChannel:source==='whatsapp'?'whatsapp':'public_form',sourceReference:typeof b.sourceReference==='string'?b.sourceReference.slice(0,160):null};
}
function cleanFileName(value){const name=path.basename(String(value||'CV').replace(/[\r\n\0]/g,'')).trim();return (name||'CV').slice(0,180);}
async function list(db,ctx,query={}){
  authorize(ctx);const page=Math.max(1,Math.min(100000,Number.parseInt(query.page,10)||1)),limit=Math.min(50,Math.max(1,Number.parseInt(query.limit,10)||25));
  const status=String(query.status||'').trim(),search=String(query.search||'').trim().slice(0,100),clauses=['a.tenant_id=?'],params=[ctx.tenant.id];
  if(status&&status!=='all'){if(!STATUSES.has(status))fail('INVALID_STATUS');clauses.push('a.status=?');params.push(status);}
  if(search){const term=`%${search.replace(/[\\%_]/g,'\\$&')}%`;clauses.push('(a.reference_code LIKE ? OR a.full_name LIKE ? OR a.normalized_mobile LIKE ? OR a.email LIKE ?)');params.push(term,term,term,term);}
  const where=clauses.join(' AND '),[[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_recruitment_applications a WHERE ${where}`,params);
  const [items]=await db.query(`SELECT a.id,a.reference_code AS referenceCode,a.full_name AS fullName,a.mobile,a.email,a.english_level AS englishLevel,a.hindi_level AS hindiLevel,a.experience_years AS experienceYears,a.crm_saas_experience AS crmSaasExperience,a.availability,a.cv_file_name AS cvFileName,a.cv_mime_type AS cvMimeType,a.cv_bytes AS cvBytes,a.linked_contact_id AS linkedContactId,a.linked_lead_id AS linkedLeadId,COALESCE(a.linked_chat_id,(SELECT pc.chat_id FROM pipeline_conversations pc WHERE pc.uid_hash=(SELECT legacy_uid_hash FROM sx_legacy_ownership WHERE tenant_id=a.tenant_id AND source_table='user' LIMIT 1) AND pc.lead_id=a.linked_lead_id ORDER BY pc.last_inbound_at DESC LIMIT 1)) AS linkedChatId,COALESCE(a.linked_chat_origin,(SELECT pc.origin FROM pipeline_conversations pc WHERE pc.uid_hash=(SELECT legacy_uid_hash FROM sx_legacy_ownership WHERE tenant_id=a.tenant_id AND source_table='user' LIMIT 1) AND pc.lead_id=a.linked_lead_id ORDER BY pc.last_inbound_at DESC LIMIT 1)) AS linkedChatOrigin,a.source_channel AS sourceChannel,a.source_reference AS sourceReference,a.status,a.revision,a.consented_at AS consentedAt,a.created_at AS createdAt,a.updated_at AS updatedAt FROM sx_recruitment_applications a WHERE ${where} ORDER BY a.created_at DESC,a.id LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
  return {items:items.map(item=>({...item,experienceYears:Number(item.experienceYears),cvBytes:Number(item.cvBytes),revision:Number(item.revision)})),page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit)};
}
async function saveScreening(db,{tenantId,channelKind,channelRef,conversationId,mobile,senderName,answers,complete,consent}){
  if(consent!==true||!answers||!Object.keys(answers).length||!['whatsapp_meta','whatsapp_qr'].includes(channelKind))return false;
  let normalizedMobile;try{normalizedMobile='+'+normalizeMobile(mobile);}catch{return false;}
  if(typeof conversationId!=='string'||!conversationId||typeof channelRef!=='string'||!channelRef)return false;
  const allowed=['location','englishLevel','hindiLevel','salesExperience','availability'];
  const safeAnswers=Object.fromEntries(allowed.filter(key=>typeof answers[key]==='string').map(key=>[key,answers[key]]));
  if(!Object.keys(safeAnswers).length)return false;
  await db.query(`INSERT INTO sx_recruitment_screenings(id,tenant_id,channel_kind,channel_ref,conversation_id,conversation_hash,mobile,normalized_mobile,sender_name,answers,consent_text,consented_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),IF(?,UTC_TIMESTAMP(3),NULL))
    ON DUPLICATE KEY UPDATE mobile=VALUES(mobile),sender_name=COALESCE(VALUES(sender_name),sender_name),answers=VALUES(answers),completed_at=IF(VALUES(completed_at) IS NULL,completed_at,VALUES(completed_at))`,
  [uuid(),tenantId,channelKind,channelRef,conversationId,hash(conversationId),String(mobile).slice(0,40),normalizedMobile,typeof senderName==='string'?senderName.trim().slice(0,160)||null:null,JSON.stringify(safeAnswers),SCREENING_CONSENT,complete?1:0]);
  return true;
}
async function listScreenings(db,ctx,query={}){
  authorize(ctx);
  const page=Math.max(1,Math.min(100000,Number.parseInt(query.page,10)||1)),limit=Math.min(50,Math.max(1,Number.parseInt(query.limit,10)||25)),search=String(query.search||'').trim().slice(0,100);
  const clauses=['s.tenant_id=?'],params=[ctx.tenant.id];
  if(search){const term=`%${search.replace(/[\\%_]/g,'\\$&')}%`;clauses.push('(s.sender_name LIKE ? OR s.mobile LIKE ?)');params.push(term,term);}
  const where=clauses.join(' AND '),[[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_recruitment_screenings s WHERE ${where}`,params);
  const [items]=await db.query(`SELECT s.id,s.mobile,s.sender_name AS senderName,s.answers,s.channel_kind AS channelKind,s.conversation_id AS linkedChatId,s.channel_ref AS channelRef,s.consented_at AS consentedAt,s.completed_at AS completedAt,s.updated_at AS updatedAt,
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
async function createPublic(pool,{tenantSlug,body,file,visitorHash,env=process.env}){
  if(typeof tenantSlug!=='string'||!/^[-a-z0-9]{1,80}$/.test(tenantSlug))fail('TENANT_NOT_FOUND',404);
  const data=cleanApplication(body),token=String(body.submissionToken||'');if(!/^[0-9a-f-]{36}$/i.test(token))fail('INVALID_SUBMISSION_TOKEN');
  if(typeof body.website==='string'&&body.website.trim())return {repeated:true,referenceCode:'IGNORED'};
  if(typeof visitorHash!=='string'||!/^[0-9a-f]{64}$/.test(visitorHash))fail('INVALID_VISITOR');
  if(!file||file.truncated||!file.tempFilePath||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_CV_BYTES)fail('INVALID_CV_FILE',413);
  const bytes=await fs.readFile(file.tempFilePath);if(bytes.length!==file.size)fail('INVALID_CV_FILE');const detected=detectCv(bytes);if(!detected)fail('CV_TYPE_NOT_ALLOWED',415);
  const db=await pool.getConnection();let storedPath=null,begun=false;
  try{
    await db.beginTransaction();begun=true;
    const [[tenant]]=await db.query(`SELECT t.id,t.slug,t.status,t.category_key AS categoryKey,t.category_version AS categoryVersion,u.uid,o.legacy_uid_hash AS uidHash
      FROM sx_tenants t JOIN sx_legacy_ownership o ON o.tenant_id=t.id AND o.source_table='user' JOIN user u ON CAST(u.id AS CHAR)=o.source_id
      WHERE t.slug=? AND t.category_key='salemax_sales' AND t.status='active' LIMIT 1 FOR UPDATE`,[tenantSlug]);
    if(!tenant)fail('TENANT_NOT_FOUND',404);
    const [prior]=await db.query('SELECT reference_code AS referenceCode FROM sx_recruitment_applications WHERE tenant_id=? AND submission_hash=?',[tenant.id,hash(token)]);
    if(prior.length){await db.commit();begun=false;return {repeated:true,referenceCode:prior[0].referenceCode};}
    const [rateRows]=await db.query(`INSERT INTO sx_recruitment_rate_limits(tenant_id,visitor_hash,window_started_at,attempts) VALUES (?,?,UTC_TIMESTAMP(3),1)
      ON DUPLICATE KEY UPDATE attempts=IF(window_started_at<TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(3)),1,attempts+1),window_started_at=IF(window_started_at<TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(3)),UTC_TIMESTAMP(3),window_started_at)`,[tenant.id,Buffer.from(visitorHash,'hex')]);
    const [[rate]]=await db.query('SELECT attempts FROM sx_recruitment_rate_limits WHERE tenant_id=? AND visitor_hash=? FOR UPDATE',[tenant.id,Buffer.from(visitorHash,'hex')]);if(Number(rate.attempts)>8)fail('APPLICATION_RATE_LIMITED',429);
    const match=await matchExistingLead(db,{tenant:{id:tenant.id},uidHash:tenant.uidHash},data.normalizedMobile);
    const id=uuid(),referenceCode='SMX-'+crypto.randomBytes(4).toString('hex').toUpperCase(),root=storageRoot(env),fileName=`${crypto.randomBytes(18).toString('hex')}.${detected.ext}`,storageKey=`${tenant.id}/${id}/${fileName}`;storedPath=path.join(root,storageKey);
    await fs.mkdir(root,{recursive:true,mode:0o700});const rootStat=await fs.lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||(rootStat.mode&0o077)!==0)fail('RECRUITMENT_STORAGE_UNAVAILABLE',503);
    await fs.mkdir(path.dirname(storedPath),{recursive:true,mode:0o700});const dirStat=await fs.lstat(path.dirname(storedPath));if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||(dirStat.mode&0o077)!==0)fail('RECRUITMENT_STORAGE_UNAVAILABLE',503);
    const handle=await fs.open(storedPath,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    const [idempotent]=await db.query(`INSERT IGNORE INTO sx_recruitment_applications(id,tenant_id,submission_hash,reference_code,full_name,mobile,normalized_mobile,email,english_level,hindi_level,experience_years,crm_saas_experience,availability,cv_storage_key,cv_file_name,cv_mime_type,cv_bytes,cv_sha256,linked_contact_id,linked_lead_id,linked_chat_id,linked_chat_origin,source_channel,source_reference,consent_text,consented_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,[id,tenant.id,hash(token),referenceCode,data.fullName,data.mobile,data.normalizedMobile,data.email,data.englishLevel,data.hindiLevel,data.experienceYears,data.crmSaasExperience,data.availability,storageKey,cleanFileName(file.name),detected.mime,bytes.length,hash(bytes),match.contactId,match.leadId,match.chatId,match.chatOrigin,data.sourceChannel,data.sourceReference,CONSENT]);
    if(!idempotent.affectedRows){await db.rollback();begun=false;await fs.rm(storedPath,{force:true});storedPath=null;const [[duplicate]]=await db.query('SELECT reference_code AS referenceCode FROM sx_recruitment_applications WHERE tenant_id=? AND submission_hash=?',[tenant.id,hash(token)]);return {repeated:true,referenceCode:duplicate?.referenceCode||referenceCode};}
    const [[owner]]=await db.query(`SELECT identity_id AS identityId FROM sx_memberships WHERE tenant_id=? AND role='owner' AND status='active' LIMIT 1`,[tenant.id]);
    if(!owner?.identityId)fail('RECRUITMENT_OWNER_UNAVAILABLE',503);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','recruitment.application-submitted','recruitment-application',?,?,?)`,[uuid(),tenant.id,owner.identityId,id,JSON.stringify({referenceCode,sourceChannel:data.sourceChannel,cvMimeType:detected.mime,cvBytes:bytes.length,linkedContact:!!match.contactId,linkedLead:!!match.leadId,linkedChat:!!match.chatId}),uuid()]);
    await db.commit();begun=false;storedPath=null;return {repeated:false,referenceCode,leadLinked:!!match.leadId,contactLinked:!!match.contactId,chatLinked:!!match.chatId};
  }catch(error){if(begun)try{await db.rollback();}catch{}if(storedPath)await fs.rm(storedPath,{force:true}).catch(()=>{});throw error;}finally{db.release();}
}
async function updateStatus(db,ctx,id,expectedRevision,status){
  authorize(ctx);if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1||!STATUSES.has(status))fail('INVALID_APPLICATION_UPDATE');
  await db.beginTransaction();try{const [[row]]=await db.query('SELECT status,revision FROM sx_recruitment_applications WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);if(!row)fail('APPLICATION_NOT_FOUND',404);if(Number(row.revision)!==expectedRevision)fail('STALE_REVISION',409);await db.query('UPDATE sx_recruitment_applications SET status=?,revision=revision+1 WHERE tenant_id=? AND id=?',[status,ctx.tenant.id,id]);await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','recruitment.application-status-updated','recruitment-application',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({from:row.status,to:status,revision:expectedRevision+1}),uuid()]);await db.commit();return {id,status,revision:expectedRevision+1};}catch(error){await db.rollback();throw error;}
}
async function getCv(db,ctx,id,{env=process.env}={}){
  authorize(ctx);if(!/^[0-9a-f-]{36}$/i.test(id))fail('APPLICATION_NOT_FOUND',404);const [[row]]=await db.query('SELECT cv_storage_key AS storageKey,cv_file_name AS fileName,cv_mime_type AS mimeType,cv_bytes AS bytes FROM sx_recruitment_applications WHERE tenant_id=? AND id=?',[ctx.tenant.id,id]);if(!row)fail('APPLICATION_NOT_FOUND',404);const root=storageRoot(env);if(!row.storageKey.startsWith(`${ctx.tenant.id}/${id}/`)||row.storageKey.includes('..'))fail('CV_NOT_FOUND',404);const filePath=path.resolve(root,row.storageKey);if(!filePath.startsWith(root+path.sep))fail('CV_NOT_FOUND',404);await fs.access(filePath);return {...row,filePath,bytes:Number(row.bytes)};
}
module.exports={MAX_CV_BYTES,CONSENT,SCREENING_CONSENT,STATUSES,authorize,storageRoot,detectCv,normalizeMobile,cleanApplication,createPublic,list,listScreenings,saveScreening,updateStatus,getCv,matchExistingLead};
