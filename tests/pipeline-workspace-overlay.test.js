'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
test('deployment adapts current production HTML and preserves unrelated runtime files',()=>{
 const target=fs.mkdtempSync(path.join(os.tmpdir(),'sx-pipeline-workspace-')),root=path.resolve(__dirname,'..');
 try{
  fs.mkdirSync(path.join(target,'client/public/pipeline'),{recursive:true});fs.writeFileSync(path.join(target,'client/public/pipeline/index.html'),'<html data-current="production"><script src="/current-only.js"></script><script src="/pipeline/pipeline.js?v=live"></script></html>');fs.writeFileSync(path.join(target,'production-only.js'),'keep');
  const run=()=>execFileSync(process.execPath,[path.join(root,'scripts/deploy-pipeline-workspace-overlay.cjs'),target,root],{stdio:'pipe'});const result=JSON.parse(run());assert.equal(result.runtimeFiles.length,5);assert.deepEqual(result.migrations,[]);
  const html=fs.readFileSync(path.join(target,'client/public/pipeline/index.html'),'utf8');assert.match(html,/data-current="production"/);assert.match(html,/current-only.js/);assert.match(html,/workspace-fields.js\?v=20261020-category1.*pipeline.js\?v=20261020-category1/);assert.equal(fs.readFileSync(path.join(target,'production-only.js'),'utf8'),'keep');assert.throws(run);
 }finally{fs.rmSync(target,{recursive:true,force:true});}
});
