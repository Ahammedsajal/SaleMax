'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const schedules=require('../modules/platform/training-report-schedules');
const runner=require('../modules/platform/training-report-runner');
const {trainingCenter}=require('../modules/platform/categories');
const base={period:'daily',timezone:'Asia/Qatar',localTime:'20:00',emailEnabled:true,emailDestination:'owner@example.qa',whatsappEnabled:true,whatsappDestination:'+97455123456'};
function context(overrides={}){return {audience:'tenant',identity:{id:'identity-a'},tenant:{id:'tenant-a',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member-a',tenantId:'tenant-a',role:'owner',status:'active',delegatedPermissions:[]},category:trainingCenter,subscription:{status:'active',capabilities:['reports.read','reports.schedule']},...overrides};}
test('report schedule input validates Qatar report destinations and channel selection',()=>{
  assert.deepEqual(schedules.normalize(base),{...base,status:'active'});
  assert.equal(schedules.normalize({...base,whatsappEnabled:false,whatsappDestination:''}).whatsappDestination,null);
  for(const input of [{...base,period:'yearly'},{...base,timezone:'Mars/Doha'},{...base,localTime:'24:00'},{...base,emailEnabled:false,whatsappEnabled:false},{...base,emailDestination:'owner-at-example.qa'},{...base,whatsappDestination:'97455123456'},{...base,unexpected:true}])assert.throws(()=>schedules.normalize(input));
});
test('daily, weekly and monthly report schedules use timezone-aware next local run times',()=>{
  const now=new Date('2026-10-02T18:00:00.000Z');
  assert.equal(schedules.nextRun({period:'daily',timezone:'Asia/Qatar',localTime:'20:00'},now),'2026-10-03 17:00:00.000');
  assert.equal(schedules.nextRun({period:'weekly',timezone:'Asia/Qatar',localTime:'08:00'},now),'2026-10-05 05:00:00.000');
  assert.equal(schedules.nextRun({period:'monthly',timezone:'Asia/Qatar',localTime:'08:00'},now),'2026-11-01 05:00:00.000');
  const before=new Date('2026-10-02T01:00:00.000Z');
  assert.equal(schedules.nextRun({period:'daily',timezone:'Asia/Qatar',localTime:'08:00'},before),'2026-10-02 05:00:00.000');
});
test('scheduled snapshots use the intended completed period and local cutoff',()=>{
  const daily=runner.windowFor({period:'daily',timezone:'Asia/Qatar',scheduledAt:'2026-10-01 16:30:00.000'});
  assert.deepEqual(daily,{period:'daily',timezone:'Asia/Qatar',date:'2026-10-01',start:'2026-09-30 21:00:00.000',end:'2026-10-01 16:30:00.000',cutoffAt:'2026-10-01 16:30:00.000'});
  const weekly=runner.windowFor({period:'weekly',timezone:'Asia/Qatar',scheduledAt:'2026-10-05 05:00:00.000'});
  assert.deepEqual(weekly,{period:'weekly',timezone:'Asia/Qatar',date:'2026-09-28',start:'2026-09-27 21:00:00.000',end:'2026-10-04 21:00:00.000',cutoffAt:'2026-10-05 05:00:00.000'});
  const monthly=runner.windowFor({period:'monthly',timezone:'Asia/Qatar',scheduledAt:'2026-11-01 05:00:00.000'});
  assert.deepEqual(monthly,{period:'monthly',timezone:'Asia/Qatar',date:'2026-10-01',start:'2026-09-30 21:00:00.000',end:'2026-10-31 21:00:00.000',cutoffAt:'2026-11-01 05:00:00.000'});
  const midnight=runner.windowFor({period:'daily',timezone:'Asia/Qatar',scheduledAt:'2026-10-02 21:00:00.000'});
  assert.deepEqual(midnight,{period:'daily',timezone:'Asia/Qatar',date:'2026-10-02',start:'2026-10-01 21:00:00.000',end:'2026-10-02 21:00:00.000',cutoffAt:'2026-10-02 21:00:00.000'});
  assert.equal(runner.nextRunAfter({period:'daily',timezone:'Asia/Qatar',localTime:'19:30'},'2026-10-01 16:30:00.000'),'2026-10-02 16:30:00.000');
});
test('daily report cutoffs must stay inside the selected Qatar-local calendar day',()=>{
  const reports=require('../helper/pipeline/reports');
  assert.equal(reports.periodWindow({period:'daily',at:'2026-10-01',timezone:'Asia/Qatar',cutoffAt:'2026-10-01 16:30:00.000'}).end,'2026-10-01 16:30:00.000');
  assert.equal(reports.periodWindow({period:'daily',at:'2026-10-02',timezone:'Asia/Qatar',cutoffAt:'2026-10-02T21:00:00.000Z'}).end,'2026-10-02 21:00:00.000');
  assert.throws(()=>reports.periodWindow({period:'daily',at:'2026-10-01',timezone:'Asia/Qatar',cutoffAt:'2026-10-01T21:00:01.000Z'}));
});
test('report schedules require active training-center entitlement and owner permission',()=>{
  assert.doesNotThrow(()=>schedules.validateContext(context()));
  assert.throws(()=>schedules.validateContext(context({membership:{id:'manager',tenantId:'tenant-a',role:'manager',status:'active',delegatedPermissions:[]}})),{code:'PERMISSION_DENIED'});
  assert.throws(()=>schedules.validateContext(context({subscription:{status:'active',capabilities:['reports.read']}})),{code:'FEATURE_UNAVAILABLE'});
});
test('corrected report versions require the active owner and a bounded explanation',async()=>{
  const revision={scheduleId:'00000000-0000-4000-8000-000000000001',runId:'00000000-0000-4000-8000-000000000002',expectedRevision:1,requestKey:'00000000-0000-4000-8000-000000000003',reason:'Late data correction.'};
  const unusedDb={beginTransaction(){throw Error('permission and input checks must run before database access');}};
  await assert.rejects(schedules.reviseRun(unusedDb,context({membership:{id:'manager',tenantId:'tenant-a',role:'manager',status:'active',delegatedPermissions:[]}}),revision),{code:'PERMISSION_DENIED'});
  await assert.rejects(schedules.reviseRun(unusedDb,context(),{...revision,reason:'short'}),{code:'INVALID_REPORT_REVISION_REASON'});
});
test('the existing bilingual pipeline Reports view exposes schedules with honest delivery state',()=>{
  const fs=require('node:fs'),path=require('node:path'),js=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/reports.js'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/index.html'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/pipeline.css'),'utf8'),routes=fs.readFileSync(path.join(__dirname,'../routes/pipeline.js'),'utf8');
  assert.match(html,/pipeline\.css\?v=10/);assert.match(html,/reports\.js\?v=17/);assert.match(js,/\/api\/pipeline\/reports\/schedules/);assert.match(js,/scheduleEmailUnverified/);assert.match(js,/scheduleWhatsAppUnverified/);assert.match(js,/scheduleRun_generated/);assert.match(js,/Snapshot generated \(not sent\)/);assert.match(js,/تم إنشاء الملخص \(لم يُرسل\)/);assert.match(js,/Create corrected snapshot/);assert.match(js,/إنشاء ملخص مصحح/);assert.match(js,/snapshotHistory/);assert.match(js,/verifications/);assert.match(js,/reportCodeSent/);assert.match(js,/reportDestinationVerified/);assert.match(routes,/reports\/schedules\/\:scheduleId\/verifications/);assert.match(css,/\.report-revision/);assert.match(css,/\.report-run-versions/);assert.match(routes,/reports\/schedules\/\:scheduleId\/runs\/\:runId\/revisions/);
});
