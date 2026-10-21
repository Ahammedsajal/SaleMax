'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {diagnosticCode,publicSubmissionError}=require('../modules/platform/recruitment-public-errors');

test('public recruitment errors show a safe exact cause without exposing internal messages',()=>{
  const databaseError=Object.assign(new Error('private SQL text with candidate details'),{code:'ER_NO_SUCH_TABLE'});
  const result=publicSubmissionError(databaseError);
  assert.equal(result.status,503);
  assert.deepEqual(result.body,{success:false,code:'RECRUITMENT_UNAVAILABLE',diagnosticCode:'ER_NO_SUCH_TABLE'});
  assert.doesNotMatch(JSON.stringify(result),/private SQL text|candidate details/);
  assert.equal(diagnosticCode(Object.assign(new Error('private detail'),{code:'SELECT_SECRET_DATA'})),'UNEXPECTED_SERVER_ERROR');
  assert.equal(publicSubmissionError(Object.assign(new Error('invalid value'),{code:'INVALID_EMAIL'})).body.code,'INVALID_EMAIL');
  assert.equal(publicSubmissionError(Object.assign(new Error('wrong origin'),{code:'ORIGIN_DENIED',status:403})).status,403);
});
