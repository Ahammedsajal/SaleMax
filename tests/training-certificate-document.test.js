'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const certificate=require('../client/public/training-certificate');

const record={number:'CERT-2026-000012',tenantName:'Salemax Academy',learnerName:'Aisha Example',courseName:'Business Skills',issuedAt:'2026-10-04T10:00:00.000Z'};

test('certificate document is printable on A4 landscape and carries its issuer, learner, course and record number',()=>{
  const html=certificate.html(record);
  for(const value of [record.tenantName,record.learnerName,record.courseName,record.number,'Certificate of Completion','Print / Save as PDF','@page{size:A4 landscape'])assert.ok(html.includes(value),`missing ${value}`);
});

test('certificate document localizes Arabic and escapes user-controlled names',()=>{
  const html=certificate.html({...record,tenantName:'<img src=x onerror=alert(1)>',learnerName:'<script>alert(1)</script>',courseName:'دورة <ب>'},'ar');
  assert.match(html,/<html lang="ar" dir="rtl">/);
  assert.match(html,/شهادة إتمام/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
});

test('certificate print control is part of the learner journey and its renderer loads before the course screen',()=>{
  const screen=fs.readFileSync(path.join(__dirname,'../client/public/training-courses.js'),'utf8');
  const index=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  assert.match(screen,/Print \/ save certificate PDF/);
  assert.match(screen,/window\.SXTrainingCertificate\.html/);
  assert.ok(index.indexOf('training-certificate.js')<index.indexOf('training-courses.js'));
  assert.match(index,/training-courses\.js\?v=20261009-report-recipients2/);
});

test('course enrollment response includes the tenant name needed on the issued certificate',async()=>{
  const progress=require('../modules/platform/training-enrollment-progress');
  const {trainingCenter}=require('../modules/platform/categories');
  const ctx={audience:'tenant',identity:{id:'11111111-1111-4111-8111-111111111111'},tenant:{id:'22222222-2222-4222-8222-222222222222',name:'Salemax Academy',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId:'22222222-2222-4222-8222-222222222222',role:'manager',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['training.courses']}};
  const db={async query(sql){
    if(sql.includes('SELECT t.name AS tenantName'))return [[{tenantName:'Salemax Academy',nameEn:'Center English',nameAr:'مركز عربي',logoUrl:'/media/center.png'}]];
    if(sql.includes('COUNT(*) AS total'))return [[{total:0}]];
    if(sql.includes('SELECT e.id,e.status'))return [[]];
    if(sql.includes('SELECT status,COUNT(*)'))return [[]];
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const result=await progress.list(db,ctx);
  assert.equal(result.tenantName,'Center English');assert.deepEqual(result.businessProfile,{nameEn:'Center English',nameAr:'مركز عربي',logoUrl:'/media/center.png'});
});
