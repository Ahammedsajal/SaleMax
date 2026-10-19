'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {filterChats,normalizeOriginFilter}=require('../helper/inbox/chatData');

test('Inbox assignment source filter keeps only assigned conversations and preserves existing origins',()=>{
  const chats=[
    {chat_id:'old-1',origin:'qr',assigned_agent:'[]'},
    {chat_id:'old-2',origin:'qr',assigned_agent:'[{"id":9}]'},
    {chat_id:'meta_3',origin:'meta',assigned_agent:{id:10}},
  ];
  assert.equal(normalizeOriginFilter('assigned'),'assigned');
  assert.deepEqual(filterChats(chats,{origin:'assigned'}).map(chat=>chat.chat_id),['old-2','meta_3']);
  assert.deepEqual(filterChats(chats,{origin:'qr'}).map(chat=>chat.chat_id),['old-1','old-2']);
  assert.deepEqual(filterChats(chats,{assignedOnly:true}).map(chat=>chat.chat_id),['old-2','meta_3']);
});

test('Inbox WhatsApp number filter matches stored QR instance number or unique ID plus legacy chat IDs',()=>{
  const chats=[
    {chat_id:'97450000000_customer',origin:'qr'},
    {chat_id:'qr-customer',origin:'qr',origin_instance_unique_id:'instance-2',origin_instance_number:'97450000002'},
    {chat_id:'meta_customer',origin:'meta',origin_instance_number:'97450000002'},
  ];
  assert.deepEqual(filterChats(chats,{instance:'97450000000'}).map(chat=>chat.chat_id),['97450000000_customer']);
  assert.deepEqual(filterChats(chats,{instance:'instance-2'}).map(chat=>chat.chat_id),['qr-customer']);
  assert.deepEqual(filterChats(chats,{instance:'97450000002'}).map(chat=>chat.chat_id),['qr-customer']);
});
