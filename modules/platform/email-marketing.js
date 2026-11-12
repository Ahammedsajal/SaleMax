'use strict';

const crypto=require('node:crypto');
const ses=require('./email-marketing-ses');
const providerSettings=require('./email-marketing-provider-settings');
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const uuid=()=>crypto.randomUUID();
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const MAX_RECIPIENTS=10000,MAX_ATTACHMENT_BYTES=5*1024*1024,MAX_TOTAL_ATTACHMENT_BYTES=10*1024*1024,MAX_ATTACHMENTS=3;
const attachmentTypes=Object.freeze({'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.csv':'text/csv','.txt':'text/plain'});
const normalizeEmail=value=>String(value||'').trim().toLowerCase();
const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

function cleanDomain(value){
  const source=String(value||'').trim().replace(/\.$/,'').toLowerCase();
  if(!source||source.length>253||source.includes('@')||source.includes('/')||source.includes(':'))fail('INVALID_EMAIL_DOMAIN');
  const labels=source.split('.');
  if(labels.length<2||labels.some(label=>!label||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))fail('INVALID_EMAIL_DOMAIN');
  if(!/^[a-z]{2,63}$/.test(labels.at(-1)))fail('INVALID_EMAIL_DOMAIN');
  return source;
}
function cleanRegion(value){try{return ses.region(value||ses.defaultRegion());}catch{fail('INVALID_SES_REGION');}}
function cleanEmail(value,required=false){const email=normalizeEmail(value);if((required&&!email)||(email&&!validEmail(email)))fail('INVALID_EMAIL_ADDRESS');return email;}
function cleanText(value,max,code,{required=false}={}){if(typeof value!=='string')fail(code);const text=value.trim();if(text.length>max||(required&&!text))fail(code);return text;}
function base64url(value){return Buffer.from(value).toString('base64url');}
function tokenFor(key,tenantId,campaignId,recipientId){
  const payload=base64url(JSON.stringify([tenantId,campaignId,recipientId]));
  const signature=crypto.createHmac('sha256',key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function decodeToken(key,token){
  if(typeof token!=='string'||token.length>512)fail('INVALID_UNSUBSCRIBE_TOKEN',404);
  const [payload,signature,...extra]=token.split('.');if(!payload||!signature||extra.length)fail('INVALID_UNSUBSCRIBE_TOKEN',404);
  const expected=crypto.createHmac('sha256',key).update(payload).digest(),provided=Buffer.from(signature,'base64url');
  if(expected.length!==provided.length||!crypto.timingSafeEqual(expected,provided))fail('INVALID_UNSUBSCRIBE_TOKEN',404);
  let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));}catch{fail('INVALID_UNSUBSCRIBE_TOKEN',404);}
  if(!Array.isArray(data)||data.length!==3||!/^[-0-9a-f]{36}$/i.test(String(data[0]))||!/^[-0-9a-f]{36}$/i.test(String(data[1]))||!/^[-0-9a-f]{36}$/i.test(String(data[2])))fail('INVALID_UNSUBSCRIBE_TOKEN',404);
  return {tenantId:String(data[0]),campaignId:String(data[1]),recipientId:String(data[2])};
}
function emailMarketingAccess(context){
  if(context?.audience!=='tenant'||context.category?.key!=='7network_sales'||Number(context.tenant?.categoryVersion)!==Number(context.category?.version))fail('CATEGORY_UNAVAILABLE',403);
  const {decision}=require('./policy'),result=decision(context,{capability:'email.marketing',permission:'email.marketing.manage'});
  if(!result.allowed)fail(result.code,403);
  return result;
}
async function sessionContext(db,session){
  const context=session?.context;emailMarketingAccess(context);
  const phonebook=await require('./phonebook-workspace').sessionContext(db,session);
  if(!phonebook.manage||!session.actor||!context.identity?.id)fail('PERMISSION_DENIED',403);
  return {tenantId:String(context.tenant.id),identityId:String(context.identity.id),ownerUid:phonebook.uid,actor:session.actor,context};
}
function safeSesError(error){return ses.publicCode(error);}
async function configuredProvider(db,key){
  const config=await providerSettings.read(db,key);
  if(!config.configured)fail('AWS_CREDENTIALS_REQUIRED',503);
  return config;
}
function domainStatus(status){return status==='SUCCESS'?'verified':status==='FAILED'?'failed':'pending';}
function decodeDomain(row){let tokens=[];try{tokens=JSON.parse(row.dkim_tokens||'[]');}catch{}return {id:row.id,domain:row.domain,region:row.region,status:row.verification_status,dkimStatus:row.dkim_status,records:tokens,updatedAt:row.updated_at};}
function decodeSender(row){return {id:row.id,domainId:row.domain_id,email:row.email,status:row.verification_status,updatedAt:row.updated_at};}

