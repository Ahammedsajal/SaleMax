'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const createHandler=require('../modules/platform/contact-delete-handler');

function response(){return {statusCode:200,body:null,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};}

test('legacy /del_contact route uses authenticated owner scope and validates input',async()=>{
  const source=fs.readFileSync(require.resolve('../routes/user'),'utf8');
  assert.match(source,/router\.post\("\/del_contact",\s*validateUser,\s*createContactDeleteHandler\(query\)\)/);
  const calls=[],handler=createHandler(async(sql,params)=>{calls.push({sql,params});return sql.includes('WHERE o.source_table')?[]:{affectedRows:1};});
  const ok=response();
  await handler({decode:{uid:'synthetic-owner',role:'user'},body:{id:'42'}},ok);
  assert.equal(ok.statusCode,200);
  assert.deepEqual(ok.body,{success:true,msg:'Contact was deleted'});
  const deletion=calls.find(call=>call.sql.includes('DELETE FROM contact'));
  assert.match(deletion.sql,/DELETE FROM contact WHERE id = \? AND uid = \?/);
  assert.deepEqual(deletion.params,[42,'synthetic-owner']);
  const invalid=response();
  await handler({decode:{uid:'synthetic-owner',role:'user'},body:{id:'42 OR 1=1'}},invalid);
  assert.equal(invalid.statusCode,400);
  assert.deepEqual(invalid.body,{success:false,code:'INVALID_CONTACT_ID'});
  assert.equal(calls.filter(call=>call.sql.includes('DELETE FROM contact')).length,1);
  const failed=response();
  await createHandler(async sql=>{if(sql.includes('WHERE o.source_table'))return [];throw Object.assign(new Error('private SQL detail'),{code:'ER_PARSE_ERROR'});})({decode:{uid:'synthetic-owner',role:'user'},body:{id:42}},failed);
  assert.equal(failed.statusCode,500);
  assert.deepEqual(failed.body,{success:false,code:'CONTACT_DELETE_FAILED',msg:'Contact could not be deleted.'});
});

test('canonical staff contact deletion uses the verified tenant owner and live feature policy',async()=>{
  const calls=[];
  const handler=createHandler(async(sql,params)=>{calls.push({sql,params});return {affectedRows:1};},{
    resolveInboxScope:async()=>({canonical:true,uid:'tenant-owner',ctx:{tenant:{id:'tenant-1'},identity:{id:'staff-identity'},membership:{id:'staff-membership',role:'manager'}}}),
    resolveFeatureSession:async actor=>({ownerUid:'tenant-owner',actor}),
    authorizeInboxFeature:async(scope,event,session)=>{assert.equal(event,'del_contact');assert.equal(session.ownerUid,'tenant-owner');},
    authorizeInboxPayload:async(_query,scope,event,payload,actor)=>{assert.equal(event,'del_contact');assert.equal(actor.uid,'staff-user');return {contactId:Number(payload.id),ownerUid:scope.uid};},
  });
  const res=response();
  await handler({decode:{uid:'staff-user',userData:{uid:'staff-user',role:'user'}},body:{id:42}},res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(calls[0].params,[42,'tenant-owner']);
});
