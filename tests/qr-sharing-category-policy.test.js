'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const guard=require('../modules/platform/team-role-request-guard');

const request={baseUrl:'/api/inbox',path:'/get_chat_list',method:'GET'};
const accountant={role:'accountant',roleProfileId:'role-1',seatRole:'accountant',rolePermissions:['conversations.read','conversations.reply']};

test('legacy QR accountant route uses the exact versioned category sharing contract',async()=>{
  const calls=[];
  const allowed=await guard.authorizeLegacyRequest(request,{sourceTable:'user',sourceId:'42'},async sql=>{
    calls.push(sql);
    if(sql.includes('SELECT m.role'))return [{...accountant,categoryKey:'training_center',categoryVersion:1}];
    if(sql.includes('SELECT 1 FROM sx_legacy_ownership'))return [{shared:1}];
    return [];
  });
  assert.deepEqual(allowed,{allowed:true,permission:'conversations.read'});
  assert.equal(calls.length,2);

  const deniedCalls=[];
  const denied=await guard.authorizeLegacyRequest(request,{sourceTable:'user',sourceId:'42'},async sql=>{
    deniedCalls.push(sql);
    return sql.includes('SELECT m.role')?[{...accountant,categoryKey:'training_center',categoryVersion:2}]:[{shared:1}];
  });
  assert.deepEqual(denied,{allowed:false,code:'CATEGORY_UNAVAILABLE'});
  assert.equal(deniedCalls.length,1);
});