async function providerStatus(db,ctx,key){
  const settings=await providerSettings.read(db,key);
  if(!settings.configured)return {configured:false,credentialSource:'super_admin',region:settings.region,code:'AWS_CREDENTIALS_REQUIRED',account:null};
  try{return {configured:true,credentialSource:'super_admin',region:settings.region,account:await ses.getAccount(settings.region,settings.credentials)};}
  catch(error){return {configured:false,credentialSource:'super_admin',region:settings.region,code:safeSesError(error),account:null};}
}
async function setup(db,ctx,key){
  emailMarketingAccess(ctx.context);
  const [domains]=await db.query('SELECT * FROM sx_email_sender_domains WHERE tenant_id=? ORDER BY created_at,id',[ctx.tenantId]);
  const [senders]=await db.query('SELECT * FROM sx_email_senders WHERE tenant_id=? ORDER BY created_at,id',[ctx.tenantId]);
  const [books]=await db.query('SELECT id,name,(SELECT COUNT(*) FROM contact c WHERE c.uid=p.uid AND c.phonebook_id=p.id) AS contactCount FROM phonebook p WHERE p.uid=? ORDER BY p.name,p.id',[ctx.ownerUid]);
  const [templates]=await db.query('SELECT id,name,subject,text_body AS text,revision,updated_at AS updatedAt FROM sx_email_templates WHERE tenant_id=? ORDER BY updated_at DESC,id',[ctx.tenantId]);
  return {provider:await providerStatus(db,ctx,key),domains:domains.map(decodeDomain),senders:senders.map(decodeSender),phonebooks:books,templates};
}

async function addDomain(db,ctx,input,key){
  emailMarketingAccess(ctx.context);
  const settings=await configuredProvider(db,key),domain=cleanDomain(input?.domain),region=cleanRegion(input?.region||settings.region);
  const [[existing]]=await db.query('SELECT * FROM sx_email_sender_domains WHERE tenant_id=? AND region=? AND domain=?',[ctx.tenantId,region,domain]);
  if(existing)return refreshDomain(db,ctx,existing.id,key);
  const [[claimed]]=await db.query('SELECT tenant_id FROM sx_email_sender_domains WHERE region=? AND domain=? LIMIT 1',[region,domain]);
  if(claimed&&claimed.tenant_id!==ctx.tenantId)fail('EMAIL_DOMAIN_ALREADY_CONNECTED',409);
  let identity;try{identity=await ses.createDomainIdentity(region,domain,settings.credentials);}catch(error){fail(safeSesError(error),error?.status||503);}
  const id=uuid();
  try{
    await db.query('INSERT INTO sx_email_sender_domains(id,tenant_id,domain,region,verification_status,dkim_status,dkim_tokens,signing_hosted_zone,created_by_identity_id) VALUES(?,?,?,?,?,?,?,?,?)',[id,ctx.tenantId,domain,region,domainStatus(identity.status),identity.dkimStatus,JSON.stringify(identity.records),identity.signingHostedZone,ctx.identityId]);
  }catch(error){if(error?.code==='ER_DUP_ENTRY')fail('EMAIL_DOMAIN_ALREADY_CONNECTED',409);throw error;}
  await audit(db,ctx,'email.domain.created','email-domain',id,{domain,region});
  return {id,domain,region,status:domainStatus(identity.status),dkimStatus:identity.dkimStatus,records:identity.records};
}
async function refreshDomain(db,ctx,id,key){
  emailMarketingAccess(ctx.context);if(typeof id!=='string'||!/^[-0-9a-f]{36}$/i.test(id))fail('INVALID_EMAIL_DOMAIN_ID');
  const settings=await configuredProvider(db,key);
  const [[row]]=await db.query('SELECT * FROM sx_email_sender_domains WHERE tenant_id=? AND id=?',[ctx.tenantId,id]);if(!row)fail('EMAIL_DOMAIN_NOT_FOUND',404);
  let identity;try{identity=await ses.getIdentity(row.region,row.domain,settings.credentials);}catch(error){fail(safeSesError(error),error?.status||503);}
  const attrs=identity.DkimAttributes||{},hostedZone=String(attrs.SigningHostedZone||row.signing_hosted_zone||''),tokens=Array.isArray(attrs.Tokens)?attrs.Tokens:[];
  let savedRecords=[];try{savedRecords=JSON.parse(row.dkim_tokens||'[]');}catch{}
  const records=tokens.length===3&&hostedZone?[...savedRecords.filter(record=>record.type==='TXT'),...tokens.map(token=>({type:'CNAME',name:`${token}._domainkey.${row.domain}`,value:`${token}.${hostedZone}`}))]:savedRecords;
  const status=domainStatus(identity.VerificationStatus),dkimStatus=attrs.Status||row.dkim_status;
  await db.query('UPDATE sx_email_sender_domains SET verification_status=?,dkim_status=?,dkim_tokens=?,signing_hosted_zone=?,last_error_code=NULL WHERE tenant_id=? AND id=?',[status,dkimStatus,JSON.stringify(records),hostedZone||null,ctx.tenantId,id]);
  return {id,domain:row.domain,region:row.region,status,dkimStatus,records,updatedAt:new Date().toISOString()};
}
async function addSender(db,ctx,input,key){
  emailMarketingAccess(ctx.context);
  const settings=await configuredProvider(db,key);
  const id=String(input?.domainId||'');if(!/^[-0-9a-f]{36}$/i.test(id))fail('INVALID_EMAIL_DOMAIN_ID');
  const email=cleanEmail(input?.email,true);
  const [[domain]]=await db.query('SELECT id,domain,region,verification_status FROM sx_email_sender_domains WHERE tenant_id=? AND id=?',[ctx.tenantId,id]);if(!domain)fail('EMAIL_DOMAIN_NOT_FOUND',404);
  if(email.split('@')[1]!==domain.domain)fail('EMAIL_SENDER_DOMAIN_MISMATCH');
  let identity;try{identity=await ses.createSenderIdentity(domain.region,email,settings.credentials);}catch(error){fail(safeSesError(error),error?.status||503);}
  const senderId=uuid(),status=domainStatus(identity.status);
  await db.query(`INSERT INTO sx_email_senders(id,tenant_id,domain_id,email,verification_status,created_by_identity_id) VALUES(?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE domain_id=VALUES(domain_id),verification_status=VALUES(verification_status),last_error_code=NULL`,[senderId,ctx.tenantId,id,email,status,ctx.identityId]);
  const [[saved]]=await db.query('SELECT * FROM sx_email_senders WHERE tenant_id=? AND email=?',[ctx.tenantId,email]);
  await audit(db,ctx,'email.sender.created','email-sender',saved.id,{email,status});
  return decodeSender(saved);
}
async function refreshSender(db,ctx,id,key){
  emailMarketingAccess(ctx.context);if(typeof id!=='string'||!/^[-0-9a-f]{36}$/i.test(id))fail('INVALID_EMAIL_SENDER_ID');
  const settings=await configuredProvider(db,key);
  const [[row]]=await db.query('SELECT s.*,d.region FROM sx_email_senders s JOIN sx_email_sender_domains d ON d.tenant_id=s.tenant_id AND d.id=s.domain_id WHERE s.tenant_id=? AND s.id=?',[ctx.tenantId,id]);if(!row)fail('EMAIL_SENDER_NOT_FOUND',404);
  let identity;try{identity=await ses.getIdentity(row.region,row.email,settings.credentials);}catch(error){fail(safeSesError(error),error?.status||503);}
  const status=domainStatus(identity.VerificationStatus);await db.query('UPDATE sx_email_senders SET verification_status=?,last_error_code=NULL WHERE tenant_id=? AND id=?',[status,ctx.tenantId,id]);
  return {...decodeSender({...row,verification_status:status}),region:row.region};
}

