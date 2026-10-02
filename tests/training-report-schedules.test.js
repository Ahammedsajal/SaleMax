'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const schedules=require('../modules/platform/training-report-schedules');
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
test('report schedules require active training-center entitlement and owner permission',()=>{
  assert.doesNotThrow(()=>schedules.validateContext(context()));
  assert.throws(()=>schedules.validateContext(context({membership:{id:'manager',tenantId:'tenant-a',role:'manager',status:'active',delegatedPermissions:[]}})),{code:'PERMISSION_DENIED'});
  assert.throws(()=>schedules.validateContext(context({subscription:{status:'active',capabilities:['reports.read']}})),{code:'FEATURE_UNAVAILABLE'});
});
test('the existing bilingual pipeline Reports view exposes schedules with honest delivery state',()=>{
  const fs=require('node:fs'),path=require('node:path'),js=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/reports.js'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/index.html'),'utf8');
  assert.match(html,/reports\.js\?v=5/);assert.match(js,/\/api\/pipeline\/reports\/schedules/);assert.match(js,/scheduleEmailUnverified/);assert.match(js,/scheduleWhatsAppUnverified/);assert.match(js,/scheduleProvider/);assert.match(js,/المجدول والتسليم الآلي غير مفعّلين/);
});
