'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

function loadFlowExecutor({sendResults}){
  const sent=[];const queries=[];const scheduled=[];let resultIndex=0;
  const flowProcessor={
    async getFlowSession(){return {id:9,data:{node:{id:'reply',type:'SEND_MESSAGE',data:{content:'Hello'}},variables:{}}};},
    async checkIfChatDisabled(){return false;},
    replaceVariables(value){return value;},
    async processSendMessage(input){sent.push(input.node.id);return sendResults[resultIndex++]||{moveToNextNode:false};},
  };
  const mocks={
    '../automation/functions':flowProcessor,
    '../database/dbpromise':{query:async(sql)=>{queries.push(sql);return [{}];}},
    '../modules/platform/chatbot-conversation-control':{shouldPause:async()=>false},
  };
  const cacheKeys=[];
  for(const [request,exports] of Object.entries(mocks)){
    const filename=require.resolve(request.startsWith('../')?require('node:path').join(__dirname,request):request);
    cacheKeys.push(filename);
    require.cache[filename]={id:filename,filename,loaded:true,exports};
  }
  const executorPath=require.resolve('../automation/automation');cacheKeys.push(executorPath);delete require.cache[executorPath];
  const originalSetTimeout=global.setTimeout;
  global.setTimeout=(callback)=>{scheduled.push(callback);return scheduled.length;};
  return {processFlow:require('../automation/automation').processFlow,sent,queries,scheduled,restore(){global.setTimeout=originalSetTimeout;for(const filename of cacheKeys)delete require.cache[filename];}};
}

test('a chatbot guided flow rechecks authority before each scheduled node and clears stale session state',async()=>{
  const harness=loadFlowExecutor({sendResults:[{moveToNextNode:true}]});let checks=0;
  try{
    await harness.processFlow({nodes:[],edges:[],uid:'owner-1',flowId:'profile-channel-key',message:{senderMobile:'+97455500000'},incomingText:'Hi',user:{},sessionId:'channel-1',origin:'qr',chatId:'chat-1',element:{flow_id:'profile-channel-key'},beforeNode:async()=>++checks===1?'allowed':false});
    assert.deepEqual(harness.sent,['reply']);
    assert.equal(harness.scheduled.length,1);
    await harness.scheduled[0]();
    assert.equal(checks,2);
    assert.deepEqual(harness.sent,['reply']);
    assert.ok(harness.queries.some(sql=>sql.includes('DELETE FROM flow_session')));
  }finally{harness.restore();}
});

test('a revoked chatbot flow is stopped before its first node sends',async()=>{
  const harness=loadFlowExecutor({sendResults:[{moveToNextNode:false}]});
  try{
    await harness.processFlow({nodes:[],edges:[],uid:'owner-1',flowId:'profile-channel-key',message:{senderMobile:'+97455500000'},incomingText:'Hi',user:{},sessionId:'channel-1',origin:'qr',chatId:'chat-1',element:{flow_id:'profile-channel-key'},beforeNode:async()=>false});
    assert.deepEqual(harness.sent,[]);
    assert.ok(harness.queries.some(sql=>sql.includes('DELETE FROM flow_session')));
  }finally{harness.restore();}
});

test('a manual pause stops a flow without clearing its session or replacing the pause',async()=>{
  const harness=loadFlowExecutor({sendResults:[{moveToNextNode:false}]});
  try{
    const result=await harness.processFlow({nodes:[],edges:[],uid:'owner-1',flowId:'profile-channel-key',message:{senderMobile:'+97455500000'},incomingText:'Hi',user:{},sessionId:'channel-1',origin:'qr',chatId:'chat-1',element:{flow_id:'profile-channel-key'},beforeNode:async()=>'paused'});
    assert.equal(result,'paused');
    assert.deepEqual(harness.sent,[]);
    assert.equal(harness.queries.length,0);
  }finally{harness.restore();}
});
