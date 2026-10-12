'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');

const controls=fs.readFileSync(path.join(__dirname,'../client/public/training-registration-controls.js'),'utf8');
const pipeline=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/pipeline.js'),'utf8');
const pipelinePage=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/index.html'),'utf8');

test('Lead Pipeline reuses the full bilingual nationality catalogue from its shared controls asset',()=>{
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

  const start=pipeline.indexOf('  let generatedFieldId=0;'),end=pipeline.indexOf('  async function addLead()',start);
  assert.ok(start>=0&&end>start,'generated Pipeline field helpers exist');
  const sandbox={ar:false,window,escape:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')};
  vm.runInNewContext(`${pipeline.slice(start,end)}\nthis.profileControl=profileControl;`,sandbox);
  const englishField=sandbox.profileControl('nationality','Nationality','Egypt');
  assert.equal((englishField.match(/<option\b/g)||[]).length,251,'prompt plus all 250 countries are rendered');
  assert.match(englishField,/for="sx-pipeline-qualification_nationality-\d+"/);
  assert.match(englishField,/selected value="Egypt"/);
  sandbox.ar=true;
  const arabicField=sandbox.profileControl('nationality','الجنسية','Egypt');
  assert.match(arabicField,/value="Egypt">مصر<\/option>/,'Arabic labels keep canonical English saved values');
  assert.match(arabicField,/selected value="Egypt"/,'an existing selection remains selected when the field is rebuilt');
});
