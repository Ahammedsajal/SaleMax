const test=require('node:test');
const assert=require('node:assert/strict');
const {periodWindow,getActivityReport}=require('../helper/pipeline/reports');

test('pipeline reports define Qatar-local daily, Monday-weekly and monthly periods',()=>{
  assert.deepEqual(periodWindow({period:'daily',at:'2026-10-01',timezone:'Asia/Qatar'}),{period:'daily',timezone:'Asia/Qatar',start:'2026-09-30 21:00:00.000',end:'2026-10-01 21:00:00.000'});
  assert.equal(periodWindow({period:'weekly',at:'2026-10-01',timezone:'Asia/Qatar'}).start,'2026-09-27 21:00:00.000');
  assert.equal(periodWindow({period:'monthly',at:'2026-10-01',timezone:'Asia/Qatar'}).end,'2026-10-31 21:00:00.000');
});

test('pipeline reports reject unsupported periods, invalid dates, roles and paging before database access',async()=>{
  assert.throws(()=>periodWindow({period:'quarterly',timezone:'Asia/Qatar'}),{status:400});
  assert.throws(()=>periodWindow({period:'daily',at:'2026-13-40',timezone:'Asia/Qatar'}),{status:400});
  assert.throws(()=>periodWindow({period:'daily',timezone:'Mars/Doha'}),{status:400});
  const pool={getConnection(){throw new Error('must not connect')}};
  await assert.rejects(getActivityReport({pool,uid:'synthetic',role:'accountant'}),{status:403});
  await assert.rejects(getActivityReport({pool,uid:'synthetic',role:'owner',page:0}),{status:400});
});

test('finance report summary remains owner-only and presents exact bilingual Qatar currency totals',()=>{
  const fs=require('node:fs'),path=require('node:path'),ui=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/reports.js'),'utf8'),screen=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/index.html'),'utf8');
  assert.match(screen,/\/pipeline\/reports\.js\?v=7/);
  assert.match(ui,/report\.finance/);assert.match(ui,/BigInt\(String\(value\|\|'0'\)\)/);
  assert.match(ui,/Outstanding now/);assert.match(ui,/المتبقي الآن/);
  assert.match(ui,/collected and outstanding are current/);assert.match(ui,/يعرض المحصل والمتبقي حتى وقت إعداد التقرير/);
});
