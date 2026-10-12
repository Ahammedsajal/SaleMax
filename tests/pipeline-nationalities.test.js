'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');

const controls=fs.readFileSync(path.join(__dirname,'../client/public/training-registration-controls.js'),'utf8');
const pipeline=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/pipeline.js'),'utf8');
const pipelinePage=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/index.html'),'utf8');

test('Lead Pipeline reuses the full bilingual nationality catalogue without requiring registration form code',()=>{
  const window={};
  vm.runInNewContext(controls,{window,Intl});
  const english=window.SXTrainingNationalities.choices('en');
  const arabic=window.SXTrainingNationalities.choices('ar');
  assert.equal(english.length,250);
  assert.equal(new Set(english.map(([value])=>value)).size,250);
  assert.ok(english.some(([value])=>value==='Egypt'));
  assert.ok(english.some(([value])=>value==='Ethiopia'));
  assert.equal(arabic.find(([value])=>value==='Qatar')[1],'قطر');
  assert.equal(Array.from(english.find(([value])=>value==='Western Sahara')).join('|'),'Western Sahara|Western Sahara');
  assert.equal(Array.from(arabic.find(([value])=>value==='Western Sahara')).join('|'),'Western Sahara|الصحراء الغربية');
  assert.match(pipelinePage,/training-registration-controls\.js\?v=20261012-full-nationalities1/);
  assert.match(pipeline,/SXTrainingNationalities\?\.choices\(ar\?'ar':'en'\)/);
  assert.match(pipeline,/if\(value&&!entries\.some\(\(\[name\]\)=>name===value\)\)entries\.push\(\[value,value\]\)/);
});
