'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const publicRouter=fs.readFileSync(path.join(root,'modules/platform/recruitment-router.js'),'utf8');
const application=fs.readFileSync(path.join(root,'client/public/recruitment-application.js'),'utf8');
const applicationHtml=fs.readFileSync(path.join(root,'client/public/recruitment-application.html'),'utf8');

test('public recruitment page identifies 7Network as the hiring company without exposing the registered entity',()=>{
  assert.match(publicRouter,/data:\{companyName:'7Network',role:COPY\.role,roleSummary:COPY\.roleSummary,talabApple:COPY\.talabApple,talabAndroid:COPY\.talabAndroid,tenantSlug:tenant\.slug,consent:recruitment\.CONSENT\}/);
  assert.match(application,/7Network is the company hiring for this role/);
  assert.match(application,/7Network هي الشركة التي توظف لهذا الدور/);
  assert.match(application,/Please attach your CV before submitting/);
  assert.match(application,/We could not submit your application right now/);
  assert.match(application,/\[\$\{language\?'السبب':'Cause'\}: \$\{diagnostic\}\]/);
  assert.match(application,/safeCode==='RECRUITMENT_UNAVAILABLE'\?safeCause:safeCode==='APPLICATION_SUBMIT_FAILED'\?safeCode:''/);
  assert.doesNotMatch(application,/Sitta Arbaa Sitta|registered company name|Commercial Registration/);
  assert.match(applicationHtml,/recruitment-application\.js\?v=20261021-apply-diagnostics-2/);
  const recruiter=fs.readFileSync(path.join(root,'modules/platform/recruitment-router.js'),'utf8');
  assert.match(recruiter,/work with the 7Network Sales Manager/);
  assert.match(recruiter,/15% of each paid QAR 2,500 annual subscription \(approximately INR 9,000–9,800 per paid sale\)/);
  assert.doesNotMatch(recruiter,/65,200|26\.08 per QAR|INR amounts are estimates/);
});
