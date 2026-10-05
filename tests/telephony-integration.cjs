'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const plans=require('../modules/platform/plans');
const {trainingCenter}=require('../modules/platform/categories');
const queueService=require('../modules/platform/telephony-queues');
const gatewayService=require('../modules/platform/asterisk-gateway-ports');
const extensionService=require('../modules/platform/telephony-extensions');

module.exports=async function telephonyIntegration(db,other,{tenantId,identityId,membershipId}){
  const id=crypto.randomUUID();
  const platform={audience:'platform',identity:{id:identityId},mfaVerified:true,membership:{role:'super_admin',status:'active'}};
  const specification={name:`Telephony fixture ${id.slice(0,8)}`,categoryKey:'training_center',categoryVersion:1,
    capabilities:['telephony.call-center'],roleLimits:{owner:1,accountant:1,manager:2,agent:10}};
  const draft=await plans.createDraft(db,platform,specification);
  await plans.publish(db,platform,draft.id,draft.revision);
  await plans.assign(db,platform,{tenantId,planVersionId:draft.id,roleLimits:specification.roleLimits,durationDays:30});
  const context={audience:'tenant',identity:{id:identityId},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},
    membership:{id:membershipId,tenantId,role:'owner',status:'active'},category:trainingCenter,subscription:await plans.loadEntitlements(db,tenantId)};
  const agentIdentity=crypto.randomUUID(),agentMembership=crypto.randomUUID();
  await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES(?,?,?,'active')",[agentIdentity,`${id}@example.invalid`,'Synthetic call agent']);
  await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES(?,?,?,'agent','active')",[agentMembership,tenantId,agentIdentity]);
  for(const [member,extension] of [[membershipId,'7401'],[agentMembership,'7402']])
    await db.query('INSERT INTO sx_telephony_extensions(tenant_id,membership_id,extension,revision,assigned_by_identity_id) VALUES(?,?,?,1,?)',[tenantId,member,extension,identityId]);

  const initial={id:null,expectedRevision:0,name:'support_main',strategy:'ringall',ringTimeoutSeconds:20,enabled:false,membershipIds:[membershipId,agentMembership]};
  const created=await queueService.save(db,context,initial);
  assert.equal(created.enabled,false);assert.equal(created.members.length,2);assert.equal(created.revision,1);
  const updateA={...initial,id:created.id,expectedRevision:created.revision,ringTimeoutSeconds:30};
  assert.throws(()=>queueService.parse({...initial,strategy:'rrmemory'}),{code:'INVALID_TELEPHONY_QUEUE'});
  assert.throws(()=>queueService.parse({...initial,strategy:'linear'}),{code:'INVALID_TELEPHONY_QUEUE'});
  const updateB={...initial,id:created.id,expectedRevision:created.revision,strategy:'ringall'};
  const race=await Promise.allSettled([queueService.save(db,context,updateA),queueService.save(other,context,updateB)]);
  assert.equal(race.filter(item=>item.status==='fulfilled').length,1);
  assert.equal(race.find(item=>item.status==='rejected').reason.code,'STALE_TELEPHONY_QUEUE');
  const latest=(await queueService.list(db,context)).find(item=>item.id===created.id);
  const root={audience:'platform',identity:{id:identityId},mfaVerified:true,membership:{role:'super_admin',status:'active'}};
  let channels=await gatewayService.list(db,root);
  channels=channels.map(port=>port.channelNo===1?{...port,expectedRevision:port.revision,tenantId,inboundDid:'+97455550001',inboundQueueId:created.id}: {
    ...port,expectedRevision:port.revision,tenantId:port.tenantId||null,inboundDid:port.inboundDid||null,inboundQueueId:port.inboundQueueId||null,
  });
  await gatewayService.save(db,root,{channels});
  channels=await gatewayService.list(db,root);
  await assert.rejects(gatewayService.save(db,root,{channels:channels.map(port=>port.channelNo===1?{...port,expectedRevision:port.revision,enabled:true,inboundEnabled:true}: {
    ...port,expectedRevision:port.revision,tenantId:port.tenantId||null,inboundDid:port.inboundDid||null,inboundQueueId:port.inboundQueueId||null,
  })}),{code:'GATEWAY_QUEUE_DISABLED'});
  const enabledQueue=await queueService.save(db,context,{...initial,id:created.id,expectedRevision:latest.revision,enabled:true});
  await assert.rejects(extensionService.save(db,context,{membershipId:agentMembership,expectedRevision:1,extension:'7403'}),{code:'EXTENSION_QUEUE_MUST_BE_DISABLED'});
  assert.equal(enabledQueue.enabled,true);
  channels=await gatewayService.list(db,root);
  channels=channels.map(port=>port.channelNo===1?{...port,expectedRevision:port.revision,enabled:true,inboundEnabled:true,outboundEnabled:true}: {
    ...port,expectedRevision:port.revision,tenantId:port.tenantId||null,inboundDid:port.inboundDid||null,inboundQueueId:port.inboundQueueId||null,
  });
  await gatewayService.save(db,root,{channels});
  const preview=await gatewayService.previewRouting(db,root);
  assert.match(preview.config,/Stasis\\(salemax-call-center,inbound-did,\$\{EXTEN\}\\)/);
  assert.equal(preview.inboundRoutes[0].queueId,created.id);
  assert.deepEqual(preview.dinstarOutboundRoutes.map(route=>[route.channelNo,route.gatewayPort,route.routePrefix,route.digitsToDelete]),[[1,0,'9901',4]]);
  assert.match(preview.config,/Destination Prefix: 9901[\s\S]*Digits to be Deleted: 4/);
  const latestQueue=(await queueService.list(db,context)).find(item=>item.id===created.id);
  await assert.rejects(queueService.save(db,context,{...initial,id:created.id,expectedRevision:latestQueue.revision,enabled:false}),{code:'TELEPHONY_QUEUE_INBOUND_CHANNELS_ACTIVE'});
  channels=await gatewayService.list(db,root);
  channels=channels.map(port=>port.channelNo===1?{...port,expectedRevision:port.revision,enabled:false,inboundEnabled:false,outboundEnabled:false}: {
    ...port,expectedRevision:port.revision,tenantId:port.tenantId||null,inboundDid:port.inboundDid||null,inboundQueueId:port.inboundQueueId||null,
  });
  await gatewayService.save(db,root,{channels});
  const finalQueue=(await queueService.list(db,context)).find(item=>item.id===created.id);
  const disabled=await queueService.save(db,context,{...initial,id:created.id,expectedRevision:finalQueue.revision,enabled:false});
  assert.equal(disabled.enabled,false);
  return {tenantQueuePolicy:true,extensionMembersRequired:true,concurrentQueueRevision:true,inboundQueueRequiredAndEnabled:true,extensionChangeProtectedByEnabledQueue:true,inboundDidQueueTenantLink:true,queueDisableProtectedByInboundChannel:true,tenantBoundStasisPreview:true,dinstarOutboundSimRoutePreview:true};
};
