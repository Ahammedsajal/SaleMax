'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { configure, usage } = require('../modules/platform/ai-prompt-cache');
const { generate, generateConversation } = require('../modules/platform/chatbot-provider');
const { buildAiPrompt } = require('../modules/platform/chatbot-ai-prompt');
const settings = require('../modules/platform/tenant-ai-settings');
const { createTenantAiSettingsRouter } = require('../modules/platform/tenant-ai-settings-router');
const { trainingCenter } = require('../modules/platform/categories');
const { navigationFor } = require('../modules/platform/navigation');

function response(payload) { return { ok: true, headers: { get() { return null; } }, async text() { return JSON.stringify(payload); } }; }
const reply = JSON.stringify({ can_answer: true, confidence: 1, reply: 'Synthetic answer' });

test('OpenAI caches only the stable policy/evidence prefix and scopes its opaque key per tenant', async () => {
  const requests = [];
  for (const tenant of ['tenant-a','tenant-a','tenant-b']) {
    const result = await generate({ provider: 'openai', model: 'gpt-6-luna', apiKey: 'synthetic-key-12345678', system: 'Rules', context: 'Stable evidence', user: requests.length ? 'New question' : 'First question', cacheScope: `${tenant}:bot`, fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 1500, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 1200, cache_write_tokens: 200 } } });
    } });
    assert.equal(result.cachedInputTokens, 1200);
    assert.equal(result.cacheWriteTokens, 200);
  }
  assert.deepEqual(requests[0].prompt_cache_options, { mode: 'explicit', ttl: '30m' });
  assert.deepEqual(requests[0].messages[1].content, [{ type: 'text', text: 'Stable evidence', prompt_cache_breakpoint: { mode: 'explicit' } }]);
  assert.equal(requests[0].messages[1].prompt_cache_breakpoint, undefined);
  assert.equal(requests[0].messages[2].prompt_cache_breakpoint, undefined);
  assert.equal(requests[0].prompt_cache_key, requests[1].prompt_cache_key);
  assert.notEqual(requests[0].prompt_cache_key, requests[2].prompt_cache_key);
  assert.doesNotMatch(requests[0].prompt_cache_key, /tenant|synthetic-key|question/);
});

test('older OpenAI models and other providers do not receive unsupported cache options', () => {
  for (const [provider,model] of [['openai','gpt-4o-mini'],['openai','gpt-5.4'],['deepseek','deepseek-flash'],['gemini','gemini-3.1-flash-lite']]) {
    const result = configure({ messages: [{ role: 'system', content: 'Rules' }] }, { provider, model, cacheScope: 'tenant-a:bot' });
    assert.equal(result.prompt_cache_options, undefined);
    assert.equal(result.messages[0].prompt_cache_breakpoint, undefined);
    if (provider !== 'openai') assert.equal(result.prompt_cache_key, undefined);
  }
});

test('flow conversations preserve reported cache usage and implicit prefix reuse', async () => {
  let body;
  const result = await generateConversation({ provider:'openai', model:'gpt-6-luna', apiKey:'synthetic-key-12345678', messages:[{role:'system',content:'Rules'},{role:'user',content:'Hi'}], cacheScope:'tenant-a:flow', fetchImpl:async(_url, options)=>{
    body=JSON.parse(options.body);
    return response({choices:[{message:{content:'Hello'}}],usage:{prompt_tokens:1300,completion_tokens:3,prompt_tokens_details:{cached_tokens:1100,cache_write_tokens:100}}});
  }});
  assert.equal(body.prompt_cache_options.mode,'implicit');
  assert.equal(result.usage.cachedInputTokens,1100);
  assert.equal(result.usage.cacheWriteTokens,100);
});

test('usage reads DeepSeek and Gemini cache counters and bounds untrusted counts', () => {
  assert.deepEqual(usage({ usage: { prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 80 } }), { inputTokens: 100, outputTokens: 5, cachedInputTokens: 80, cacheWriteTokens: 0 });
  assert.deepEqual(usage({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5, thoughtsTokenCount: 2, cachedContentTokenCount: 70 } }), { inputTokens: 100, outputTokens: 7, cachedInputTokens: 70, cacheWriteTokens: 0 });
  const bounded = usage({ usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 500, cache_write_tokens: 400 } } });
  assert.equal(bounded.cachedInputTokens,100); assert.equal(bounded.cacheWriteTokens,0);
});

