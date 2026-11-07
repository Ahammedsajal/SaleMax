'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const client=fs.readFileSync(path.join(root,'client/public/pipeline/lead-detail-workspace.js'),'utf8');
const pipeline=fs.readFileSync(path.join(root,'client/public/pipeline/pipeline.js'),'utf8');
const inbox=fs.readFileSync(path.join(root,'routes/inbox.js'),'utf8');
const taskRouter=fs.readFileSync(path.join(root,'modules/platform/task-router.js'),'utf8');
const workspaceApi=fs.readFileSync(path.join(root,'client/public/workspace-api.js'),'utf8');

test('lead detail opens the latest linked chat in the same window and prepares an exact Inbox selection',()=>{
  assert.match(client,/lead\.conversations\?\.\[0\]/);
  assert.match(client,/open\.href = inboxHref\(conversation\.chat_id\)/);
  assert.match(client,/open\.target = '_top'/);
  assert.match(client,/prepareChatOpen\(conversation, lead\)/);
  assert.match(client,/7networkLeadChatFocus/);
  assert.match(client,/link\.target = '_top'/);
  assert.match(client,/a\.conversation-open/);
  assert.match(client,/localStorage\.setItem\('currentChat'/);
  assert.match(client,/window\.SaleMaxWorkspace\.request\('inbox', '\/lead-status\?chatId='/);
  assert.match(pipeline,/SaleMaxLeadDetailWorkspace\?\.inboxHref\(c\.chat_id\)/);
  assert.doesNotMatch(pipeline,/appHome\(\)\?page=chat/);
  assert.match(workspaceApi,/inbox:'\/api\/workspace\/inbox'/);
  assert.match(fs.readFileSync(path.join(root,'client/public/index.html'),'utf8'),/inbox-deep-link\.js\?v=20261107-exact-chat2/);
});

test('lead chat links route users and agents to the selected shared Inbox conversation',()=>{
  const values=new Map();
  const context={window:{},URLSearchParams,localStorage:{getItem:key=>values.get(key)||null}};
  vm.runInNewContext(client,context);
  assert.equal(context.window.SaleMaxLeadDetailWorkspace.inboxHref('qr:chat/7'),'/user?page=inbox&chatId=qr%3Achat%2F7');
  values.set('wacrm_agent','agent-session');
  assert.equal(context.window.SaleMaxLeadDetailWorkspace.inboxHref('qr:chat/7'),'/user?actor=agent&page=inbox&chatId=qr%3Achat%2F7');
});

test('lead chat preparation primes the exact chat and restores the prior filters after Inbox selection',()=>{
  const values=new Map([['chatFilters',JSON.stringify({search:'old',origin:'qr',unreadOnly:true})]]);
  const session=new Map();
  const context={window:{},URLSearchParams,Date,localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)}};
  vm.runInNewContext(client,context);
  context.window.SaleMaxLeadDetailWorkspace.prepareChatOpen({chat_id:'exact:chat/42',origin:'meta'},{mobile:'+97455500000',relationship_name:'Synthetic Lead'});
  assert.equal(JSON.parse(values.get('currentChat')).chat_id,'exact:chat/42');
  assert.equal(values.get('chatInfo'),'null');
  assert.equal(JSON.parse(values.get('chatFilters')).search,'exact:chat/42');
  assert.deepEqual(JSON.parse(session.get('7networkLeadChatFocus')).previousFilters,{search:'old',origin:'qr',unreadOnly:true});
});

test('lead detail summarizes one authorized next task and the linked sale milestones',()=>{
  assert.match(pipeline,/SaleMaxLeadDetailWorkspace\?\.mount\(/);
  assert.match(pipeline,/SaleMaxLeadDetailWorkspace\?\.updateProgress\(lead,reviews\)/);
  assert.match(client,/SaleMaxWorkspace\.request\('tasks', '\/lead\/'/);
  assert.match(client,/task\.assignees/);
  assert.match(client,/dueOverdue/);
  assert.match(client,/applicationSubmission|applications\[0\]/);
  assert.match(client,/saleReview/);
  assert.match(client,/enrollment/);
  assert.match(client,/invoice/);
  assert.match(taskRouter,/router\.get\('\/lead\/:leadId\/next'/);
});

test('Inbox unread contract exposes a count only after current conversation-scope filtering',()=>{
  const start=inbox.indexOf('// A lead detail may request only the unread state');
  const end=inbox.indexOf('// getting chat lists',start);
  assert.ok(start>=0&&end>start);
  const route=inbox.slice(start,end);
  assert.match(route,/resolveInboxScope\(query, req\.decode\.userData, 'get_lead_status'\)/);
  assert.match(route,/filterAssignedChats\(rows, scope\)/);
  assert.match(route,/SELECT chat_id,unread_count,origin,origin_instance_unique_id,assigned_agent/);
  assert.match(route,/unreadCount: Math\.max\(0, Number\(rows\[0\]\.unread_count\)/);
  assert.doesNotMatch(route,/last_message|transcript|message_text/i);
});
