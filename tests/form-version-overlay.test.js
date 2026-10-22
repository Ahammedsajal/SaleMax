'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
test('generic staff forms overlay retains live shell markup and installs shared API loaders',()=>{
 const root=path.resolve(__dirname,'..'),target=fs.mkdtempSync(path.join(os.tmpdir(),'sx-form-version-'));try{
  const formPath=path.join(target,'client/public/training-form.html'),indexPath=path.join(target,'client/public/index.html');fs.mkdirSync(path.dirname(formPath),{recursive:true});
  const beforeForm=fs.readFileSync(path.join(root,'client/public/training-form.html'),'utf8').replace('<script src="/workspace-api.js?v=20261022-generic-staff-forms1" defer></script>','').replace('/training-public-form.js?v=20261022-generic-staff-forms1','/training-public-form.js?v=live');
  const beforeIndex=fs.readFileSync(path.join(root,'client/public/index.html'),'utf8').replace('/workspace-api.js?v=20261022-generic-staff-forms1','/workspace-api.js?v=live').replace('/training-forms.js?v=20261022-generic-staff-forms1','/training-forms.js?v=live');
  fs.writeFileSync(formPath,beforeForm);fs.writeFileSync(indexPath,beforeIndex);
  const result=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/deploy-form-version-overlay.cjs'),target,root],{encoding:'utf8'}));assert.equal(result.runtimeFiles.length,9);assert.deepEqual(result.migrations,['20261022_pipeline_identity_activity_actor.sql']);
  const form=fs.readFileSync(formPath,'utf8'),index=fs.readFileSync(indexPath,'utf8');assert.match(form,/workspace-api\.js\?v=20261022-generic-staff-forms1.*training-public-form\.js\?v=20261022-generic-staff-forms1/);assert.match(index,/workspace-api\.js\?v=20261022-generic-staff-forms1/);assert.match(index,/training-forms\.js\?v=20261022-generic-staff-forms1/);assert.equal(fs.readFileSync(path.join(target,'client/public/workspace-api.js'),'utf8'),fs.readFileSync(path.join(root,'client/public/workspace-api.js'),'utf8'));assert.equal(fs.readFileSync(path.join(target,'client/public/index.html'),'utf8').includes('/static/css/main.e546b2bd.css'),true);
 }finally{fs.rmSync(target,{recursive:true,force:true});}
});
