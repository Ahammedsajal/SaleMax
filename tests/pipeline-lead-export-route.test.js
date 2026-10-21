'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const http=require('node:http');
const path=require('node:path');

const fakeCalls=[];
const fakePool={query:async()=>[[]],getConnection:async()=>{throw new Error('Unexpected DB connection');}};
const pipelinePath=require.resolve('../helper/pipeline/leadPipeline');
const configPath=require.resolve('../database/config');
const dbPromisePath=require.resolve('../database/dbpromise');
const journeyPath=require.resolve('../modules/platform/training-lead-journey');
require.cache[pipelinePath]={id:pipelinePath,filename:pipelinePath,loaded:true,exports:{getBoard:async input=>{fakeCalls.push(input);return {leads:[{id:31,title:'Reference',contact_name:'Synthetic',mobile:'55550000',stage_key:'new',status:'open',qualification_data:{customFields:{field_a:{value:'A-17',definition:{label:{en:'Ref'},type:'text'},configurationRevision:3}}}}]};}}};
require.cache[configPath]={id:configPath,filename:configPath,loaded:true,exports:{promise:()=>fakePool}};
require.cache[dbPromisePath]={id:dbPromisePath,filename:dbPromisePath,loaded:true,exports:{query:async()=>[{id:1,uid:'tenant-from-session',role:'user',timezone:'Asia/Qatar'}]}};
require.cache[journeyPath]={id:journeyPath,filename:journeyPath,loaded:true,exports:{reconcileExisting:async()=>{}}};
process.env.JWTKEY='pipeline-export-route-test-secret';
const jwt=require('jsonwebtoken');
const router=require('../routes/pipeline');
const app=express();app.use('/api/pipeline',router);
let server,base;
test.before(async()=>{server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));for(const modulePath of [pipelinePath,configPath,dbPromisePath,journeyPath])delete require.cache[modulePath];});

test('authenticated Pipeline export returns bounded CSV using the session tenant and current filters',async()=>{
  const token=jwt.sign({email:'owner@example.test',password:'session-password'},process.env.JWTKEY);
  const response=await fetch(`${base}/api/pipeline/leads/export?search=reference&sourceType=manual&qrInstanceId=8`,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/csv/);
  assert.match(response.headers.get('content-disposition'),/7network-pipeline-leads\.csv/);
  const csv=await response.text();assert.match(csv,/A-17/);assert.match(csv,/""configurationRevision"":3/);
  assert.equal(fakeCalls.length,1);
  assert.equal(fakeCalls[0].uid,'tenant-from-session');
  assert.equal(fakeCalls[0].includeQualificationData,true);
  assert.equal(fakeCalls[0].filters.limit,300);assert.equal(fakeCalls[0].filters.page,1);
  assert.equal(fakeCalls[0].filters.search,'reference');assert.equal(fakeCalls[0].filters.sourceType,'manual');assert.equal(fakeCalls[0].filters.qrInstanceId,'8');
});

test('Pipeline export rejects anonymous requests before reading leads',async()=>{
  fakeCalls.length=0;
  const response=await fetch(`${base}/api/pipeline/leads/export`);
  assert.equal(response.status,401);assert.equal(fakeCalls.length,0);
});
