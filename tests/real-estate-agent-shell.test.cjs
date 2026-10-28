'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const patcher=path.resolve(__dirname,'../deploy/patch-real-estate-agent-shell.cjs');
test('patches only the real estate team cache reference in a production-derived shell',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'real-estate-shell-'));
  try{for(const prior of ['20261027-real-estate-team1','20261022-agent-password-reset1']){const file=path.join(directory,'index.html'),html=`<script src="campaign-upload.js?v=prod-only"></script><script src="team-invitations.js?v=${prior}"></script><script src="pwa-launch-splash.js?v=prod-only"></script>`;fs.writeFileSync(file,html);const result=spawnSync(process.execPath,[patcher,file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(file,'utf8'),html.replace(prior,'20261028-real-estate-profiles1'));}}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('rejects missing or ambiguous cache anchors without changing the shell',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'real-estate-shell-'));
  try{for(const html of ['<script src="campaign.js?v=other"></script>','<script src="team-invitations.js?v=other"></script><script src="team-invitations.js?v=again"></script>']){const file=path.join(directory,'index.html');fs.writeFileSync(file,html);const result=spawnSync(process.execPath,[patcher,file],{encoding:'utf8'});assert.notEqual(result.status,0);assert.equal(fs.readFileSync(file,'utf8'),html);}}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
