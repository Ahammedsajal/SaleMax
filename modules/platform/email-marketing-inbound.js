'use strict';

const crypto=require('node:crypto');
const https=require('node:https');
const dns=require('node:dns').promises;

const SES_VERSION='2010-12-01',SNS_VERSION='2010-03-31';
const INBOUND_ENDPOINT='https://7network.live/api/public/email/ses/inbound';
const RULE_SET_NAME='7NetworkEmailInboundReplies';
const RECEIVED_MESSAGE_MAX_BYTES=150*1024;
const fail=(code,status=400)=>Object.assign(Error(code),{code,status});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const hmac=(key,value)=>crypto.createHmac('sha256',key).update(value).digest();
const xmlDecode=value=>String(value||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');

function xmlValues(xml,name){
  const tag=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),re=new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,'g');
  return [...String(xml||'').matchAll(re)].map(match=>xmlDecode(match[1].trim()));
}
function xmlMembers(xml,name){
  const section=xmlValues(xml,name)[0]||'',member=/<\/?member(?:\s[^>]*)?>/g,values=[];let depth=0,start=0,match;
  while((match=member.exec(section))){
    if(match[0][1]==='/'){
      if(depth>0&&--depth===0)values.push(section.slice(start,match.index));
    }else{
      if(depth===0)start=member.lastIndex;
      depth++;
    }
  }
  return values.map(value=>xmlDecode(value.replace(/<[^>]+>/g,'').trim()));
}
function awsError(xml,status){
  const code=xmlValues(xml,'Code')[0]||'AWS_REQUEST_FAILED',message=xmlValues(xml,'Message')[0]||'AWS request failed';
  return Object.assign(Error(message),{code,status,awsCode:code});
}
function signKey(secret,date,region,service){
  const dateKey=hmac(Buffer.from(`AWS4${secret}`),date),regionKey=hmac(dateKey,region),serviceKey=hmac(regionKey,service);
  return hmac(serviceKey,'aws4_request');
}
function awsQuery(region,service,version,action,params,credentials){
  if(!credentials?.accessKeyId||!credentials?.secretAccessKey)throw fail('AWS_CREDENTIALS_REQUIRED',503);
  const host=service==='ses'?`email.${region}.amazonaws.com`:`sns.${region}.amazonaws.com`;
  const body=new URLSearchParams({Action:action,Version:version,...params}).toString();
  const contentType='application/x-www-form-urlencoded; charset=utf-8';
  const amzDate=new Date().toISOString().replace(/[:-]|\.\d{3}/g,'');
  const date=amzDate.slice(0,8),payloadHash=sha(body),signedHeaders='content-type;host;x-amz-date';
  const canonicalHeaders=`content-type:${contentType}\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest=`POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope=`${date}/${region}/${service}/aws4_request`;
  const stringToSign=`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha(canonicalRequest)}`;
  const signature=crypto.createHmac('sha256',signKey(credentials.secretAccessKey,date,region,service)).update(stringToSign).digest('hex');
  const authorization=`AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return new Promise((resolve,reject)=>{
    const request=https.request({hostname:host,path:'/',method:'POST',headers:{'content-type':contentType,'content-length':Buffer.byteLength(body),'x-amz-date':amzDate,authorization}},response=>{
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>256*1024){request.destroy(fail('AWS_RESPONSE_TOO_LARGE',503));return;}chunks.push(chunk);});
      response.on('end',()=>{const xml=Buffer.concat(chunks).toString('utf8');if(response.statusCode<200||response.statusCode>=300)return reject(awsError(xml,response.statusCode));if(/<ErrorResponse\b/.test(xml))return reject(awsError(xml,400));resolve(xml);});
      response.on('error',()=>reject(fail('AWS_PROVIDER_UNAVAILABLE',503)));
    });
    request.setTimeout(8000,()=>request.destroy(fail('AWS_PROVIDER_TIMEOUT',503)));
    request.on('error',error=>reject(error?.code?error:fail('AWS_PROVIDER_UNAVAILABLE',503)));
    request.end(body);
  });
}
function querySes(region,action,params,credentials){return awsQuery(region,'ses',SES_VERSION,action,params,credentials);}
function querySns(region,action,params,credentials){return awsQuery(region,'sns',SNS_VERSION,action,params,credentials);}

async function ensureInboundTopic(region,credentials,onTopic=async()=>{}){
  const xml=await querySns(region,'CreateTopic',{Name:'7network-email-inbound'},credentials),topicArn=xmlValues(xml,'TopicArn')[0];
  if(!/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/.test(topicArn||''))throw fail('AWS_SNS_TOPIC_UNAVAILABLE',503);
  await onTopic(topicArn);
  const subscriptions=await querySns(region,'ListSubscriptionsByTopic',{TopicArn:topicArn},credentials);
  const endpoints=[...subscriptions.matchAll(/<member>([\s\S]*?)<\/member>/g)].map(match=>match[1]);
  const existing=endpoints.find(item=>xmlValues(item,'Protocol')[0]==='https'&&xmlValues(item,'Endpoint')[0]===INBOUND_ENDPOINT);
  if(!existing){
    await querySns(region,'Subscribe',{TopicArn:topicArn,Protocol:'https',Endpoint:INBOUND_ENDPOINT,ReturnSubscriptionArn:'true'},credentials);
  }
  const subscriptionArn=existing?xmlValues(existing,'SubscriptionArn')[0]||'':'';
  return {topicArn,subscriptionConfirmed:Boolean(subscriptionArn&&subscriptionArn!=='PendingConfirmation'),endpoint:INBOUND_ENDPOINT};
}

async function domainVerification(region,domain,credentials){
  const xml=await querySes(region,'VerifyDomainIdentity',{Domain:domain},credentials),token=xmlValues(xml,'VerificationToken')[0];
  if(!/^[A-Za-z0-9+/=]{16,512}$/.test(token||''))throw fail('SES_DOMAIN_VERIFICATION_TOKEN_UNAVAILABLE',503);
  return {token,status:'pending',record:{type:'TXT',name:`_amazonses.${domain}`,value:token}};
}
async function domainVerificationStatus(region,domain,credentials){
  const xml=await querySes(region,'GetIdentityVerificationAttributes',{'Identities.member.1':domain},credentials);
  return xmlValues(xml,'VerificationStatus')[0]||'NotStarted';
}

function ruleName(domain){return `7n-inbound-${sha(domain).slice(0,20)}`;}
function recipientCoversDomain(recipient,domain){
  const value=String(recipient||'').trim().toLowerCase();
  return !value.includes('@')&&(value===domain||domain.endsWith(`.${value}`));
}
async function activeRuleSet(region,credentials){
  try{
    const xml=await querySes(region,'DescribeActiveReceiptRuleSet',{},credentials),name=xmlValues(xml,'Name')[0];
    return name?{name,xml}:null;
  }catch(error){
    if(['RuleSetDoesNotExist','RuleSetNotFound','NoSuchEntity'].includes(error.awsCode))return null;
    throw error;
  }
}
async function receiptRule(region,domain,topicArn,credentials){
  let active=await activeRuleSet(region,credentials),setName=active?.name||RULE_SET_NAME,createdSet=false;
  if(!active){
    try{await querySes(region,'CreateReceiptRuleSet',{RuleSetName:setName},credentials);createdSet=true;}
    catch(error){if(error.awsCode==='AlreadyExists'){const existing=await querySes(region,'DescribeReceiptRuleSet',{RuleSetName:setName},credentials);if(xmlValues(existing,'Name')[0]!==setName||/<Rules>\s*<member>/.test(existing))throw fail('SES_RECEIPT_RULE_SET_CONFLICT',409);createdSet=true;}else throw error;}
  }
  const name=ruleName(domain);
  const ruleXml=await querySes(region,'DescribeReceiptRuleSet',{RuleSetName:setName},credentials);
  const ruleBlocks=xmlMembers(ruleXml,'Rules');
  const found=ruleBlocks.find(block=>xmlValues(block,'Name')[0]===name);
  if(found){
    if(xmlValues(found,'Enabled')[0]!=='true'||xmlMembers(found,'Recipients').length!==1||
      !xmlMembers(found,'Recipients').includes(domain)||!xmlValues(found,'TopicArn').includes(topicArn))throw fail('SES_RECEIPT_RULE_CONFLICT',409);
  }else{
    if(active&&ruleBlocks.some(block=>{
      if(xmlValues(block,'Enabled')[0]==='false')return false;
      const recipients=xmlMembers(block,'Recipients');
      return recipients.length===0||recipients.some(recipient=>recipientCoversDomain(recipient,domain));
    }))throw fail('SES_RECEIPT_RULE_SET_CONFLICT',409);
    const params={RuleSetName:setName,'Rule.Name':name,'Rule.Enabled':'true','Rule.ScanEnabled':'true','Rule.TlsPolicy':'Optional',
      'Rule.Recipients.member.1':domain,'Rule.Actions.member.1.SNSAction.TopicArn':topicArn,'Rule.Actions.member.1.SNSAction.Encoding':'Base64',
      'Rule.Actions.member.2.StopAction.Scope':'RuleSet'};
    try{await querySes(region,'CreateReceiptRule',params,credentials);}
    catch(error){
      if(!/AlreadyExists/i.test(String(error.awsCode||'')))throw error;
      const observed=await querySes(region,'DescribeReceiptRule',{RuleSetName:setName,RuleName:name},credentials);
      if(!xmlMembers(observed,'Recipients').includes(domain)||!xmlValues(observed,'TopicArn').includes(topicArn))throw fail('SES_RECEIPT_RULE_CONFLICT',409);
    }
  }
  if(!active){
    if(!createdSet)throw fail('SES_RECEIPT_RULE_SET_CONFLICT',409);
    await querySes(region,'SetActiveReceiptRuleSet',{RuleSetName:setName},credentials);
  }
  return {ruleSetName:setName,ruleName:name,active:true};
}

async function checkMx(domain,region){
  const expected=`inbound-smtp.${region}.amazonaws.com`.toLowerCase();
  try{
    const records=await dns.resolveMx(domain);
    return records.some(record=>String(record.exchange||'').replace(/\.$/,'').toLowerCase()===expected);
  }catch(error){if(['ENODATA','ENOTFOUND','ESERVFAIL','ETIMEOUT','ECONNREFUSED'].includes(error.code))return false;throw fail('DNS_LOOKUP_UNAVAILABLE',503);}
}

function bytesFromUuid(value){const hex=String(value||'').replace(/-/g,'');if(!/^[a-f0-9]{32}$/i.test(hex))throw fail('INVALID_EMAIL_REPLY_TOKEN');return Buffer.from(hex,'hex');}
function replyToken(key,tenantId,campaignId,recipientId){
  const recipient=String(recipientId||'').replace(/-/g,'').toLowerCase();bytesFromUuid(recipientId);
  const signature=hmac(key,`7network-email-reply:v1\0${tenantId}\0${campaignId}\0${recipientId}`).toString('hex').slice(0,24);
  return `reply+${recipient}.${signature}`;
}
function recipientFromToken(key,localPart){
  const match=/^reply\+([a-f0-9]{32})\.([a-f0-9]{24})$/i.exec(String(localPart||'').toLowerCase());
  if(!match)return null;const value=match[1].toLowerCase(),id=`${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;return {recipientId:id,signature:match[2].toLowerCase()};
}
function validReplyToken(key,tenantId,campaignId,recipientId,signature){
  const expected=Buffer.from(replyToken(key,tenantId,campaignId,recipientId).split('+')[1].split('.')[1],'hex');
  const supplied=Buffer.from(String(signature||'').toLowerCase(),'hex');return expected.length===supplied.length&&crypto.timingSafeEqual(expected,supplied);
}

function decodeQuotedPrintable(value,{header=false}={}){
  let source=String(value||'');if(header)source=source.replace(/_/g,' ');source=source.replace(/=\r?\n/g,'');
  const bytes=[];for(let i=0;i<source.length;i++){
    if(source[i]==='='&&/^[0-9A-Fa-f]{2}$/.test(source.slice(i+1,i+3))){bytes.push(parseInt(source.slice(i+1,i+3),16));i+=2;}
    else{const code=source.charCodeAt(i);if(code<128)bytes.push(code);else bytes.push(...Buffer.from(source[i]));}
  }
  return Buffer.from(bytes).toString('utf8');
}
function decodeHeader(value){
  return String(value||'').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,(_,charset,encoding,payload)=>{
    try{const bytes=encoding.toLowerCase()==='b'?Buffer.from(payload,'base64'):Buffer.from(decodeQuotedPrintable(payload,{header:true}),'utf8');return charset.toLowerCase()==='iso-8859-1'||charset.toLowerCase()==='windows-1252'?bytes.toString('latin1'):bytes.toString('utf8');}catch{return payload;}
  }).replace(/\r?\n[ \t]+/g,' ').trim();
}
function splitMime(buffer){
  const text=buffer.toString('latin1'),match=/\r?\n\r?\n/.exec(text);if(!match)return {headers:'',body:buffer};
  const head=text.slice(0,match.index),bodyStart=match.index+match[0].length;return {headers:head,body:Buffer.from(text.slice(bodyStart),'latin1')};
}
function mimeHeaders(source){
  const headers=new Map();let current='';
  for(const line of String(source||'').split(/\r?\n/)){
    if(/^[ \t]/.test(line)&&current){const rows=headers.get(current)||[];rows[rows.length-1]+=' '+line.trim();headers.set(current,rows);continue;}
    const index=line.indexOf(':');if(index<1)continue;current=line.slice(0,index).trim().toLowerCase();const rows=headers.get(current)||[];rows.push(line.slice(index+1).trim());headers.set(current,rows);
  }
  return name=>(headers.get(String(name).toLowerCase())||[]).at(-1)||'';
}
function decodeTransfer(body,encoding){
  const kind=String(encoding||'').trim().toLowerCase();
  if(kind==='base64')return Buffer.from(body.toString('latin1').replace(/[^A-Za-z0-9+/=]/g,''),'base64');
  if(kind==='quoted-printable')return Buffer.from(decodeQuotedPrintable(body.toString('latin1')),'utf8');
  return body;
}
function parseMimeText(buffer,depth=0){
  if(depth>6)return '';
  const {headers,body}=splitMime(buffer),get=mimeHeaders(headers),type=get('content-type')||'text/plain',disposition=get('content-disposition')||'';
  if(/attachment/i.test(disposition))return '';
  const boundary=/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(type),media=(type.split(';')[0]||'').trim().toLowerCase();
  if(media.startsWith('multipart/')&&boundary){
    const raw=body.toString('latin1'),parts=raw.split(`--${boundary[1]||boundary[2]}`);
    for(const part of parts){const cleaned=part.replace(/^\r?\n/,'').replace(/\r?\n$/,'');if(!cleaned.trim()||cleaned.trim()==='--')continue;const value=parseMimeText(Buffer.from(cleaned,'latin1'),depth+1);if(value)return value;}
    return '';
  }
  const decoded=decodeTransfer(body,get('content-transfer-encoding'));
  const charset=/charset\s*=\s*["']?([^;"'\s]+)/i.exec(type)?.[1]?.toLowerCase()||'utf-8';
  const content=['iso-8859-1','latin1','windows-1252','us-ascii'].includes(charset)?decoded.toString('latin1'):decoded.toString('utf8');
  if(media==='text/plain'||!media)return content.replace(/\u0000/g,'').trim().slice(0,30000);
  if(media==='text/html')return content.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'').replace(/<\/(?:p|div|br|li|tr|h[1-6])\s*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(0x10ffff,Number(n)))).replace(/[ \t]+/g,' ').replace(/\n\s*\n\s*\n/g,'\n\n').trim().slice(0,30000);
  return '';
}
function decodeMime(raw){
  if(!Buffer.isBuffer(raw)||raw.length<1||raw.length>RECEIVED_MESSAGE_MAX_BYTES)throw fail('SES_INBOUND_MESSAGE_TOO_LARGE');
  const text=parseMimeText(raw);return text||'(This email did not contain a readable plain-text message.)';
}

