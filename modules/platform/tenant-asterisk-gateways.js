'use strict';

const crypto=require('node:crypto');
const net=require('node:net');
const {platformDecision}=require('./policy');
const shared=require('./asterisk-gateway-ports');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function authorize(context){if(!platformDecision(context,'telephony.configure'))fail('PERMISSION_DENIED');}
async function tenantForLegacyUser(db,context,userId){
  authorize(context);
  if(!/^\d{1,10}$/.test(String(userId||'')))fail('INVALID_BUSINESS_USER');
  const [[link]]=await db.query(`SELECT o.tenant_id AS tenantId,o.membership_id AS membershipId,t.name,t.status,t.category_key AS categoryKey,
      t.category_version AS categoryVersion,p.managed_by_identity_id AS portfolioOwner
    FROM sx_legacy_ownership o JOIN sx_tenants t ON t.id=o.tenant_id
    JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='owner'
    LEFT JOIN sx_platform_user_portfolios p ON p.legacy_user_id=CAST(o.source_id AS UNSIGNED)
    WHERE o.source_table='user' AND o.source_id=? AND m.status='active' LIMIT 1`,[String(userId)]);
  if(!link)fail('VERIFIED_BUSINESS_LINK_REQUIRED');
  if(context.membership?.role!=='super_admin'&&link.portfolioOwner!==context.identity.id)fail('TENANT_PORTFOLIO_FORBIDDEN');
  return link;
}
function host(value){
  if(typeof value!=='string'||value.length>253||value!==value.trim())fail('INVALID_GATEWAY_IP');
  const version=net.isIP(value);if(!version)fail('INVALID_GATEWAY_IP');
  if(version===4){const p=value.split('.').map(Number),a=p[0],b=p[1];
    if(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===0||b===168))
      ||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0)|| (a===100&&b>=64&&b<=127))fail('INVALID_GATEWAY_IP');
  }else{
    const normalized=value.toLowerCase();
    if(!/^[23]/.test(normalized)||normalized.startsWith('2001:db8:')||normalized.startsWith('2001:0db8:'))fail('INVALID_GATEWAY_IP');
  }
  return value;
}
function present(row,channels){return {configured:!!row,gateway:row?{id:row.id,name:row.gateway_name,host:row.gateway_host,port:Number(row.gateway_sip_port),transport:row.gateway_sip_transport,
  enabled:!!row.enabled,connectionStatus:row.connection_status,revision:Number(row.revision),updatedAt:row.updated_at}:null,
  channels:channels.map(c=>({channelNo:Number(c.channel_no),enabled:!!c.enabled,inboundEnabled:!!c.inbound_enabled,outboundEnabled:!!c.outbound_enabled,
    inboundDid:c.inbound_did||'',inboundQueueId:c.inbound_queue_id||'',inboundQueueName:c.queue_name||'',revision:Number(c.revision)})),
  callReadiness:row?.enabled&&row?.connection_status==='online'&&channels.some(c=>c.enabled)?'ready':'needs_attention',
  callReadinessReason:!row?'TENANT_GATEWAY_NOT_CONFIGURED':!row.enabled?'TENANT_GATEWAY_NOT_ENABLED':row.connection_status!=='online'?'GATEWAY_ENDPOINT_NOT_READY':!channels.some(c=>c.enabled)?'GATEWAY_CHANNELS_NOT_ENABLED':null};}
