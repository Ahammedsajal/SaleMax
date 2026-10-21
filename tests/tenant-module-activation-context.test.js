'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const {once}=require('node:events');
const customization=require('../modules/platform/tenant-customization');
const {trainingCenter}=require('../modules/platform/categories');

const tenantContext=(tenantId)=>({audience:'tenant',identity:{id:`identity-${tenantId}`},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:`membership-${tenantId}`,tenantId,status:'active',role:'owner'},category:trainingCenter,runtimeReady:{}});
const activationDoc=tenant=>{
  const enabled=trainingCenter.modules.map(ref=>({ref,module:require('../modules/platform/categories').moduleRegistry.get(ref.id,ref.version)})).filter(({module})=>module.activation!=='locked_compatibility').map(({ref})=>`${ref.id}@${ref.version}`).filter(key=>key!=='core.inbox@1');
  return customization.normalize(tenant,{...customization.defaults(),enabledModules:enabled});
};
const rowFor=(tenant,document)=>({id:`00000000-0000-4000-8000-${tenant.tenant.id.padEnd(12,'0').slice(0,12)}`,tenant_id:tenant.tenant.id,category_key:'training_center',category_version:1,schema_version:document.schemaVersion,revision:1,kind:'published',document:JSON.stringify(document),checksum:customization.checksum(document),created_at:'2026-10-21 00:00:00.000'});

test('canonical /me session attaches only the authenticated tenant activation',async t=>{
  const sessions=require('../modules/platform/sessions'),plans=require('../modules/platform/plans');
  const oldLoadSession=sessions.loadSession,oldEntitlements=plans.loadEntitlements;
  const docs=new Map();
  for(const tenantId of ['tenant-a','tenant-b']){const context=tenantContext(tenantId);docs.set(tenantId,rowFor(context,activationDoc(context)));}
  sessions.loadSession=async(_db,token)=>tenantContext(token);
  plans.loadEntitlements=async(_db,tenantId)=>({status:'active',capabilities:trainingCenter.capabilities});
  const db={query:async(_sql,args)=>[[docs.get(args[0])||null]],release(){}};
  const serverApp=express(),auth=require('../modules/platform/auth-router').createAuthRouter({pool:{getConnection:async()=>db},key:Buffer.alloc(32,7),origin:'http://127.0.0.1:3010',insecureLoopback:true,allowedAudience:'tenant'});
  serverApp.use('/auth',auth.router);
  const server=require('node:http').createServer(serverApp);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.close();await once(server,'close');sessions.loadSession=oldLoadSession;plans.loadEntitlements=oldEntitlements;});
  const read=async tenantId=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/auth/me`,{headers:{Cookie:`salemax_dev_session=${tenantId}`}});assert.equal(response.status,200);return response.json();};
  const a=await read('tenant-a'),b=await read('tenant-b');
  assert.equal(a.context.tenant.id,'tenant-a');assert.ok(!a.context.enabledModules.includes('core.inbox@1'));
  assert.equal(b.context.tenant.id,'tenant-b');assert.ok(!b.context.enabledModules.includes('core.inbox@1'));
});

test('adapted legacy business sessions attach activation from their own tenant revision',async t=>{
  const plans=require('../modules/platform/plans'),oldEntitlements=plans.loadEntitlements;
  plans.loadEntitlements=async()=>({status:'active',capabilities:trainingCenter.capabilities});
  const actor={id:17,uid:'synthetic-legacy-owner'};
  const row=tenantContext('legacy-tenant-a'),doc=activationDoc(row);
  const firstQuery=[{uidHash:crypto.createHash('sha256').update(actor.uid).digest('hex'),tenantId:'legacy-tenant-a',tenantName:'Synthetic',tenantStatus:'active',categoryKey:'training_center',categoryVersion:1,currency:'QAR',timezone:'Asia/Qatar',membershipId:'legacy-member-a',identityId:'legacy-identity-a',role:'owner',membershipStatus:'active',roleProfileId:null,delegatedPermissions:'[]',assignedNavigation:null,rolePermissions:null,seatRole:null,roleStatus:null,identityStatus:'active'}];
  const activation=rowFor(row,doc);
  const db={query:async sql=>sql.includes('sx_tenant_customization_heads')?[[activation]]:[firstQuery],release(){}};
  const legacy=require('../modules/platform/business-feature-session').legacyContext;
  t.after(()=>{plans.loadEntitlements=oldEntitlements;});
  const context=await legacy(db,actor);
  assert.equal(context.tenant.id,'legacy-tenant-a');assert.ok(!context.enabledModules.includes('core.inbox@1'));
  assert.deepEqual(require('../modules/platform/policy').decision(context,{capability:'messaging.inbox',permission:'conversations.read'}),{allowed:false,code:'MODULE_DISABLED'});
});
