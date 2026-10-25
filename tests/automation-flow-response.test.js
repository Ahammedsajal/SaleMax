'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {setVariables}=require('../modules/platform/automation-flow-response');
const {conditionEdge}=require('../modules/platform/automation-flow-condition');

test('flow response saver captures normalized Meta button text when the configured path is absent',()=>{
 const vars=setVariables([{varName:'demoRequested',responsePath:'msgContext.text.body'}],{message:{type:'text'}},{fallbackText:'Yes'});
 assert.deepEqual(vars,{demoRequested:'Yes'});
});

test('flow response saver prefers the configured message path over fallback text',()=>{
 const vars=setVariables([{varName:'demoRequested',responsePath:'msgContext.text.body'}],{message:{msgContext:{text:{body:'Yes'}}}},{fallbackText:'No'});
 assert.deepEqual(vars,{demoRequested:'Yes'});
});

test('condition routing scopes repeated reply handles to the current condition node',()=>{
 const edges=[{source:'demo_branch',sourceHandle:'Yes',target:'send_demo'},{source:'owner_branch',sourceHandle:'Yes',target:'contact_confirmation'}];
 assert.deepEqual(conditionEdge(edges,'owner_branch','Yes'),edges[1]);
});
