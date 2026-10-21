'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
test('base CRM deploy patches only its loader in the existing generated shell',()=>{
 const target=fs.mkdtempSync(path.join(os.tmpdir(),'base-crm-overlay-')),root=path.resolve(__dirname,'..');try{fs.mkdirSync(path.join(target,'client/public'),{recursive:true});const html='<script src="/static/unchanged.js"></script><script src="/admin-user-plans.js?v=old"></script><div>production-only</div>';fs.writeFileSync(path.join(target,'client/public/index.html'),html);execFileSync(process.execPath,[path.join(root,'scripts/deploy-base-crm-overlay.cjs'),target,root]);assert.equal(fs.readFileSync(path.join(target,'client/public/index.html'),'utf8'),html.replace('admin-user-plans.js?v=old','admin-user-plans.js?v=20261021-base-crm1'));}finally{fs.rmSync(target,{recursive:true,force:true});}
});
