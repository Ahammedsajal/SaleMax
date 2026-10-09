'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('existing Inbox integration clears a transferred staff chat but keeps owner/assigned chats',async()=>{
  for(const access of [{allowed:true,assignedOnly:true},{allowed:false,assignedOnly:true},{allowed:true,assignedOnly:false}]){
    const values=new Map([['wacrm_user','synthetic-token'],['currentChat',JSON.stringify({chat_id:'shared-chat'})],['conversationArr','private-cache']]);
    let callback,replaced=null,cacheCleared=false;
    const storage={getItem:k=>values.get(k)||null,removeItem:k=>values.delete(k)};
    const context={URLSearchParams,localStorage:storage,sessionStorage:{getItem:()=>null},location:{pathname:'/user',search:'?page=inbox',replace:url=>{replaced=url;}},
      document:{head:{append:()=>{}},documentElement:{},createElement:()=>({}),querySelectorAll:()=>[],getElementById:()=>null},
      MutationObserver:class{observe(){}},window:{setInterval:fn=>{callback=fn;},addEventListener:()=>{}},
      fetch:async url=>{assert.match(url,/conversation-access\?chatId=shared-chat/);return {ok:true,json:async()=>({success:true,data:access})};},
      indexedDB:{open:()=>{const request={};queueMicrotask(()=>{request.result={objectStoreNames:{contains:()=>true},close:()=>{},transaction:()=>{const txn={objectStore:()=>({clear:()=>{cacheCleared=true;queueMicrotask(()=>txn.oncomplete());}})};return txn;}};request.onsuccess();});return request;}}
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../client/public/team-invitations.js'),'utf8'),context);
    await callback();
    if(access.assignedOnly&&!access.allowed){assert.equal(replaced,'/user?page=inbox');assert.equal(cacheCleared,true);assert.equal(values.has('currentChat'),false);assert.equal(values.has('conversationArr'),false);}
    else{assert.equal(replaced,null);assert.equal(cacheCleared,false);assert.equal(values.has('currentChat'),true);}
  }
});
