'use strict';

const crypto=require('node:crypto');
const ses=require('./email-marketing-ses');

function fail(code,status=400){throw Object.assign(Error(code),{code,status});}
function encryptionKey(platformKey){
  if(!Buffer.isBuffer(platformKey)||platformKey.length!==32)fail('EMAIL_PROVIDER_KEY_UNAVAILABLE',503);
  return Buffer.from(crypto.hkdfSync('sha256',platformKey,Buffer.alloc(0),'7network/email-marketing/aws-credentials/v1',32));
}
function encrypt(value,platformKey,field){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(platformKey),iv);
  cipher.setAAD(Buffer.from(`ses:${field}:v1`));
  const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return {ciphertext,iv,tag:cipher.getAuthTag()};
}
function decrypt(ciphertext,iv,tag,platformKey,field){
  const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(platformKey),Buffer.from(iv));
  decipher.setAAD(Buffer.from(`ses:${field}:v1`));decipher.setAuthTag(Buffer.from(tag));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext)),decipher.final()]).toString('utf8');
}
function decode(row,platformKey){
  if(!row)return {configured:false,region:ses.defaultRegion(),configurationSetName:'',snsTopicArn:'',credentials:null,revision:0,updatedAt:null};
  try{return {configured:true,region:ses.region(row.region),configurationSetName:String(row.configuration_set_name||''),snsTopicArn:String(row.sns_topic_arn||''),credentials:{accessKeyId:decrypt(row.access_key_ciphertext,row.access_key_iv,row.access_key_tag,platformKey,'access-key-id'),secretAccessKey:decrypt(row.secret_key_ciphertext,row.secret_key_iv,row.secret_key_tag,platformKey,'secret-access-key')},revision:Number(row.revision)||1,updatedAt:row.updated_at||null};}
  catch{fail('EMAIL_PROVIDER_SETTINGS_UNAVAILABLE',503);}
}
async function read(db,platformKey){
  const [[row]]=await db.query(`SELECT region,configuration_set_name,sns_topic_arn,access_key_ciphertext,access_key_iv,access_key_tag,
    secret_key_ciphertext,secret_key_iv,secret_key_tag,revision,updated_at
    FROM sx_platform_email_provider_settings WHERE provider_key='ses' LIMIT 1`);
  return decode(row,platformKey);
}
function superAdmin(context){
  if(context?.audience!=='platform'||context.membership?.role!=='super_admin'||context.membership?.status!=='active'||!require('./policy').platformDecision(context,'providers.configure'))fail('PERMISSION_DENIED',403);
  return context.identity.id;
}
function publicAccount(account){
  return {region:account.region,sendingEnabled:account.sendingEnabled,productionAccessEnabled:account.productionAccessEnabled,
    max24HourSend:account.max24HourSend,maxSendRate:account.maxSendRate,sentLast24Hours:account.sentLast24Hours};
}
async function status(db,platformKey,context){
  superAdmin(context);const settings=await read(db,platformKey);
  const data={configured:settings.configured,credentialSource:settings.configured?'super_admin':'none',region:settings.region,configurationSetName:settings.configurationSetName,snsTopicArn:settings.snsTopicArn,eventEndpoint:'https://7network.live/api/public/email/ses/events',eventDestinationConfigured:false,revision:settings.revision,updatedAt:settings.updatedAt,account:null};
  if(!settings.configured)return {...data,code:'AWS_CREDENTIALS_REQUIRED'};
  try{
    const account=await ses.getAccount(settings.region,settings.credentials);
    let eventDestinationConfigured=false;
    try{eventDestinationConfigured=await ses.eventDestinationConfigured(settings.region,settings.configurationSetName,settings.snsTopicArn,settings.credentials);}catch{}
    return {...data,eventDestinationConfigured,account:publicAccount(account)};
  }
  catch(error){return {...data,code:ses.publicCode(error)};}
}
async function save(db,platformKey,context,input){
  const actorId=superAdmin(context),current=await read(db,platformKey),region=ses.region(input?.region||current.region||ses.defaultRegion());
  const configurationSetName=String(input?.configurationSetName===undefined?current.configurationSetName:(input.configurationSetName||'')).trim(),snsTopicArn=String(input?.snsTopicArn===undefined?current.snsTopicArn:(input.snsTopicArn||'')).trim();
  if(configurationSetName.length>64||(configurationSetName&&!/^[A-Za-z0-9_-]{1,64}$/.test(configurationSetName)))fail('INVALID_SES_CONFIGURATION_SET');
  if(snsTopicArn.length>256||(snsTopicArn&&!/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}$/.test(snsTopicArn)))fail('INVALID_SES_SNS_TOPIC');
  if(snsTopicArn&&snsTopicArn.split(':')[3]!==region)fail('SES_SNS_REGION_MISMATCH');
  const accessKeyId=String(input?.accessKeyId||'').trim(),secretAccessKey=String(input?.secretAccessKey||'').trim();
  if(accessKeyId.length>128||secretAccessKey.length>256||/\s/.test(accessKeyId)||/\s/.test(secretAccessKey))fail('INVALID_AWS_CREDENTIALS');
  const rotating=accessKeyId!==''||secretAccessKey!=='';
  if(!Number.isSafeInteger(input?.expectedRevision)||input.expectedRevision!==current.revision)fail('STALE_REVISION',409);
  if(rotating&&(accessKeyId===''||secretAccessKey===''||!/^[A-Z0-9]{16,128}$/.test(accessKeyId)||secretAccessKey.length<20))fail('INVALID_AWS_CREDENTIALS');
  if(!rotating&&!current.configured)fail('AWS_CREDENTIALS_REQUIRED');
  const credentials=rotating?{accessKeyId,secretAccessKey}:current.credentials;
  let account;try{account=await ses.getAccount(region,credentials);}catch(error){fail(ses.publicCode(error),503);}
  const encryptedAccess=rotating?encrypt(accessKeyId,platformKey,'access-key-id'):null;
  const encryptedSecret=rotating?encrypt(secretAccessKey,platformKey,'secret-access-key'):null;
  await db.beginTransaction();
  try{
    const [locked]=await db.query("SELECT revision FROM sx_platform_email_provider_settings WHERE provider_key='ses' FOR UPDATE");
    if((Number(locked[0]?.revision)||0)!==input.expectedRevision)fail('STALE_REVISION',409);
    if(rotating){
      await db.query(`INSERT INTO sx_platform_email_provider_settings
        (provider_key,region,configuration_set_name,sns_topic_arn,access_key_ciphertext,access_key_iv,access_key_tag,secret_key_ciphertext,secret_key_iv,secret_key_tag,revision,updated_by_identity_id)
        VALUES('ses',?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE region=VALUES(region),configuration_set_name=VALUES(configuration_set_name),sns_topic_arn=VALUES(sns_topic_arn),access_key_ciphertext=VALUES(access_key_ciphertext),
        access_key_iv=VALUES(access_key_iv),access_key_tag=VALUES(access_key_tag),secret_key_ciphertext=VALUES(secret_key_ciphertext),
        secret_key_iv=VALUES(secret_key_iv),secret_key_tag=VALUES(secret_key_tag),revision=revision+1,updated_by_identity_id=VALUES(updated_by_identity_id),updated_at=UTC_TIMESTAMP(3)`,
      [region,configurationSetName||null,snsTopicArn||null,encryptedAccess.ciphertext,encryptedAccess.iv,encryptedAccess.tag,encryptedSecret.ciphertext,encryptedSecret.iv,encryptedSecret.tag,1,actorId]);
    }else{
      await db.query(`UPDATE sx_platform_email_provider_settings SET region=?,configuration_set_name=?,sns_topic_arn=?,revision=revision+1,updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE provider_key='ses'`,[region,configurationSetName||null,snsTopicArn||null,actorId]);
    }
    await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES(?,?,'identity','platform.email-ses.credentials-updated','provider','ses',?,?)`,
    [crypto.randomUUID(),actorId,JSON.stringify({region,credentialsRotated:rotating,configurationSetName:configurationSetName||null,snsTopicConfigured:Boolean(snsTopicArn),productionAccessEnabled:account.productionAccessEnabled,sendingEnabled:account.sendingEnabled}),crypto.randomUUID()]);
    await db.commit();
  }catch(error){await db.rollback();throw error;}
  let eventDestinationConfigured=false;
  try{eventDestinationConfigured=await ses.eventDestinationConfigured(region,configurationSetName,snsTopicArn,credentials);}catch{}
  return {configured:true,credentialSource:'super_admin',region,configurationSetName,snsTopicArn,eventEndpoint:'https://7network.live/api/public/email/ses/events',eventDestinationConfigured,revision:current.revision+1,account:publicAccount(account)};
}

async function snsTopic(db){const [[row]]=await db.query("SELECT sns_topic_arn AS topicArn FROM sx_platform_email_provider_settings WHERE provider_key='ses' LIMIT 1");return String(row?.topicArn||'').trim()||null;}
async function configureEvents(db,platformKey,context){
  const actorId=superAdmin(context),settings=await read(db,platformKey);
  if(!settings.configured)fail('AWS_CREDENTIALS_REQUIRED');
  if(!settings.configurationSetName||!settings.snsTopicArn)fail('SES_EVENT_SETTINGS_REQUIRED');
  try{await ses.configureEventDestination(settings.region,settings.configurationSetName,settings.snsTopicArn,settings.credentials);}
  catch(error){fail(ses.publicCode(error),503);}
  await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES(?,?,'identity','platform.email-ses.events-configured','provider','ses',?,?)`,[crypto.randomUUID(),actorId,JSON.stringify({configurationSetName:settings.configurationSetName,snsTopicArn:settings.snsTopicArn}),crypto.randomUUID()]);
  return {configured:true,configurationSetName:settings.configurationSetName,snsTopicArn:settings.snsTopicArn,eventEndpoint:'https://7network.live/api/public/email/ses/events'};
}

module.exports={encryptionKey,encrypt,decrypt,decode,read,status,save,snsTopic,configureEvents,superAdmin};
