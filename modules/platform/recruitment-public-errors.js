'use strict';

const SAFE_DIAGNOSTIC_CODES=new Set([
  'APPLICATION_RATE_LIMITED','CATEGORY_UNAVAILABLE','CONSENT_REQUIRED','CV_FILE_REQUIRED','CV_NOT_FOUND','CV_TYPE_NOT_ALLOWED',
  'INVALID_APPLICATION','INVALID_AVAILABILITY','INVALID_CV_FILE','INVALID_EMAIL','INVALID_ENGLISH_LEVEL','INVALID_EXPERIENCE_YEARS',
  'INVALID_HINDI_LEVEL','INVALID_MOBILE','INVALID_SUBMISSION_TOKEN','INVALID_VISITOR','ORIGIN_DENIED','PREFILL_NOT_FOUND',
  'RECRUITMENT_OWNER_UNAVAILABLE','RECRUITMENT_STORAGE_NOT_CONFIGURED','RECRUITMENT_STORAGE_UNAVAILABLE','TENANT_NOT_FOUND',
]);

function diagnosticCode(error){
  const code=error?.code;
  if(typeof code!=='string')return 'UNEXPECTED_SERVER_ERROR';
  // Error codes are useful for support, but error.message may contain SQL,
  // filesystem paths, or applicant data. Only return machine-generated code
  // tokens with well-known prefixes; never return arbitrary strings.
  if(SAFE_DIAGNOSTIC_CODES.has(code)||/^ER_[A-Z0-9_]{1,72}$/.test(code)||/^PROTOCOL_[A-Z0-9_]{1,64}$/.test(code)||['EACCES','EADDRINUSE','ECONNABORTED','ECONNREFUSED','ECONNRESET','EHOSTUNREACH','EPIPE','ENETUNREACH','ENOSPC','ETIMEDOUT','EAI_AGAIN','ENOTFOUND'].includes(code))return code;
  return 'UNEXPECTED_SERVER_ERROR';
}

function publicSubmissionError(error){
  const code=error?.code||'RECRUITMENT_UNAVAILABLE';
  const status=Number(error?.status)||(['APPLICATION_RATE_LIMITED'].includes(code)?429:['INVALID_','CONSENT_REQUIRED'].some(prefix=>typeof code==='string'&&code.startsWith(prefix))?400:['TENANT_NOT_FOUND','PREFILL_NOT_FOUND'].includes(code)?404:503);
  return {status,body:{success:false,code:status>=500?'RECRUITMENT_UNAVAILABLE':code,...(status>=500?{diagnosticCode:diagnosticCode(error)}:{})}};
}

module.exports={diagnosticCode,publicSubmissionError};