function headerValue(raw,name){const {headers}=splitMime(raw);return mimeHeaders(headers)(name);}
function cleanFrom(value){
  const source=String(value||'').trim(),angle=/<([^<>]+)>/.exec(source),email=(angle?.[1]||source).trim().toLowerCase();
  return email.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)?email:null;
}
async function persistReceived(pool,parsed,key){
  const envelope=parsed?.envelope,event=parsed?.event,snsId=String(envelope?.MessageId||'');
  if(!/^[A-Za-z0-9-]{1,128}$/.test(snsId))throw fail('SNS_MESSAGE_INVALID');
  if(String(event?.notificationType||event?.eventType||'')!=='Received')return {accepted:true,ignored:true};
  if(!Buffer.isBuffer(key)||key.length!==32)throw fail('EMAIL_PROVIDER_KEY_UNAVAILABLE',503);
  const content=String(event?.content||'');
  if(!content||content.length>RECEIVED_MESSAGE_MAX_BYTES*2)throw fail('SES_INBOUND_MESSAGE_INVALID');
  if(!/^[A-Za-z0-9+/=\r\n]+$/.test(content))throw fail('SES_INBOUND_MESSAGE_INVALID');
  const raw=Buffer.from(content.replace(/\s/g,''),'base64');
  if(raw.length<1||raw.length>RECEIVED_MESSAGE_MAX_BYTES)throw fail('SES_INBOUND_MESSAGE_TOO_LARGE');
  const destinations=Array.isArray(event?.mail?.destination)?event.mail.destination.slice(0,10):[];
  const alias=destinations.map(value=>{
    const address=String(value||'').trim(),at=address.lastIndexOf('@');return at>0?{local:address.slice(0,at).toLowerCase(),domain:address.slice(at+1).toLowerCase()}:null;
  }).filter(Boolean).map(value=>({...value,token:recipientFromToken(key,value.local)})).find(value=>value.token);
  if(!alias)return {accepted:true,ignored:true,unrouted:true};
  const db=await pool.getConnection();
  try{
    const [rows]=await db.query(`SELECT r.id AS recipientId,c.id AS campaignId,c.tenant_id AS tenantId,t.id AS threadId,i.reply_domain AS replyDomain
      FROM sx_email_campaign_recipients r JOIN sx_email_campaigns c ON c.tenant_id=r.tenant_id AND c.id=r.campaign_id
      JOIN sx_email_threads t ON t.tenant_id=r.tenant_id AND t.campaign_id=r.campaign_id AND t.recipient_id=r.id
      JOIN sx_email_senders s ON s.tenant_id=c.tenant_id AND s.id=c.sender_id
      JOIN sx_email_sender_domains d ON d.tenant_id=s.tenant_id AND d.id=s.domain_id
      JOIN sx_email_inbound_domains i ON i.tenant_id=d.tenant_id AND i.sender_domain_id=d.id
      WHERE r.id=? AND r.status='accepted' LIMIT 2`,[alias.token.recipientId]);
    if(rows.length!==1)return {accepted:true,ignored:true,unrouted:true};
    const row=rows[0];if(String(row.replyDomain).toLowerCase()!==alias.domain||!validReplyToken(key,row.tenantId,row.campaignId,row.recipientId,alias.token.signature))return {accepted:true,ignored:true,unrouted:true};
    const source=cleanFrom(event?.mail?.source)||cleanFrom(headerValue(raw,'from'));
    const subject=decodeHeader(headerValue(raw,'subject')||event?.mail?.commonHeaders?.subject||'').replace(/[\r\n]+/g,' ').slice(0,998)||'Email reply';
    const text=decodeMime(raw),providerId=String(event?.mail?.messageId||'').slice(0,120)||null;
    const timestamp=Date.parse(event?.mail?.timestamp||''),receivedAt=Number.isFinite(timestamp)?new Date(timestamp).toISOString().slice(0,23).replace('T',' '):null;
    await db.beginTransaction();
    try{
      await db.query(`INSERT INTO sx_email_messages(tenant_id,thread_id,direction,from_email,subject,text_body,provider_message_id,inbound_sns_message_id,sent_at)
        VALUES(?,?,'inbound',?,?,?,?,?,COALESCE(?,UTC_TIMESTAMP(3)))`,[row.tenantId,row.threadId,source,subject,text,providerId,snsId,receivedAt]);
      await db.query('UPDATE sx_email_threads SET last_message_at=GREATEST(last_message_at,COALESCE(?,UTC_TIMESTAMP(3))),unread_count=unread_count+1 WHERE tenant_id=? AND id=?',[receivedAt,row.tenantId,row.threadId]);
      await db.commit();return {accepted:true,received:true};
    }catch(error){
      try{await db.rollback();}catch{}
      if(error?.code==='ER_DUP_ENTRY')return {accepted:true,duplicate:true};
      throw error;
    }
  }finally{db.release();}
}

module.exports={SES_VERSION,SNS_VERSION,INBOUND_ENDPOINT,RULE_SET_NAME,RECEIVED_MESSAGE_MAX_BYTES,awsQuery,querySes,querySns,ensureInboundTopic,domainVerification,domainVerificationStatus,receiptRule,checkMx,ruleName,recipientCoversDomain,replyToken,recipientFromToken,validReplyToken,decodeHeader,decodeMime,headerValue,persistReceived};
