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
});

test('oversized CV parser errors stay on the applicant upload-error path with exact safe cause',()=>{
  const parserError=Object.assign(new Error('private upload parser detail'),{code:'LIMIT_FILE_SIZE'});
  const result=publicSubmissionError(parserError);
  assert.equal(result.status,413);
  assert.deepEqual(result.body,{success:false,code:'INVALID_CV_FILE',diagnosticCode:'LIMIT_FILE_SIZE'});
  assert.equal(format(result.body.code,result.body.diagnosticCode), 'Your CV is larger than 8 MB. Please choose a smaller file and try again. [Cause: The CV is larger than the 8 MB limit (LIMIT_FILE_SIZE)]');
  assert.doesNotMatch(JSON.stringify(result),/private upload parser detail/);

  const validationError=Object.assign(new Error('private validator detail'),{code:'INVALID_CV_FILE',status:413});
  assert.deepEqual(publicSubmissionError(validationError).body,{success:false,code:'INVALID_CV_FILE',diagnosticCode:'HTTP_413'});
  assert.equal(format('INVALID_CV_FILE','HTTP_413'), 'Your CV could not be uploaded. Please choose a file under 8 MB and try again. [Cause: The CV upload exceeded the allowed request size (HTTP_413)]');
});

test('applicants receive plain-language guidance and an exact safe cause for technical failures',()=>{
  assert.equal(format('RECRUITMENT_UNAVAILABLE','ER_BAD_FIELD_ERROR'), 'We could not send your application just now. Please try again. If it still does not work, contact the 7Network recruitment team and include the cause shown in brackets. [Cause: The application details could not be saved (ER_BAD_FIELD_ERROR)]');
  assert.equal(format('RECRUITMENT_UNAVAILABLE','ECONNREFUSED','ar'), 'تعذر إرسال طلبك الآن. يرجى المحاولة مرة أخرى. إذا لم ينجح ذلك، تواصل مع فريق التوظيف في 7Network وأرسل لهم السبب الظاهر بين القوسين. [السبب: رفضت خدمة التقديم الاتصال (ECONNREFUSED)]');
  assert.equal(format('APPLICATION_SUBMIT_FAILED','HTTP_413'), 'Your CV could not be uploaded. Please choose a file under 8 MB and try again. [Cause: The CV upload exceeded the allowed request size (HTTP_413)]');
  assert.equal(format('LIMIT_FILE_SIZE','LIMIT_FILE_SIZE'), 'Your CV is larger than 8 MB. Please choose a smaller file and try again. [Cause: The CV is larger than the 8 MB limit (LIMIT_FILE_SIZE)]');
  assert.equal(format('INVALID_HINDI_LEVEL'), 'Please choose a Hindi level from the list.');
  assert.equal(format('RECRUITMENT_UNAVAILABLE','private database error'), 'We could not send your application just now. Please try again. If it still does not work, contact the 7Network recruitment team and include the cause shown in brackets. [Cause: An unexpected technical error (UNEXPECTED_SERVER_ERROR)]');
});
