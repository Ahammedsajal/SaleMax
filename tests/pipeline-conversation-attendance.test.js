'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {recordAgentReply}=require('../helper/pipeline/conversationAttendance');

test('successful agent WhatsApp replies are linked to the exact tenant conversation and attributed without message text',async()=>{
  const calls=[],uid='legacy-owner',chatId='whatsapp-chat-1',leadId='lead-1',agentId=17;
  const recorded=await recordAgentReply({uid,chatId,agentId,origin:'meta',providerMessageId:'provider-message-123',query:async(sql,params)=>{calls.push({sql,params});
    if(sql.includes('SELECT lead_id FROM pipeline_conversations'))return [[{lead_id:leadId}]];
    if(sql.includes('SELECT id FROM pipeline_activity'))return [[]];
    if(sql.includes('INSERT INTO pipeline_activity'))return [{insertId:44}];
    throw new Error(`Unexpected query: ${sql}`);
  }});
  assert.equal(recorded,true);
  assert.deepEqual(calls[0].params.slice(1),[uid,chatId,'meta']);
  const insert=calls[2];assert.match(insert.sql,/VALUES \(\?,\?,'agent',\?,'agent_message_sent'/);
  assert.equal(insert.params[1],leadId);assert.equal(insert.params[2],String(agentId));
  assert.deepEqual(JSON.parse(insert.params[3]),{origin:'meta',providerMessageId:'provider-message-123'});
  assert.doesNotMatch(insert.params[3],/text|body|message content/i);
});

test('agent reply activity is idempotent per provider message and ignores unlinked chats',async()=>{
  const duplicate=await recordAgentReply({uid:'u',chatId:'chat',agentId:17,origin:'qr',providerMessageId:'m1',query:async sql=>sql.includes('SELECT lead_id')?[[{lead_id:'lead'}]]:[[{id:8}]]});
  assert.equal(duplicate,false);
  let inserts=0;const unlinked=await recordAgentReply({uid:'u',chatId:'unlinked',agentId:17,origin:'qr',providerMessageId:'m2',query:async sql=>{if(sql.includes('INSERT INTO'))inserts++;return [[]];}});
  assert.equal(unlinked,false);assert.equal(inserts,0);
});

test('only a successful agent send in QR or Meta writes lead attendance',()=>{
  const socket=fs.readFileSync(path.join(__dirname,'../helper/socket/index.js'),'utf8');
  assert.match(socket,/if\(isAgent\)try\{await recordAgentReply\([\s\S]*?origin:chatInfo\.origin,providerMessageId:sendMsg\.id/);
  assert.match(socket,/if\(isAgent\)try\{await recordAgentReply\([\s\S]*?origin:'qr',providerMessageId:sendNewMsg\.id/);
});
