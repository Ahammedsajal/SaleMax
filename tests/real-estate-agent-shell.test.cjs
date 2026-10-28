'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const patcher=path.resolve(__dirname,'../deploy/patch-real-estate-agent-shell.cjs');
test('patches Real Estate Team Access assets and inserts its preference helper once',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'real-estate-shell-'));
  try{for(const prior of ['20261027-real-estate-team1','20261022-agent-password-reset1']){const file=path.join(directory,'index.html'),html=`<link rel="stylesheet" href="/team-access.css?v=prior"><script src="campaign-upload.js?v=prod-only"></script><script src="team-invitations.js?v=${prior}"></script><script src="pwa-launch-splash.js?v=prod-only"></script>`;fs.writeFileSync(file,html);const result=spawnSync(process.execPath,[patcher,file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const updated=fs.readFileSync(file,'utf8');assert.match(updated,/team-ui-preferences\.js\?v=20261028-team-ui-sync1/);assert.equal((updated.match(/team-ui-preferences\.js/g)||[]).length,1);assert.match(updated,/team-invitations\.js\?v=20261028-real-estate-ui-sync1/);assert.match(updated,/team-access\.css\?v=20261028-team-ui-sync1/);assert.ok(updated.indexOf('team-ui-preferences.js')<updated.indexOf('team-invitations.js'));}}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('rejects missing or ambiguous cache anchors without changing the shell',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'real-estate-shell-'));
  try{for(const html of ['<script src="campaign.js?v=other"></script>','<script src="team-invitations.js?v=other"></script><script src="team-invitations.js?v=again"></script>']){const file=path.join(directory,'index.html');fs.writeFileSync(file,html);const result=spawnSync(process.execPath,[patcher,file],{encoding:'utf8'});assert.notEqual(result.status,0);assert.equal(fs.readFileSync(file,'utf8'),html);}}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
