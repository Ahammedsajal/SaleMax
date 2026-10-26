'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { normalizeFlowEditorData } = require('../modules/platform/flow-editor-data');
const { conversationScope } = require('../modules/platform/chatbot-conversation-scope');
const flow = require('../modules/platform/chatbot-flow-understanding');
test('legacy graph missing coordinates opens without changing execution or valid layout', () => {
  const original = { nodes:[{id:'initialNode',position:{x:0,y:0}},{id:'reply',type:'SEND_MESSAGE',data:{content:'approved'}}],edges:[{source:'initialNode',target:'reply'}] };
  const fixed=normalizeFlowEditorData(JSON.stringify(original));
  assert.deepEqual(fixed.nodes[0],original.nodes[0]); assert.ok(Number.isFinite(fixed.nodes[1].position.x));
  assert.deepEqual(fixed.nodes[1].data,original.nodes[1].data); assert.deepEqual(fixed.edges,original.edges); assert.equal(original.nodes[1].position,undefined);
});
test('channel resolution uses chat origin and never guesses between multiple numbers', () => {
  const channels=[{kind:'whatsapp_meta',reference:'m1',label:'+974 5555 0001'},{kind:'whatsapp_qr',reference:'q1',label:'97455550002'}];
  assert.deepEqual(conversationScope({origin:'meta',origin_instance_id:'{"id":"+974 5555 0001"}'},channels),{channelKind:'whatsapp_meta',channelRef:'m1'});
  assert.deepEqual(conversationScope({origin:'qr',origin_instance_unique_id:'q1'},channels),{channelKind:'whatsapp_qr',channelRef:'q1'});
  assert.equal(conversationScope({origin:'meta'},[...channels,{kind:'whatsapp_meta',reference:'m2'}]),null);
  assert.equal(conversationScope({origin:'email'},channels),null);
});
const question = {id:'question',type:'SEND_MESSAGE',data:{content:{type:'interactive',interactive:{body:{text:'Are you using a system?'},action:{buttons:[{reply:{id:'yes',title:'Yes'}},{reply:{id:'no',title:'No'}}]}}}}};
const graph={nodes:[question,{id:'answer',type:'RESPONSE_SAVER',data:{variables:[{varName:'system'}]}}],edges:[{source:'question',target:'answer'}]};
const turn=flow.expectedTurn(graph,{node:{id:'answer'}});
test('only an answer to the waiting question advances its branch', () => {
  assert.equal(turn.question,'Are you using a system?');
  assert.equal(flow.deterministicDecision('نعم',turn).text,'Yes');
  assert.equal(flow.deterministicDecision('No thanks',turn).text,'No');
  assert.equal(flow.deterministicDecision('What is your price?',turn).action,'interpret');
  assert.equal(flow.deterministicDecision('Show me a demo',turn).action,'interpret');
  assert.equal(flow.deterministicDecision('I need a human',turn).action,'handoff');
  assert.equal(flow.deterministicDecision('',turn).action,'handoff');
});
test('AI cannot invent a stage, inject a reply, or continue with low confidence', () => {
  assert.equal(flow.validateInterpretation({canAnswer:true,confidence:0.96,reply:'Yes',sourceIds:['choice:0']},turn).text,'Yes');
  for(const response of [{canAnswer:true,confidence:0.5,reply:'Yes',sourceIds:['choice:0']},{canAnswer:true,confidence:1,reply:'Pay me',sourceIds:['choice:0']},{canAnswer:true,confidence:1,reply:'Yes',sourceIds:['arbitrary-node']},{canAnswer:false,confidence:1,reply:'Yes',sourceIds:['choice:0']}])assert.equal(flow.validateInterpretation(response,turn).action,'handoff');
});
test('handoff acknowledgement follows customer language', () => {
  assert.match(flow.handoffReply('أحتاج المساعدة'),/موظفينا/);assert.match(flow.handoffReply('help'),/team/);
});

test('saved interactive messages expose the editor button/list type while preserving provider content', () => {
  for (const type of ['button','list']) {
    const content={type:'interactive',interactive:{type,body:{text:'Approved question'},action:{buttons:[]}}};
    const graph={nodes:[{id:'question',type:'SEND_MESSAGE',position:{x:1,y:2},data:{type:{type:'interactive'},content}}],edges:[]};
    const result=normalizeFlowEditorData(graph);
    assert.equal(result.nodes[0].data.type.type,type); assert.deepEqual(result.nodes[0].data.content,content);
    assert.equal(graph.nodes[0].data.type.type,'interactive');
  }
});
