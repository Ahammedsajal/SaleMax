'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
test('bot form overlay preserves the actual generated shell and supports its indirect sidebar loader',()=>{
 const root=path.resolve(__dirname,'..'),target=fs.mkdtempSync(path.join(os.tmpdir(),'sx-bot-form-overlay-'));try{
  const rel='client/public/index.html',before=fs.readFileSync(path.join(root,rel),'utf8').replace(/\/training-sidebar\.js\?[^"\s<>]+/g,'/training-sidebar.js?v=live');fs.mkdirSync(path.dirname(path.join(target,rel)),{recursive:true});fs.writeFileSync(path.join(target,rel),before);
  const run=()=>JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/deploy-bot-capture-forms-overlay.cjs'),target,root],{encoding:'utf8'}));
  assert.equal(run().runtimeFiles.length,9);assert.equal(fs.readFileSync(path.join(target,rel),'utf8'),before.replace('/training-sidebar.js?v=live','/training-sidebar.js?v=20261020-bot-forms1'));
  fs.appendFileSync(path.join(target,rel),'<script src="/chatbot-admin.js?v=old-direct"></script>');run();assert.match(fs.readFileSync(path.join(target,rel),'utf8'),/chatbot-admin.js\?v=20261020-bot-forms1/);
  fs.appendFileSync(path.join(target,rel),'<script src="/training-sidebar.js?v=duplicate"></script>');assert.throws(run);
 }finally{fs.rmSync(target,{recursive:true,force:true});}
});