test('invalid model output retains its actual cache accounting', async () => {
  await assert.rejects(generate({provider:'openai',model:'gpt-6-luna',apiKey:'synthetic-key-12345678',system:'Rules',user:'Hi',fetchImpl:async()=>response({choices:[{message:{content:'invalid json'}}],usage:{prompt_tokens:1300,completion_tokens:2,prompt_tokens_details:{cached_tokens:1200}}})}),error=>error.code==='AI_PROVIDER_INVALID_OUTPUT'&&error.usage.cachedInputTokens===1200&&error.tokensUsed===1302);
});

test('changing a customer turn preserves policy/evidence, changing a fact invalidates evidence', () => {
  const common = {pack:{title:'Training center',systemGuidance:'Use verified facts.'},profile:{config:{instructions:'Friendly tone'}},facts:[{sourceId:'s0',duration:'8 weeks'}],history:[]};
  const a=buildAiPrompt({...common,customerMessage:'Hi'}),b=buildAiPrompt({...common,customerMessage:'How much?'}),c=buildAiPrompt({...common,customerMessage:'How much?',facts:[{sourceId:'s0',duration:'10 weeks'}]});
  assert.equal(a.system,b.system); assert.equal(a.context,b.context); assert.notEqual(a.user,b.user); assert.notEqual(b.context,c.context);
  assert.doesNotMatch(a.context,/customerMessage|conversationSummary/);
});

test('cost includes discounted reads and cache-write premium without double counting', () => {
  const estimate=settings.estimateUsage('openai','gpt-6-luna',1_000_000,1_000_000,{cachedInputTokens:600_000,cacheWriteTokens:200_000});
  assert.ok(Math.abs(estimate.estimatedUsd-0.551)<1e-10);
  assert.ok(Math.abs(estimate.readSavingsUsd-0.054)<1e-10);
  assert.ok(Math.abs(estimate.writePremiumUsd-0.005)<1e-10);
  assert.equal(settings.estimatedCostUsd('openai','unknown-model',1000,100,{cachedInputTokens:1000}),settings.estimatedCostUsd('openai','unknown-model',1000,100));
});

const owner = {audience:'tenant',tenant:{id:'tenant-a',status:'active',categoryKey:'training_center',categoryVersion:1},identity:{id:'identity-a'},membership:{tenantId:'tenant-a',status:'active',role:'owner'},category:trainingCenter,subscription:{status:'active',capabilities:[...trainingCenter.capabilities]}};

test('AI integrations navigation remains owner-only even with delegated tenant.manage', () => {
  assert.ok(navigationFor(owner).some(item=>item.key==='ai-integrations'));
  for(const role of ['manager','accountant','agent'])assert.equal(navigationFor({...owner,membership:{...owner.membership,role,customPermissions:['tenant.manage']}}).some(item=>item.key==='ai-integrations'),false);
});

test('integration settings and usage APIs reject staff, enforce origin and tenant scope, and never return keys', async t => {
  const express=require('express'); let queries=[], role='owner';
  const db={release(){},async query(sql,args){queries.push([sql,args]);if(/SELECT provider,model/.test(sql))return [[{provider:'openai',model:'gpt-6-luna',dailyTokenLimit:50000,revision:2}]];if(/COUNT\(\*\)/.test(sql))return [[{count:0}]];return [[]];}};
  const app=express();app.use('/api/workspace/ai/settings',createTenantAiSettingsRouter({pool:{async getConnection(){return db;}},origin:'http://127.0.0.1',authenticate(req,_res,next){req.featureSession={context:{...owner,membership:{...owner.membership,role}}};next();}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());const root=`http://127.0.0.1:${server.address().port}/api/workspace/ai/settings`;
  const config=await fetch(root);assert.equal(config.status,200);assert.equal(config.headers.get('cache-control'),'no-store');const data=(await config.json()).data;
  assert.equal(data.providers.length,3);assert.equal(data.promptCaching.ttl,'30m');assert.equal(data.apiKey,undefined);assert.equal(data.key_ciphertext,undefined);
  const usageRes=await fetch(root+'/usage');assert.equal(usageRes.status,200);assert.equal((await usageRes.json()).data.replyCap,false);assert.ok(queries.every(([,args])=>args[0]==='tenant-a'));
  role='manager';queries=[];assert.equal((await fetch(root)).status,403);assert.equal((await fetch(root+'/usage')).status,403);assert.equal(queries.length,0);
  assert.equal((await fetch(root,{method:'PUT',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
});
