'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('customization release overlays preserve the existing generated shell and unrelated source',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sx-customization-overlay-')),target=path.join(root,'live-copy');
 try{
  fs.mkdirSync(path.join(target,'client/public'),{recursive:true});
  const original='<head><script src="/workspace-api.js?v=old"></script><script defer src="/training-sidebar.js?v=old"></script><script defer="defer" src="/tenant-crm-appearance.js?v=old"></script><script src="/static/js/current-production.js"></script></head>';
  fs.writeFileSync(path.join(target,'client/public/index.html'),original);fs.writeFileSync(path.join(target,'current-fix.js'),'production-only fix');
  const script=path.join(__dirname,'../scripts/deploy-tenant-customization-overlay.cjs'),source=path.join(__dirname,'..'),result=spawnSync(process.execPath,[script,target,source],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const evidence=JSON.parse(result.stdout);assert.equal(evidence.runtimeFiles.length,10);assert.deepEqual(evidence.migrations,['20261220_tenant_customization.sql']);
  const html=fs.readFileSync(path.join(target,'client/public/index.html'),'utf8');assert.ok(html.includes('/static/js/current-production.js'));assert.equal(html.match(/\/tenant-customization.js/g).length,1);assert.ok(html.indexOf('/tenant-customization.js')<html.indexOf('/tenant-crm-appearance.js'));assert.equal(fs.readFileSync(path.join(target,'current-fix.js'),'utf8'),'production-only fix');
  const repeat=spawnSync(process.execPath,[script,target,source],{encoding:'utf8'});assert.notEqual(repeat.status,0);assert.match(repeat.stderr,/CUSTOMIZATION_LOADER_ALREADY_PRESENT/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
