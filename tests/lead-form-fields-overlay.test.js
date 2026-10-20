'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
test('form-field overlay patches current loaders and preserves unrelated production content',()=>{
 const target=fs.mkdtempSync(path.join(os.tmpdir(),'sx-form-fields-')),root=path.resolve(__dirname,'..');try{
  for(const [rel,assets] of Object.entries({'client/public/index.html':['training-forms.js','lead-field-editor.js'],'client/public/training-form.html':['training-public-form.js'],'client/public/pipeline/index.html':['pipeline/pipeline.js']})){
   fs.mkdirSync(path.dirname(path.join(target,rel)),{recursive:true});fs.writeFileSync(path.join(target,rel),'<html data-live="preserve">'+assets.map(a=>'<script src="/'+a+'?v=live"></script>').join('')+'<script src="/live-only.js"></script></html>');
  }
  const result=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/deploy-lead-form-fields-overlay.cjs'),target,root],{encoding:'utf8'}));assert.equal(result.runtimeFiles.length,12);assert.deepEqual(result.migrations,[]);
  for(const rel of ['client/public/index.html','client/public/training-form.html','client/public/pipeline/index.html']){const html=fs.readFileSync(path.join(target,rel),'utf8');assert.match(html,/data-live="preserve"/);assert.match(html,/live-only.js/);assert.match(html,/20261020-form-fields1/);}
 }finally{fs.rmSync(target,{recursive:true,force:true});}
});
