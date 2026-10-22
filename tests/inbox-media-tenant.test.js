'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {deleteMediaFromConversation}=require('../helper/socket/function');

test('shared Inbox media deletion keeps files referenced by another conversation and rejects path tricks',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'7network-inbox-media-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  for(const name of ['owned.jpg','shared.jpg','legacy-shared.jpg','outside.jpg'])fs.writeFileSync(path.join(directory,name),'synthetic');
  const calls=[];
  const queryFn=async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('FROM beta_conversation'))return params[2].includes('%shared.jpg%')?[{referenced:1}]:[];
    return params[2].includes('legacy-shared.jpg')?[{referenced:1}]:[];
  };
  const originalLog=console.log;
  try{
    console.log=()=>{};
    await deleteMediaFromConversation({
      mediaFolderPath:directory,type:'media',uid:'tenant-a-owner',chatId:'chat-a',queryFn,
      conversationData:[
        {type:'image',msgContext:JSON.stringify({image:{link:'https://crm.salemax.qa/meta-media/owned.jpg'}})},
        {type:'image',msgContext:JSON.stringify({image:{link:'https://crm.salemax.qa/meta-media/shared.jpg'}})},
        {type:'image',msgContext:JSON.stringify({image:{link:'https://crm.salemax.qa/meta-media/legacy-shared.jpg'}})},
        {type:'image',msgContext:JSON.stringify({image:{link:'https://crm.salemax.qa/meta-media/../../outside.jpg'}})},
      ],
    });
  }finally{console.log=originalLog;}
  assert.equal(fs.existsSync(path.join(directory,'owned.jpg')),false);
  assert.equal(fs.existsSync(path.join(directory,'shared.jpg')),true);
  assert.equal(fs.existsSync(path.join(directory,'legacy-shared.jpg')),true,'legacy chats.last_message references keep shared files');
  assert.equal(fs.existsSync(path.join(directory,'outside.jpg')),true);
  assert.equal(calls.length,5,'invalid paths are rejected before a database check');
  for(const {sql,params} of calls){
    assert.match(sql,/NOT \(uid = \? AND chat_id = \?\)/);
    assert.deepEqual(params.slice(0,2),['tenant-a-owner','chat-a']);
  }
});
