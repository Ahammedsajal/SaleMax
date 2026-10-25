'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createTrainingCourseRouter}=require('../modules/platform/training-course-router');
const {trainingCenter}=require('../modules/platform/categories');

function context(role){return {audience:'tenant',identity:{id:`identity-${role}`},tenant:{id:'tenant-training',status:'active',categoryKey:trainingCenter.key,categoryVersion:trainingCenter.version},membership:{id:`member-${role}`,tenantId:'tenant-training',role,status:'active',delegatedPermissions:[]},category:trainingCenter,subscription:{status:'active',capabilities:['training.courses']},runtimeReady:{}};}

test('canonical owner and manager sessions can read course setup through the existing course API',async()=>{
  const queries=[];
  const pool={query:async(sql)=>{queries.push(sql);return sql.includes('COUNT(*) AS n')?[[{n:0}],[]]:[[],[]];}};
  const app=express();
  app.use('/api/user/training/courses',createTrainingCourseRouter({pool,origin:'http://localhost',userGuard(_req,res){res.status(401).json({code:'LEGACY_AUTH_ONLY'});},canonicalGuard(req,_res,next){req.businessContext=context('manager');next();}}));
  const server=app.listen(0,'127.0.0.1');
  try{
    await new Promise(resolve=>server.once('listening',resolve));
    const address=server.address();
    const response=await fetch(`http://127.0.0.1:${address.port}/api/user/training/courses?limit=1`);
    const body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.success,true);
    assert.equal(body.data.total,0);
    assert.equal(queries.length,2);
    assert.ok(queries.every(sql=>sql.includes('tenant_id=?')));
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('canonical accountant may read the course catalogue but cannot create or change courses',async()=>{
  let queried=false;
  const connection={query:async()=>{queried=true;return [[{n:0}],[]];},release(){}};
  const pool={query:connection.query,getConnection:async()=>connection};
  const app=express();
  app.use('/api/user/training/courses',createTrainingCourseRouter({pool,origin:'http://localhost',userGuard(_req,res){res.status(401).json({code:'LEGACY_AUTH_ONLY'});},canonicalGuard(req,_res,next){req.businessContext=context('accountant');next();}}));
  app.use((error,_req,res,_next)=>res.status(error.status|| (error.code==='PERMISSION_DENIED'?403:500)).json({code:error.code||'INTERNAL_ERROR'}));
  const server=app.listen(0,'127.0.0.1');
  try{
    await new Promise(resolve=>server.once('listening',resolve));
    const address=server.address();
    const response=await fetch(`http://127.0.0.1:${address.port}/api/user/training/courses`,{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({code:'CS-101',nameEn:'Service',nameAr:'خدمة',durationValue:1,durationUnit:'weeks',deliveryMode:'online',offer:{priceMinor:1000}})});
    const body=await response.json();
    assert.equal(response.status,403);
    assert.equal(body.code,'PERMISSION_DENIED');
    assert.equal(queried,false);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('course owner can explicitly approve one attached PDF brochure for the public catalogue',async()=>{
  const courseId='11111111-1111-4111-8111-111111111111',mediaId='22222222-2222-4222-8222-222222222222',calls=[];let committed=false;
  const db={async beginTransaction(){},async commit(){committed=true;},async rollback(){},release(){},async query(sql,args){calls.push({sql,args});if(sql.includes('SELECT id,status FROM sx_training_courses'))return [[{id:courseId,status:'active'}]];if(sql.includes("media_kind='document'"))return [[{id:mediaId}]];return [{affectedRows:1}];}};
  const app=express();app.use(express.json());
  app.use('/api/user/training/courses',createTrainingCourseRouter({pool:{getConnection:async()=>db,query:db.query},origin:'http://localhost',userGuard(_req,res){res.status(401).json({code:'LEGACY_AUTH_ONLY'});},canonicalGuard(req,_res,next){req.businessContext=context('owner');next();}}));
  const server=app.listen(0,'127.0.0.1');
  try{await new Promise(resolve=>server.once('listening',resolve));const response=await fetch(`http://127.0.0.1:${server.address().port}/api/user/training/courses/${courseId}/media/${mediaId}/public-brochure`,{method:'PUT',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({public:true})});const body=await response.json();assert.equal(response.status,200);assert.deepEqual(body.data,{courseId,mediaId,public:true});assert.equal(committed,true);assert.match(calls[1].sql,/tenant_id=\? AND course_id=\? AND id=\?/);assert.match(calls[2].sql,/ON DUPLICATE KEY UPDATE media_id/);assert.equal(calls[2].args[0],context('owner').tenant.id);}
  finally{await new Promise(resolve=>server.close(resolve));}
});

test('accountant cannot publish a public course brochure',async()=>{
  let queried=false;const db={async query(){queried=true;return [[]];},release(){}};const app=express();app.use(express.json());
  app.use('/api/user/training/courses',createTrainingCourseRouter({pool:{getConnection:async()=>db,query:db.query},origin:'http://localhost',userGuard(_req,res){res.status(401).json({code:'LEGACY_AUTH_ONLY'});},canonicalGuard(req,_res,next){req.businessContext=context('accountant');next();}}));
  app.use((error,_req,res,_next)=>res.status(error.status|| (error.code==='PERMISSION_DENIED'?403:500)).json({code:error.code||'INTERNAL_ERROR'}));
  const server=app.listen(0,'127.0.0.1');try{await new Promise(resolve=>server.once('listening',resolve));const response=await fetch(`http://127.0.0.1:${server.address().port}/api/user/training/courses/${'11111111-1111-4111-8111-111111111111'}/media/${'22222222-2222-4222-8222-222222222222'}/public-brochure`,{method:'PUT',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({public:true})});const body=await response.text();assert.equal(response.status,403,body);assert.equal(JSON.parse(body).code,'PERMISSION_DENIED');assert.equal(queried,false);}finally{await new Promise(resolve=>server.close(resolve));}
});
