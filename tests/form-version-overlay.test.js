'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
test('version handshake deployment retains current public form template and unrelated assets',()=>{
 const root=path.resolve(__dirname,'..'),target=fs.mkdtempSync(path.join(os.tmpdir(),'sx-form-version-'));try{
  const file=path.join(target,'client/public/training-form.html');fs.mkdirSync(path.dirname(file),{recursive:true});const before=fs.readFileSync(path.join(root,'client/public/training-form.html'),'utf8').replace('/training-public-form.js?v=20261021-version1','/training-public-form.js?v=live');fs.writeFileSync(file,before);
  const result=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/deploy-form-version-overlay.cjs'),target,root],{encoding:'utf8'}));assert.equal(result.runtimeFiles.length,6);assert.deepEqual(result.migrations,[]);assert.equal(fs.readFileSync(file,'utf8'),before.replace('/training-public-form.js?v=live','/training-public-form.js?v=20261021-version1'));
 }finally{fs.rmSync(target,{recursive:true,force:true});}
});
