'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {diagnosticCode,publicSubmissionError}=require('../modules/platform/recruitment-public-errors');
const {format}=require('../client/public/recruitment-application-errors');

test('public recruitment errors show a safe exact cause without exposing internal messages',()=>{
  const databaseError=Object.assign(new Error('private SQL text with candidate details'),{code:'ER_NO_SUCH_TABLE'});
  const result=publicSubmissionError(databaseError);
  assert.equal(result.status,503);
  assert.deepEqual(result.body,{success:false,code:'RECRUITMENT_UNAVAILABLE',diagnosticCode:'ER_NO_SUCH_TABLE'});
  assert.doesNotMatch(JSON.stringify(result),/private SQL text|candidate details/);
  assert.equal(diagnosticCode(Object.assign(new Error('connection detail'),{code:'PROTOCOL_CONNECTION_LOST'})),'PROTOCOL_CONNECTION_LOST');
  assert.equal(diagnosticCode(Object.assign(new Error('network detail'),{code:'EHOSTUNREACH'})),'EHOSTUNREACH');
  assert.equal(diagnosticCode(Object.assign(new Error('private detail'),{code:'SELECT_SECRET_DATA'})),'UNEXPECTED_SERVER_ERROR');
  assert.equal(publicSubmissionError(Object.assign(new Error('invalid value'),{code:'INVALID_EMAIL'})).body.code,'INVALID_EMAIL');
  assert.equal(publicSubmissionError(Object.assign(new Error('wrong origin'),{code:'ORIGIN_DENIED',status:403})).status,403);
  assert.deepEqual(publicSubmissionError(Object.assign(new Error('large upload'),{code:'LIMIT_FILE_SIZE'})),{status:413,body:{success:false,code:'INVALID_CV_FILE',diagnosticCode:'LIMIT_FILE_SIZE'}});
  assert.deepEqual(publicSubmissionError(Object.assign(new Error('truncated upload'),{code:'INVALID_CV_FILE',status:413})),{status:413,body:{success:false,code:'INVALID_CV_FILE',diagnosticCode:'HTTP_413'}});
});

test('applicants receive plain-language guidance and an exact safe cause for technical failures',()=>{
  assert.equal(format('RECRUITMENT_UNAVAILABLE','ER_BAD_FIELD_ERROR'), 'We could not submit your application right now. Please try again in a few minutes. [Cause: ER_BAD_FIELD_ERROR]');
  assert.equal(format('RECRUITMENT_UNAVAILABLE','ECONNREFUSED','ar'), 'تعذر إرسال طلبك الآن. يرجى المحاولة مرة أخرى بعد بضع دقائق. [السبب: ECONNREFUSED]');
  assert.equal(format('APPLICATION_SUBMIT_FAILED','HTTP_413'), 'Your CV could not be uploaded. Please choose a file under 8 MB and try again. [Cause: HTTP_413]');
  assert.equal(format('INVALID_CV_FILE','LIMIT_FILE_SIZE'), 'Your CV is larger than 8 MB. Please choose a smaller file and try again. [Cause: LIMIT_FILE_SIZE]');
  assert.equal(format('INVALID_HINDI_LEVEL'), 'Please choose a Hindi level from the list.');
  assert.equal(format('RECRUITMENT_UNAVAILABLE','private database error'), 'We could not submit your application right now. Please try again in a few minutes. [Cause: UNEXPECTED_SERVER_ERROR]');
});
