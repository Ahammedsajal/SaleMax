'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const recipients=require('../modules/platform/training-report-recipients');
const schedules=require('../modules/platform/training-report-schedules');
test('Business Profile report recipients normalize email and international WhatsApp destinations',()=>{
  assert.equal(recipients.normalizeDestination('email',' Owner@Example.qa '),'owner@example.qa');
  assert.equal(recipients.normalizeDestination('whatsapp','+974 5512-3456'),'+97455123456');
  assert.throws(()=>recipients.normalizeDestination('email','bad-address'),{code:'INVALID_REPORT_EMAIL'});
  assert.throws(()=>recipients.normalizeDestination('whatsapp','97455123456'),{code:'INVALID_REPORT_WHATSAPP'});
});
test('scheduled report channels can be enabled without a legacy single destination',()=>{
  const value=schedules.normalize({period:'daily',timezone:'Asia/Qatar',localTime:'20:00',emailEnabled:true,emailDestination:'',whatsappEnabled:true,whatsappDestination:''});
  assert.equal(value.emailDestination,'');assert.equal(value.whatsappDestination,'');
});
test('recipient management is owner-only and the profile presents add, verify and remove controls',()=>{
  const db={query(){throw Error('database must not be reached for an unauthorized user');}};
  const ctx={audience:'tenant',tenant:{id:'tenant',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{tenantId:'tenant',status:'active',role:'agent'},category:require('../modules/platform/categories').trainingCenter,subscription:{status:'active',capabilities:['courses.manage']}};
  return recipients.list(db,ctx).then(()=>assert.fail('expected authorization denial'),error=>assert.ok(['PERMISSION_DENIED','FEATURE_UNAVAILABLE'].includes(error.code)));
});
test('report delivery migration keeps channel idempotency per profile recipient',()=>{
  const sql=fs.readFileSync(require.resolve('../database/migrations/20261117_training_report_recipients.sql'),'utf8');
  assert.match(sql,/CREATE TABLE sx_training_report_recipients/);assert.match(sql,/CREATE TABLE sx_training_report_recipient_challenges/);assert.match(sql,/UNIQUE KEY uq_training_report_delivery_channel \(tenant_id,report_run_id,channel,recipient_key\)/);
  const ui=fs.readFileSync(require.resolve('../client/public/training-courses.js'),'utf8');
  for(const control of ['Scheduled report recipients','Add recipient','Send code','Verify','Remove'])assert.ok(ui.includes(control));
});
