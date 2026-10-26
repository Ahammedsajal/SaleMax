'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const test=require('node:test');
const {createInboxTranslationRouter}=require('../modules/platform/inbox-translation-router');
const training=require('../modules/platform/categories').trainingCenter;
const tenantId='11111111-1111-4111-8111-111111111111';
const base={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:training.key,categoryVersion:training.version},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId,role:'owner',status:'active'},category:training,subscription:{status:'active',categoryKey:training.key,categoryVersion:training.version,capabilities:[...training.capabilities]}};
async function start(context,{endpoint='http://translate.internal',azureKey='',azureRegion='',azureEndpoint='https://api.cognitive.microsofttranslator.com',fetchImpl=async(_url,options)=>({ok:true,json:async()=>({translatedText:JSON.parse(options.body).target==='ar'?'مرحبا':'Hello'})})}={}){
 const app=express();app.use('/api/workspace/inbox/translate',createInboxTranslationRouter({authenticate(req,_res,next){req.featureSession={context};next();},origin:'https://7network.live',endpoint,azureKey,azureRegion,azureEndpoint,fetchImpl}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return{origin:`http://127.0.0.1:${server.address().port}`,server};
}
async function translate(app,text){return fetch(app.origin+'/api/workspace/inbox/translate',{method:'POST',headers:{Origin:'https://7network.live','Content-Type':'application/json'},body:JSON.stringify({text})});}
const close=app=>new Promise(resolve=>app.server.close(resolve));

test('Azure Translator is primary, receives only text and uses explicit English/Arabic direction',async t=>{
 const requests=[];
 const app=await start(base,{azureKey:'synthetic-azure-key',azureRegion:'qatar-region',fetchImpl:async(url,options)=>{requests.push({url:String(url),headers:options.headers,body:JSON.parse(options.body)});const target=new URL(url).searchParams.get('to');return{ok:true,json:async()=>[{translations:[{text:target==='ar'?'مرحبا':'Hello',to:target}]}]};}});t.after(()=>close(app));
 let response=await translate(app,'Good morning');assert.equal(response.status,200);assert.deepEqual((await response.json()).data,{text:'مرحبا',targetLanguage:'ar',provider:'azure'});
 response=await translate(app,'صباح الخير');assert.equal(response.status,200);assert.deepEqual((await response.json()).data,{text:'Hello',targetLanguage:'en',provider:'azure'});
 assert.deepEqual(requests.map(r=>[new URL(r.url).searchParams.get('from'),new URL(r.url).searchParams.get('to'),r.headers['Ocp-Apim-Subscription-Key'],r.headers['Ocp-Apim-Subscription-Region'],r.body]),[['en','ar','synthetic-azure-key','qatar-region',[{Text:'Good morning'}]],['ar','en','synthetic-azure-key','qatar-region',[{Text:'صباح الخير'}]]]);
});

test('Azure quota or service failures fall back to private LibreTranslate',async t=>{
 const calls=[];
 const app=await start(base,{azureKey:'synthetic-azure-key',fetchImpl:async(url,options)=>{calls.push(String(url));if(String(url).includes('cognitive.microsofttranslator.com'))return{ok:false,status:403,json:async()=>({})};return{ok:true,json:async()=>({translatedText:'مرحبا'})};}});t.after(()=>close(app));
 const response=await translate(app,'Hello');assert.equal(response.status,200);assert.deepEqual((await response.json()).data,{text:'مرحبا',targetLanguage:'ar',provider:'libretranslate'});assert.equal(calls.length,2);assert.match(calls[0],/cognitive\.microsofttranslator\.com\/translate\?/);assert.equal(calls[1],'http://translate.internal/translate');
});

test('without cloud credentials, Inbox translation uses the private fallback',async t=>{
 const calls=[];
 const app=await start(base,{fetchImpl:async(url,options)=>{calls.push(String(url));return{ok:true,json:async()=>({translatedText:'مرحبا'})};}});t.after(()=>close(app));
 const response=await translate(app,'Hello');assert.equal(response.status,200);assert.deepEqual((await response.json()).data,{text:'مرحبا',targetLanguage:'ar',provider:'libretranslate'});assert.deepEqual(calls,['http://translate.internal/translate']);
});

test('Inbox message translation requires read permission and same-origin POST',async t=>{
 const noRead=await start({...base,membership:{...base.membership,role:'accountant'}});t.after(()=>close(noRead));
 let response=await translate(noRead,'Hello');assert.equal(response.status,403);assert.equal((await response.json()).code,'PERMISSION_DENIED');
 const owner=await start(base);t.after(()=>close(owner));
 response=await fetch(owner.origin+'/api/workspace/inbox/translate',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({text:'Hello'})});assert.equal(response.status,403);assert.equal((await response.json()).code,'ORIGIN_DENIED');
});

test('Inbox translation rejects oversized or blank text and returns a safe failure when both providers fail',async t=>{
 const app=await start(base,{azureKey:'synthetic-azure-key',fetchImpl:async()=>({ok:false,status:503})});t.after(()=>close(app));
 let response=await translate(app,' ');assert.equal(response.status,400);assert.equal((await response.json()).code,'INVALID_TEXT');
 response=await translate(app,'x'.repeat(4001));assert.equal(response.status,400);assert.equal((await response.json()).code,'TEXT_TOO_LONG');
 response=await translate(app,'Hello');assert.equal(response.status,503);assert.equal((await response.json()).code,'TRANSLATION_UNAVAILABLE');
});
