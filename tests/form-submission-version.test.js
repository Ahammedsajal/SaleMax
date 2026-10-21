'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),guard=require('../modules/platform/form-submission-version');
test('displayed versions use exact positive integers while older omitted versions remain compatible',()=>{
 for(const value of [null,'1',0,-1,1.1,{},Number.MAX_SAFE_INTEGER+1])assert.throws(()=>guard.normalize(value),{code:'INVALID_FORM_VERSION',status:400});
 assert.equal(guard.normalize(undefined),undefined);guard.assertCurrent(undefined,2);guard.assertCurrent(2,'2');assert.throws(()=>guard.assertCurrent(1,2),{code:'FORM_VERSION_CHANGED',status:409});
});
test('retry lookup binds original version to tenant, form and idempotency token',async()=>{
 const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});return [[{id:'submission-a',reference_code:'REFERENCE',lead_id:'lead-a',schema_json:'{"templateKey":null}'}]];}};
 assert.deepEqual(await guard.replay(db,{tenantId:'tenant-a',formId:'form-a',tokenHash:'hash'}),{referenceCode:'REFERENCE',leadId:'lead-a',repeated:true});
 assert.match(calls[0].sql,/v.tenant_id=s.tenant_id/);assert.match(calls[0].sql,/v.version=s.form_version/);assert.deepEqual(calls[0].args,['tenant-a','form-a','hash']);assert.equal(await guard.replay({query:async()=>[[]]},{tenantId:'b',formId:'a',tokenHash:'hash'}),null);
});
