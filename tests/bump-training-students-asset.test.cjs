'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const script=path.join(__dirname,'../scripts/bump-training-students-asset.cjs');

test('training student asset bump updates exactly one loader reference and is repeatable',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'salemax-student-asset-'));
  try{
    const file=path.join(dir,'training-courses.js');
    fs.writeFileSync(file,"script.src='/training-students.js?v=previous';\n");
    const first=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
    assert.equal(first.status,0,first.stderr);
    assert.equal(fs.readFileSync(file,'utf8'),"script.src='/training-students.js?v=20261012-trainer-picker1';\n");
    const second=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
    assert.equal(second.status,0,second.stderr);
    assert.equal(fs.readFileSync(file,'utf8'),"script.src='/training-students.js?v=20261012-trainer-picker1';\n");
  }finally{const file=path.join(dir,'training-courses.js');if(fs.existsSync(file))fs.unlinkSync(file);if(fs.existsSync(dir))fs.rmdirSync(dir);}
});

test('training student asset bump refuses ambiguous loader references',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'salemax-student-asset-'));
  try{
    const file=path.join(dir,'training-courses.js');
    fs.writeFileSync(file,"a.src='/training-students.js?v=one'; b.src='/training-students.js?v=two';\n");
    const result=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Expected one training-students script reference/);
    assert.match(fs.readFileSync(file,'utf8'),/v=one.*v=two/);
  }finally{const file=path.join(dir,'training-courses.js');if(fs.existsSync(file))fs.unlinkSync(file);if(fs.existsSync(dir))fs.rmdirSync(dir);}
});