async function audit(db,ctx,action,resourceType,resourceId,changes){
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES(?,?,?,'identity',?,?,?,?,?)`,[uuid(),ctx.tenantId,ctx.identityId,action,resourceType,String(resourceId),JSON.stringify(changes),uuid()]);
}

function safeFilename(value){
  const source=String(value||'attachment').replace(/[\u0000-\u001f\u007f/\\]/g,'_').trim().slice(0,180)||'attachment';
  const extension=require('node:path').extname(source).toLowerCase();if(!Object.hasOwn(attachmentTypes,extension))fail('ATTACHMENT_TYPE_NOT_ALLOWED');return source;
}
function sniffAttachment(fileName,buffer){
  const ext=require('node:path').extname(fileName).toLowerCase(),type=attachmentTypes[ext];
  if(!Buffer.isBuffer(buffer)||buffer.length<1||buffer.length>MAX_ATTACHMENT_BYTES)fail('ATTACHMENT_SIZE_INVALID');
  const valid=ext==='.pdf'?buffer.subarray(0,5).toString()==='%PDF-':ext==='.png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='.jpg'||ext==='.jpeg'?buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff:ext==='.gif'?/^GIF8[79]a$/.test(buffer.subarray(0,6).toString()):!buffer.includes(0);
  if(!valid)fail('ATTACHMENT_CONTENT_INVALID');
  return {fileName,contentType:type,size:buffer.length,sha256:sha(buffer)};
}
async function saveAttachment(db,ctx,{fileName,buffer}){
  emailMarketingAccess(ctx.context);const name=safeFilename(fileName),meta=sniffAttachment(name,buffer),id=uuid();
  await db.query('INSERT INTO sx_email_attachments(id,tenant_id,file_name,content_type,size_bytes,sha256,content,created_by_identity_id,expires_at) VALUES(?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))',[id,ctx.tenantId,name,meta.contentType,meta.size,meta.sha256,buffer,ctx.identityId]);
  return {id,fileName:name,contentType:meta.contentType,size:meta.size};
}
async function loadAttachments(db,tenantId,ids){
  if(!Array.isArray(ids)||ids.length>MAX_ATTACHMENTS||ids.some(id=>typeof id!=='string'||!/^[-0-9a-f]{36}$/i.test(id)))fail('INVALID_ATTACHMENT_SELECTION');
  const unique=[...new Set(ids)];if(unique.length!==ids.length)fail('DUPLICATE_ATTACHMENT');if(!unique.length)return [];
  const [rows]=await db.query('SELECT id,file_name,content_type,size_bytes,content FROM sx_email_attachments WHERE tenant_id=? AND id IN (?)',[tenantId,unique]);
  if(rows.length!==unique.length)fail('ATTACHMENT_NOT_FOUND',404);
  const total=rows.reduce((sum,row)=>sum+Number(row.size_bytes),0);if(total>MAX_TOTAL_ATTACHMENT_BYTES)fail('ATTACHMENT_TOTAL_TOO_LARGE');
  return rows.map(row=>({id:row.id,fileName:row.file_name,contentType:row.content_type,size:Number(row.size_bytes),content:Buffer.from(row.content)}));
}
async function attachToTemplate(db,ctx,templateId,attachmentIds){
  const attachments=await loadAttachments(db,ctx.tenantId,attachmentIds);
  await db.query('DELETE FROM sx_email_template_attachments WHERE tenant_id=? AND template_id=?',[ctx.tenantId,templateId]);
  for(const attachment of attachments)await db.query('INSERT INTO sx_email_template_attachments(tenant_id,template_id,attachment_id) VALUES(?,?,?)',[ctx.tenantId,templateId,attachment.id]);
  if(attachments.length)await db.query('UPDATE sx_email_attachments SET expires_at=NULL WHERE tenant_id=? AND id IN (?)',[ctx.tenantId,attachments.map(x=>x.id)]);
  return attachments.map(({id,fileName,contentType,size})=>({id,fileName,contentType,size}));
}

function cleanTemplateInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_EMAIL_TEMPLATE');
  const name=cleanText(input.name,120,'INVALID_EMAIL_TEMPLATE_NAME',{required:true}),subject=cleanText(input.subject,998,'INVALID_EMAIL_SUBJECT',{required:true}),text=cleanText(input.text,30000,'INVALID_EMAIL_TEXT',{required:true});
  if(/[\r\n]/.test(subject))fail('INVALID_EMAIL_SUBJECT');
  const attachmentIds=Array.isArray(input.attachmentIds)?input.attachmentIds:[];
  if(attachmentIds.length>MAX_ATTACHMENTS)fail('INVALID_ATTACHMENT_SELECTION');
  return {name,subject,text,attachmentIds};
}
async function listTemplates(db,ctx){
  emailMarketingAccess(ctx.context);
  const [rows]=await db.query(`SELECT t.id,t.name,t.subject,t.text_body AS text,t.revision,t.updated_at AS updatedAt,
    COALESCE(JSON_ARRAYAGG(IF(a.id IS NULL,NULL,JSON_OBJECT('id',a.id,'fileName',a.file_name,'contentType',a.content_type,'size',a.size_bytes))),JSON_ARRAY()) AS attachments
    FROM sx_email_templates t LEFT JOIN sx_email_template_attachments x ON x.tenant_id=t.tenant_id AND x.template_id=t.id
    LEFT JOIN sx_email_attachments a ON a.tenant_id=x.tenant_id AND a.id=x.attachment_id WHERE t.tenant_id=? GROUP BY t.id ORDER BY t.updated_at DESC,t.id LIMIT 200`,[ctx.tenantId]);
  return rows.map(row=>({...row,attachments:parseJsonArray(row.attachments)}));
}
function parseJsonArray(value){if(Array.isArray(value))return value.filter(Boolean);try{return JSON.parse(value||'[]').filter(Boolean);}catch{return [];}}
async function saveTemplate(db,ctx,input,id=null){
  emailMarketingAccess(ctx.context);const clean=cleanTemplateInput(input);
  await db.beginTransaction();try{
    const attachments=await loadAttachments(db,ctx.tenantId,clean.attachmentIds);
    const total=attachments.reduce((sum,item)=>sum+item.size,0);if(total>MAX_TOTAL_ATTACHMENT_BYTES)fail('ATTACHMENT_TOTAL_TOO_LARGE');
    let templateId=id;
    if(id){
      if(!/^[-0-9a-f]{36}$/i.test(id)||!Number.isSafeInteger(input.revision)||input.revision<1)fail('INVALID_EMAIL_TEMPLATE_ID');
      const [result]=await db.query('UPDATE sx_email_templates SET name=?,subject=?,text_body=?,revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=? AND revision=?',[clean.name,clean.subject,clean.text,ctx.identityId,ctx.tenantId,id,input.revision]);
      if(!result.affectedRows){const [[found]]=await db.query('SELECT revision FROM sx_email_templates WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenantId,id]);if(!found)fail('EMAIL_TEMPLATE_NOT_FOUND',404);fail('STALE_EMAIL_TEMPLATE',409);}
    }else{
      templateId=uuid();await db.query('INSERT INTO sx_email_templates(id,tenant_id,name,subject,text_body,created_by_identity_id,updated_by_identity_id) VALUES(?,?,?,?,?,?,?)',[templateId,ctx.tenantId,clean.name,clean.subject,clean.text,ctx.identityId,ctx.identityId]);
    }
    await attachToTemplate(db,ctx,templateId,clean.attachmentIds);
    await audit(db,ctx,id?'email.template.updated':'email.template.created','email-template',templateId,{name:clean.name,revision:id?input.revision+1:1});
    const [[saved]]=await db.query('SELECT id,name,subject,text_body AS text,revision,updated_at AS updatedAt FROM sx_email_templates WHERE tenant_id=? AND id=?',[ctx.tenantId,templateId]);
    await db.commit();return {...saved,attachments:attachments.map(({id,fileName,contentType,size})=>({id,fileName,contentType,size}))};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}

async function audienceRows(db,tenantId,ownerUid,phonebookId,{lock=false}={}){
  const [rows]=await db.query(`SELECT c.id,c.name,c.mobile,c.email,c.email_marketing_consent,c.email_marketing_consent_at,c.email_unsubscribed_at,
    s.normalized_email AS suppressed_email FROM contact c JOIN phonebook p ON p.uid=c.uid AND p.id=c.phonebook_id
    LEFT JOIN sx_email_suppressions s ON s.tenant_id=? AND s.normalized_email=LOWER(TRIM(c.email))
    WHERE c.uid=? AND c.phonebook_id=? ORDER BY c.id LIMIT ?${lock?' FOR UPDATE':''}`,[tenantId,ownerUid,phonebookId,MAX_RECIPIENTS+1]);
  if(rows.length>MAX_RECIPIENTS)fail('EMAIL_AUDIENCE_TOO_LARGE',413);
  return rows;
}
function summarizeAudience(rows){
  const result={total:rows.length,eligible:0,missingEmail:0,invalidEmail:0,noConsent:0,unsubscribed:0,suppressed:0,duplicate:0};
  const seen=new Set(),eligible=[];
  for(const row of rows){
    const email=normalizeEmail(row.email);
    if(!email){result.missingEmail++;continue;}
    if(!validEmail(email)){result.invalidEmail++;continue;}
    if(Number(row.email_marketing_consent)!==1){result.noConsent++;continue;}
    if(row.email_unsubscribed_at){result.unsubscribed++;continue;}
    if(row.suppressed_email){result.suppressed++;continue;}
    if(seen.has(email)){result.duplicate++;continue;}
    seen.add(email);eligible.push({...row,normalizedEmail:email});
  }
  result.eligible=eligible.length;return {summary:result,eligible};
}
function fingerprint(rows){return sha(JSON.stringify(rows.map(row=>[Number(row.id),normalizeEmail(row.email),Number(row.email_marketing_consent),row.email_marketing_consent_at||null,row.email_unsubscribed_at||null,row.suppressed_email||null])));}
function makePreviewToken(key,ctx,phonebookId,hashValue){
  const payload=base64url(JSON.stringify({v:1,tenantId:ctx.tenantId,owner:sha(ctx.ownerUid),phonebookId:Number(phonebookId),fingerprint:hashValue,expiresAt:Date.now()+10*60*1000}));
  return payload+'.'+crypto.createHmac('sha256',key).update(payload).digest('base64url');
}
function readPreviewToken(key,token,ctx,phonebookId){
  if(typeof token!=='string'||token.length>2048)fail('INVALID_AUDIENCE_PREVIEW');
  const [payload,signature,...extra]=token.split('.');if(!payload||!signature||extra.length)fail('INVALID_AUDIENCE_PREVIEW');
  const expected=crypto.createHmac('sha256',key).update(payload).digest(),provided=Buffer.from(signature,'base64url');
  if(expected.length!==provided.length||!crypto.timingSafeEqual(expected,provided))fail('INVALID_AUDIENCE_PREVIEW');
  let value;try{value=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));}catch{fail('INVALID_AUDIENCE_PREVIEW');}
  if(value.v!==1||value.tenantId!==ctx.tenantId||value.owner!==sha(ctx.ownerUid)||Number(value.phonebookId)!==Number(phonebookId)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<Date.now()||!/^[0-9a-f]{64}$/.test(value.fingerprint||''))fail('AUDIENCE_PREVIEW_EXPIRED',409);
  return value;
}
async function previewAudience(db,ctx,input,key){
  emailMarketingAccess(ctx.context);const phonebookId=Number(input?.phonebookId);if(!Number.isSafeInteger(phonebookId)||phonebookId<1)fail('INVALID_PHONEBOOK');
  const [[book]]=await db.query('SELECT id,name FROM phonebook WHERE uid=? AND id=?',[ctx.ownerUid,phonebookId]);if(!book)fail('PHONEBOOK_NOT_FOUND',404);
  const rows=await audienceRows(db,ctx.tenantId,ctx.ownerUid,phonebookId),audience=summarizeAudience(rows),hashValue=fingerprint(rows);
  return {phonebook:{id:Number(book.id),name:book.name},...audience.summary,previewToken:makePreviewToken(key,ctx,phonebookId,hashValue),expiresInSeconds:600};
}

async function campaignAttachments(db,ctx,input,template){
  let ids=Array.isArray(input.attachmentIds)?input.attachmentIds:[];
  if(!ids.length&&template?.id){const [rows]=await db.query('SELECT attachment_id AS id FROM sx_email_template_attachments WHERE tenant_id=? AND template_id=? ORDER BY attachment_id',[ctx.tenantId,template.id]);ids=rows.map(row=>row.id);}
  return loadAttachments(db,ctx.tenantId,ids);
}
async function createCampaign(db,ctx,input,key){
  emailMarketingAccess(ctx.context);
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_EMAIL_CAMPAIGN');
  const name=cleanText(input.name,120,'INVALID_EMAIL_CAMPAIGN_NAME',{required:true});
  const phonebookId=Number(input.phonebookId),senderId=String(input.senderId||''),templateId=input.templateId?String(input.templateId):null;
  if(!Number.isSafeInteger(phonebookId)||phonebookId<1||!/^[-0-9a-f]{36}$/i.test(senderId)||(templateId&&!/^[-0-9a-f]{36}$/i.test(templateId)))fail('INVALID_EMAIL_CAMPAIGN');
  const preview=readPreviewToken(key,input.previewToken,ctx,phonebookId),scheduledAt=input.scheduledAt?new Date(input.scheduledAt):null;
  if(scheduledAt&&(!Number.isFinite(scheduledAt.getTime())||scheduledAt.getTime()<Date.now()+60000||scheduledAt.getTime()>Date.now()+90*86400000))fail('INVALID_EMAIL_SCHEDULE');
  await db.beginTransaction();try{
    const [rows]=await db.query(`SELECT s.id,s.email,s.verification_status,d.region,d.domain,d.verification_status AS domain_status,d.dkim_status
      FROM sx_email_senders s JOIN sx_email_sender_domains d ON d.tenant_id=s.tenant_id AND d.id=s.domain_id
      WHERE s.tenant_id=? AND s.id=? FOR UPDATE`,[ctx.tenantId,senderId]);
    const sender=rows[0];if(!sender)fail('EMAIL_SENDER_NOT_FOUND',404);if(sender.verification_status!=='verified'||sender.domain_status!=='verified'||sender.dkim_status!=='SUCCESS')fail('EMAIL_SENDER_NOT_VERIFIED',409);
    let template=null;
    if(templateId){const [[row]]=await db.query('SELECT id,subject,text_body AS text,revision FROM sx_email_templates WHERE tenant_id=? AND id=?',[ctx.tenantId,templateId]);if(!row)fail('EMAIL_TEMPLATE_NOT_FOUND',404);template=row;}
    const body=cleanText(input.text||template?.text||'',30000,'INVALID_EMAIL_TEXT',{required:true}),mailSubject=cleanText(input.subject||template?.subject||'',998,'INVALID_EMAIL_SUBJECT',{required:true});
    if(/[\r\n]/.test(mailSubject))fail('INVALID_EMAIL_SUBJECT');
    const attachments=await campaignAttachments(db,ctx,input,template);if(attachments.reduce((sum,item)=>sum+item.size,0)>MAX_TOTAL_ATTACHMENT_BYTES)fail('ATTACHMENT_TOTAL_TOO_LARGE');
    const audienceRowsValue=await audienceRows(db,ctx.tenantId,ctx.ownerUid,phonebookId,{lock:true}),audience=summarizeAudience(audienceRowsValue),currentFingerprint=fingerprint(audienceRowsValue);
    if(currentFingerprint!==preview.fingerprint)fail('AUDIENCE_CHANGED',409);
    if(!audience.eligible.length)fail('NO_ELIGIBLE_RECIPIENTS',409);
    const id=uuid(),status=scheduledAt?'scheduled':'queued';
    await db.query(`INSERT INTO sx_email_campaigns(id,tenant_id,sender_id,template_id,name,subject,text_body,phonebook_id,audience_hash,status,scheduled_at,recipient_count,created_by_identity_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,ctx.tenantId,senderId,templateId,name,mailSubject,body,phonebookId,currentFingerprint,status,scheduledAt, audience.eligible.length,ctx.identityId]);
    for(const attachment of attachments){await db.query('INSERT INTO sx_email_campaign_attachments(tenant_id,campaign_id,attachment_id) VALUES(?,?,?)',[ctx.tenantId,id,attachment.id]);await db.query('UPDATE sx_email_attachments SET expires_at=NULL WHERE tenant_id=? AND id=?',[ctx.tenantId,attachment.id]);}
    const recipientRows=audience.eligible.map(row=>{const recipientId=uuid(),token=tokenFor(key,ctx.tenantId,id,recipientId);return [recipientId,ctx.tenantId,id,row.id,row.email,normalizeEmail(row.email),String(row.name||'').slice(0,200),sha(token)];});
    for(let start=0;start<recipientRows.length;start+=500){const batch=recipientRows.slice(start,start+500);await db.query('INSERT INTO sx_email_campaign_recipients(id,tenant_id,campaign_id,contact_id,recipient_email,normalized_email,recipient_name,unsubscribe_token_hash) VALUES ?',[batch]);}
    await audit(db,ctx,'email.campaign.created','email-campaign',id,{name,status,recipientCount:audience.eligible.length,phonebookId});
    await db.commit();return {id,name,status,scheduledAt,recipientCount:audience.eligible.length,acceptedCount:0,failedCount:0,suppressedCount:0,createdAt:new Date().toISOString()};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}

