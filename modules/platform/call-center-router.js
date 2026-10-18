'use strict';

const express=require('express');
const {decision}=require('./policy');
const courses=require('./training-courses');
const legacyPipelineActor=require('./legacy-pipeline-actor');
const extensions=require('./telephony-extensions');
const queues=require('./telephony-queues');
const {AsteriskCallControl}=require('./asterisk-call-control');
const asteriskConfig=require('./asterisk-config');
const asteriskSecrets=require('./asterisk-secrets');
const gatewayPorts=require('./asterisk-gateway-ports');
const callRecordings=require('./telephony-recordings');
const callCoaching=require('./telephony-call-coaching');
const {createTelephonyCallOutcomes}=require('./telephony-call-outcomes');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');

function parseCallCursor(value){
  if(value===undefined)return null;
  const fail=()=>{throw Object.assign(new Error('INVALID_CALL_CURSOR'),{code:'INVALID_CALL_CURSOR',status:400});};
  if(typeof value!=='string'||value.length>256)fail();
  let cursor;
  try{cursor=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch(_){fail();}
  if(!cursor||typeof cursor!=='object'||Array.isArray(cursor)||typeof cursor.startedAt!=='string'||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(cursor.startedAt)||
    Number.isNaN(Date.parse(cursor.startedAt.replace(' ','T')+'Z'))||
    typeof cursor.callId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.callId))fail();
  return cursor;
}
function shapeCallOutcome(value){
  if(typeof value!=='string'||value.length>10000)return null;
  let detail;try{detail=JSON.parse(value);}catch(_){return null;}
  const outcomes=new Set(['no_answer','connected','interested','not_interested','follow_up_scheduled','wrong_number','requested_call','sale_requested','do_not_call']);
  if(!detail||typeof detail!=='object'||!outcomes.has(detail.outcome))return null;
  return {outcome:detail.outcome,followUpRequired:detail.followUpRequired===true,
    nextFollowUpAt:typeof detail.nextFollowUpAt==='string'?detail.nextFollowUpAt:null,note:typeof detail.note==='string'?detail.note.slice(0,2000):''};
}

