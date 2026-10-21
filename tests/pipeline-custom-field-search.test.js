'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const pipeline=require('../helper/pipeline/leadPipeline');

function fixture(){
  const calls=[];
  const connection={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,args=[]){
    calls.push({sql,args});
    if(sql.startsWith('SELECT * FROM pipeline_settings'))return [[{enabled:1,auto_capture_qr:0,auto_capture_meta:0,interest_keywords:'[]'}]];
    if(sql.startsWith('SELECT stage_key'))return [[]];
    if(sql.startsWith('SELECT l.id,'))return [[]];
    if(sql.startsWith('SELECT COUNT(*) AS total, COALESCE'))return [[{total:0,today_new_leads:0}]];
    if(sql.startsWith('SELECT id, name, email, is_active FROM agents'))return [[]];
    return [{affectedRows:1}];
  }};
  return {calls,pool:{getConnection:async()=>connection}};
}

test('Pipeline search searches custom field values within tenant-scoped lead queries',async()=>{
  const f=fixture();
  await pipeline.getBoard({uid:'tenant-one',role:'owner',filters:{search:'  architect  '},pool:f.pool});
  const leads=f.calls.find(call=>call.sql.startsWith('SELECT l.id,'));
  assert.match(leads.sql,/JSON_TABLE\(/);
  assert.match(leads.sql,/JSON_VALID\(l\.qualification_data\)/);
  assert.match(leads.sql,/\$\.customFields\.\*/);
  assert.match(leads.sql,/PATH '\$\.value'/);
  assert.match(leads.sql,/l\.uid_hash = \?/);
  assert.match(leads.sql,/FROM pipeline_leads l FORCE INDEX \(idx_pipeline_board\)/);
  assert.equal(leads.args.at(-3),'%architect%');
  const count=f.calls.find(call=>call.sql.startsWith('SELECT COUNT(*) AS total, COALESCE'));
  assert.match(count.sql,/JSON_TABLE\(/,'count and page use the same search filter');
  assert.match(count.sql,/FROM pipeline_leads l FORCE INDEX \(idx_pipeline_board\)/);
  assert.equal(count.args.at(-1),'%architect%');
});

test('Pipeline custom-field search copy explains the broader search in English and Arabic',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const root=path.join(__dirname,'..');
  const screen=fs.readFileSync(path.join(root,'client/public/pipeline/pipeline.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'client/public/pipeline/index.html'),'utf8');
  assert.match(screen,/Search name, phone, campaign or custom answers/);
  assert.match(screen,/ابحث بالاسم أو الرقم أو الحملة أو الإجابات المخصصة/);
  assert.match(html,/placeholder="Search name, phone, campaign or custom answers/);
  assert.match(html,/pipeline\.js\?v=20261021-custom-field-search1/);
});
