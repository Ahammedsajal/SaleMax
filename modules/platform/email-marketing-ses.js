'use strict';

const regions=Object.freeze({
  'me-south-1':'Middle East (Bahrain)',
  'us-east-1':'US East (N. Virginia)',
  'eu-west-1':'Europe (Ireland)',
  'eu-central-1':'Europe (Frankfurt)',
  'us-west-2':'US West (Oregon)',
});

function defaultRegion(){
  const configured=String(process.env.AWS_REGION||process.env.AWS_DEFAULT_REGION||'eu-central-1').trim();
  return region(configured);
}

function region(value){
  const result=String(value||'').trim();
  if(!Object.hasOwn(regions,result))throw Object.assign(Error('INVALID_SES_REGION'),{code:'INVALID_SES_REGION',status:400});
  return result;
}

function createClient(value,credentials=null){
  const selected=region(value);
  let sdk;
  try{sdk=require('@aws-sdk/client-sesv2');}
  catch{throw Object.assign(Error('SES_PROVIDER_NOT_INSTALLED'),{code:'SES_PROVIDER_NOT_CONFIGURED'});}
  const options={region:selected};
  if(credentials)options.credentials={accessKeyId:credentials.accessKeyId,secretAccessKey:credentials.secretAccessKey};
  return {client:new sdk.SESv2Client(options),sdk,region:selected};
}

function publicCode(error){
  const code=String(error?.name||error?.code||'');
  if(/Credentials|credential|UnrecognizedClient|InvalidClientToken|ExpiredToken/i.test(code))return 'AWS_CREDENTIALS_UNAVAILABLE';
  if(/AccessDenied|UnauthorizedOperation|not authorized/i.test(code))return 'AWS_SES_PERMISSION_DENIED';
  if(/Throttl|TooManyRequests|RateExceeded|SendingRateExceeded/i.test(code))return 'SES_THROTTLED';
  if(/AlreadyExists/i.test(code))return 'SES_IDENTITY_EXISTS';
  if(/NotFound/i.test(code))return 'SES_IDENTITY_NOT_FOUND';
  if(/MessageRejected/i.test(code))return 'SES_MESSAGE_REJECTED';
  if(/Daily.*Quota|QuotaExceeded/i.test(code))return 'SES_DAILY_QUOTA_REACHED';
  if(/AccountSendingPaused|SendingDisabled/i.test(code))return 'SES_SENDING_DISABLED';
  return 'SES_PROVIDER_UNAVAILABLE';
}

async function getAccount(value,credentials=null){
  const {client,sdk,region:selected}=createClient(value,credentials);
  const result=await client.send(new sdk.GetAccountCommand({}));
  return {region:selected,sendingEnabled:result.SendingEnabled===true,productionAccessEnabled:result.ProductionAccessEnabled===true,
    max24HourSend:Number(result.SendQuota?.Max24HourSend||0),maxSendRate:Number(result.SendQuota?.MaxSendRate||0),sentLast24Hours:Number(result.SendQuota?.SentLast24Hours||0)};
}

async function getIdentity(value,identity,credentials=null){
  const {client,sdk}=createClient(value,credentials);
  return client.send(new sdk.GetEmailIdentityCommand({EmailIdentity:identity}));
}

async function createDomainIdentity(value,domain,credentials=null){
  const {client,sdk,region:selected}=createClient(value,credentials);
  let result;
  try{
    result=await client.send(new sdk.CreateEmailIdentityCommand({EmailIdentity:domain,DkimSigningAttributes:{NextSigningKeyLength:'RSA_2048_BIT'}}));
  }catch(error){
    if(error?.name!=='AlreadyExistsException'&&error?.$metadata?.httpStatusCode!==409)throw error;
    result=await client.send(new sdk.GetEmailIdentityCommand({EmailIdentity:domain}));
  }
  const attrs=result.DkimAttributes||{};
  const hostedZone=String(attrs.SigningHostedZone||'').trim();
  const tokens=Array.isArray(attrs.Tokens)?attrs.Tokens.filter(token=>typeof token==='string'&&/^[a-zA-Z0-9-]{8,160}$/.test(token)):[];
  if(!hostedZone||tokens.length!==3)throw Object.assign(Error('SES_DKIM_RECORDS_UNAVAILABLE'),{code:'SES_DKIM_RECORDS_UNAVAILABLE'});
  const verificationToken=String(result.VerificationToken||'').trim();
  const records=[...(verificationToken?[{type:'TXT',name:`_amazonses.${domain}`,value:verificationToken}]:[]),...tokens.map(token=>({type:'CNAME',name:`${token}._domainkey.${domain}`,value:`${token}.${hostedZone}`}))];
  return {region:selected,status:result.VerificationStatus||'PENDING',dkimStatus:attrs.Status||'PENDING',signingHostedZone:hostedZone,
    verificationToken,tokens,records};
}

async function createSenderIdentity(value,email,credentials=null){
  const {client,sdk,region:selected}=createClient(value,credentials);
  try{
    await client.send(new sdk.CreateEmailIdentityCommand({EmailIdentity:email}));
  }catch(error){
    if(error?.name!=='AlreadyExistsException'&&error?.$metadata?.httpStatusCode!==409)throw error;
  }
  const result=await client.send(new sdk.GetEmailIdentityCommand({EmailIdentity:email}));
  return {region:selected,status:result.VerificationStatus||'PENDING'};
}

async function sendSimple(value,message,credentials=null){
  const {client,sdk}=createClient(value,credentials);
  const result=await client.send(new sdk.SendEmailCommand(message));
  return {messageId:result.MessageId||null};
}

module.exports={regions,region,defaultRegion,publicCode,getAccount,getIdentity,createDomainIdentity,createSenderIdentity,sendSimple};
