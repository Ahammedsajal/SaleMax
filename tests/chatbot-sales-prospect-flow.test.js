'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const flow=require('../chatbot-flows/training-center-prospect-flow.json');
const {parseGuidedFlow}=require('../modules/platform/chatbot-profile-utils');

test('Training Center prospect flow opens with the approved introduction and quick replies',()=>{
 assert.equal(flow.source,'wa_chatbot');assert.equal(flow.is_active,true);assert.ok(parseGuidedFlow(flow));
 const nodes=flow.data.nodes,edges=flow.data.edges,byId=new Map(nodes.map(n=>[n.id,n]));
 const intro=byId.get('opening');assert.equal(intro.data.content.text.body,'Hi! We’re 7Network (CR No. 251489). We help training centers manage course enquiries and student follow-ups, send WhatsApp campaigns to students, and keep invoices and payments in one place. We can also customize the system.');
 assert.equal(edges.find(e=>e.source==='opening')?.target,'system_question');
 assert.equal(edges.find(e=>e.source==='system_question')?.target,'system_answer');
 assert.equal(edges.find(e=>e.source==='system_answer')?.target,'system_answer_validation');
 assert.equal(edges.find(e=>e.source==='system_answer_validation'&&e.sourceHandle==='Yes')?.target,'feature_explanation_1');
 assert.equal(edges.find(e=>e.source==='system_answer_validation'&&e.sourceHandle==='No')?.target,'feature_explanation_1');
 assert.equal(edges.find(e=>e.source==='system_answer_validation'&&e.sourceHandle==='default')?.target,'system_invalid');
 assert.equal(edges.find(e=>e.source==='system_invalid')?.target,'system_question');
 assert.equal(edges.find(e=>e.source==='feature_explanation_1')?.target,'feature_explanation_2');
 assert.equal(edges.find(e=>e.source==='feature_explanation_2')?.target,'demo_question');
 assert.match(byId.get('feature_explanation_1').data.content.text.body,/student contacts.*campaigns.*chatbots.*application forms.*course.*source/i);
 assert.match(byId.get('feature_explanation_2').data.content.text.body,/application submissions.*invoices.*payments.*due-date reminders.*reports.*notifications/i);
 assert.ok(byId.has('feature_explanation_3'),'retain the old cursor node for conversations already in progress');
 assert.equal(edges.find(e=>e.source==='feature_explanation_3')?.target,'demo_question');
 assert.equal(edges.find(e=>e.source==='demo_question')?.target,'demo_answer');
 assert.ok(!nodes.some(n=>/May I confirm your training center|Which business management system do you use/i.test(n.data?.content?.text?.body||n.data?.content?.interactive?.body?.text||'')));
 assert.ok(!nodes.some(n=>n.data?.variables?.some(v=>v.responsePath==='msgContext.interactive.button_reply.title')),'Meta button taps are normalized to msgContext.text.body');
 for(const node of nodes.filter(n=>n.type==='SEND_MESSAGE'&&n.data.type?.type==='interactive')){
  const buttons=node.data.content.interactive.action.buttons;
  assert.ok(buttons.length>=2&&buttons.length<=3,`${node.id} has a Meta-supported quick-reply count`);
  for(const button of buttons)assert.ok(button.reply.title.length<=20,`${node.id} button title fits Meta limits`);
 }
 assert.equal(byId.get('demo_question').data.content.interactive.body.text,'Would you like me to send you a short demo video?');
 assert.equal(edges.find(e=>e.source==='demo_branch'&&e.sourceHandle==='Yes')?.target,'send_demo','accepting the demo sends it immediately');
 assert.ok(!byId.has('name_for_demo')&&!byId.has('save_name_for_demo'),'demo delivery does not require an extra typed name');
 assert.match(byId.get('send_demo').data.content.text.body,/https:\/\/7network\.live\/training-center-demo\.mp4/);
 assert.ok(byId.get('after_demo_options').data.content.interactive.action.buttons.some(b=>b.reply.title==='Know the price'));
 assert.ok(byId.get('after_demo_options').data.content.interactive.action.buttons.some(b=>b.reply.title==='Talk to our team'));
 assert.equal(byId.get('price_message').data.content.text.body,'Our current offer is QAR 2,500 per year. It includes one admin user, one manager user and seven agent users.');
 assert.equal(nodes.filter(n=>n.type==='INITIAL').length,1);
 for(const edge of edges)assert.ok(byId.has(edge.source)&&byId.has(edge.target),`edge ${edge.id} has valid endpoints`);
 const reachable=new Set();const visit=id=>{if(reachable.has(id))return;reachable.add(id);for(const edge of edges.filter(e=>e.source===id))visit(edge.target);};visit('initialNode');
 assert.deepEqual([...byId.keys()].filter(id=>!reachable.has(id)),['feature_explanation_3'],'only the retained legacy cursor is outside the new path');
 assert.ok(nodes.filter(n=>n.type==='CONDITION').every(n=>edges.some(e=>e.source===n.id&&e.sourceHandle==='default')),'conditions have explicit fallback branches');
 for(const condition of nodes.filter(n=>n.type==='CONDITION'))for(const branch of condition.data.conditions||[])assert.ok(edges.some(e=>e.source===condition.id&&e.sourceHandle===branch.targetNodeId),'condition target maps to its saved Flow Builder edge handle');
});
