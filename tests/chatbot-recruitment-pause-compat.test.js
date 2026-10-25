'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {releaseRetiredRecruitmentPause}=require('../modules/platform/chatbot-recruitment-pause-compat');

function fakeDb(control,{failAudit=false}={}){
 const calls=[];
 return {calls,async beginTransaction(){calls.push(['begin']);},async commit(){calls.push(['commit']);},async rollback(){calls.push(['rollback']);},async query(sql,params){calls.push([sql,params]);if(sql.includes('SELECT id,mode,reason'))return [[control]];if(sql.includes('INSERT INTO sx_audit_events')&&failAudit)throw Object.assign(Error('audit failed'),{code:'AUDIT_FAILED'});return [{affectedRows:1}];}};
}

test('only a system recruitment pause is released for the replacement prospect workflow and audited',async()=>{
 const db=fakeDb({id:'control-1',mode:'paused',reason:'recruitment-awaiting-cv',revision:2,updatedByKind:'system'});
 assert.equal(await releaseRetiredRecruitmentPause(db,{tenantId:'tenant-1',channelKind:'whatsapp_meta',channelRef:'meta-1',conversationId:'chat-1'}),true);
 assert.equal(db.calls[0][0],'begin');assert.equal(db.calls.at(-1)[0],'commit');
 assert.ok(db.calls.some(([sql,params])=>String(sql).includes("SET mode='inherit'")&&params[0]==='control-1'&&params[1]===2));
 assert.ok(db.calls.some(([sql])=>String(sql).includes("chatbot.recruitment-pause-released-for-new-workflow")));
});

test('manual pauses and unrelated system pauses are preserved',async()=>{
 for(const control of [
  {id:'manual',mode:'paused',reason:'agent-requested-pause',revision:1,updatedByKind:'identity'},
  {id:'other',mode:'paused',reason:'sales-owner-requested',revision:1,updatedByKind:'system'},
 ]){
  const db=fakeDb(control);
  assert.equal(await releaseRetiredRecruitmentPause(db,{tenantId:'tenant-1',channelKind:'whatsapp_meta',channelRef:'meta-1',conversationId:'chat-1'}),false);
  assert.equal(db.calls.at(-1)[0],'commit');
  assert.equal(db.calls.some(([sql])=>String(sql).includes("SET mode='inherit'")),false);
 }
});

test('failed audit rolls back the pause transition',async()=>{
 const db=fakeDb({id:'control-1',mode:'paused',reason:'recruitment-complete',revision:3,updatedByKind:'system'},{failAudit:true});
 await assert.rejects(releaseRetiredRecruitmentPause(db,{tenantId:'tenant-1',channelKind:'whatsapp_meta',channelRef:'meta-1',conversationId:'chat-1'}),{code:'AUDIT_FAILED'});
 assert.equal(db.calls.at(-1)[0],'rollback');
});
