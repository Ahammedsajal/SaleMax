'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const script=path.join(__dirname,'../scripts/bump-pipeline-script-asset.cjs');

function withHtml(html,run){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'salemax-pipeline-asset-')),file=path.join(dir,'index.html');
  try{fs.writeFileSync(file,html);run(file);}finally{if(fs.existsSync(file))fs.unlinkSync(file);if(fs.existsSync(dir))fs.rmdirSync(dir);}
}

test('pipeline asset bump updates one loader reference and is repeatable',()=>withHtml('<script src="/pipeline/pipeline.js?v=previous"></script>',file=>{
  const first=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
  assert.equal(first.status,0,first.stderr);
  assert.equal(fs.readFileSync(file,'utf8'),'<script src="/pipeline/pipeline.js?v=20261012-course-interest1"></script>');
  const second=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
  assert.equal(second.status,0,second.stderr);
}));

test('pipeline asset bump rejects ambiguous loader references without editing',()=>withHtml('<script src="/pipeline/pipeline.js?v=one"></script><script src="/pipeline/pipeline.js?v=two"></script>',file=>{
  const result=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Expected one pipeline script reference/);
  assert.match(fs.readFileSync(file,'utf8'),/v=one.*v=two/);
}));
