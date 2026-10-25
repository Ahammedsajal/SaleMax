'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function run(script,file){return spawnSync(process.execPath,[path.join(root,'deploy',script),file],{encoding:'utf8'});}

test('production server patch adds and idempotently preserves the reminder worker lifecycle',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sales-prospect-server-'));
 try{
  const file=path.join(dir,'server.js');fs.writeFileSync(file,"let businessNotificationRuntime = null;\n  businessNotificationRuntime = require('./modules/platform/business-notifications').start();\n  businessNotificationRuntime?.stop();\n");
  let result=run('patch-sales-prospect-runtime.cjs',file);assert.equal(result.status,0,result.stderr);
  const expected=fs.readFileSync(file,'utf8');assert.match(expected,/let salesProspectReminderRuntime = null/);assert.match(expected,/chatbot-sales-prospect-reminders'\)\.start\(\)/);assert.match(expected,/salesProspectReminderRuntime\?\.stop\(\)/);
  result=run('patch-sales-prospect-runtime.cjs',file);assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(file,'utf8'),expected);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('chatbot cache patch preserves production sidebar content and changes exactly one script key',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sales-prospect-sidebar-'));
 try{
  const file=path.join(dir,'training-sidebar.js');fs.writeFileSync(file,"const preserved='live sidebar'; const script='/chatbot-admin.js?v=20261021-base-lead-capture1';");
  const result=run('patch-sales-prospect-cache.cjs',file);assert.equal(result.status,0,result.stderr);
  const output=fs.readFileSync(file,'utf8');assert.match(output,/live sidebar/);assert.match(output,/20261025-sales-prospect-flow1/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
