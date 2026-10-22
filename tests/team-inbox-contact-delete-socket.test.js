'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

test('legacy contact-delete socket event uses the authenticated owner and rejects agents',async t=>{
  const dbPath=require.resolve('../database/dbpromise');
  const priorDb=require.cache[dbPath];
  const calls=[];
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('WHERE o.source_table'))return [];
    if(sql.includes('DELETE FROM contact'))return {affectedRows:1};
    throw new Error('UNEXPECTED_QUERY');
  };
  require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query}};
  delete require.cache[require.resolve('../helper/socket')];
  const {processSocketEvent}=require('../helper/socket');
  t.after(()=>{if(priorDb)require.cache[dbPath]=priorDb;else delete require.cache[dbPath];delete require.cache[require.resolve('../helper/socket')];});
  const handlers={},events=[];
  const socket={userData:{id:12,uid:'synthetic-owner',role:'user',isAgent:false},decodedToken:{uid:'synthetic-owner',role:'user'},on:(name,fn)=>{handlers[name]=fn;},emit:(name,data)=>events.push({name,data})};
  processSocketEvent({socket,initializeSocket(){},sendToUid(){},sendToSocket(){},sendToAll(){},getConnectedUsers(){return[];},getConnectionsByUid(){return[];},getConnectionBySocketId(){return null;},getAllSocketData(){return[];}});
  await handlers.message({type:'del_contact',payload:{contactId:42}});
  assert.deepEqual(calls.find(call=>call.sql.includes('DELETE FROM contact')).params,[42,'synthetic-owner']);
  assert.match(calls.find(call=>call.sql.includes('DELETE FROM contact')).sql,/id = \? AND uid = \?/);
  socket.userData={id:30,uid:'synthetic-agent',owner_uid:'synthetic-owner',role:'agent',isAgent:true};
  await handlers.message({type:'del_contact',payload:{contactId:42}});
  assert.equal(calls.filter(call=>call.sql.includes('DELETE FROM contact')).length,1);
  assert.equal(events.filter(event=>event.name==='error').length,1);
});
