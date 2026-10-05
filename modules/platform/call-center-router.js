'use strict';

const express=require('express');
const {decision}=require('./policy');
const courses=require('./training-courses');
const extensions=require('./telephony-extensions');
const queues=require('./telephony-queues');
const {AsteriskCallControl}=require('./asterisk-call-control');
const asteriskConfig=require('./asterisk-config');

function createCallCenterRouter({pool,userGuard,canonicalGuard,origin}){
  const router=express.Router();
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const withDb=async fn=>{const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}};
  router.use(express.json({limit:'16kb',strict:true}));
  router.use((req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      if(!origin||req.get('Origin')!==origin)return res.status(403).json({success:false,code:'ORIGIN_DENIED'});
      if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({success:false,code:'INVALID_BODY'});
    }
    next();
  });
  async function legacyContext(uid){
    const context=await courses.legacyOwnerContext(pool,uid);
    try{
      const [[row]]=await withDb(db=>db.query('SELECT assigned_navigation AS assignedNavigation FROM sx_memberships WHERE id=? AND tenant_id=?',[context.membership.id,context.tenant.id]));
      if(row?.assignedNavigation!==null&&row?.assignedNavigation!==undefined){
        const value=typeof row.assignedNavigation==='string'?JSON.parse(row.assignedNavigation):row.assignedNavigation;
        context.membership.assignedNavigation=Array.isArray(value)?value:[];
      }
    }catch(error){if(error.code!=='ER_BAD_FIELD_ERROR')throw error;}
    return context;
  }
  router.use((req,res,next)=>{
    if(/^Bearer\s+/i.test(req.get('Authorization')||'')){
      return userGuard(req,res,()=>legacyContext(req.decode.uid).then(ctx=>{req.callCenterContext=ctx;next();}).catch(next));
    }
    return canonicalGuard(req,res,()=>{req.callCenterContext=req.businessContext;next();});
  });
  router.get('/extensions',wrap(async(req,res)=>res.json({success:true,data:await withDb(db=>extensions.list(db,req.callCenterContext))})));
  router.put('/extensions',wrap(async(req,res)=>res.json({success:true,data:await withDb(db=>extensions.save(db,req.callCenterContext,req.body))})));
  router.put('/extensions/credentials',wrap(async(req,res)=>res.json({success:true,data:await withDb(db=>extensions.rotateEndpointCredential(db,req.callCenterContext,req.body))})));
  router.get('/queues',wrap(async(req,res)=>res.json({success:true,data:await withDb(db=>queues.list(db,req.callCenterContext))})));
  router.post('/webrtc-config',wrap(async(req,res)=>res.json({success:true,data:await withDb(db=>asteriskConfig.ownBrowserEndpoint(db,req.callCenterContext))})));
  router.post('/sip-config',wrap(async(req,res)=>res.json({success:true,data:await withDb(db=>asteriskConfig.ownMobileEndpoint(db,req.callCenterContext))})));
  router.put('/queues',wrap(async(req,res)=>res.json({success:true,data:await withDb(db=>queues.save(db,req.callCenterContext,req.body))})));
  router.post('/calls',wrap(async(req,res)=>{
    const access=decision(req.callCenterContext,{capability:'telephony.call-center',permission:'calls.control'});
    if(!access.allowed)throw Object.assign(new Error(access.code),{code:access.code});
    const result=await new AsteriskCallControl({pool}).originateOutbound(req.callCenterContext,req.body);
    res.status(202).json({success:true,data:result});
  }));
  router.get('/calls',wrap(async(req,res)=>{
    const context=req.callCenterContext;
    const access=decision(context,{capability:'telephony.call-center',permission:'calls.read'});
    if(!access.allowed)throw Object.assign(new Error(access.code),{code:access.code});
    const rows=await withDb(async db=>{
      const [items]=await db.query(`SELECT c.id,c.direction,c.status,c.gateway_channel_no AS gatewayChannelNo,
          q.queue_name AS queueName,c.started_at AS startedAt,c.answered_at AS answeredAt,c.ended_at AS endedAt,
          IF(c.answered_at IS NULL,NULL,IF(c.ended_at IS NULL,TIMESTAMPDIFF(SECOND,c.answered_at,UTC_TIMESTAMP(3)),c.duration_seconds)) AS durationSeconds,
          c.answered_by_membership_id AS answeredByMembershipId
        FROM sx_telephony_calls c LEFT JOIN sx_telephony_queues q ON q.tenant_id=c.tenant_id AND q.id=c.inbound_queue_id
        WHERE c.tenant_id=? AND (?=0 OR c.started_by_membership_id=? OR c.answered_by_membership_id=? OR EXISTS(
          SELECT 1 FROM sx_telephony_queue_members qm WHERE qm.tenant_id=c.tenant_id AND qm.queue_id=c.inbound_queue_id AND qm.membership_id=?))
        ORDER BY c.started_at DESC,c.id DESC LIMIT 100`,[context.tenant.id,access.scope==='assigned'?1:0,
        context.membership.id,context.membership.id,context.membership.id]);
      return items.map(row=>({callId:row.id,direction:row.direction,status:row.status,gatewayChannelNo:Number(row.gatewayChannelNo),
        queueName:row.queueName||'',startedAt:row.startedAt,answeredAt:row.answeredAt,endedAt:row.endedAt,
        durationSeconds:row.durationSeconds===null?null:Number(row.durationSeconds),answeredByMembershipId:row.answeredByMembershipId||null,
        canControl:context.membership.role==='owner'||context.membership.role==='manager'||row.answeredByMembershipId===context.membership.id}));
    });
    res.json({success:true,data:{items:rows,hasMore:rows.length===100}});
  }));
  router.get('/status',wrap(async(req,res)=>{
    const context=req.callCenterContext;
    const decisionResult=decision(context,{capability:'telephony.call-center',permission:'calls.read'});
    if(!decisionResult.allowed)throw Object.assign(new Error(decisionResult.code),{code:decisionResult.code});
    const callControlAccess=decision(context,{capability:'telephony.call-center',permission:'calls.control'});
    const [[pbx]]=await withDb(db=>db.query(`SELECT enabled,ari_base_url,ari_username,gateway_host,gateway_sip_port,gateway_sip_transport,gateway_endpoint_status,gateway_endpoint_tested_at,credential_ciphertext,revision,last_tested_at,last_test_status,last_test_version
      FROM sx_platform_asterisk_config WHERE id=1`));
    const [[eventRuntime]]=await withDb(db=>db.query(`SELECT status,updated_at,
        (status='connected' AND updated_at>=UTC_TIMESTAMP(3)-INTERVAL 15 SECOND) AS heartbeat_fresh
      FROM sx_platform_asterisk_runtime WHERE id=1`));
    const [[portPolicy]]=await withDb(db=>db.query(`SELECT COUNT(*) AS assignedChannels,
      COALESCE(SUM(enabled=1),0) AS enabledChannels,COALESCE(SUM(enabled=1 AND inbound_enabled=1),0) AS inboundChannels,
      COALESCE(SUM(enabled=1 AND outbound_enabled=1),0) AS outboundChannels
      FROM sx_platform_asterisk_gateway_ports WHERE tenant_id=?`,[context.tenant.id]));
    const configured=!!(pbx?.ari_base_url&&pbx?.ari_username&&pbx?.credential_ciphertext);
    const extension=await withDb(db=>extensions.own(db,context));
    const provisioned=extension.assigned&&!!pbx?.enabled?await withDb(async db=>{
      const [rows]=await db.query(`SELECT client_type FROM sx_telephony_endpoint_provisioning
        WHERE tenant_id=? AND membership_id=? AND extension=? AND extension_revision=? AND asterisk_config_revision=?
          AND ((client_type='mobile' AND credential_revision=?) OR (client_type='browser' AND credential_revision=?))`,
      [context.tenant.id,context.membership.id,extension.extension,extension.revision,Number(pbx.revision),extension.mobileCredentialRevision,extension.browserCredentialRevision]);
      return new Set(rows.map(row=>row.client_type));
    }):new Set();
    res.json({success:true,data:{
      tenantId:context.tenant.id,
      membershipRole:context.membership.role,
      asterisk:{configured,enabled:!!pbx?.enabled,revision:configured?Number(pbx.revision):0,health:configured?pbx.last_test_status||'unknown':'not_configured',lastTestedAt:pbx.last_tested_at||null,version:pbx.last_test_version||null,
        events:{status:eventRuntime?.status||'not_started',ready:Number(eventRuntime?.heartbeat_fresh)===1,lastHeartbeatAt:eventRuntime?.updated_at||null}},
      gateway:{model:'DINSTAR UC2000-VE',channelCapacity:4,settingsConfigured:!!pbx?.gateway_host,
        endpointStatus:pbx?.gateway_endpoint_status||'not_tested',endpointTestedAt:pbx?.gateway_endpoint_tested_at||null,
        provisioned:['online','offline'].includes(pbx?.gateway_endpoint_status),
        channelPolicy:{assignedChannels:Number(portPolicy.assignedChannels),enabledChannels:Number(portPolicy.enabledChannels),inboundChannels:Number(portPolicy.inboundChannels),outboundChannels:Number(portPolicy.outboundChannels)}},
      calls:{inboundAvailable:false,outboundAvailable:false,reason:Number(eventRuntime?.heartbeat_fresh)===1?'CALL_ROUTING_NOT_PROVISIONED':'ASTERISK_EVENTS_NOT_READY'},
      clients:{
        mobileSip:{ready:false,provisioned:provisioned.has('mobile'),reason:provisioned.has('mobile')?null:'SIP_ENDPOINT_NOT_PROVISIONED'},
        browserWebRtc:{ready:false,provisioned:provisioned.has('browser'),reason:provisioned.has('browser')?null:'WEBRTC_ENDPOINT_NOT_PROVISIONED'},
      },
      member:{extension:extension.extension,extensionAssigned:extension.assigned,extensionProvisioned:provisioned.size>0},
      permissions:{manageExtensions:['owner','manager'].includes(context.membership.role),controlCalls:callControlAccess.allowed},
      feature:{enabled:true,scope:decisionResult.scope}
    }});
  }));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'CALL_CENTER_UNAVAILABLE';
    const status=code==='PERMISSION_DENIED'?403:['FEATURE_UNAVAILABLE','CATEGORY_UNAVAILABLE','ACCOUNT_INACTIVE'].includes(code)?409
      :['TEAM_MEMBER_NOT_FOUND','TELEPHONY_QUEUE_NOT_FOUND','SIP_ENDPOINT_NOT_PROVISIONED'].includes(code)?404:['OUTBOUND_CHANNEL_UNAVAILABLE','OUTBOUND_EXTENSION_NOT_READY','OUTBOUND_TENANT_NOT_ELIGIBLE','ASTERISK_CONTROL_NOT_READY','ASTERISK_EVENTS_NOT_READY','ASTERISK_CONFIG_CHANGED','GATEWAY_ENDPOINT_NOT_READY','STALE_ENDPOINT_CREDENTIAL'].includes(code)?409:['STALE_EXTENSION_ASSIGNMENT','EXTENSION_ALREADY_ASSIGNED','STALE_TELEPHONY_QUEUE','TELEPHONY_QUEUE_NAME_EXISTS','TELEPHONY_QUEUE_MEMBER_EXTENSION_REQUIRED','TELEPHONY_QUEUE_MEMBERS_REQUIRED','EXTENSION_QUEUE_MUST_BE_DISABLED','TELEPHONY_QUEUE_INBOUND_CHANNELS_ACTIVE'].includes(code)?409
        :code.startsWith('INVALID_')?400:503;
    const finalStatus=error.type==='entity.too.large'?413:error.type==='entity.parse.failed'?400:status;
    res.status(finalStatus).json({success:false,code:finalStatus>=500?'CALL_CENTER_UNAVAILABLE':error.type==='entity.too.large'?'BODY_TOO_LARGE':error.type==='entity.parse.failed'?'INVALID_JSON':code});
  });
  return router;
}

module.exports={createCallCenterRouter};
