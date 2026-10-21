'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const contract=require('../modules/platform/ai-assistant-contract');

test('AI translation and reply inputs accept supported providers and bounded values',()=>{
  assert.deepEqual(contract.translationInput({provider:'openai',apiKey:' secret ',text:' Hello ',targetLanguage:'Arabic'}),{provider:'openai',apiKey:'secret',text:'Hello',targetLanguage:'Arabic'});
  assert.deepEqual(contract.replyInput({provider:'gemini',apiKey:'key',chatId:123,lastMessage:null}),{provider:'gemini',apiKey:'key',chatId:'123',lastMessage:''});
});

test('AI request inputs reject missing credentials, unsupported providers, oversized data and invalid chat IDs',()=>{
  for(const input of [
    ()=>contract.translationInput({provider:'other',apiKey:'key',text:'hi',targetLanguage:'Arabic'}),
    ()=>contract.translationInput({provider:'openai',apiKey:'key',text:'x'.repeat(contract.MAX_TRANSLATION_LENGTH+1),targetLanguage:'Arabic'}),
    ()=>contract.translationInput({provider:'openai',apiKey:'',text:'hi',targetLanguage:'Arabic'}),
    ()=>contract.replyInput({provider:'openai',apiKey:'key',chatId:{toString(){return 'owned'}}}),
    ()=>contract.replyInput({provider:'openai',apiKey:'key',chatId:'c1',lastMessage:'x'.repeat(contract.MAX_REPLY_CONTEXT_LENGTH+1)}),
  ])assert.throws(input,error=>error.code==='INVALID_AI_REQUEST');
});
