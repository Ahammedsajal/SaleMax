'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('static branch options route precedes dynamic course offer route',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../modules/platform/training-course-router.js'),'utf8');
  assert.ok(source.indexOf("router.get('/branches/options'")<source.indexOf("router.get('/:id/offers'"));
  assert.match(source,/courses\.listBranchOptions\(pool, req\.courseContext\)/);
});

test('public course and guest registration batches expose only explicitly public active branch locations',()=>{
  for(const file of ['../modules/platform/tenant-storefront-catalogue.js','../modules/platform/training-registration-workflow.js']){
    const source=fs.readFileSync(path.join(__dirname,file),'utf8');
    assert.match(source,/br\.status='active' AND br\.public_enabled=1/);
    assert.match(source,/b\.branch_id IS NULL OR br\.id IS NOT NULL/);
  }
});