async function listCampaigns(db,ctx){
  emailMarketingAccess(ctx.context);
  const [rows]=await db.query(`SELECT c.id,c.name,c.status,c.scheduled_at AS scheduledAt,c.created_at AS createdAt,c.recipient_count AS recipientCount,
    SUM(r.status='accepted') AS acceptedCount,SUM(r.status='failed') AS failedCount,SUM(r.status='suppressed') AS suppressedCount,SUM(r.status='unknown') AS unknownCount
    FROM sx_email_campaigns c LEFT JOIN sx_email_campaign_recipients r ON r.tenant_id=c.tenant_id AND r.campaign_id=c.id
    WHERE c.tenant_id=? GROUP BY c.id ORDER BY c.created_at DESC,c.id LIMIT 200`,[ctx.tenantId]);
  return rows.map(row=>({...row,recipientCount:Number(row.recipientCount),acceptedCount:Number(row.acceptedCount||0),failedCount:Number(row.failedCount||0),suppressedCount:Number(row.suppressedCount||0),unknownCount:Number(row.unknownCount||0)}));
}
async function campaignDetail(db,ctx,id){
  emailMarketingAccess(ctx.context);if(typeof id!=='string'||!/^[-0-9a-f]{36}$/i.test(id))fail('INVALID_EMAIL_CAMPAIGN_ID');
  const [[campaign]]=await db.query(`SELECT c.id,c.name,c.status,c.subject,c.text_body AS text,c.scheduled_at AS scheduledAt,c.created_at AS createdAt,c.recipient_count AS recipientCount,
    s.email AS senderEmail FROM sx_email_campaigns c JOIN sx_email_senders s ON s.tenant_id=c.tenant_id AND s.id=c.sender_id WHERE c.tenant_id=? AND c.id=?`,[ctx.tenantId,id]);if(!campaign)fail('EMAIL_CAMPAIGN_NOT_FOUND',404);
  const [recipients]=await db.query('SELECT id,recipient_email AS email,recipient_name AS name,status,provider_message_id AS providerMessageId,last_error_code AS errorCode,accepted_at AS acceptedAt FROM sx_email_campaign_recipients WHERE tenant_id=? AND campaign_id=? ORDER BY id LIMIT 1000',[ctx.tenantId,id]);
  return {...campaign,recipients};
}

