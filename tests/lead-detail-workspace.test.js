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

test('lead detail opens the latest linked chat in a new tab and primes the shared Inbox selection',()=>{
  assert.match(client,/lead\.conversations\?\.\[0\]/);
  assert.match(client,/open\.href = inboxHref\(conversation\.chat_id\)/);
  assert.match(client,/open\.target = '_blank'/);
  assert.match(client,/localStorage\.setItem\('currentChat'/);
  assert.match(client,/window\.SaleMaxWorkspace\.request\('inbox', '\/lead-status\?chatId='/);
  assert.match(pipeline,/SaleMaxLeadDetailWorkspace\?\.inboxHref\(c\.chat_id\)/);
  assert.doesNotMatch(pipeline,/appHome\(\)\?page=chat/);
  assert.match(workspaceApi,/inbox:'\/api\/workspace\/inbox'/);
});

test('lead chat links route users and agents to the selected shared Inbox conversation',()=>{
  const values=new Map();
  const context={window:{},URLSearchParams,localStorage:{getItem:key=>values.get(key)||null}};
  vm.runInNewContext(client,context);
  assert.equal(context.window.SaleMaxLeadDetailWorkspace.inboxHref('qr:chat/7'),'/user?page=inbox&chatId=qr%3Achat%2F7');
  values.set('wacrm_agent','agent-session');
  assert.equal(context.window.SaleMaxLeadDetailWorkspace.inboxHref('qr:chat/7'),'/user?actor=agent&page=inbox&chatId=qr%3Achat%2F7');
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
