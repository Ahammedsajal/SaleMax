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
  assert.deepEqual(publicSubmissionError(Object.assign(new Error('file too large'),{code:'INVALID_CV_FILE',status:413})),{status:413,body:{success:false,code:'INVALID_CV_FILE',diagnosticCode:'HTTP_413'}});
  assert.deepEqual(publicSubmissionError(Object.assign(new Error('file too large'),{code:'LIMIT_FILE_SIZE'})),{status:413,body:{success:false,code:'INVALID_CV_FILE',diagnosticCode:'LIMIT_FILE_SIZE'}});
});

test('applicants receive plain-language guidance and an exact safe cause for technical failures',()=>{
  assert.equal(format('RECRUITMENT_UNAVAILABLE','ER_BAD_FIELD_ERROR'), 'We could not send your application just now. Please try again. If it still does not work, contact the 7Network recruitment team and include the cause shown in brackets. [Cause: The application details could not be saved (ER_BAD_FIELD_ERROR)]');
  assert.equal(format('RECRUITMENT_UNAVAILABLE','ECONNREFUSED','ar'), 'تعذر إرسال طلبك الآن. يرجى المحاولة مرة أخرى. إذا لم ينجح ذلك، تواصل مع فريق التوظيف في 7Network وأرسل لهم السبب الظاهر بين القوسين. [السبب: رفضت خدمة التقديم الاتصال (ECONNREFUSED)]');
  assert.equal(format('RECRUITMENT_UNAVAILABLE','ER_NO_SUCH_TABLE'), 'We could not send your application just now. Please try again. If it still does not work, contact the 7Network recruitment team and include the cause shown in brackets. [Cause: A required application service component is unavailable (ER_NO_SUCH_TABLE)]');
  assert.equal(format('INVALID_CV_FILE','HTTP_413'), 'Your CV could not be uploaded. Please choose a file under 8 MB and try again. [Cause: The CV upload exceeded the allowed request size (HTTP_413)]');
  assert.equal(format('APPLICATION_SUBMIT_FAILED','HTTP_413'), 'Your CV could not be uploaded. Please choose a file under 8 MB and try again. [Cause: The CV upload exceeded the allowed request size (HTTP_413)]');
  assert.equal(format('RECRUITMENT_UNAVAILABLE','RECRUITMENT_STORAGE_NOT_CONFIGURED'), 'We could not send your application just now. Please try again. If it still does not work, contact the 7Network recruitment team and include the cause shown in brackets. [Cause: Your CV could not be saved securely (RECRUITMENT_STORAGE_NOT_CONFIGURED)]');
  assert.equal(format('LIMIT_FILE_SIZE','LIMIT_FILE_SIZE'), 'Your CV is larger than 8 MB. Please choose a smaller file and try again. [Cause: The CV is larger than the 8 MB limit (LIMIT_FILE_SIZE)]');
  assert.equal(format('INVALID_HINDI_LEVEL'), 'Please choose a Hindi level from the list.');
  assert.equal(format('RECRUITMENT_UNAVAILABLE','private database error'), 'We could not send your application just now. Please try again. If it still does not work, contact the 7Network recruitment team and include the cause shown in brackets. [Cause: An unexpected technical error (UNEXPECTED_SERVER_ERROR)]');
  assert.equal(format('RECRUITMENT_UNAVAILABLE','ER_BAD_FIELD_ERROR','en','09a5fb13-8b8c-4f3a-92f6-f69da1bbd113'), 'We could not send your application just now. Please try again. If it still does not work, contact the 7Network recruitment team and include the cause shown in brackets. [Cause: The application details could not be saved (ER_BAD_FIELD_ERROR); Support reference: 09a5fb13-8b8c-4f3a-92f6-f69da1bbd113]');
  assert.doesNotMatch(format('RECRUITMENT_UNAVAILABLE','ER_BAD_FIELD_ERROR','en','candidate@example.com'),/candidate@example\.com/);
});
