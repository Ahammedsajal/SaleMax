'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {isAuthorizedInternalRequest,requireInternalAuth}=require('../modules/platform/internal-request-auth');

function request(headers={}){const normalized=Object.fromEntries(Object.entries(headers).map(([key,value])=>[key.toLowerCase(),value]));return {get:name=>normalized[name.toLowerCase()]||''};}

test('internal request authentication fails closed when the shared secret is absent or wrong',()=>{
  assert.equal(isAuthorizedInternalRequest(request({'x-internal-secret':'secret'}),{}),false);
  assert.equal(isAuthorizedInternalRequest(request({'x-internal-secret':'wrong'}),{CRM_INTERNAL_SECRET:'secret'}),false);
  assert.equal(isAuthorizedInternalRequest(request({Authorization:'Bearer secret-extra'}),{CRM_INTERNAL_SECRET:'secret'}),false);
});

test('internal request authentication accepts only the configured secret header or bearer token',()=>{
  const env={CRM_INTERNAL_SECRET:'internal-secret-123'};
  assert.equal(isAuthorizedInternalRequest(request({'x-internal-secret':'internal-secret-123'}),env),true);
  assert.equal(isAuthorizedInternalRequest(request({Authorization:'Bearer internal-secret-123'}),env),true);
  assert.equal(isAuthorizedInternalRequest(request({Authorization:'Basic internal-secret-123'}),env),false);
});

test('internal middleware rejects before continuing and preserves the shared response contract',()=>{
  let body,status,continued=false;
  const response={status(value){status=value;return this;},json(value){body=value;return this;}};
  requireInternalAuth(request(),response,()=>{continued=true;});
  assert.equal(status,401);
  assert.deepEqual(body,{success:false,msg:'Unauthorized internal request'});
  assert.equal(continued,false);
});
