'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const express=require('express');
const categories=require('../modules/platform/categories');
const {createLegacyModuleAccess}=require('../modules/platform/legacy-module-access');

test('legacy chatbot API applies active tenant module policy before reading its owner data',async()=>{
  const calls=[],tenantContext={audience:'tenant',tenant:{id:'tenant-a',status:'active',categoryKey:categories.baseCrm.key,categoryVersion:categories.baseCrm.version},membership:{id:'member-a',tenantId:'tenant-a',role:'owner',status:'active'},category:categories.baseCrm,subscription:{status:'active',categoryKey:categories.baseCrm.key,categoryVersion:categories.baseCrm.version,capabilities:[...categories.baseCrm.capabilities]},enabledModules:categories.baseCrm.modules.map(item=>`${item.id}@${item.version}`).filter(key=>key!=='core.chatbot@1')};
  const pool={getConnection(){throw new Error('the fixed resolver must not use the fake pool');}};
  const stubs={
    '../database/dbpromise.js':{query:async(...args)=>{calls.push(args);return []; }},
    '../database/config.js':{promise:()=>pool},
    '../middlewares/user.js':(req,res,next)=>{req.decode={uid:'owner-a',userData:{id:1,uid:'owner-a',role:'user'}};next();},
    '../middlewares/plan.js':{checkPlan:(req,res,next)=>next()},
    '../modules/platform/legacy-module-access':{createLegacyModuleAccess:options=>createLegacyModuleAccess({...options,pool,resolveContext:async()=>tenantContext})},
    '../functions/function.js':{isValidEmail:()=>true,getFileExtension:()=>'',makeRequest:async()=>({}),readJsonFromFile:()=>[]},
  };
  const cacheKeys=[];
  for(const [specifier,exports] of Object.entries(stubs)){const filename=require.resolve(path.join(__dirname,specifier));cacheKeys.push(filename);require.cache[filename]={id:filename,filename,loaded:true,exports};}
  const routerPath=require.resolve('../routes/chatbot.js');cacheKeys.push(routerPath);delete require.cache[routerPath];
  const app=express();app.use('/api/chatbot',require('../routes/chatbot.js'));
  const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/chatbot/get_chatbot`);
    assert.equal(response.status,403);assert.deepEqual(await response.json(),{success:false,code:'MODULE_DISABLED'});assert.deepEqual(calls,[]);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const filename of cacheKeys)delete require.cache[filename];}
});
