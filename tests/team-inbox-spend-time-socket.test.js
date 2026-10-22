'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');

test('Inbox socket time tracking writes only the authenticated active agent row in its owner scope',async t=>{
  const dbPath=require.resolve('../database/dbpromise');
  const priorDb=require.cache[dbPath];
  const agent={id:7,uid:'synthetic-agent',owner_uid:'synthetic-owner',role:'agent',isAgent:true,is_active:1};
  const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  const member={tenantId:'synthetic-tenant',tenantStatus:'active',categoryKey:'training_center',membershipId:'synthetic-membership',identityId:'agent-identity',role:'agent',membershipStatus:'active',identityStatus:'active',uidHash:hash(agent.uid),delegatedPermissions:[]};
  const calls=[];
  let logs='{}';
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('WHERE o.source_table'))return [member];
    if(sql.includes("m.role='owner'"))return [{uid:agent.owner_uid,identityId:'owner-identity',uidHash:hash(agent.owner_uid)}];
    if(sql.includes('FROM sx_qr_channel_shares share'))return [];
    if(sql.includes('SELECT uid FROM agents WHERE uid=? AND owner_uid=? AND is_active=1')){
      return params[0]===agent.uid&&params[1]===agent.owner_uid?[{uid:agent.uid}]:[];
    }
    if(sql.includes('SELECT logs FROM agents WHERE uid = ? AND owner_uid = ? AND is_active = 1')){
      return params[0]===agent.uid&&params[1]===agent.owner_uid?[{logs}]:[];
    }
    if(sql.includes('UPDATE agents SET logs = ? WHERE uid = ? AND owner_uid = ? AND is_active = 1')){
      assert.deepEqual(params.slice(1),[agent.uid,agent.owner_uid]);
      logs=params[0];
      return {affectedRows:1};
    }
    throw new Error('UNEXPECTED_QUERY');
  };
  require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query}};
  delete require.cache[require.resolve('../helper/socket')];
  const {processSocketEvent}=require('../helper/socket');
  t.after(()=>{
    if(priorDb)require.cache[dbPath]=priorDb;else delete require.cache[dbPath];
    delete require.cache[require.resolve('../helper/socket')];
  });

  const handlers={},events=[];
  const category=require('../modules/platform/categories').trainingCenter;
  const socket={userData:agent,decodedToken:{uid:agent.uid,role:'agent'},businessFeatureSession:{ownerUid:agent.owner_uid,refresh:async()=>({ownerUid:agent.owner_uid,context:{audience:'tenant',identity:{id:'agent-identity'},tenant:{id:'synthetic-tenant',status:'active',categoryKey:'training_center',categoryVersion:1,disabledModules:[]},membership:{id:'synthetic-membership',tenantId:'synthetic-tenant',identityId:'agent-identity',role:'agent',status:'active'},category,subscription:{status:'active',capabilities:[...category.capabilities]}}})},on:(name,fn)=>{handlers[name]=fn;},emit:(name,data)=>events.push({name,data})};
  processSocketEvent({socket,initializeSocket(){},sendToUid(){},sendToSocket(){},sendToAll(){},getConnectedUsers(){return[];},getConnectionsByUid(){return[];},getConnectionBySocketId(){return null;},getAllSocketData(){return[];}});

  await handlers.message({type:'update_spend_time',payload:{uid:agent.uid,date:'1900-01-01',timeSpent:5}});
  assert.equal(events.length,0);
  assert.ok(JSON.parse(logs).spendTime);
  const read=calls.find(call=>call.sql.includes('SELECT logs FROM agents'));
  const write=calls.find(call=>call.sql.includes('UPDATE agents SET logs'));
  assert.deepEqual(read.params,[agent.uid,agent.owner_uid]);
  assert.deepEqual(write.params.slice(1),[agent.uid,agent.owner_uid]);

  const writesBefore=calls.filter(call=>call.sql.includes('UPDATE agents SET logs')).length;
  await handlers.message({type:'update_spend_time',payload:{uid:'foreign-agent',timeSpent:5}});
  await handlers.message({type:'update_spend_time',payload:{uid:agent.uid,timeSpent:301}});
  socket.userData={id:2,uid:'synthetic-manager',owner_uid:agent.owner_uid,role:'manager',isAgent:false};
  await handlers.message({type:'update_spend_time',payload:{uid:agent.uid,timeSpent:5}});
  assert.equal(calls.filter(call=>call.sql.includes('UPDATE agents SET logs')).length,writesBefore);
  assert.equal(events.filter(event=>event.name==='error').length,3);
});