async function inbox(db,ctx){
  emailMarketingAccess(ctx.context);
  const [rows]=await db.query(`SELECT id,campaign_id AS campaignId,recipient_id AS recipientId,recipient_email AS email,recipient_name AS name,subject,last_message_at AS lastMessageAt,unread_count AS unreadCount
    FROM sx_email_threads WHERE tenant_id=? ORDER BY last_message_at DESC,id DESC LIMIT 200`,[ctx.tenantId]);
  return {items:rows.map(row=>({...row,unreadCount:Number(row.unreadCount||0)})),receivingReady:false};
}
async function threadMessages(db,ctx,id){
  emailMarketingAccess(ctx.context);if(typeof id!=='string'||!/^[-0-9a-f]{36}$/i.test(id))fail('INVALID_EMAIL_THREAD_ID');
  const [[thread]]=await db.query('SELECT id,subject,recipient_email AS email,recipient_name AS name FROM sx_email_threads WHERE tenant_id=? AND id=?',[ctx.tenantId,id]);if(!thread)fail('EMAIL_THREAD_NOT_FOUND',404);
  const [messages]=await db.query(`SELECT id,direction,subject,text_body AS text,provider_message_id AS providerMessageId,sent_at AS sentAt,created_at AS createdAt
    FROM sx_email_messages WHERE tenant_id=? AND thread_id=? ORDER BY id LIMIT 500`,[ctx.tenantId,id]);
  return {thread,messages,receivingReady:false};
}
async function testSend(db,ctx,input,key){
  emailMarketingAccess(ctx.context);const senderId=String(input?.senderId||'');if(!/^[-0-9a-f]{36}$/i.test(senderId))fail('INVALID_EMAIL_SENDER_ID');
  const settings=await configuredProvider(db,key);
  const [[sender]]=await db.query(`SELECT s.email,s.verification_status,d.region,d.verification_status AS domainStatus,d.dkim_status AS dkimStatus
    FROM sx_email_senders s JOIN sx_email_sender_domains d ON d.tenant_id=s.tenant_id AND d.id=s.domain_id
    WHERE s.tenant_id=? AND s.id=?`,[ctx.tenantId,senderId]);if(!sender)fail('EMAIL_SENDER_NOT_FOUND',404);
  if(sender.verification_status!=='verified'||sender.domainStatus!=='verified'||sender.dkimStatus!=='SUCCESS')fail('EMAIL_SENDER_NOT_VERIFIED',409);
  let account;try{account=await ses.getAccount(sender.region,settings.credentials);}catch(error){fail(safeSesError(error),503);}
  if(!account.sendingEnabled)fail('SES_SENDING_DISABLED',409);
  try{const sent=await ses.sendSimple(sender.region,{FromEmailAddress:sender.email,Destination:{ToAddresses:[sender.email]},
    Content:{Simple:{Subject:{Data:'7Network Email setup test',Charset:'UTF-8'},Body:{Text:{Data:'Your 7Network Sales email sender is connected. Campaigns will only include contacts with explicit email marketing consent.',Charset:'UTF-8'}}}}},settings.credentials);
    return {sent:true,recipient:sender.email,messageId:sent.messageId};
  }catch(error){fail(safeSesError(error),error?.$metadata?.httpStatusCode||503);}
}

