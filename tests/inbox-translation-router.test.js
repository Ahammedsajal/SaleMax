'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const test=require('node:test');
const {createInboxTranslationRouter}=require('../modules/platform/inbox-translation-router');
const training=require('../modules/platform/categories').trainingCenter;
const tenantId='11111111-1111-4111-8111-111111111111';
const base={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:training.key,categoryVersion:training.version},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId,role:'owner',status:'active'},category:training,subscription:{status:'active',categoryKey:training.key,categoryVersion:training.version,capabilities:[...training.capabilities]}};
async function start(context,{endpoint='http://translate.internal',fetchImpl=async(_url,options)=>({ok:true,json:async()=>({translatedText:JSON.parse(options.body).target==='ar'?'مرحبا':'Hello'})})}={}){
 const app=express();app.use('/api/workspace/inbox/translate',createInboxTranslationRouter({authenticate(req,_res,next){req.featureSession={context};next();},origin:'https://7network.live',endpoint,fetchImpl}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return{origin:`http://127.0.0.1:${server.address().port}`,server};
}
async function translate(app,text){return fetch(app.origin+'/api/workspace/inbox/translate',{method:'POST',headers:{Origin:'https://7network.live','Content-Type':'application/json'},body:JSON.stringify({text})});}

test('Inbox translation selects the opposite language and sends no saved-message metadata',async t=>{
 const payloads=[];
 const target=await start(base,{fetchImpl:async(url,options)=>{payloads.push({url,body:JSON.parse(options.body)});return{ok:true,json:async()=>({translatedText:payloads.at(-1).body.target==='ar'?'مرحبا':'Hello'})};}});t.after(()=>new Promise(resolve=>target.server.close(resolve)));
 let response=await translate(target,'Good morning');assert.equal(response.status,200);assert.deepEqual((await response.json()).data,{text:'مرحبا',targetLanguage:'ar'});
 response=await translate(target,'صباح الخير');assert.equal(response.status,200);assert.deepEqual((await response.json()).data,{text:'Hello',targetLanguage:'en'});
 assert.deepEqual(payloads.map(item=>[item.url,item.body.source,item.body.target,Object.keys(item.body)]),[['http://translate.internal/translate','auto','ar',['q','source','target','format']],['http://translate.internal/translate','auto','en',['q','source','target','format']]]);
});

test('Inbox translation requires reply permission and same-origin POST',async t=>{
 const noReply=await start({...base,membership:{...base.membership,role:'accountant'}});t.after(()=>new Promise(resolve=>noReply.server.close(resolve)));
 let response=await translate(noReply,'Hello');assert.equal(response.status,403);assert.equal((await response.json()).code,'PERMISSION_DENIED');
 const owner=await start(base);t.after(()=>new Promise(resolve=>owner.server.close(resolve)));
 response=await fetch(owner.origin+'/api/workspace/inbox/translate',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({text:'Hello'})});assert.equal(response.status,403);assert.equal((await response.json()).code,'ORIGIN_DENIED');
});

test('Inbox translation rejects oversized or blank drafts and maps provider failures safely',async t=>{
 const app=await start(base,{fetchImpl:async()=>({ok:false,status:503})});t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 let response=await translate(app,' ');assert.equal(response.status,400);assert.equal((await response.json()).code,'INVALID_TEXT');
 response=await translate(app,'x'.repeat(4001));assert.equal(response.status,400);assert.equal((await response.json()).code,'TEXT_TOO_LONG');
 response=await translate(app,'Hello');assert.equal(response.status,503);assert.equal((await response.json()).code,'TRANSLATION_UNAVAILABLE');
});
