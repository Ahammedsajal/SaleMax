'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const flow=require('../chatbot-flows/training-center-prospect-flow.json');
const {parseGuidedFlow}=require('../modules/platform/chatbot-profile-utils');

test('Training Center prospect conversation is a supported editable WA Chatbot Flow Builder graph',()=>{
 assert.equal(flow.source,'wa_chatbot');assert.equal(flow.is_active,true);assert.ok(parseGuidedFlow(flow));
 const nodes=flow.data.nodes,edges=flow.data.edges,byId=new Map(nodes.map(n=>[n.id,n]));
 assert.ok(nodes.some(n=>n.type==='INITIAL'&&n.id==='initialNode'));
 assert.ok(nodes.some(n=>n.type==='CONDITION'&&n.data.variable?.message==='{{{phonebookCenterName}}}'));
 const openings=nodes.filter(n=>['phonebook_name_prompt','phonebook_confirm'].includes(n.id));
 assert.equal(openings.length,2);
 for(const opening of openings){
  const text=opening.data.content?.text?.body||opening.data.content?.interactive?.body?.text||'';
  assert.match(text,/we’re 7Network/);assert.match(text,/CR No\. is 251489/);assert.match(text,/training centers/i);
  assert.doesNotMatch(text,/parent company|mother company|ProCatalyst/i);
 }
 assert.ok(nodes.some(n=>n.type==='RESPONSE_SAVER'&&n.data.variables?.some(v=>v.varName==='trainingCenterName')));
 const interactive=nodes.filter(n=>n.type==='SEND_MESSAGE'&&n.data.type?.type==='interactive');
 assert.ok(nodes.filter(n=>n.type==='SEND_MESSAGE').every(n=>n.data.moveToNextNode===false),'question sends stop so customer input is saved on the next turn');
 assert.ok(interactive.length>=5,'native Meta reply buttons exist for the guided choices');
 for(const node of interactive){
  const buttons=node.data.content?.interactive?.action?.buttons||[];
  assert.ok(buttons.length>=2&&buttons.length<=3,`${node.id} must stay within Meta reply-button limits`);
  for(const button of buttons)assert.ok(button.reply.id&&button.reply.title.length<=20);
 }
 for(const node of nodes.filter(n=>n.type==='CONDITION')){
  for(const condition of node.data.conditions||[])assert.ok(edges.some(e=>e.source===node.id&&e.sourceHandle===condition.targetNodeId),`${node.id} condition ${condition.value} has a connected edge`);
  assert.ok(edges.some(e=>e.source===node.id&&e.sourceHandle==='default'),`${node.id} has a default route for unrecognized answers`);
 }
 for(const edge of edges){assert.ok(byId.has(edge.source),`missing source ${edge.source}`);assert.ok(byId.has(edge.target),`missing target ${edge.target}`);}
 const reachable=new Set();const visit=id=>{if(reachable.has(id))return;reachable.add(id);for(const edge of edges.filter(e=>e.source===id))visit(edge.target);};visit('initialNode');
 assert.equal(reachable.size,nodes.length,'every saved builder node must be connected to the flow');
 assert.ok(nodes.filter(n=>!edges.some(e=>e.source===n.id)).every(n=>n.type==='RESET'&&n.data.moveToNextNode===false),'terminal paths reset the builder session safely');
 const video=nodes.find(n=>n.type==='SEND_MESSAGE'&&n.data.content?.text?.body?.includes('training-center-demo.mp4'));
 assert.ok(video);assert.equal(nodes.find(n=>n.id===edges.find(e=>e.source===video.id)?.target)?.type,'RESPONSE_SAVER','demo reply waits for the customer or the scheduled reminder');
 assert.ok(nodes.some(n=>n.data.content?.text?.body?.includes('QAR 2,500 per year')));
});
