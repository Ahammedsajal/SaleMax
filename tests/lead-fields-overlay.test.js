'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('lead field overlay preserves current generated shell, pipeline document and unrelated runtime source',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sx-lead-field-overlay-'));try{
  const pub=path.join(root,'client/public');fs.mkdirSync(path.join(pub,'pipeline'),{recursive:true});fs.writeFileSync(path.join(pub,'index.html'),'<head><script defer src="/tenant-customization.js?v=live"></script><script src="/static/js/live.js"></script></head>');fs.writeFileSync(path.join(pub,'pipeline/index.html'),'<body>Current live pipeline<script src="/pipeline/pipeline.js?v=live"></script></body>');fs.writeFileSync(path.join(root,'live-only.js'),'preserved');
  const script=path.join(__dirname,'../scripts/deploy-lead-fields-overlay.cjs'),result=spawnSync(process.execPath,[script,root,path.join(__dirname,'..')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).runtimeFiles.length,11);
  const html=fs.readFileSync(path.join(pub,'index.html'),'utf8'),pipeline=fs.readFileSync(path.join(pub,'pipeline/index.html'),'utf8');assert.match(html,/\/static\/js\/live.js/);assert.ok(html.indexOf('/lead-field-editor.js')<html.indexOf('/tenant-customization.js'));assert.ok(pipeline.includes('Current live pipeline'));assert.ok(pipeline.indexOf('/pipeline/lead-fields.js')<pipeline.indexOf('/pipeline/pipeline.js'));assert.equal(fs.readFileSync(path.join(root,'live-only.js'),'utf8'),'preserved');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
