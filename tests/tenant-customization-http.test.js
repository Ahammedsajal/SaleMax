'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createTenantCustomizationRouter}=require('../modules/platform/tenant-customization-router');
const {trainingCenter}=require('../modules/platform/categories');
const base={audience:'tenant',identity:{id:'owner'},tenant:{id:'tenant-a',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member-a',tenantId:'tenant-a',role:'owner',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:[...trainingCenter.capabilities]}};
async function fixture(){
 let context=base,queries=0,refreshes=0;const stageQueries=[];
 const app=express(),authenticate=(req,res,next)=>{if(!['Bearer synthetic-owner','Bearer synthetic-staff'].includes(req.get('Authorization'))&&req.get('Cookie')!=='synthetic=owner')return res.status(401).json({success:false,code:'AUTH_REQUIRED'});req.featureSession={context,ownerUid:'authenticated-owner-uid',refresh:async()=>{refreshes++;return {context,ownerUid:'authenticated-owner-uid'}}};next();};
 const router=createTenantCustomizationRouter({pool:{getConnection:async()=>({query:async(sql,args)=>{queries++;if(sql.includes('FROM pipeline_stages')){stageQueries.push(args);return [[{key:'new',title:'New'}]];}return [[]]},release(){}})},origin:'https://crm.example.test',authenticate});
 app.use(['/api/workspace/customization','/api/crm/customization'],router);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 return {base:`http://127.0.0.1:${server.address().port}`,setContext:value=>context=value,counts:()=>({queries,refreshes}),stageQueries,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)})};
}
test('shared customization router and alias serve bearer and cookie contexts without tenant input',async()=>{
 const app=await fixture();try{
  for(const prefix of ['/api/workspace/customization','/api/crm/customization'])for(const headers of [{Authorization:'Bearer synthetic-owner'},{Cookie:'synthetic=owner'}]){
   const response=await fetch(app.base+prefix+'?ownerUid=forged-owner&uidHash=forged-hash',{headers});assert.equal(response.status,200);const result=await response.json();assert.equal(result.data.revision,0);assert.equal(result.data.active,null);assert.ok(result.data.fields.some(field=>field.key==='courses'));assert.deepEqual(result.data.stageFields,[{key:'new',title:'New'}]);assert.equal(result.data.resolved.value.navigationLabels.courses.en,'Courses');assert.deepEqual(result.data.resolved.provenance['navigationLabels.courses.en'],{scope:'platform'});assert.match(response.headers.get('cache-control'),/no-store/);
  }
  assert.equal(app.counts().refreshes,4);
  const expectedHash=require('node:crypto').createHash('sha256').update('authenticated-owner-uid','utf8').digest('hex');assert.equal(app.stageQueries.length,4);for(const args of app.stageQueries)assert.deepEqual(args,[expectedHash,'authenticated-owner-uid']);
 }finally{await app.close();}
});
test('preview rejects foreign schema keys, denied staff, missing credentials and cross-origin writes',async()=>{
 const app=await fixture();try{
  const url=app.base+'/api/workspace/customization/preview',document={schemaVersion:3,navigationLabels:{courses:{en:'Programmes A',ar:'برامج أ'}},leadFields:[],hiddenNavigation:['courses']};
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://crm.example.test'},body:JSON.stringify({document})})).status,401);
  const headers={Authorization:'Bearer synthetic-owner','Content-Type':'application/json',Origin:'https://foreign.example.test'};
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({document})})).status,403);
  assert.equal(app.counts().refreshes,0);
  headers.Origin='https://crm.example.test';
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({document})}),preview=await response.json();assert.equal(response.status,200);assert.equal(preview.data.readOnly,true);assert.deepEqual(preview.data.document.hiddenNavigation,['courses']);assert.equal(preview.data.resolved.value.navigationLabels.courses.en,'Programmes A');assert.equal(preview.data.resolved.provenance['navigationLabels.courses.en'].scope,'tenant');assert.equal(app.counts().queries,0);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({document:{...document,tenantId:'tenant-b'}})})).status,400);
  app.setContext({...base,membership:{...base.membership,role:'agent'}});
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({document})})).status,403);
  assert.equal(app.counts().queries,0);
 }finally{await app.close();}
});
test('shared customization API exposes validated category lead-field inheritance in GET and preview',async()=>{
 const app=await fixture();try{
  const field={key:'cf_text_0123456789abcdef',type:'text',label:{en:'Property reference',ar:'مرجع العقار'},required:false,active:true,version:1};
  app.setContext({...base,category:{...trainingCenter,customizationDefaults:{schemaVersion:3,navigationLabels:{},leadFields:[field],hiddenNavigation:[]}}});
  const headers={Authorization:'Bearer synthetic-owner'};
  const response=await fetch(app.base+'/api/workspace/customization',{headers});assert.equal(response.status,200);
  const state=(await response.json()).data;assert.deepEqual(state.inherited.leadFields,[field]);assert.deepEqual(state.resolved.provenance.leadFields,{scope:'category_version',categoryKey:'training_center',categoryVersion:1});
  const queriesAfterGet=app.counts().queries;
  const preview=await fetch(app.base+'/api/workspace/customization/preview',{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:'https://crm.example.test'},body:JSON.stringify({document:{schemaVersion:3,navigationLabels:{},hiddenNavigation:[]}})});
  const previewPayload=await preview.json();assert.equal(preview.status,200,JSON.stringify(previewPayload));const result=previewPayload.data;assert.deepEqual(result.resolved.value.leadFields,[field]);assert.deepEqual(result.resolved.provenance.leadFields,{scope:'category_version',categoryKey:'training_center',categoryVersion:1});assert.equal(app.counts().queries,queriesAfterGet,'preview does not write category defaults');
  const cleared=await fetch(app.base+'/api/workspace/customization/preview',{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:'https://crm.example.test'},body:JSON.stringify({document:{schemaVersion:3,navigationLabels:{},leadFields:[],hiddenNavigation:[]}})});
  assert.equal(cleared.status,200);const clearedData=(await cleared.json()).data;assert.deepEqual(clearedData.resolved.value.leadFields,[]);assert.deepEqual(clearedData.resolved.provenance.leadFields,{scope:'tenant',revision:0});assert.equal(app.counts().queries,queriesAfterGet,'preview does not write explicit overrides either');
 }finally{await app.close();}
});
test('shared customization preview accepts schema v5 removal of inherited labels without persisting',async()=>{
 const app=await fixture();try{
  app.setContext({...base,category:{...trainingCenter,customizationDefaults:{schemaVersion:4,navigationLabels:{courses:{en:'Learning',ar:'التعلم'}},leadFields:[],hiddenNavigation:[],stageLabels:{new:{en:'Prospect',ar:'عميل محتمل'}}}}});
  const headers={Authorization:'Bearer synthetic-owner','Content-Type':'application/json',Origin:'https://crm.example.test'};
  const response=await fetch(app.base+'/api/workspace/customization/preview',{method:'POST',headers,body:JSON.stringify({document:{schemaVersion:5,navigationLabels:{courses:null},leadFields:[],hiddenNavigation:[],stageLabels:{new:null}}})});
  const payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));
  assert.equal(payload.data.resolved.value.navigationLabels.courses.en,'Courses');
  assert.deepEqual(payload.data.resolved.provenance['navigationLabels.courses.en'],{scope:'platform'});
  assert.equal(Object.hasOwn(payload.data.resolved.value.stageLabels,'new'),false);
  assert.equal(payload.data.resolved.deleted['navigationLabels.courses'].scope,'tenant');
  assert.equal(payload.data.resolved.deleted['stageLabels.new'].scope,'tenant');
  assert.equal(app.counts().queries,0,'preview is read-only');
 }finally{await app.close();}
});
test('existing customization API returns versioned module schemas and validates typed business overrides',async()=>{
 const app=await fixture();try{
  const schema={moduleSettings:{pipeline:{capability:'crm.leads',fields:[{key:'reminders',type:'boolean',label:{en:'Lead reminders',ar:'تذكيرات العملاء المحتملين'},default:false},{key:'days',type:'integer',label:{en:'Reminder days',ar:'أيام التذكير'},min:0,max:30,default:7}]}}};
  app.setContext({...base,category:{...trainingCenter,customizationSchema:schema}});
  const headers={Authorization:'Bearer synthetic-owner','Content-Type':'application/json',Origin:'https://crm.example.test'};
  const state=await (await fetch(app.base+'/api/workspace/customization',{headers})).json();
  assert.deepEqual(state.data.moduleSettingsSchema,schema.moduleSettings);
  assert.deepEqual(state.data.inherited.moduleSettings,{pipeline:{reminders:false,days:7}});
  const body={document:{schemaVersion:6,navigationLabels:{},hiddenNavigation:[],stageLabels:{},moduleSettings:{pipeline:{reminders:true,days:0}}}};
  const response=await fetch(app.base+'/api/workspace/customization/preview',{method:'POST',headers,body:JSON.stringify(body)}),preview=await response.json();
  assert.equal(response.status,200,JSON.stringify(preview));assert.equal(preview.data.resolved.value.moduleSettings.pipeline.days,0);assert.deepEqual(preview.data.resolved.provenance['moduleSettings.pipeline.reminders'],{scope:'tenant',revision:0});
  const invalid={document:{...body.document,moduleSettings:{pipeline:{days:31}}}};
  assert.equal((await fetch(app.base+'/api/workspace/customization/preview',{method:'POST',headers,body:JSON.stringify(invalid)})).status,400);
 }finally{await app.close();}
});
