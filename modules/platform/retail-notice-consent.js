'use strict';

const crypto=require('node:crypto');
const TOKEN=/^[A-Za-z0-9_-]{43}$/;

function masterKey(env=process.env){
  const value=env.SALEMAX_PLATFORM_KEY_BASE64;
  if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw Object.assign(Error('RETAIL_CONSENT_KEY_UNAVAILABLE'),{code:'RETAIL_CONSENT_KEY_UNAVAILABLE',status:503});
  const key=Buffer.from(value,'base64');
  if(key.length!==32||key.toString('base64')!==value)throw Object.assign(Error('RETAIL_CONSENT_KEY_UNAVAILABLE'),{code:'RETAIL_CONSENT_KEY_UNAVAILABLE',status:503});
  return key;
}
function derive(tenantId,purpose,env){return Buffer.from(crypto.hkdfSync('sha256',masterKey(env),Buffer.from(tenantId),`7network/retail-customer-notice/${purpose}/v1`,32));}
function aad(tenantId,orderId){return Buffer.from(`${tenantId}\0${orderId}\0retail-customer-notice-v1`);}
function tokenHash(token,tenantId,orderId,env=process.env){
  if(typeof token!=='string'||!TOKEN.test(token))return null;
  return crypto.createHmac('sha256',derive(tenantId,'revocation',env)).update(orderId).update('\0').update(token).digest('hex');
}
function create(tenantId,orderId,env=process.env){
  const token=crypto.randomBytes(32).toString('base64url'),iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',derive(tenantId,'encryption',env),iv);cipher.setAAD(aad(tenantId,orderId));
  const ciphertext=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return {token,tokenHash:tokenHash(token,tenantId,orderId,env),ciphertext,iv,authTag:cipher.getAuthTag()};
}
function reveal(row,tenantId,orderId,env=process.env){
  try{
    const decipher=crypto.createDecipheriv('aes-256-gcm',derive(tenantId,'encryption',env),Buffer.from(row.token_iv));
    decipher.setAAD(aad(tenantId,orderId));decipher.setAuthTag(Buffer.from(row.token_auth_tag));
    const token=Buffer.concat([decipher.update(Buffer.from(row.token_ciphertext)),decipher.final()]).toString('utf8');
    const actual=Buffer.from(tokenHash(token,tenantId,orderId,env),'hex'),expected=Buffer.from(row.token_hash,'hex');
    if(!TOKEN.test(token)||actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))throw Error();
    return token;
  }catch{throw Object.assign(Error('RETAIL_CONSENT_UNAVAILABLE'),{code:'RETAIL_CONSENT_UNAVAILABLE',status:503});}
}
function matches(token,row,tenantId,orderId,env=process.env){
  const actual=tokenHash(token,tenantId,orderId,env);if(!actual)return false;
  const expected=row.token_hash||row.tokenHash;if(typeof expected!=='string'||! /^[0-9a-f]{64}$/i.test(expected))return false;
  const a=Buffer.from(actual,'hex'),b=Buffer.from(expected,'hex');
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

module.exports={create,reveal,matches,tokenHash};
