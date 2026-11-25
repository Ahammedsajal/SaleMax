'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const pipeline=require('../helper/pipeline/leadPipeline');

test('a replay enriches the existing lead with the referral once',async()=>{
  const calls=[];
  const db={
    async beginTransaction(){},
    async commit(){},
    async rollback(){},
    release(){},
    async query(sql,params){
      calls.push({sql,params});
      if(sql.startsWith('SELECT * FROM pipeline_settings'))return [[{training_funnel_version:1,qr_entry_stage:'new'}]];
      if(sql.startsWith('SELECT message_text'))return [[]];
      if(sql.startsWith('SELECT stage_key'))return [[{stage_key:'new'}]];
      if(sql.includes('INSERT IGNORE INTO pipeline_events'))return [{affectedRows:0}];
      if(sql.startsWith('SELECT lead_id FROM pipeline_events'))return [[{lead_id:'existing-lead'}]];
      if(sql.includes('INSERT IGNORE INTO pipeline_attributions'))return [{affectedRows:1}];
      if(sql.startsWith('INSERT IGNORE'))return [{affectedRows:1}];
      throw Error('Unexpected query '+sql);
    }
  };
  const result=await pipeline.captureBotInbound({uid:'synthetic-owner',origin:'qr',chatId:'synthetic-chat',
    senderMobile:'97450000000',normalizedMessage:{route:'INCOMING'},providerMessageId:'message-1',
    referral:{source_type:'ad',source_id:'ad-123',headline:'Course'},pool:{getConnection:async()=>db}});
  assert.equal(result.duplicate,true);
  assert.equal(result.leadId,'existing-lead');
  const insert=calls.find(call=>call.sql.includes('INSERT IGNORE INTO pipeline_attributions'));
  assert.equal(insert.params[1],'existing-lead');
  assert.equal(insert.params[6],'ad-123');
  assert.equal(insert.params[12],0);
});
