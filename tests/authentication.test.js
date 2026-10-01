const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {credentials,createAuthentication}=require('../modules/platform/authentication');
const {createAuthRouter}=require('../modules/platform/auth-router');
const {totp,base32}=require('../modules/platform/mfa');
test('canonical authentication validates audiences, password byte length and CSRF binding',()=>{
  assert.throws(()=>createAuthentication({key:Buffer.alloc(10)}),{code:'AUTH_KEY_REQUIRED'});
  const auth=createAuthentication({key:crypto.randomBytes(32)}),a=crypto.randomBytes(32).toString('base64url'),b=crypto.randomBytes(32).toString('base64url');
  assert.equal(auth.validCsrf(a,auth.csrf(a)),true);assert.equal(auth.validCsrf(b,auth.csrf(a)),false);assert.equal(auth.validCsrf(a,'broken'),false);
  const good={email:' PERSON@example.invalid ',password:'synthetic',audience:'tenant',tenantId:crypto.randomUUID()};
  assert.equal(credentials(good).email,'person@example.invalid');
  for(const input of [null,{...good,password:'界'.repeat(25)},{...good,audience:'super_admin'},{...good,audience:'platform'},{...good,tenantId:null}])assert.throws(()=>credentials(input),{code:'AUTH_INVALID'});
  for(const options of [{origin:'http://crm.salemax.qa',insecureLoopback:true},{origin:'http://crm.salemax.qa'},{origin:'https://crm.salemax.qa/path'}])assert.throws(()=>createAuthRouter({pool:{},key:crypto.randomBytes(32),...options}),/AUTH_ORIGIN_INVALID/);
});
test('TOTP matches independent RFC 6238 SHA1 test vectors including beyond 2038',()=>{
  const secret=Buffer.from('12345678901234567890');
  for(const [time,expected] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])assert.equal(totp(secret,Math.floor(time/30),8),expected);
  assert.equal(base32(Buffer.from('foobar')),'MZXW6YTBOI');
});
