'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const exporter=require('../modules/platform/pipeline-lead-export');
const pipeline=require('../helper/pipeline/leadPipeline');

test('lead CSV keeps custom-field values with their immutable field definition snapshots',()=>{
  const csv=exporter.toCsv([{id:4,title:'Reference lead',contact_name:'Sam',mobile:'+97455550000',stage_key:'new',status:'open',priority:'normal',qualification_data:{customFields:{cf_text_123:{value:'A-17',definition:{label:{en:'Account reference',ar:'مرجع الحساب'},type:'text'},configurationRevision:8}}}}]);
  assert.ok(csv.startsWith('\uFEFF"lead_id"'));
  assert.match(csv,/"custom_fields"/);
  assert.match(csv,/Account reference/);
  assert.match(csv,/مرجع الحساب/);
  assert.match(csv,/""value"":""A-17""/);
  assert.match(csv,/""configurationRevision"":8/);
});

test('lead CSV neutralizes spreadsheet formulas and quotes delimiters',()=>{
  const csv=exporter.toCsv([{id:1,title:'=HYPERLINK("https://bad.example","open")',contact_name:'Sam, Sales',qualification_data:{customFields:{danger:{value:'@SUM(1,1)',definition:{label:{en:'Formula'},type:'text'}}}}}]);
  assert.match(csv,/'=HYPERLINK\(""https:\/\/bad\.example"",""open""\)/);
  assert.match(csv,/"Sam, Sales"/);
  assert.match(csv,/\{""danger"":\{""value"":""@SUM\(1,1\)/);
});

test('lead CSV rejects a result larger than its advertised row bound',()=>{
  assert.throws(()=>exporter.toCsv(Array.from({length:exporter.MAX_ROWS+1},()=>({}))),{code:'EXPORT_ROW_LIMIT',status:413});
});

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

test('Pipeline only selects full lead answers for the explicit export request',async()=>{
  const ordinary=fixture();
  await pipeline.getBoard({uid:'tenant-one',role:'owner',filters:{limit:300},pool:ordinary.pool});
  assert.doesNotMatch(ordinary.calls.find(item=>item.sql.startsWith('SELECT l.id,')).sql,/l\.qualification_data/);
  const exportRequest=fixture();
  await pipeline.getBoard({uid:'tenant-one',role:'manager',scopeAgentIds:[4,9],filters:{limit:300,search:'reference'},includeQualificationData:true,pool:exportRequest.pool});
  const leads=exportRequest.calls.find(item=>item.sql.startsWith('SELECT l.id,'));
  assert.match(leads.sql,/l\.qualification_data/);
  assert.match(leads.sql,/l\.owner_agent_id IN \(\?\)/);
  assert.match(leads.sql,/l\.uid_hash = \?/);
  assert.equal(leads.args.at(-3),'%reference%');
});
