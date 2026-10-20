'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const publicRouter=fs.readFileSync(path.join(root,'modules/platform/recruitment-router.js'),'utf8');
const application=fs.readFileSync(path.join(root,'client/public/recruitment-application.js'),'utf8');
const applicationHtml=fs.readFileSync(path.join(root,'client/public/recruitment-application.html'),'utf8');

test('public recruitment page identifies SaleMaX as the hiring company without exposing the registered entity',()=>{
  assert.match(publicRouter,/data:\{companyName:'SaleMaX',role:COPY\.role,roleSummary:COPY\.roleSummary,talabApple:COPY\.talabApple,talabAndroid:COPY\.talabAndroid,tenantSlug:tenant\.slug,consent:recruitment\.CONSENT\}/);
  assert.match(application,/SaleMaX is the company hiring for this role/);
  assert.match(application,/SaleMaX هي الشركة التي توظف لهذا الدور/);
  assert.doesNotMatch(application,/Sitta Arbaa Sitta|registered company name|Commercial Registration/);
  assert.match(applicationHtml,/recruitment-application\.js\?v=20261020-salemax-sales-manager-inr1/);
  const recruiter=fs.readFileSync(path.join(root,'modules/platform/recruitment-router.js'),'utf8');
  assert.match(recruiter,/work with the SaleMaX Sales Manager/);
  assert.match(recruiter,/15% of each paid QAR 2,500 annual subscription \(approximately INR 9,000–9,800 per paid sale\)/);
  assert.doesNotMatch(recruiter,/65,200|26\.08 per QAR|INR amounts are estimates/);
});
