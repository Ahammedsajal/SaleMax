'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const script=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/pipeline.js'),'utf8');
const style=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/pipeline.css'),'utf8');

test('lead selections open a full-page, deep-linkable detail view in the existing pipeline',()=>{
  assert.match(script,/detailPage: initialQuery\.get\('view'\) === 'detail'/);
  assert.match(script,/target\.searchParams\.set\("lead",id\);target\.searchParams\.set\("view","detail"\)/);
  assert.match(script,/api\(`\/leads\/\$\{encodeURIComponent\(id\)\}`\)/);
  assert.match(script,/document\.body\.classList\.toggle\('lead-detail-page',state\.detailPage\)/);
  assert.match(style,/\.lead-detail-page \.shell\{display:none\}/);
  assert.match(style,/\.lead-detail-page \.drawer\{position:relative/);
});

test('full-page lead edits refresh the same lead and the existing back control returns to the pipeline',()=>{
  assert.match(script,/if\(state\.detailPage\)\{await load\(\);await openLead\(id\);\}/);
  assert.match(script,/if\(state\.detailPage\)\{const target=new URL\(location\.href\);target\.searchParams\.delete\('lead'\);target\.searchParams\.delete\('view'\)/);
});

test('lead detail organizes the existing fields and actions into clear responsive sections',()=>{
  assert.ok(script.includes("leadFormLayout.replaceChildren(section(ar?'بيانات العميل':'Lead and contact'"));
  assert.match(script,/Pipeline and ownership/);
  assert.match(script,/Follow-up and outcome/);
  assert.match(script,/Value and source/);
  assert.ok(script.includes("actionBar.append($('#createLeadTask'),callLead,scheduleCall)"));
  assert.ok(style.includes('.lead-detail-page #editLead{max-width:none;display:grid'));
  assert.ok(style.includes('.lead-detail-page .application-chain .empty{margin:0;padding:14px'));
});

test('lead applications can be created in a modal and returned to the same linked lead',()=>{
  assert.match(script,/id="createLeadApplication"/);
  assert.match(script,/openApplicationCapture\(lead\)/);
  assert.match(script,/api\('\/training-forms'\)/);
  assert.match(script,/leadId',String\(lead\.id\)/);
  assert.match(script,/event\.source!==frame\.contentWindow/);
  assert.match(script,/sx-training-application-submitted/);
  assert.match(script,/await load\(\);await openLead\(lead\.id\)/);
  assert.match(script,/application-modal/);
  assert.match(style,/\.application-capture-frame/);
});