async function applyUnsubscribe(db,key,token){
  const parsed=decodeToken(key,token),tokenHash=sha(token);await db.beginTransaction();
  try{
    const [[recipient]]=await db.query('SELECT contact_id AS contactId,normalized_email AS email,unsubscribe_token_hash AS tokenHash,status FROM sx_email_campaign_recipients WHERE tenant_id=? AND campaign_id=? AND id=? FOR UPDATE',[parsed.tenantId,parsed.campaignId,parsed.recipientId]);
    if(!recipient||recipient.tokenHash!==tokenHash)fail('INVALID_UNSUBSCRIBE_TOKEN',404);
    const [contacts]=await db.query(`SELECT c.uid,c.id,c.email FROM sx_legacy_ownership o JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id AND m.role='owner' AND m.status='active'
      JOIN user u ON BINARY CAST(u.id AS CHAR)=BINARY o.source_id AND BINARY SHA2(u.uid,256)=BINARY o.legacy_uid_hash
      JOIN contact c ON c.uid=u.uid AND c.id=? WHERE o.tenant_id=? AND o.source_table='user' LIMIT 2 FOR UPDATE`,[recipient.contactId,parsed.tenantId]);
    if(contacts.length>1)fail('EMAIL_OWNER_LINK_INVALID',409);
    if(contacts.length===1&&normalizeEmail(contacts[0].email)===recipient.email){
      await db.query("UPDATE contact SET email_marketing_consent=0,email_unsubscribed_at=UTC_TIMESTAMP(3),email_marketing_consent_source='one_click' WHERE uid=? AND id=?",[contacts[0].uid,recipient.contactId]);
      await db.query("INSERT INTO sx_email_consent_events(tenant_id,contact_id,normalized_email,consented,source,actor_identity_id) VALUES(?,?,?,0,'one_click',NULL)",[parsed.tenantId,recipient.contactId,recipient.email]);
    }
    await db.query("INSERT INTO sx_email_suppressions(tenant_id,normalized_email,reason,source) VALUES(?,?,'unsubscribe','one_click') ON DUPLICATE KEY UPDATE reason='unsubscribe',source='one_click'",[parsed.tenantId,recipient.email]);
    await db.query("UPDATE sx_email_campaign_recipients SET status='suppressed',last_error_code='UNSUBSCRIBED',lease_owner=NULL,lease_expires_at=NULL WHERE tenant_id=? AND normalized_email=? AND status='pending'",[parsed.tenantId,recipient.email]);
    await db.commit();return {unsubscribed:true};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}

module.exports={MAX_RECIPIENTS,MAX_ATTACHMENT_BYTES,MAX_TOTAL_ATTACHMENT_BYTES,MAX_ATTACHMENTS,normalizeEmail,validEmail,cleanDomain,cleanRegion,cleanEmail,tokenFor,decodeToken,safeFilename,sniffAttachment,summarizeAudience,fingerprint,emailMarketingAccess,sessionContext,providerStatus,setup,addDomain,refreshDomain,addSender,refreshSender,audit,saveAttachment,loadAttachments,listTemplates,saveTemplate,previewAudience,createCampaign,listCampaigns,campaignDetail,inbox,threadMessages,testSend,applyUnsubscribe};
