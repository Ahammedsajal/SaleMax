'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const express=require('express');
const categories=require('../modules/platform/categories');
const {createLegacyModuleAccess}=require('../modules/platform/legacy-module-access');

test('existing AI routes enforce the shared tenant module and assigned-chat boundary before provider calls',async()=>{
  let providerCalls=0,allowConversation=true,failProvider=false;
  const tenantContext={audience:'tenant',tenant:{id:'tenant-ai',status:'active',categoryKey:categories.baseCrm.key,categoryVersion:categories.baseCrm.version},membership:{id:'member-ai',tenantId:'tenant-ai',role:'owner',status:'active'},category:categories.baseCrm,subscription:{status:'active',categoryKey:categories.baseCrm.key,categoryVersion:categories.baseCrm.version,capabilities:[...categories.baseCrm.capabilities]},enabledModules:categories.baseCrm.modules.map(item=>`${item.id}@${item.version}`)};
  const pool={getConnection(){throw new Error('fixed tenant context must not use the database');}};
  const inbox={resolveInboxScope:async(_query,user,event)=>{assert.equal(user.uid,'owner-ai');assert.equal(event,'suggest_reply');return {canonical:true,uid:user.uid,assignedOnly:true};},authorizeInboxPayload:async(_query,_scope,_event,payload)=>{if(!allowConversation||payload.chatId!=='assigned-chat')throw Object.assign(new Error('denied'),{code:'TEAM_INBOX_PERMISSION_DENIED'});}};
  const functions={getRecentMessages:async()=>[{type:'text',route:'INCOMING',text:'Hello'}],suggestReplyWithOpenAI:async()=>{providerCalls++;return 'Reply';},suggestReplyWithGemini:async()=>{providerCalls++;return 'Reply';},suggestReplyWithDeepseek:async()=>{providerCalls++;return 'Reply';},translateWithOpenAI:async()=>{providerCalls++;if(failProvider)throw new Error('provider leaked synthetic-key');return 'Hola';},translateWithGemini:async()=>{providerCalls++;return 'Hola';},translateWithDeepseek:async()=>{providerCalls++;return 'Hola';}};
  const stubs={
    '../database/dbpromise.js':{query:async()=>[]},
    '../database/config.js':{promise:()=>pool},
    '../middlewares/user.js':(req,_res,next)=>{req.decode={uid:'owner-ai',role:'user',userData:{id:5,uid:'owner-ai',role:'user'}};next();},
    '../functions/function.js':functions,
    '../modules/platform/team-inbox-scope':inbox,
    '../modules/platform/legacy-module-access':{createLegacyModuleAccess:options=>createLegacyModuleAccess({...options,pool,resolveContext:async()=>tenantContext})},
  };
  const cacheKeys=[];
  for(const [specifier,exports] of Object.entries(stubs)){const filename=require.resolve(path.join(__dirname,specifier));cacheKeys.push(filename);require.cache[filename]={id:filename,filename,loaded:true,exports};}
  const routerPath=require.resolve('../routes/ai.js');cacheKeys.push(routerPath);delete require.cache[routerPath];
  const app=express();app.use(express.json());app.use('/api/ai',require('../routes/ai.js'));
  const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const post=(path,body)=>fetch(`http://127.0.0.1:${server.address().port}/api/ai${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try{
    tenantContext.enabledModules=tenantContext.enabledModules.filter(key=>key!=='core.inbox@1');
    const disabled=await post('/translate',{provider:'openai',apiKey:'synthetic-key',text:'Hi',targetLanguage:'Arabic'});
    assert.equal(disabled.status,403);assert.equal((await disabled.json()).code,'MODULE_DISABLED');assert.equal(providerCalls,0);
    tenantContext.enabledModules=categories.baseCrm.modules.map(item=>`${item.id}@${item.version}`);
    allowConversation=false;
    const foreign=await post('/suggest_reply',{provider:'openai',apiKey:'synthetic-key',chatId:'foreign-chat',lastMessage:'hello'});
    assert.equal(foreign.status,403);assert.equal((await foreign.json()).code,'CONVERSATION_ACCESS_DENIED');assert.equal(providerCalls,0);
    allowConversation=true;
    const allowed=await post('/suggest_reply',{provider:'openai',apiKey:'synthetic-key',chatId:'assigned-chat',lastMessage:'hello'});
    assert.equal(allowed.status,200);assert.equal((await allowed.json()).suggestion,'Reply');assert.equal(providerCalls,1);
    failProvider=true;
    const providerFailure=await post('/translate',{provider:'openai',apiKey:'synthetic-key',text:'Hi',targetLanguage:'Arabic'});
    assert.equal(providerFailure.status,502);const failureBody=await providerFailure.text();assert.match(failureBody,/AI_PROVIDER_REQUEST_FAILED/);assert.doesNotMatch(failureBody,/synthetic-key|provider leaked/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const filename of cacheKeys)delete require.cache[filename];}
});