async function read(db,context,userId){
  const tenant=await tenantForLegacyUser(db,context,userId);
  const [[gateway]]=await db.query('SELECT id,gateway_name,gateway_host,gateway_sip_port,gateway_sip_transport,enabled,connection_status,revision,updated_at FROM sx_telephony_gateways WHERE tenant_id=?',[tenant.tenantId]);
  const channels=gateway?(await db.query(`SELECT c.channel_no,c.enabled,c.inbound_enabled,c.outbound_enabled,c.inbound_did,c.inbound_queue_id,c.revision,q.queue_name
    FROM sx_telephony_gateway_channels c LEFT JOIN sx_telephony_queues q ON q.tenant_id=c.tenant_id AND q.id=c.inbound_queue_id
    WHERE c.tenant_id=? AND c.gateway_id=? ORDER BY c.channel_no`,[tenant.tenantId,gateway.id]))[0]:[];
  return {tenant:{id:tenant.tenantId,name:tenant.name,eligible:await shared.eligible(db,{id:tenant.tenantId,status:tenant.status,category_key:tenant.categoryKey,category_version:tenant.categoryVersion})},...present(gateway,channels)};
}
async function queues(db,context,userId){const tenant=await tenantForLegacyUser(db,context,userId);return shared.listQueues(db,context,tenant.tenantId);}
async function statuses(db,context,userIds){
  authorize(context);
  if(!Array.isArray(userIds)||userIds.length>100||userIds.some(id=>!/^\d{1,10}$/.test(String(id))))fail('INVALID_BUSINESS_USER_LIST');
  if(!userIds.length)return [];
  const [rows]=await db.query(`SELECT CAST(o.source_id AS UNSIGNED) AS userId,o.tenant_id AS tenantId,
      g.id AS gatewayId,g.enabled AS gatewayEnabled,g.connection_status AS connectionStatus,
      (SELECT COUNT(*) FROM sx_telephony_gateway_channels c WHERE c.tenant_id=o.tenant_id AND c.gateway_id=g.id AND c.enabled=1) AS readyChannels,
      p.managed_by_identity_id AS portfolioOwner
    FROM sx_legacy_ownership o JOIN sx_tenants t ON t.id=o.tenant_id
    JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='owner' AND m.status='active'
    LEFT JOIN sx_telephony_gateways g ON g.tenant_id=o.tenant_id
    LEFT JOIN sx_platform_user_portfolios p ON p.legacy_user_id=CAST(o.source_id AS UNSIGNED)
    WHERE o.source_table='user' AND o.source_id IN (${userIds.map(()=>'?').join(',')})`,userIds.map(String));
  const results=[];
  for(const row of rows){
    if(context.membership?.role!=='super_admin'&&row.portfolioOwner!==context.identity.id)continue;
    results.push({userId:Number(row.userId),status:!row.gatewayId?'not_configured':row.gatewayEnabled&&row.connectionStatus==='online'&&Number(row.readyChannels)>0?'ready':'needs_attention'});
  }
  return results;
}
async function save(db,context,userId,input){
  const tenant=await tenantForLegacyUser(db,context,userId);
  if(!(await shared.eligible(db,{id:tenant.tenantId,status:tenant.status,category_key:tenant.categoryKey,category_version:tenant.categoryVersion})))fail('TENANT_TELEPHONY_UNAVAILABLE');
  if(!input||typeof input!=='object'||Array.isArray(input)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('INVALID_GATEWAY_CONFIG');
  const gatewayName=input.name===undefined?'Dinstar UC2000-VE':input.name;
  if(typeof gatewayName!=='string'||gatewayName.trim()!==gatewayName||gatewayName.length<2||gatewayName.length>120)fail('INVALID_GATEWAY_CONFIG');
  const gatewayHost=host(input.host),port=input.port===undefined?5061:Number(input.port);
  if(!Number.isInteger(port)||port<1||port>65535)fail('INVALID_GATEWAY_PORT');
  if(input.transport!=='tls')fail('INSECURE_GATEWAY_TRANSPORT');
  const channels=input.channels;
  if(!Array.isArray(channels)||channels.length!==4)fail('INVALID_GATEWAY_CHANNELS');
  const seen=new Set();
  for(const c of channels){
    if(!c||!Number.isInteger(c.channelNo)||c.channelNo<1||c.channelNo>4||seen.has(c.channelNo)||!Number.isSafeInteger(c.expectedRevision)||c.expectedRevision<0
      ||typeof c.enabled!=='boolean'||typeof c.inboundEnabled!=='boolean'||typeof c.outboundEnabled!=='boolean')fail('INVALID_GATEWAY_CHANNEL');
    if(!c.enabled&&(c.inboundEnabled||c.outboundEnabled))fail('INVALID_GATEWAY_CHANNEL_POLICY');
    if(c.inboundEnabled&&(!/^\+[1-9][0-9]{7,14}$/.test(c.inboundDid||'')||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(c.inboundQueueId||'')))fail('GATEWAY_DID_AND_QUEUE_REQUIRED');
    seen.add(c.channelNo);
  }
  const id=crypto.randomUUID();await db.beginTransaction();
  try{
    const [[old]]=await db.query('SELECT id,revision FROM sx_telephony_gateways WHERE tenant_id=? FOR UPDATE',[tenant.tenantId]);
    if(Number(old?.revision||0)!==input.expectedRevision)fail('STALE_GATEWAY_REVISION');
    const gatewayId=old?.id||id,revision=input.expectedRevision+1;
    if(old)await db.query(`UPDATE sx_telephony_gateways SET gateway_name=?,gateway_host=?,gateway_sip_port=?,gateway_sip_transport='tls',enabled=?,connection_status='not_tested',revision=?,configured_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`,[gatewayName,gatewayHost,port,input.enabled?1:0,revision,context.identity.id,gatewayId]);
    else await db.query(`INSERT INTO sx_telephony_gateways(id,tenant_id,gateway_name,gateway_host,gateway_sip_port,gateway_sip_transport,enabled,connection_status,revision,configured_by_identity_id) VALUES(?,?,?,?,?,'tls',?,'not_tested',?,?)`,[gatewayId,tenant.tenantId,gatewayName,gatewayHost,port,input.enabled?1:0,revision,context.identity.id]);
    for(const channel of channels){
      const [[current]]=await db.query('SELECT revision,enabled,inbound_enabled,outbound_enabled,inbound_did,inbound_queue_id FROM sx_telephony_gateway_channels WHERE tenant_id=? AND gateway_id=? AND channel_no=? FOR UPDATE',[tenant.tenantId,gatewayId,channel.channelNo]);
      if(Number(current?.revision||0)!==channel.expectedRevision)fail('STALE_GATEWAY_CHANNEL_REVISION');
      const did=channel.inboundDid||null,queueId=channel.inboundQueueId||null;
      if(channel.inboundQueueId){const [[queue]]=await db.query('SELECT enabled FROM sx_telephony_queues WHERE tenant_id=? AND id=? FOR UPDATE',[tenant.tenantId,channel.inboundQueueId]);if(!queue)fail('GATEWAY_QUEUE_TENANT_MISMATCH');if(channel.inboundEnabled&&!queue.enabled)fail('GATEWAY_QUEUE_DISABLED');}
      const before=current&&[!!current.enabled,!!current.inbound_enabled,!!current.outbound_enabled,current.inbound_did||null,current.inbound_queue_id||null];
      const after=[channel.enabled,channel.inboundEnabled,channel.outboundEnabled,did,queueId];
      const routingChanged=before&&(before[3]!==did||before[4]!==queueId);
      if(routingChanged&&(before[0]||channel.enabled))fail('GATEWAY_CHANNEL_MUST_BE_DISABLED_FOR_REASSIGNMENT');
      if(current&&(before[0]!==channel.enabled||before[1]!==channel.inboundEnabled||before[2]!==channel.outboundEnabled||routingChanged)){
        const [[active]]=await db.query(`SELECT id FROM sx_telephony_calls WHERE tenant_id=? AND gateway_id=? AND gateway_channel_no=? AND status IN ('starting','ringing','connected') LIMIT 1 FOR UPDATE`,[tenant.tenantId,gatewayId,channel.channelNo]);
        if(active)fail('GATEWAY_CHANNEL_CALL_ACTIVE');
      }
      if(current)await db.query(`UPDATE sx_telephony_gateway_channels SET enabled=?,inbound_enabled=?,outbound_enabled=?,inbound_did=?,inbound_queue_id=?,revision=revision+1,updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND gateway_id=? AND channel_no=?`,[channel.enabled?1:0,channel.inboundEnabled?1:0,channel.outboundEnabled?1:0,did,queueId,context.identity.id,tenant.tenantId,gatewayId,channel.channelNo]);
      else await db.query(`INSERT INTO sx_telephony_gateway_channels(tenant_id,gateway_id,channel_no,enabled,inbound_enabled,outbound_enabled,inbound_did,inbound_queue_id,revision,updated_by_identity_id,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,UTC_TIMESTAMP(3))`,[tenant.tenantId,gatewayId,channel.channelNo,channel.enabled?1:0,channel.inboundEnabled?1:0,channel.outboundEnabled?1:0,did,queueId,context.identity.id]);
    }
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES(?,?,?,'identity','telephony.tenant-gateway-configured','telephony-gateway',?,?,?)`,[crypto.randomUUID(),tenant.tenantId,context.identity.id,gatewayId,JSON.stringify({host:gatewayHost,port,transport:'tls',enabled:!!input.enabled,revision,channels:channels.map(c=>({channelNo:c.channelNo,enabled:c.enabled,inboundEnabled:c.inboundEnabled,outboundEnabled:c.outboundEnabled,inboundDid:c.inboundDid||null,inboundQueueId:c.inboundQueueId||null}))}),crypto.randomUUID()]);
    await db.commit();return read(db,context,userId);
  }catch(error){try{await db.rollback();}catch{}if(error.code==='ER_DUP_ENTRY')fail('GATEWAY_DID_ALREADY_ASSIGNED');throw error;}
}

async function applyPeer(db,context,userId,clientFactory){
  const tenant=await tenantForLegacyUser(db,context,userId);
  let gateway=null,correlationId=crypto.randomUUID();
  await db.beginTransaction();
  try{
    const [[stored]]=await db.query(`SELECT id,gateway_host,gateway_sip_port,gateway_sip_transport,enabled,revision,connection_status
      FROM sx_telephony_gateways WHERE tenant_id=? FOR UPDATE`,[tenant.tenantId]);
    gateway=stored;
    if(!gateway||!gateway.enabled)fail('TENANT_GATEWAY_NOT_ENABLED');
    const [[pbx]]=await db.query(`SELECT ari_base_url,ari_username,credential_ciphertext,credential_iv,credential_auth_tag,enabled,revision,last_test_status
      FROM sx_platform_asterisk_config WHERE id=1`);
    if(!pbx?.enabled)fail('ASTERISK_CONTROL_NOT_READY');
    if(pbx.last_test_status!=='success')fail('ASTERISK_CONNECTION_TEST_REQUIRED');
    const suffix=String(gateway.id).replace(/-/g,'').toLowerCase();
    const endpoint=`salemax_gw_${suffix}`,aor=`${endpoint}_aor`,identify=`${endpoint}_identify`;
    const hostUri=net.isIP(gateway.gateway_host)===6?`[${gateway.gateway_host}]`:gateway.gateway_host;
    const client=await(clientFactory||((connection,config)=>require('./asterisk-ari-client').createAriClient(config,{pool:connection})))(db,pbx);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES(?,?,?,'identity','telephony.gateway-peer-apply-requested','telephony-gateway',?,?,?)`,[crypto.randomUUID(),tenant.tenantId,context.identity.id,gateway.id,JSON.stringify({host:gateway.gateway_host,port:Number(gateway.gateway_sip_port),revision:Number(gateway.revision)}),correlationId]);
    await client.upsertPjsipObject('aor',aor,[{attribute:'contact',value:`sips:${hostUri}:${gateway.gateway_sip_port}`},{attribute:'qualify_frequency',value:'30'}]);
    await client.upsertPjsipObject('endpoint',endpoint,[{attribute:'context',value:'from-dinstar-unrouted'},{attribute:'disallow',value:'all'},{attribute:'allow',value:'alaw,ulaw'},
      {attribute:'transport',value:'transport-salemax-tls'},{attribute:'media_encryption',value:'sdes'},{attribute:'media_encryption_optimistic',value:'no'},
      {attribute:'aors',value:aor},{attribute:'direct_media',value:'no'},{attribute:'rtp_symmetric',value:'yes'},{attribute:'force_rport',value:'yes'},{attribute:'rewrite_contact',value:'yes'}]);
    await client.upsertPjsipObject('identify',identify,[{attribute:'endpoint',value:endpoint},{attribute:'match',value:gateway.gateway_host}]);
    const status=await client.endpointState(endpoint);
    const [updated]=await db.query(`UPDATE sx_telephony_gateways SET connection_status=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND revision=?`,[status==='online'?'online':'offline',tenant.tenantId,gateway.id,gateway.revision]);
    if(updated.affectedRows!==1)fail('STALE_GATEWAY_REVISION');
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES(?,?,?,'identity','telephony.gateway-peer-applied','telephony-gateway',?,?,?)`,[crypto.randomUUID(),tenant.tenantId,context.identity.id,gateway.id,JSON.stringify({objects:3,endpointState:status}),correlationId]);
    await db.commit();
    return {applied:true,endpoint,status:status==='online'?'online':'offline',callsReady:status==='online',note:'PJSIP objects were applied through ARI. Calling still requires tenant DID/channel mappings, verified gateway network reachability, loaded Asterisk modules, and a successful media/call check.'};
  }catch(error){
    try{await db.rollback();}catch{}
    if(gateway?.id){
      await db.query(`UPDATE sx_telephony_gateways SET connection_status='offline',updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND revision=?`,[tenant.tenantId,gateway.id,gateway.revision]);
      await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES(?,?,?,'identity','telephony.gateway-peer-apply-failed','telephony-gateway',?,?,?)`,[crypto.randomUUID(),tenant.tenantId,context.identity.id,gateway.id,JSON.stringify({failureCode:/^[A-Z0-9_]{2,80}$/.test(error.code||'')?error.code:'ARI_UNAVAILABLE'}),correlationId]);
    }
    throw error;
  }
}
module.exports={read,save,statuses,queues,applyPeer};