function createCallCenterRouter({pool,userGuard,canonicalGuard,origin,fetchImpl=globalThis.fetch}){
  const router=express.Router();
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const withDb=async fn=>{const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}};
  const callOutcomes=createTelephonyCallOutcomes(pool);
  router.use(express.json({limit:'16kb',strict:true}));
  router.use((req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      if(!origin||!require('./request-origin').matches(req,origin))return res.status(403).json({success:false,code:'ORIGIN_DENIED'});
      if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({success:false,code:'INVALID_BODY'});
    }
    next();
  });
  async function legacyContext(uid,userData){
    let context;
    if(userData){
      const actor=await legacyPipelineActor.resolve(pool,userData);
      if(actor?.denied)throw Object.assign(new Error(actor.code),{code:actor.code});
      if(actor?.categoryKey==='salemax_sales'&&actor.canonicalContext){context=actor.canonicalContext;context.timezone=actor.timezone||context.tenant.timezone||'Asia/Kolkata';}
    }
    if(!context)context=await courses.legacyOwnerContext(pool,uid);
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
      return userGuard(req,res,()=>(req.featureSession?.context?Promise.resolve(req.featureSession.context):legacyContext(req.decode.uid,req.decode.userData)).then(ctx=>{req.callCenterContext=ctx;next();}).catch(next));
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
  router.get('/recording-policy',wrap(async(req,res)=>res.json({success:true,data:await withDb(db=>callRecordings.getPolicy(db,req.callCenterContext))})));
  router.put('/recording-policy',wrap(async(req,res)=>res.json({success:true,data:await withDb(db=>callRecordings.savePolicy(db,req.callCenterContext,req.body))})));
  router.post('/calls',wrap(async(req,res)=>{
    const access=decision(req.callCenterContext,{capability:'telephony.call-center',permission:'calls.control'});
    if(!access.allowed)throw Object.assign(new Error(access.code),{code:access.code});
    const result=await new AsteriskCallControl({pool}).originateOutbound(req.callCenterContext,req.body);
    res.status(202).json({success:true,data:result});
  }));
  router.get('/calls/agents',wrap(async(req,res)=>{
    const context=req.callCenterContext;
    const access=decision(context,{capability:'telephony.call-center',permission:'calls.read'});
    if(context.tenant.categoryKey!=='salemax_sales'||!access.allowed||!['owner','manager','team_leader'].includes(context.membership.role))
      throw Object.assign(new Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED'});
    const agents=await withDb(async db=>{
      const role=context.membership.role;
      const scope=role==='owner'?'':role==='manager'?' AND EXISTS(SELECT 1 FROM sx_sales_org_history h WHERE h.tenant_id=m.tenant_id AND h.membership_id=m.id AND h.manager_membership_id=? AND h.ended_at IS NULL)':' AND EXISTS(SELECT 1 FROM sx_sales_org_history h WHERE h.tenant_id=m.tenant_id AND h.membership_id=m.id AND h.team_leader_membership_id=? AND h.ended_at IS NULL)';
      const args=[context.tenant.id,...(role==='owner'?[]:[context.membership.id])];
      const [rows]=await db.query(`SELECT m.id AS membershipId,i.display_name AS displayName
        FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
        WHERE m.tenant_id=? AND m.status='active' AND m.role='agent'${scope}
        ORDER BY i.display_name,m.id LIMIT 500`,args);
      return rows.map(row=>({membershipId:row.membershipId,displayName:row.displayName||'Sales Agent'}));
    });
    res.json({success:true,data:{agents}});
  }));
  router.get('/calls/:callId/recording',async(req,res,next)=>{
    try{
      const recording=await withDb(db=>callRecordings.openRecording(db,req.callCenterContext,req.params.callId));
      const client=await new AsteriskCallControl({pool}).client();
      const file=await client.getStoredRecordingFile(recording.recordingName);
      res.status(200);res.setHeader('Content-Type','audio/wav');res.setHeader('Content-Disposition','inline; filename="call-recording.wav"');
      res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');
      if(file.contentLength)res.setHeader('Content-Length',String(file.contentLength));
      let size=0;
      const limit=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>file.maxBytes)return callback(Object.assign(new Error('RECORDING_SIZE_LIMIT'),{code:'RECORDING_SIZE_LIMIT'}));callback(null,chunk);}});
      await pipeline(Readable.fromWeb(file.body),limit,res);
    }catch(error){if(res.headersSent){res.destroy(error);return;}next(error);}
  });
  router.get('/calls/:callId/coaching',wrap(async(req,res)=>res.json({success:true,data:await withDb(db=>callCoaching.list(db,req.callCenterContext,req.params.callId))})));
  router.post('/calls/:callId/coaching',wrap(async(req,res)=>res.status(201).json({success:true,data:await withDb(db=>callCoaching.create(db,req.callCenterContext,req.params.callId,req.body))})));
  router.post('/calls/:callId/lead-outcome',wrap(async(req,res)=>res.json({success:true,data:await withDb(db=>callOutcomes.log(db,req.callCenterContext,req.params.callId,req.body))})));
  router.post('/calls/:callId/end',wrap(async(req,res)=>{
    const result=await new AsteriskCallControl({pool}).endCall(req.callCenterContext,req.params.callId);
    res.json({success:true,data:result});
  }));
  router.get('/calls',wrap(async(req,res)=>{
    const context=req.callCenterContext;
    const access=decision(context,{capability:'telephony.call-center',permission:'calls.read'});
    if(!access.allowed)throw Object.assign(new Error(access.code),{code:access.code});
    const cursor=parseCallCursor(req.query.cursor);
    const recordedOnly=req.query.recordedOnly===undefined?'0':req.query.recordedOnly;
    const agentMembershipId=req.query.agentMembershipId;
    if(!['0','1'].includes(recordedOnly)||agentMembershipId!==undefined&&(typeof agentMembershipId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agentMembershipId)||context.tenant.categoryKey!=='salemax_sales'))throw Object.assign(new Error('INVALID_CALL_FILTER'),{code:'INVALID_CALL_FILTER',status:400});
    const cursorFilter=cursor?' AND (c.started_at < ? OR (c.started_at = ? AND c.id < ?))':'';
    const recordingFilter=recordedOnly==='1'?" AND r.state='ready' AND r.expires_at>UTC_TIMESTAMP(3)":'';
    const rows=await withDb(async db=>{
      const salesTeam=['manager','team_leader'].includes(context.membership.role)&&context.tenant.categoryKey==='salemax_sales';
      let teamMembershipIds=[];
      if(salesTeam){
        const teamColumn=context.membership.role==='manager'?'manager_membership_id':'team_leader_membership_id';
        const [members]=await db.query(`SELECT id AS membershipId FROM sx_memberships WHERE tenant_id=? AND id=? AND status='active'
          UNION SELECT h.membership_id AS membershipId FROM sx_sales_org_history h
            JOIN sx_memberships m ON m.tenant_id=h.tenant_id AND m.id=h.membership_id AND m.status='active'
          WHERE h.tenant_id=? AND h.${teamColumn}=? AND h.ended_at IS NULL`,
        [context.tenant.id,context.membership.id,context.tenant.id,context.membership.id]);
        teamMembershipIds=[...new Set(members.map(row=>row.membershipId))];
      }
      const teamFilter=salesTeam?(teamMembershipIds.length?` AND (c.started_by_membership_id IN (?) OR c.answered_by_membership_id IN (?) OR EXISTS(
        SELECT 1 FROM sx_telephony_call_legs scoped_leg WHERE scoped_leg.tenant_id=c.tenant_id AND scoped_leg.call_id=c.id AND scoped_leg.membership_id IN (?)))`:' AND 1=0'):'';
      let agentFilter='',agentFilterArgs=[];
      if(agentMembershipId!==undefined){
        if(!['owner','manager','team_leader'].includes(context.membership.role)||salesTeam&&!teamMembershipIds.includes(agentMembershipId))throw Object.assign(new Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED'});
        const [[agent]]=await db.query(`SELECT id FROM sx_memberships WHERE tenant_id=? AND id=? AND role='agent' AND status='active'`,[context.tenant.id,agentMembershipId]);
        if(!agent)throw Object.assign(new Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED'});
        agentFilter=` AND (c.started_by_membership_id=? OR c.answered_by_membership_id=? OR EXISTS(
          SELECT 1 FROM sx_telephony_call_legs selected_leg WHERE selected_leg.tenant_id=c.tenant_id AND selected_leg.call_id=c.id AND selected_leg.membership_id=?))`;
        agentFilterArgs=[agentMembershipId,agentMembershipId,agentMembershipId];
      }
      const outcomeSelect=context.tenant.categoryKey==='salemax_sales'?`(SELECT pa.details FROM pipeline_activity pa WHERE c.lead_uid_hash IS NOT NULL AND pa.uid_hash=c.lead_uid_hash
        AND pa.lead_id=c.lead_id AND pa.activity_type='contact_outcome'
        AND (CASE WHEN JSON_VALID(pa.details) THEN JSON_UNQUOTE(JSON_EXTRACT(pa.details,'$.sourceCallId')) ELSE NULL END)=c.id
        ORDER BY pa.created_at DESC,pa.id DESC LIMIT 1) AS callOutcomeDetails`:'NULL AS callOutcomeDetails';
      const [items]=await db.query(`SELECT c.id,c.direction,c.status,c.lead_id AS leadId,c.gateway_channel_no AS gatewayChannelNo,
          q.queue_name AS queueName,c.started_at AS startedAt,c.answered_at AS answeredAt,c.ended_at AS endedAt,
          DATE_FORMAT(c.started_at,'%Y-%m-%d %H:%i:%s.%f') AS cursorStartedAt,
          IF(c.answered_at IS NULL,NULL,IF(c.ended_at IS NULL,TIMESTAMPDIFF(SECOND,c.answered_at,UTC_TIMESTAMP(3)),c.duration_seconds)) AS durationSeconds,
          c.answered_by_membership_id AS answeredByMembershipId,c.started_by_membership_id AS startedByMembershipId,
          answered_identity.display_name AS answeredByName,answered_member.role AS answeredByRole,
          started_identity.display_name AS startedByName,started_member.role AS startedByRole,
          r.state AS recordingState,r.expires_at AS recordingExpiresAt,
          ${outcomeSelect},
          EXISTS(SELECT 1 FROM sx_telephony_call_legs l WHERE l.tenant_id=c.tenant_id AND l.call_id=c.id AND l.membership_id=?
            AND l.status IN ('originating','ringing','connected')) AS hasAssignedActiveLeg
        FROM sx_telephony_calls c LEFT JOIN sx_telephony_queues q ON q.tenant_id=c.tenant_id AND q.id=c.inbound_queue_id
        LEFT JOIN sx_memberships answered_member ON answered_member.tenant_id=c.tenant_id AND answered_member.id=c.answered_by_membership_id
        LEFT JOIN sx_identities answered_identity ON answered_identity.id=answered_member.identity_id
        LEFT JOIN sx_memberships started_member ON started_member.tenant_id=c.tenant_id AND started_member.id=c.started_by_membership_id
        LEFT JOIN sx_identities started_identity ON started_identity.id=started_member.identity_id
        LEFT JOIN sx_telephony_call_recordings r ON r.tenant_id=c.tenant_id AND r.call_id=c.id
        WHERE c.tenant_id=? AND (?=0 OR c.started_by_membership_id=? OR c.answered_by_membership_id=? OR EXISTS(
          SELECT 1 FROM sx_telephony_queue_members qm WHERE qm.tenant_id=c.tenant_id AND qm.queue_id=c.inbound_queue_id AND qm.membership_id=?))
          ${cursorFilter}${teamFilter}${recordingFilter}${agentFilter}
        ORDER BY c.started_at DESC,c.id DESC LIMIT 101`,[context.membership.id,context.tenant.id,access.scope==='assigned'?1:0,
        context.membership.id,context.membership.id,context.membership.id,...(cursor?[cursor.startedAt,cursor.startedAt,cursor.callId]:[]),
        ...(salesTeam&&teamMembershipIds.length?[teamMembershipIds,teamMembershipIds,teamMembershipIds]:[]),...agentFilterArgs]);
      const hasMore=items.length>100,page=items.slice(0,100),last=page[page.length-1];
      const nextCursor=hasMore&&last?Buffer.from(JSON.stringify({startedAt:last.cursorStartedAt,callId:last.id})).toString('base64url'):null;
      return {hasMore,nextCursor,items:page.map(row=>({callId:row.id,direction:row.direction,status:row.status,leadId:row.leadId||null,gatewayChannelNo:Number(row.gatewayChannelNo),
        queueName:row.queueName||'',startedAt:row.startedAt,answeredAt:row.answeredAt,endedAt:row.endedAt,
        durationSeconds:row.durationSeconds===null?null:Number(row.durationSeconds),answeredByMembershipId:row.answeredByMembershipId||null,
        answeredByName:row.answeredByName||'',answeredByRole:row.answeredByRole||'',startedByName:row.startedByName||'',startedByRole:row.startedByRole||'',
        outcome:shapeCallOutcome(row.callOutcomeDetails),
        recordingState:row.recordingState||'not_recorded',canListenRecording:row.recordingState==='ready'&&new Date(row.recordingExpiresAt).getTime()>Date.now()&&decision(context,{capability:'telephony.call-center',permission:'calls.recording.listen'}).allowed,
        canCoach:context.tenant.categoryKey==='salemax_sales'&&decision(context,{capability:'telephony.call-center',permission:'calls.coaching.write'}).allowed,
        canViewCoaching:context.tenant.categoryKey==='salemax_sales'&&decision(context,{capability:'telephony.call-center',permission:'calls.coaching.read'}).allowed,
        canControl:context.membership.role==='owner'||context.membership.role==='manager'||salesTeam||row.startedByMembershipId===context.membership.id
          ||row.answeredByMembershipId===context.membership.id||Number(row.hasAssignedActiveLeg)===1}))};
    });
    res.json({success:true,data:rows});
  }));
  router.get('/status',wrap(async(req,res)=>{
    const context=req.callCenterContext;
    const decisionResult=decision(context,{capability:'telephony.call-center',permission:'calls.read'});
    if(!decisionResult.allowed)throw Object.assign(new Error(decisionResult.code),{code:decisionResult.code});
    const callControlAccess=decision(context,{capability:'telephony.call-center',permission:'calls.control'});
    const [[tenantSettings]]=await withDb(db=>db.query('SELECT timezone FROM sx_tenants WHERE id=? LIMIT 1',[context.tenant.id]));
    const [[pbx]]=await withDb(db=>db.query(`SELECT enabled,ari_base_url,ari_username,gateway_host,gateway_sip_port,gateway_sip_transport,gateway_endpoint_status,gateway_endpoint_tested_at,credential_ciphertext,credential_iv,credential_auth_tag,revision,last_tested_at,last_test_status,last_test_version
      FROM sx_platform_asterisk_config WHERE id=1`));
    const [[eventRuntime]]=await withDb(db=>db.query(`SELECT status,updated_at,
        (status='connected' AND updated_at>=UTC_TIMESTAMP(3)-INTERVAL 15 SECOND) AS heartbeat_fresh
      FROM sx_platform_asterisk_runtime WHERE id=1`));
    const [[tenantGateway]]=await withDb(db=>db.query(`SELECT id,gateway_name,gateway_host,gateway_sip_port,gateway_sip_transport,enabled,connection_status,revision,updated_at
      FROM sx_telephony_gateways WHERE tenant_id=?`,[context.tenant.id]));
    const gatewayResource=tenantGateway?`salemax_gw_${String(tenantGateway.id).replace(/-/g,'').toLowerCase()}`:null;
    const [[portPolicy]]=await withDb(db=>db.query(`SELECT COUNT(*) AS assignedChannels,
      COALESCE(SUM(enabled=1),0) AS enabledChannels,COALESCE(SUM(enabled=1 AND inbound_enabled=1),0) AS inboundChannels,
      COALESCE(SUM(enabled=1 AND outbound_enabled=1),0) AS outboundChannels
      FROM sx_telephony_gateway_channels WHERE tenant_id=? AND gateway_id=?`,[context.tenant.id,tenantGateway?.id||null]));
    const configured=!!(pbx?.ari_base_url&&pbx?.ari_username&&pbx?.credential_ciphertext);
    const extension=await withDb(db=>extensions.own(db,context));
    const provisioned=extension.assigned&&!!pbx?.enabled?await withDb(async db=>{
      const [rows]=await db.query(`SELECT client_type FROM sx_telephony_endpoint_provisioning
        WHERE tenant_id=? AND membership_id=? AND extension=? AND extension_revision=? AND asterisk_config_revision=?
          AND ((client_type='mobile' AND credential_revision=?) OR (client_type='browser' AND credential_revision=?))`,
      [context.tenant.id,context.membership.id,extension.extension,extension.revision,Number(pbx.revision),extension.mobileCredentialRevision,extension.browserCredentialRevision]);
      return new Set(rows.map(row=>row.client_type));
    }):new Set();
    const tenantEligible=await withDb(db=>gatewayPorts.eligible(db,{id:context.tenant.id,status:context.tenant.status,
      category_key:context.tenant.categoryKey,category_version:context.tenant.categoryVersion}));
    const [[routeCounts]]=await withDb(db=>db.query(`SELECT
        (SELECT COUNT(*) FROM sx_telephony_gateway_channels p
          JOIN sx_tenants t ON t.id=p.tenant_id AND t.status='active'
          JOIN sx_telephony_queues q ON q.tenant_id=p.tenant_id AND q.id=p.inbound_queue_id AND q.enabled=1
          WHERE p.tenant_id=? AND p.gateway_id=? AND p.enabled=1 AND p.inbound_enabled=1 AND p.inbound_did REGEXP '^[+][1-9][0-9]{7,14}$') AS inbound_routes,
        (SELECT COUNT(*) FROM sx_telephony_gateway_channels p
          WHERE p.tenant_id=? AND p.gateway_id=? AND p.enabled=1 AND p.outbound_enabled=1 AND NOT EXISTS(
            SELECT 1 FROM sx_telephony_calls c WHERE c.gateway_id=p.gateway_id AND c.leased_channel_no=p.channel_no)) AS free_outbound_channels`,
      [context.tenant.id,tenantGateway?.id||null,context.tenant.id,tenantGateway?.id||null]));
    const inboundRouteCount=Number(routeCounts.inbound_routes||0),freeOutboundChannels=Number(routeCounts.free_outbound_channels||0);
    const inboundMembers=inboundRouteCount&&tenantEligible?await withDb(async db=>{
      const [rows]=await db.query(`SELECT DISTINCT x.extension FROM sx_telephony_gateway_channels p
        JOIN sx_telephony_queues q ON q.tenant_id=p.tenant_id AND q.id=p.inbound_queue_id AND q.enabled=1
        JOIN sx_telephony_queue_members qm ON qm.tenant_id=q.tenant_id AND qm.queue_id=q.id
        JOIN sx_memberships m ON m.tenant_id=qm.tenant_id AND m.id=qm.membership_id AND m.status='active'
        JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
        JOIN sx_telephony_extensions x ON x.tenant_id=m.tenant_id AND x.membership_id=m.id AND x.extension REGEXP '^[0-9]{3,8}$'
          WHERE p.tenant_id=? AND p.gateway_id=? AND p.enabled=1 AND p.inbound_enabled=1 AND p.inbound_did REGEXP '^[+][1-9][0-9]{7,14}$' AND m.role IN ('owner','manager','team_leader','agent')`,
      [context.tenant.id,tenantGateway?.id||null]);
      return rows.map(row=>String(row.extension));
    }):[];
    const endpointResources=[...(gatewayResource?[gatewayResource]:[]),...(extension.assigned?['mobile','browser'].map(type=>`salemax-${extension.extension}-${type}`):[]),
      ...inboundMembers.flatMap(ext=>['mobile','browser'].map(type=>`salemax-${ext}-${type}`))];
    let endpointStates={};
    if(pbx?.enabled&&Number(eventRuntime?.heartbeat_fresh)===1&&configured){
      try{endpointStates=await asteriskConfig.probePjsipEndpointStates(fetchImpl,pbx.ari_base_url,pbx.ari_username,asteriskSecrets.decrypt(pbx),endpointResources);}
      catch(_){endpointStates=Object.fromEntries([...new Set(endpointResources)].map(resource=>[resource,'unknown']));}
    }
    const gatewayLiveStatus=gatewayResource?(endpointStates[gatewayResource]||tenantGateway?.connection_status||'unknown'):'not_configured';
    const ownEndpointState=type=>extension.assigned?endpointStates[`salemax-${extension.extension}-${type}`]||'unknown':'not_provisioned';
    const inboundAgentReady=inboundMembers.some(ext=>['mobile','browser'].some(type=>endpointStates[`salemax-${ext}-${type}`]==='online'));
    const controlReady=!!pbx?.enabled&&Number(eventRuntime?.heartbeat_fresh)===1;
    const inboundAvailable=controlReady&&tenantEligible&&gatewayLiveStatus==='online'&&inboundRouteCount>0&&inboundAgentReady;
    const outboundAvailable=controlReady&&tenantEligible&&gatewayLiveStatus==='online'&&freeOutboundChannels>0&&extension.assigned
      &&['mobile','browser'].some(type=>ownEndpointState(type)==='online');
    const inboundReason=!controlReady?(pbx?.enabled?'ASTERISK_EVENTS_NOT_READY':'ASTERISK_CONTROL_NOT_READY')
      :!tenantEligible?'OUTBOUND_TENANT_NOT_ELIGIBLE':gatewayLiveStatus!=='online'?'GATEWAY_ENDPOINT_NOT_READY'
        :!inboundRouteCount?'INBOUND_ROUTE_NOT_READY':!inboundAgentReady?'INBOUND_QUEUE_ENDPOINT_NOT_REGISTERED':null;
    const outboundReason=!controlReady?(pbx?.enabled?'ASTERISK_EVENTS_NOT_READY':'ASTERISK_CONTROL_NOT_READY')
      :!tenantEligible?'OUTBOUND_TENANT_NOT_ELIGIBLE':gatewayLiveStatus!=='online'?'GATEWAY_ENDPOINT_NOT_READY'
        :!extension.assigned?'OUTBOUND_EXTENSION_NOT_READY':!freeOutboundChannels?'OUTBOUND_CHANNEL_UNAVAILABLE'
          :!['mobile','browser'].some(type=>ownEndpointState(type)==='online')?'AGENT_ENDPOINT_NOT_REGISTERED':null;
    res.json({success:true,data:{
      tenantId:context.tenant.id,
      categoryKey:context.tenant.categoryKey,
      timezone:tenantSettings?.timezone||context.timezone||context.tenant.timezone||'Asia/Qatar',
      membershipRole:context.membership.role,
      asterisk:{configured,enabled:!!pbx?.enabled,revision:configured?Number(pbx.revision):0,health:configured?pbx.last_test_status||'unknown':'not_configured',lastTestedAt:pbx.last_tested_at||null,version:pbx.last_test_version||null,
        events:{status:eventRuntime?.status||'not_started',ready:Number(eventRuntime?.heartbeat_fresh)===1,lastHeartbeatAt:eventRuntime?.updated_at||null}},
      gateway:{model:tenantGateway?.gateway_name||'DINSTAR UC2000-VE',channelCapacity:4,settingsConfigured:!!tenantGateway?.gateway_host,
        endpointStatus:tenantGateway?.connection_status||'not_configured',liveEndpointStatus:gatewayLiveStatus,endpointTestedAt:tenantGateway?.updated_at||null,
        provisioned:['online','offline'].includes(tenantGateway?.connection_status),
        channelPolicy:{assignedChannels:Number(portPolicy.assignedChannels),enabledChannels:Number(portPolicy.enabledChannels),inboundChannels:Number(portPolicy.inboundChannels),outboundChannels:Number(portPolicy.outboundChannels)}},
      calls:{inboundAvailable,outboundAvailable,inboundReason,outboundReason,reason:outboundReason||inboundReason||null,
        freeOutboundChannels,inboundRoutes:inboundRouteCount,registeredInboundEndpoints:inboundMembers.filter(ext=>['mobile','browser'].some(type=>endpointStates[`salemax-${ext}-${type}`]==='online')).length},
      clients:{
        mobileSip:{ready:ownEndpointState('mobile')==='online',registrationStatus:ownEndpointState('mobile'),provisioned:provisioned.has('mobile'),reason:!provisioned.has('mobile')?'SIP_ENDPOINT_NOT_PROVISIONED':ownEndpointState('mobile')!=='online'?'SIP_ENDPOINT_NOT_REGISTERED':null},
        browserWebRtc:{ready:ownEndpointState('browser')==='online',registrationStatus:ownEndpointState('browser'),provisioned:provisioned.has('browser'),reason:!provisioned.has('browser')?'WEBRTC_ENDPOINT_NOT_PROVISIONED':ownEndpointState('browser')!=='online'?'WEBRTC_ENDPOINT_NOT_REGISTERED':null},
      },
      member:{extension:extension.extension,extensionAssigned:extension.assigned,extensionProvisioned:provisioned.size>0},
      permissions:{manageExtensions:['owner','manager'].includes(context.membership.role),controlCalls:callControlAccess.allowed,
        manageRecordings:decision(context,{capability:'telephony.call-center',permission:'calls.recording.manage'}).allowed},
      feature:{enabled:true,scope:decisionResult.scope}
    }});
  }));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'CALL_CENTER_UNAVAILABLE';
    const status=['PERMISSION_DENIED','BUSINESS_LINK_INVALID'].includes(code)?403:['FEATURE_UNAVAILABLE','CATEGORY_UNAVAILABLE','ACCOUNT_INACTIVE'].includes(code)?409
      :['TEAM_MEMBER_NOT_FOUND','TELEPHONY_QUEUE_NOT_FOUND','SIP_ENDPOINT_NOT_PROVISIONED','CALL_NOT_FOUND','CALL_LEAD_NOT_LINKED'].includes(code)?404:code==='OUTBOUND_CALL_RATE_LIMITED'?429:['OUTBOUND_CALL_ALREADY_ACTIVE','OUTBOUND_CHANNEL_UNAVAILABLE','OUTBOUND_EXTENSION_NOT_READY','OUTBOUND_TENANT_NOT_ELIGIBLE','ASTERISK_CONTROL_NOT_READY','ASTERISK_EVENTS_NOT_READY','ASTERISK_CONFIG_CHANGED','GATEWAY_ENDPOINT_NOT_READY','STALE_ENDPOINT_CREDENTIAL','CALL_NOT_FINISHED','CALL_LEAD_DO_NOT_CALL'].includes(code)?409:['STALE_EXTENSION_ASSIGNMENT','EXTENSION_ALREADY_ASSIGNED','STALE_TELEPHONY_QUEUE','TELEPHONY_QUEUE_NAME_EXISTS','TELEPHONY_QUEUE_MEMBER_EXTENSION_REQUIRED','TELEPHONY_QUEUE_MEMBERS_REQUIRED','EXTENSION_QUEUE_MUST_BE_DISABLED','TELEPHONY_QUEUE_INBOUND_CHANNELS_ACTIVE'].includes(code)?409
        :['INVALID_COACHING_AGENT','INVALID_COACHING_QUALITY','INVALID_COACHING_FEEDBACK','INVALID_COACHING_ACTION','INVALID_COACHING_VISIBILITY','INVALID_CALL_ID','INVALID_CALL_OUTCOME'].includes(code)?400
        :code.startsWith('INVALID_')?400:503;
    const finalStatus=error.type==='entity.too.large'?413:error.type==='entity.parse.failed'?400:status;
    if(code==='OUTBOUND_CALL_RATE_LIMITED')res.setHeader('Retry-After','60');
    res.status(finalStatus).json({success:false,code:finalStatus>=500?'CALL_CENTER_UNAVAILABLE':error.type==='entity.too.large'?'BODY_TOO_LARGE':error.type==='entity.parse.failed'?'INVALID_JSON':code});
  });
  return router;
}

module.exports={createCallCenterRouter};
