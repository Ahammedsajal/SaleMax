'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

test('label deletion validates and deletes the tag within the authenticated owner scope',async t=>{
  const dbPath=require.resolve('../database/dbpromise');
  const previous=require.cache[dbPath];
  const calls=[];
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('WHERE o.source_table'))return [];
    if(sql.includes('SELECT id FROM chat_tags WHERE id=? AND uid=?'))return [{id:17}];
    if(sql.includes('DELETE FROM chat_tags'))return {affectedRows:1};
    if(sql.includes('SELECT * FROM chat_tags'))return [];
    throw new Error('UNEXPECTED_QUERY');
  };
  require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query}};
  delete require.cache[require.resolve('../helper/socket')];
  const {processSocketEvent}=require('../helper/socket');
  t.after(()=>{
    if(previous)require.cache[dbPath]=previous;else delete require.cache[dbPath];
    delete require.cache[require.resolve('../helper/socket')];
  });
  const handlers={},errors=[];
  const socket={userData:{id:12,uid:'synthetic-owner',role:'user',isAgent:false},decodedToken:{uid:'synthetic-owner',role:'user'},on:(name,fn)=>{handlers[name]=fn;},emit:(name,data)=>{if(name==='error')errors.push(data);}};
  processSocketEvent({socket,initializeSocket(){},sendToUid(){},sendToSocket(){},sendToAll(){},getConnectedUsers(){return[];},getConnectionsByUid(){return[];},getConnectionBySocketId(){return null;},getAllSocketData(){return[];}});
  await handlers.message({type:'on_label_delete',payload:{labelId:17}});
  assert.deepEqual(calls.find(call=>call.sql.includes('DELETE FROM chat_tags')).params,[17,'synthetic-owner']);
  assert.match(calls.find(call=>call.sql.includes('DELETE FROM chat_tags')).sql,/id = \? AND uid = \?/);
  assert.deepEqual(errors,[]);
});
