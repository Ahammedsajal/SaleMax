'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createTenantCustomizationRouter}=require('../modules/platform/tenant-customization-router');
const {trainingCenter}=require('../modules/platform/categories');
const base={audience:'tenant',identity:{id:'owner'},tenant:{id:'tenant-a',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member-a',tenantId:'tenant-a',role:'owner',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:[...trainingCenter.capabilities]}};
async function fixture(){
 let context=base,queries=0,refreshes=0;
 const app=express(),authenticate=(req,res,next)=>{if(!['Bearer synthetic-owner','Bearer synthetic-staff'].includes(req.get('Authorization'))&&req.get('Cookie')!=='synthetic=owner')return res.status(401).json({success:false,code:'AUTH_REQUIRED'});req.featureSession={context,refresh:async()=>{refreshes++;return {context}}};next();};
 const router=createTenantCustomizationRouter({pool:{getConnection:async()=>({query:async()=>{queries++;return [[]]},release(){}})},origin:'https://crm.example.test',authenticate});
 app.use(['/api/workspace/customization','/api/crm/customization'],router);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 return {base:`http://127.0.0.1:${server.address().port}`,setContext:value=>context=value,counts:()=>({queries,refreshes}),close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)})};
}
test('shared customization router and alias serve bearer and cookie contexts without tenant input',async()=>{
 const app=await fixture();try{
  for(const prefix of ['/api/workspace/customization','/api/crm/customization'])for(const headers of [{Authorization:'Bearer synthetic-owner'},{Cookie:'synthetic=owner'}]){
   const response=await fetch(app.base+prefix,{headers});assert.equal(response.status,200);const result=await response.json();assert.equal(result.data.revision,0);assert.equal(result.data.active,null);assert.ok(result.data.fields.some(field=>field.key==='courses'));assert.match(response.headers.get('cache-control'),/no-store/);
  }
  assert.equal(app.counts().refreshes,4);
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
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({document})}),preview=await response.json();assert.equal(response.status,200);assert.equal(preview.data.readOnly,true);assert.deepEqual(preview.data.document.hiddenNavigation,['courses']);assert.equal(app.counts().queries,2,'preview loads the tenant-owned baseline to preserve disabled scopes');
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({document:{...document,tenantId:'tenant-b'}})})).status,400);
  app.setContext({...base,membership:{...base.membership,role:'agent'}});
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({document})})).status,403);
  assert.equal(app.counts().queries,4,'a denied staff preview must not load tenant customization state');
 }finally{await app.close();}
});
