'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {redirectAgentEntry}=require('../modules/platform/agent-entry');

test('agent compatibility route sends no-store shared-shell redirect',()=>{
 const headers={};let status=null,target=null;
 const result=redirectAgentEntry({originalUrl:'/agent?page=chat&token=private'}, {
  setHeader:(key,value)=>{headers[key]=value;},
  redirect:(code,url)=>{status=code;target=url;return 'redirected';}
 });
 assert.equal(result,'redirected');
 assert.equal(headers['Cache-Control'],'no-store');
 assert.equal(status,302);
 assert.equal(target,'/user?actor=agent&page=inbox');
});
