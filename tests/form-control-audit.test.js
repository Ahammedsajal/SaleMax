'use strict';
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

test('form inventory includes read-only outputs and marks read-only controls',()=>{
  const inventory=execFileSync(process.execPath,[path.join(__dirname,'../scripts/audit-form-controls.cjs')],{encoding:'utf8'});
  assert.match(inventory,/output:data-sale-course-price/);
  assert.match(inventory,/output:data-sale-registration-fee/);
  assert.match(inventory,/textarea:data-preview-config \[readonly\]/);
  assert.match(inventory,/button:Verify access/);
  assert.doesNotMatch(inventory,/output:unlabelled/);
});

