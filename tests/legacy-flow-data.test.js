'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const flowData=require('../modules/platform/legacy-flow-data');
const fs=require('node:fs');
const path=require('node:path');

test('legacy flow state resolves and mutates by owner UID as well as the conversation key',async()=>{
  const rows=[{id:1,uid:'owner-a',uniqueId:'ambiguous-key',inputs:'{"answer":"A"}',other:null},{id:2,uid:'owner-b',uniqueId:'ambiguous-key',inputs:'{"answer":"B"}',other:null}];
  const calls=[];
  const query=async(sql,args)=>{
    calls.push({sql,args});
    if(sql.startsWith('SELECT'))return rows.filter(row=>row.uid===args[1]&&row.uniqueId===args[2]);
    if(sql.startsWith('UPDATE flow_data SET other')){const row=rows.find(item=>item.uid===args[2]&&item.uniqueId===args[3]);if(row)row.other=args[0];return {affectedRows:row?1:0};}
    if(sql.startsWith('UPDATE flow_data SET inputs')){const [owner,key]=args.slice(-2),row=rows.find(item=>item.uid===owner&&item.uniqueId===key);if(row){row.inputs=args[0];if(sql.includes('other = ?'))row.other=args[1];}return {affectedRows:row?1:0};}
    if(sql.startsWith('INSERT')){rows.push({id:rows.length+1,uid:args[0],uniqueId:args[1],inputs:sql.includes('inputs')?args[2]:null,other:sql.includes('inputs')?args[3]:args[2]});return {insertId:rows.length};}
    throw Error('Unexpected flow-data query');
  };
  assert.equal((await flowData.find(query,'owner-a','ambiguous-key')).inputs,'{"answer":"A"}');
  await flowData.setOther(query,'owner-a','ambiguous-key','{"node":"A"}');
  await flowData.setInputs(query,'owner-a','ambiguous-key','{"answer":"updated"}');
  await flowData.saveAnswer(query,'owner-a','ambiguous-key','{"answer":"final"}');
  assert.equal(rows[0].inputs,'{"answer":"final"}');assert.equal(rows[0].other,null);
  assert.equal(rows[1].inputs,'{"answer":"B"}');assert.equal(rows[1].other,null);
  await assert.rejects(flowData.find(query,'','ambiguous-key'),{code:'LEGACY_FLOW_OWNER_REQUIRED'});
  assert.ok(calls.filter(call=>call.sql.startsWith('SELECT')||call.sql.startsWith('UPDATE')).every(call=>/owner_key_hash\s*=\s*\?\s+AND uid\s*=\s*\?\s+AND uniqueId\s*=\s*\?/.test(call.sql)));
  const expectedHash=crypto.createHash('sha256').update('owner-a').update('\0').update('ambiguous-key').digest();
  assert.ok(calls.filter(call=>call.sql.startsWith('SELECT')||call.sql.startsWith('UPDATE')).every(call=>call.args.some(value=>Buffer.isBuffer(value)&&value.equals(expectedHash))));
});

test('profile conversation keys isolate chatbot profiles and reject missing scope',()=>{
  const first=flowData.profileConversationKey('owner-a',41,'97450000001','chat-a');
  const second=flowData.profileConversationKey('owner-a',42,'97450000001','chat-a');
  assert.notEqual(first,second);
  assert.notEqual(first,flowData.profileConversationKey('owner-a',41,'97450000002','chat-a'));
  assert.notEqual(first,flowData.profileConversationKey('owner-a',41,'97450000001','chat-b'));
  assert.notEqual(first,'owner-a-97450000001-chat-a');
  assert.match(first,/^profile:41:/);
  assert.throws(()=>flowData.profileConversationKey('owner-a',null,'97450000001','chat-a'),{code:'LEGACY_FLOW_PROFILE_REQUIRED'});
  assert.throws(()=>flowData.profileConversationKey('','41','97450000001','chat-a'),{code:'LEGACY_FLOW_OWNER_REQUIRED'});
  assert.throws(()=>flowData.profileConversationKey('owner-a','41','97450000001','bad\0key'),{code:'LEGACY_FLOW_PROFILE_REQUIRED'});
});

test('exact owner-key uniqueness migration uses a bounded generated digest and has a reversible index/column rollback',()=>{
  const migrations=require('../database/migration-runner').discover(path.join(__dirname,'../database/migrations'));
  const forward=migrations.find(item=>item.file==='20261024_legacy_flow_data_exact_key.sql');
  assert.ok(forward);
  const sql=forward.statements.join('\n');
  assert.match(sql,/GENERATED ALWAYS AS/i);assert.match(sql,/SHA2\(CONCAT\(CAST\(CONVERT\(uid USING utf8mb4\) AS BINARY\), 0x00, CAST\(CONVERT\(uniqueId USING utf8mb4\) AS BINARY\)\), 256\)/i);
  assert.match(sql,/UNIQUE KEY uq_flow_data_owner_key_hash \(owner_key_hash\)/i);
  assert.ok(!migrations.some(item=>item.file.includes('rollback')));
  const rollback=fs.readFileSync(path.join(__dirname,'../database/migrations/20261024_legacy_flow_data_exact_key_rollback.sql'),'utf8');
  assert.match(rollback,/DROP INDEX uq_flow_data_owner_key_hash/i);assert.match(rollback,/DROP COLUMN owner_key_hash/i);
});

test('legacy QR and Meta bot adapters send every flow-state access through the owner-scoped helper',()=>{
  const root=path.join(__dirname,'..');
  const runtime=fs.readFileSync(path.join(root,'functions/chatbot.js'),'utf8');
  const meta=fs.readFileSync(path.join(root,'helper/chatbot/meta/index.js'),'utf8');
  for(const source of [runtime,meta]){
    assert.doesNotMatch(source,/SELECT \* FROM flow_data WHERE uniqueId/i);
    assert.doesNotMatch(source,/UPDATE flow_data SET [^`]+ WHERE uniqueId/i);
    assert.doesNotMatch(source,/INSERT INTO flow_data/i);
  }
  assert.match(runtime,/returnVariables\(\{\s*uid,/);
  assert.match(runtime,/flowStateData\.find\(query,\s*uid,\s*uniqueId\)/);
  assert.match(runtime,/flowStateData\.profileConversationKey\(\s*uid,\s*chatbotFromMysq\?\.id,/);
  assert.match(meta,/flowData\.find\(query,\s*uid,\s*uniqueId\)/);
  assert.match(meta,/flowData\.profileConversationKey\(\s*uid,\s*chatbot\?\.id,/);
});
