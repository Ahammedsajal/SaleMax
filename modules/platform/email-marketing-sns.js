'use strict';

const crypto=require('node:crypto');
const https=require('node:https');

const certificateCache=new Map();
const MAX_CERT_BYTES=16*1024;
const MAX_SNS_BODY_BYTES=240*1024;
const FAIL=(code,status=400)=>Object.assign(Error(code),{code,status});

function trustedSnsUrl(value,topicArn,{certificate=false}={}){
  let url;try{url=new URL(String(value||''));}catch{throw FAIL('SNS_URL_INVALID');}
  const topicRegion=String(topicArn||'').match(/^arn:aws:sns:([a-z0-9-]+):\d{12}:[A-Za-z0-9_-]+$/)?.[1];
  if(!topicRegion||url.protocol!=='https:'||url.username||url.password||url.port||url.hash)throw FAIL('SNS_URL_INVALID');
  const hosts=new Set([`sns.${topicRegion}.amazonaws.com`,`sns.${topicRegion}.amazonaws.com.cn`]);
  if(!hosts.has(url.hostname.toLowerCase()))throw FAIL('SNS_URL_UNTRUSTED');
  if(certificate){
    if(!/^\/SimpleNotificationService-[A-Za-z0-9_-]{8,160}\.pem$/.test(url.pathname)||url.search)throw FAIL('SNS_CERT_URL_INVALID');
  }else if(url.pathname!=='/'||url.searchParams.get('Action')!=='ConfirmSubscription'||!url.searchParams.has('Token'))throw FAIL('SNS_CONFIRM_URL_INVALID');
  return url;
}

function getHttps(url,{maxBytes=MAX_CERT_BYTES,timeoutMs=5000}={}){
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{timeout:timeoutMs,headers:{Accept:'application/x-x509-ca-cert, application/octet-stream'}},response=>{
      if(response.statusCode!==200){response.resume();return reject(FAIL('SNS_REMOTE_FETCH_FAILED',503));}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){request.destroy(FAIL('SNS_REMOTE_RESPONSE_TOO_LARGE',503));return;}chunks.push(chunk);});
      response.on('end',()=>resolve(Buffer.concat(chunks)));
      response.on('error',()=>reject(FAIL('SNS_REMOTE_FETCH_FAILED',503)));
    });
    request.on('timeout',()=>request.destroy(FAIL('SNS_REMOTE_FETCH_TIMEOUT',503)));
    request.on('error',error=>reject(error?.code?error:FAIL('SNS_REMOTE_FETCH_FAILED',503)));
  });
}

async function signingCertificate(url,topicArn){
  const trusted=trustedSnsUrl(url,topicArn,{certificate:true}).toString();
  const cached=certificateCache.get(trusted);
  if(cached&&cached.expiresAt>Date.now())return cached.certificate;
  const pem=await getHttps(trusted),certificate=new crypto.X509Certificate(pem);
  if(Date.parse(certificate.validTo)<=Date.now()||Date.parse(certificate.validFrom)>Date.now())throw FAIL('SNS_CERT_EXPIRED',403);
  if(!certificate.publicKey||!/^-----BEGIN CERTIFICATE-----/.test(pem.toString('ascii')))throw FAIL('SNS_CERT_INVALID',403);
  certificateCache.set(trusted,{certificate,expiresAt:Math.min(Date.now()+6*60*60*1000,Date.parse(certificate.validTo))});
  return certificate;
}

function canonicalString(message){
  if(!message||typeof message!=='object'||Array.isArray(message))throw FAIL('SNS_MESSAGE_INVALID');
  const type=String(message.Type||'');
  let fields;
  if(type==='Notification')fields=['Message','MessageId',...(Object.hasOwn(message,'Subject')?['Subject']:[]),'Timestamp','TopicArn','Type'];
  else if(type==='SubscriptionConfirmation'||type==='UnsubscribeConfirmation')fields=['Message','MessageId','SubscribeURL','Timestamp','Token','TopicArn','Type'];
  else throw FAIL('SNS_MESSAGE_TYPE_INVALID');
  return fields.map(field=>{
    const value=message[field];
    if(typeof value!=='string'||!value||value.length>MAX_SNS_BODY_BYTES)throw FAIL('SNS_MESSAGE_INVALID');
    return `${field}\n${value}\n`;
  }).join('');
}

function validEnvelope(message,expectedTopicArn){
  if(!message||typeof message!=='object'||Array.isArray(message))throw FAIL('SNS_MESSAGE_INVALID');
  if(typeof expectedTopicArn!=='string'||!/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/.test(expectedTopicArn))throw FAIL('SNS_TOPIC_NOT_CONFIGURED',503);
  if(message.TopicArn!==expectedTopicArn)throw FAIL('SNS_TOPIC_NOT_ALLOWED',403);
  if(!/^[A-Za-z0-9-]{1,128}$/.test(String(message.MessageId||'')))throw FAIL('SNS_MESSAGE_INVALID');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(String(message.Signature||'')))throw FAIL('SNS_SIGNATURE_INVALID',403);
}

async function verifyEnvelope(message,expectedTopicArn){
  validEnvelope(message,expectedTopicArn);
  const canonical=canonicalString(message),certificate=await signingCertificate(message.SigningCertURL,expectedTopicArn);
  const version=String(message.SignatureVersion||''),algorithm=version==='1'?'RSA-SHA1':version==='2'?'RSA-SHA256':null;
  if(!algorithm)throw FAIL('SNS_SIGNATURE_VERSION_UNSUPPORTED',403);
  let valid=false;
  try{valid=crypto.verify(algorithm,Buffer.from(canonical,'utf8'),certificate.publicKey,Buffer.from(message.Signature,'base64'));}catch{}
  if(!valid)throw FAIL('SNS_SIGNATURE_INVALID',403);
  return message.Type;
}

async function confirmSubscription(message,expectedTopicArn){
  const url=trustedSnsUrl(message.SubscribeURL,expectedTopicArn);
  const response=await getHttps(url,{maxBytes:8*1024,timeoutMs:5000});
  return {confirmed:response.length<=8*1024};
}

async function parseAndVerify(body,expectedTopicArn){
  if(!Buffer.isBuffer(body)||body.length<1||body.length>MAX_SNS_BODY_BYTES)throw FAIL('SNS_BODY_INVALID');
  let envelope;try{envelope=JSON.parse(body.toString('utf8'));}catch{throw FAIL('SNS_BODY_INVALID');}
  const type=await verifyEnvelope(envelope,expectedTopicArn);
  if(type==='SubscriptionConfirmation')return {type,confirmation:await confirmSubscription(envelope,expectedTopicArn)};
  if(type==='UnsubscribeConfirmation')return {type,ignored:true};
  let event;try{event=JSON.parse(envelope.Message);}catch{throw FAIL('SES_EVENT_INVALID');}
  if(!event||typeof event!=='object'||Array.isArray(event))throw FAIL('SES_EVENT_INVALID');
  return {type,envelope,event};
}

module.exports={MAX_SNS_BODY_BYTES,trustedSnsUrl,canonicalString,verifyEnvelope,parseAndVerify};
