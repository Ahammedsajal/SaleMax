'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const inbox=require('../client/public/inbox-deep-link.js');
const {prioritizeExactChat}=require('../helper/inbox/chatData.js');
const socket=fs.readFileSync(require('node:path').join(__dirname,'../helper/socket/index.js'),'utf8');

test('Inbox deep-link matching selects only a row whose React chat id exactly matches',()=>{
  const makeRow=(chatId)=>{
    const element={nodeType:1,clicked:false,scrollIntoView(){},click(){this.clicked=true}};
    const host={tag:5,stateNode:element,memoizedProps:{onClick(){}},return:null,child:null,sibling:null};
    const component={tag:0,memoizedProps:{chat:{chat_id:chatId}},return:null,child:host,sibling:null};
    host.return=component;
    element.__reactFiber$test=host;
    return element;
  };
  const decoy=makeRow('chat-123-extra');
  const exact=makeRow('chat-123');
  const root={querySelectorAll:()=>[decoy,exact]};
  assert.equal(inbox.findExactChatRow(root,'chat-123'),exact);
  assert.equal(inbox.findExactChatRow(root,'123'),null);
});

test('Inbox deep-link only runs for the inbox route and preserves the complete opaque chat id',()=>{
  assert.equal(inbox.inboxTarget('?page=lead-pipeline&chatId=qr%3Achat%2F42'),'');
  assert.equal(inbox.inboxTarget('?page=inbox&chatId=qr%3Achat%2F42'),'qr:chat/42');
});

test('Inbox search keeps an exact chat id ahead of fuzzy message matches before pagination',()=>{
  const exact={chat_id:'97455500000@s.whatsapp.net'};
  const fuzzy={chat_id:'group:123',last_message:'97455500000@s.whatsapp.net'};
  assert.deepEqual(prioritizeExactChat([fuzzy,exact],' 97455500000@s.whatsapp.net '),[exact,fuzzy]);
  assert.deepEqual(prioritizeExactChat([fuzzy],'missing-chat'),[fuzzy]);
});

test('agent deep-link search retains the existing assigned-agent authorization filter',()=>{
  assert.match(socket,/FROM beta_chats WHERE \(assigned_agent LIKE \? OR assigned_agent LIKE \?\)/);
  assert.match(socket,/chat_id = \? OR[\s\S]+sender_name LIKE/);
  assert.match(socket,/filterAssignedChats\(chats, inboxScope\);[\s\S]+prioritizeExactChat\(chats, search\)/);
});
