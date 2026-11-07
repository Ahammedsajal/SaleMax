'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const inbox=require('../client/public/inbox-deep-link.js');
const {prioritizeExactChat,exactChatIdFromSearch,filterExactChat}=require('../helper/inbox/chatData.js');
const socket=fs.readFileSync(require('node:path').join(__dirname,'../helper/socket/index.js'),'utf8');

test('exact Inbox search returns only the authorized full chat id',()=>{
  const exact={chat_id:'synthetic_sender_synthetic_contact_channel-token-123'};
  const other={chat_id:'synthetic_sender_synthetic_contact_other',last_message:exact.chat_id};
  const query=inbox.exactQuery(exact.chat_id);
  assert.equal(exactChatIdFromSearch(query),exact.chat_id);
  assert.deepEqual(filterExactChat([other,exact],exactChatIdFromSearch(query)),[exact]);
  assert.deepEqual(filterExactChat([other],'missing'),[]);
  assert.equal(exactChatIdFromSearch('ordinary search'),'');
  assert.equal(exactChatIdFromSearch('chatid:'+'x'.repeat(1000)),'');
});

test('deep-link finds the Inbox list beside its visible search field',()=>{
  const node=(children=[])=>({children,parentElement:null,contains(target){return this===target||this.children.some(child=>child.contains(target));},querySelector(){return null;}});
  const header=node();
  header.querySelector=selector=>selector==='h6,[role="heading"]'?{}:null;
  const input=node();
  input.getAttribute=()=> 'Search…';
  input.getClientRects=()=>[{}];
  const field=node([input]);
  const toolbar=node([field]);
  const list=node();
  const pane=node([header,toolbar,list]);
  for(const parent of [field,toolbar,pane])for(const child of parent.children)child.parentElement=parent;
  assert.deepEqual(inbox.findInboxSurface({querySelectorAll:()=>[input]}),{input,list});
});

test('deep-link waits for an empty result before clicking the only returned chat row',()=>{
  const empty={children:[{querySelector:()=>null}],textContent:'No conversations found. Try adjusting your search.',
    querySelector:selector=>selector==='svg'?{}:null};
  assert.equal(inbox.isEmptyResult(empty),true);
  assert.equal(inbox.exactResultRow(empty),null);
  const row={querySelector:selector=>selector.includes('MuiAvatar-root')?{}:null};
  const result={children:[row]};
  assert.equal(inbox.exactResultRow(result),row);
  assert.equal(inbox.exactResultRow({children:[row,row]}),null);
});

test('deep-link updates the native Inbox search input and dispatches its input event',()=>{
  const previousInput=global.HTMLInputElement,previousEvent=global.Event;
  class FakeInput{
    constructor(){this._value='';this.events=[];}
    get value(){return this._value;}
    set value(value){this._value=value;}
    dispatchEvent(event){this.events.push(event.type);}
  }
  global.HTMLInputElement=FakeInput;
  global.Event=class{constructor(type){this.type=type;}};
  try{
    const input=new FakeInput();
    inbox.setReactInput(input,'chatid:chat-123');
    assert.equal(input.value,'chatid:chat-123');
    assert.deepEqual(input.events,['input']);
  }finally{
    if(previousInput===undefined)delete global.HTMLInputElement;else global.HTMLInputElement=previousInput;
    if(previousEvent===undefined)delete global.Event;else global.Event=previousEvent;
  }
});

test('Inbox deep-link only runs for the inbox route and preserves the complete opaque chat id',()=>{
  assert.equal(inbox.inboxTarget('?page=lead-pipeline&chatId=qr%3Achat%2F42'),'');
  assert.equal(inbox.inboxTarget('?page=inbox&chatId=qr%3Achat%2F42'),'qr:chat/42');
});

test('Inbox search keeps an exact chat id ahead of fuzzy message matches before pagination',()=>{
  const exact={chat_id:'synthetic-contact@s.whatsapp.net'};
  const fuzzy={chat_id:'group:123',last_message:'synthetic-contact@s.whatsapp.net'};
  assert.deepEqual(prioritizeExactChat([fuzzy,exact],' synthetic-contact@s.whatsapp.net '),[exact,fuzzy]);
  assert.deepEqual(prioritizeExactChat([fuzzy],'missing-chat'),[fuzzy]);
});

test('agent deep-link search retains the existing assigned-agent authorization filter',()=>{
  assert.match(socket,/FROM beta_chats WHERE \(assigned_agent LIKE \? OR assigned_agent LIKE \?\)/);
  assert.match(socket,/AND uid = \? AND chat_id = \?/);
  assert.match(socket,/filterAssignedChats\(chats, inboxScope\);\s+chats = filterExactChat\(chats, exactChatId\)/);
});
