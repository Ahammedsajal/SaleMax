'use strict';

require('dotenv').config({quiet:true});
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const mysql=require('mysql2/promise');
const plans=require('../modules/platform/plans');
const {trainingCenter}=require('../modules/platform/categories');
const queues=require('../modules/platform/telephony-queues');
const extensions=require('../modules/platform/telephony-extensions');
const gateway=require('../modules/platform/asterisk-gateway-ports');
const asteriskConfig=require('../modules/platform/asterisk-config');
const asteriskSecrets=require('../modules/platform/asterisk-secrets');
const {AsteriskCallControl}=require('../modules/platform/asterisk-call-control');

async function main(){
  if(process.env.LOCAL_ONLY_MODE!=='true'||!['127.0.0.1','localhost','::1'].includes(process.env.DBHOST))throw new Error('LOCAL_DATABASE_ONLY');
  const config={host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,
    password:process.env.DBPASS==='__EMPTY__'?'':process.env.DBPASS,...(process.env.SALEMAX_TEST_DB_SOCKET?{socketPath:process.env.SALEMAX_TEST_DB_SOCKET}:{})};
  const dbName=`salemax_telephony_test_${crypto.randomBytes(6).toString('hex')}`;
  const admin=await mysql.createConnection(config);let db,other,pool,created=false;
  const originalEntitlements=plans.loadEntitlements;
  const originalSipKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=crypto.randomBytes(32).toString('base64');
  try{
    await admin.query(`CREATE DATABASE \`${dbName}\``);created=true;
    db=await mysql.createConnection({...config,database:dbName});other=await mysql.createConnection({...config,database:dbName});pool=mysql.createPool({...config,database:dbName,connectionLimit:5});
    const [versionRows]=await db.query('SELECT VERSION() AS version');
    await db.query(`CREATE TABLE sx_tenants(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,slug VARCHAR(80) NOT NULL,name VARCHAR(120) NOT NULL,category_key VARCHAR(80) NOT NULL,category_version INT NOT NULL,status VARCHAR(20) NOT NULL) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE sx_identities(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,email_normalized VARCHAR(254) NOT NULL,display_name VARCHAR(120) NOT NULL,status VARCHAR(20) NOT NULL) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE sx_memberships(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,role VARCHAR(20) NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'active',PRIMARY KEY(id),UNIQUE KEY uq_test_membership_tenant_id(tenant_id,id),FOREIGN KEY(tenant_id) REFERENCES sx_tenants(id),FOREIGN KEY(identity_id) REFERENCES sx_identities(id)) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE sx_audit_events(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,actor_kind VARCHAR(24) NOT NULL,action VARCHAR(100) NOT NULL,resource_type VARCHAR(100) NOT NULL,resource_id VARCHAR(120) NOT NULL,changes JSON NOT NULL,correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,FOREIGN KEY(actor_identity_id) REFERENCES sx_identities(id),FOREIGN KEY(tenant_id) REFERENCES sx_tenants(id)) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE sx_platform_asterisk_config(id TINYINT UNSIGNED PRIMARY KEY,enabled TINYINT(1) NOT NULL DEFAULT 0,gateway_endpoint_status VARCHAR(20) NULL,
      gateway_host VARCHAR(253) NOT NULL DEFAULT '',gateway_sip_port SMALLINT UNSIGNED NOT NULL DEFAULT 5061,gateway_sip_transport VARCHAR(8) NOT NULL DEFAULT 'tls',
      ari_base_url VARCHAR(512) NOT NULL DEFAULT '',ari_username VARCHAR(128) NOT NULL DEFAULT '',credential_ciphertext VARBINARY(512) NULL,credential_iv BINARY(12) NULL,
      credential_auth_tag BINARY(16) NULL,revision BIGINT UNSIGNED NOT NULL DEFAULT 0,last_test_status VARCHAR(16) NULL) ENGINE=InnoDB`);
    await db.query('INSERT INTO sx_platform_asterisk_config(id) VALUES(1)');
    await db.query(`CREATE TABLE sx_platform_asterisk_gateway_ports(channel_no TINYINT UNSIGNED PRIMARY KEY,enabled TINYINT(1) NOT NULL DEFAULT 0,inbound_enabled TINYINT(1) NOT NULL DEFAULT 0,outbound_enabled TINYINT(1) NOT NULL DEFAULT 0,revision BIGINT UNSIGNED NOT NULL DEFAULT 0,updated_by_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,updated_at DATETIME(3) NULL,FOREIGN KEY(updated_by_identity_id) REFERENCES sx_identities(id)) ENGINE=InnoDB`);
    await db.query('INSERT INTO sx_platform_asterisk_gateway_ports(channel_no) VALUES(1),(2),(3),(4)');
    for(const name of ['20261106_tenant_telephony_extensions.sql','20261107_gateway_tenant_assignment.sql','20261108_telephony_queues.sql','20261109_gateway_inbound_queues.sql','20261110_asterisk_ari_runtime.sql','20261111_telephony_call_sessions.sql','20261112_asterisk_endpoint_credentials.sql']){
      const sql=fs.readFileSync(require('node:path').join(__dirname,'../database/migrations',name),'utf8');
      for(const statement of sql.split(';').map(part=>part.trim()).filter(Boolean))await db.query(statement);
    }
    const tenantId=crypto.randomUUID(),ownerId=crypto.randomUUID(),ownerMembership=crypto.randomUUID(),agentId=crypto.randomUUID(),agentMembership=crypto.randomUUID();
    await db.query(`INSERT INTO sx_tenants(id,slug,name,category_key,category_version,status) VALUES(?,?,?,'training_center',1,'active')`,[tenantId,'synthetic-telephony','Synthetic telephony']);
    await db.query(`INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES(?,?,?,'active'),(?,?,?,'active')`,[ownerId,'owner@example.invalid','Synthetic Owner',agentId,'agent@example.invalid','Synthetic Agent']);
    await db.query(`INSERT INTO sx_memberships(id,tenant_id,identity_id,role) VALUES(?,?,?,'owner'),(?,?,?,'agent')`,[ownerMembership,tenantId,ownerId,agentMembership,tenantId,agentId]);
    for(const [memberId,extension] of [[ownerMembership,'7401'],[agentMembership,'7402']])await db.query('INSERT INTO sx_telephony_extensions(tenant_id,membership_id,extension,revision,assigned_by_identity_id) VALUES(?,?,?,1,?)',[tenantId,memberId,extension,ownerId]);
    plans.loadEntitlements=async()=>({status:'active',categoryKey:'training_center',categoryVersion:1,capabilities:['telephony.call-center']});
    const tenantContext={audience:'tenant',identity:{id:ownerId},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:ownerMembership,tenantId,role:'owner',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['telephony.call-center']}};
    const platformContext={audience:'platform',identity:{id:ownerId},membership:{role:'super_admin',status:'active'},mfaVerified:true};
    await db.query("UPDATE sx_platform_asterisk_config SET enabled=1,gateway_host='198.51.100.42',gateway_sip_port=5061,gateway_sip_transport='tls',revision=7,last_test_status='success' WHERE id=1");
    const peerWrites=[];
    const appliedPeer=await asteriskConfig.applyGatewayPeer(db,platformContext,async()=>({async upsertPjsipObject(type,id,fields){peerWrites.push({type,id,fields});return{attributes:fields.length};}}));
    assert.equal(appliedPeer.applied,true);assert.equal(appliedPeer.objects,3);assert.equal(peerWrites.length,3);
    const [[peerAudit]]=await db.query("SELECT COUNT(*) AS total FROM sx_audit_events WHERE action IN ('asterisk.gateway-peer-apply-requested','asterisk.gateway-peer-applied')");
    assert.equal(Number(peerAudit.total),2,'gateway peer apply attempt and completion are audited');
    const endpointPreview=await asteriskConfig.previewAgentEndpoints(db,platformContext);
    assert.deepEqual(endpointPreview.extensions,['7401','7402']);
    assert.match(endpointPreview.config,/\[salemax-7401-mobile\]/);
    assert.match(endpointPreview.config,/\[salemax-7401-browser\]/);
    const createdQueue=await queues.save(db,tenantContext,{id:null,expectedRevision:0,name:'support_main',strategy:'ringall',ringTimeoutSeconds:20,enabled:false,membershipIds:[ownerMembership,agentMembership]});
    assert.equal(createdQueue.members.length,2);
    const memberIds=createdQueue.members.map(member=>member.membershipId);
    const contenders=[{...createdQueue,membershipIds:memberIds,enabled:true,expectedRevision:createdQueue.revision},{...createdQueue,membershipIds:memberIds,strategy:'ringall',expectedRevision:createdQueue.revision}];
    const race=await Promise.allSettled(contenders.map((item,index)=>queues.save(index?other:db,tenantContext,item)));
    assert.equal(race.filter(item=>item.status==='fulfilled').length,1);
    assert.equal(race.find(item=>item.status==='rejected').reason.code,'STALE_TELEPHONY_QUEUE');
    let latest=(await queues.list(db,tenantContext)).find(item=>item.id===createdQueue.id);
    latest=await queues.save(db,tenantContext,{...latest,membershipIds:latest.members.map(member=>member.membershipId),expectedRevision:latest.revision,enabled:false});
    const ports=await gateway.list(db,platformContext);
    const assign=ports.map(port=>port.channelNo===1?{...port,expectedRevision:port.revision,tenantId,inboundDid:'+97455550001',inboundQueueId:createdQueue.id}:{...port,expectedRevision:port.revision,tenantId:null,inboundDid:null,inboundQueueId:null});
    await gateway.save(db,platformContext,{channels:assign});
    let current=await gateway.list(db,platformContext);
    await assert.rejects(gateway.save(db,platformContext,{channels:current.map(port=>port.channelNo===1?{...port,expectedRevision:port.revision,enabled:true,inboundEnabled:true}:{...port,expectedRevision:port.revision})}),{code:'GATEWAY_QUEUE_DISABLED'});
    const latestMembers=latest.members.map(member=>member.membershipId);
    const enabled=await queues.save(db,tenantContext,{...latest,membershipIds:latestMembers,expectedRevision:latest.revision,enabled:true});
    assert.equal(enabled.enabled,true);
    await assert.rejects(extensions.save(db,tenantContext,{membershipId:agentMembership,expectedRevision:1,extension:'7403'}),{code:'EXTENSION_QUEUE_MUST_BE_DISABLED'});
    current=await gateway.list(db,platformContext);
    await gateway.save(db,platformContext,{channels:current.map(port=>port.channelNo===1?{...port,expectedRevision:port.revision,enabled:true,inboundEnabled:true,outboundEnabled:true}:{...port,expectedRevision:port.revision})});
    const preview=await gateway.previewRouting(db,platformContext);
    assert.equal(preview.inboundRoutes.length,1);assert.equal(preview.inboundRoutes[0].queueId,createdQueue.id);
    assert.match(preview.config,new RegExp(`Stasis\\(salemax-call-center,inbound,${tenantId},1,${createdQueue.id}\\)`));
    assert.deepEqual(preview.dinstarOutboundRoutes.map(route=>[route.channelNo,route.gatewayPort,route.routePrefix,route.digitsToDelete]),[[1,0,'9901',4]]);
    assert.match(preview.config,/Destination Prefix: 9901[\s\S]*Digits to be Deleted: 4/);
    const finalQueue=(await queues.list(db,tenantContext)).find(item=>item.id===createdQueue.id);
    await assert.rejects(queues.save(db,tenantContext,{...finalQueue,membershipIds:finalQueue.members.map(member=>member.membershipId),expectedRevision:finalQueue.revision,enabled:false}),{code:'TELEPHONY_QUEUE_INBOUND_CHANNELS_ACTIVE'});
    await db.query("UPDATE sx_platform_asterisk_runtime SET status='connected',worker_id=?,events_received=events_received+1,last_event_type='StasisStart',last_event_at=UTC_TIMESTAMP(3) WHERE id=1",['synthetic-worker']);
    const ariActions=[],originated=[],outboundGatewayOriginated=[];
    const ariFactory=async()=>({
      async createMixingBridge(id){ariActions.push(['bridge-create',id]);return{id};},
      async answer(id){ariActions.push(['answer',id]);},
      async addToBridge(bridgeId,ids){ariActions.push(['bridge-add',bridgeId,...ids]);},
      async originateAgent(input){originated.push(input);ariActions.push(['originate',input.channelId,input.extension,input.clientType]);return{id:input.channelId};},
      async originateGateway(input){outboundGatewayOriginated.push(input);ariActions.push(['originate-gateway',input.channelId,input.channelNo]);return{id:input.channelId};},
      async hangup(id){ariActions.push(['hangup',id]);},
      async destroyBridge(id){ariActions.push(['bridge-destroy',id]);},
    });
    const callControl=new AsteriskCallControl({pool,ariClientFactory:ariFactory});
    const inboundChannel='synthetic-pjsip-inbound-1';
    const inboundEvent={type:'StasisStart',application:'salemax-call-center',args:['inbound',tenantId,'1',createdQueue.id],channel:{id:inboundChannel}};
    assert.equal(await callControl.handle(inboundEvent),true);
    assert.equal(originated.length,4);
    await callControl.handle(inboundEvent);
    assert.equal(originated.length,4,'a duplicate StasisStart must not originate additional agent legs');
    const winner=originated[0];
    const agentEvent={type:'StasisStart',application:'salemax-call-center',args:winner.appArgs,channel:{id:winner.channelId}};
    assert.equal(await callControl.handle(agentEvent),true);
    await callControl.handle(agentEvent);
    const [[connectedCall]]=await db.query('SELECT status,leased_channel_no,answered_by_membership_id FROM sx_telephony_calls WHERE inbound_channel_id=?',[inboundChannel]);
    assert.equal(connectedCall.status,'connected');assert.equal(Number(connectedCall.leased_channel_no),1);assert.equal(connectedCall.answered_by_membership_id,winner.appArgs[2]);
    await callControl.handle({type:'ChannelDestroyed',application:'salemax-call-center',channel:{id:winner.channelId}});
    const [[endedCall]]=await db.query('SELECT status,leased_channel_no FROM sx_telephony_calls WHERE inbound_channel_id=?',[inboundChannel]);
    assert.equal(endedCall.status,'ended');assert.equal(endedCall.leased_channel_no,null);
    assert.ok(ariActions.some(action=>action[0]==='bridge-add'&&action.includes(winner.channelId)));
    assert.ok(ariActions.some(action=>action[0]==='hangup'&&action[1]===inboundChannel));
    const rotated=await extensions.rotateEndpointCredential(db,tenantContext,{membershipId:ownerMembership,clientType:'browser',expectedCredentialRevision:1});
    assert.equal(rotated.credentialRevision,2);
    await assert.rejects(extensions.rotateEndpointCredential(db,tenantContext,{membershipId:ownerMembership,clientType:'browser',expectedCredentialRevision:1}),{code:'STALE_ENDPOINT_CREDENTIAL'});
    await db.query("UPDATE sx_platform_asterisk_config SET enabled=1,gateway_endpoint_status='online' WHERE id=1");
    const oldEndpointEnv={key:process.env.SALEMAX_PLATFORM_KEY_BASE64,hosts:process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS,ws:process.env.SALEMAX_ASTERISK_WS_URL,mobile:process.env.SALEMAX_ASTERISK_MOBILE_SIP_HOST};
    process.env.SALEMAX_PLATFORM_KEY_BASE64=crypto.randomBytes(32).toString('base64');process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS='crm.example.invalid,sip.example.invalid';process.env.SALEMAX_ASTERISK_WS_URL='wss://crm.example.invalid/ws';process.env.SALEMAX_ASTERISK_MOBILE_SIP_HOST='sip.example.invalid';
    try{
      const browserCredentials=await asteriskConfig.ownBrowserEndpoint(db,tenantContext),mobileCredentials=await asteriskConfig.ownMobileEndpoint(db,tenantContext);
      assert.equal(browserCredentials.authorizationUsername,'7401-browser');assert.equal(mobileCredentials.username,'7401-mobile');
      assert.notEqual(browserCredentials.authorizationPassword,mobileCredentials.password);
      assert.equal(browserCredentials.authorizationPassword,asteriskSecrets.endpointCredential({tenantId,membershipId:ownerMembership,extension:'7401',clientType:'browser',revision:2}));
      const [[credentialAudits]]=await db.query("SELECT COUNT(*) AS total FROM sx_audit_events WHERE resource_type='telephony-endpoint' AND action='telephony.endpoint-credential-accessed'");
      assert.equal(Number(credentialAudits.total),3,'admin preview and member credential reads are audited without storing passwords');
    }finally{for(const [name,value] of [['SALEMAX_PLATFORM_KEY_BASE64',oldEndpointEnv.key],['SALEMAX_ASTERISK_ALLOWED_HOSTS',oldEndpointEnv.hosts],['SALEMAX_ASTERISK_WS_URL',oldEndpointEnv.ws],['SALEMAX_ASTERISK_MOBILE_SIP_HOST',oldEndpointEnv.mobile]])if(value===undefined)delete process.env[name];else process.env[name]=value;}
    const outbound=await callControl.originateOutbound(tenantContext,{destination:'+97455551234',clientType:'mobile'});
    const outboundAgent=originated.at(-1);
    assert.deepEqual(outboundAgent.appArgs,['outbound-agent',outbound.callId,ownerMembership,'mobile','+97455551234']);
    assert.equal(outboundGatewayOriginated.length,0,'the GSM leg waits until the agent endpoint answers');
    const outboundAgentEvent={type:'StasisStart',application:'salemax-call-center',args:outboundAgent.appArgs,channel:{id:outboundAgent.channelId}};
    assert.equal(await callControl.handle(outboundAgentEvent),true);
    assert.equal(outboundGatewayOriginated.length,1);
    await callControl.handle(outboundAgentEvent);
    assert.equal(outboundGatewayOriginated.length,1,'duplicate outbound agent StasisStart must not originate a second GSM leg');
    assert.equal(outboundGatewayOriginated[0].destination,'+97455551234');
    assert.equal(outboundGatewayOriginated[0].channelNo,1);
    assert.deepEqual(outboundGatewayOriginated[0].appArgs,['outbound-gateway',outbound.callId]);
    const outboundGatewayChannel=outboundGatewayOriginated[0].channelId;
    assert.equal(await callControl.handle({type:'StasisStart',application:'salemax-call-center',args:['outbound-gateway',outbound.callId],channel:{id:outboundGatewayChannel}}),true);
    await callControl.handle({type:'StasisStart',application:'salemax-call-center',args:['outbound-gateway',outbound.callId],channel:{id:outboundGatewayChannel}});
    const [[outboundConnected]]=await db.query('SELECT direction,status,leased_channel_no,answered_by_membership_id FROM sx_telephony_calls WHERE tenant_id=? AND id=?',[tenantId,outbound.callId]);
    assert.equal(outboundConnected.direction,'outbound');assert.equal(outboundConnected.status,'connected');
    assert.equal(Number(outboundConnected.leased_channel_no),1);assert.equal(outboundConnected.answered_by_membership_id,ownerMembership);
    await callControl.handle({type:'ChannelDestroyed',application:'salemax-call-center',channel:{id:outboundGatewayChannel}});
    const [[outboundEnded]]=await db.query('SELECT status,leased_channel_no FROM sx_telephony_calls WHERE tenant_id=? AND id=?',[tenantId,outbound.callId]);
    assert.equal(outboundEnded.status,'ended');assert.equal(outboundEnded.leased_channel_no,null);
    const callId=crypto.randomUUID(),bridgeId=crypto.randomUUID();
    await db.query(`INSERT INTO sx_telephony_calls(tenant_id,id,direction,status,gateway_channel_no,leased_channel_no,inbound_queue_id,inbound_channel_id,bridge_id)
      VALUES(?,?,'inbound','ringing',1,1,?,?,?)`,[tenantId,callId,createdQueue.id,'synthetic-inbound-channel',bridgeId]);
    await db.query(`INSERT INTO sx_telephony_call_legs(tenant_id,id,call_id,asterisk_channel_id,leg_role,device_kind,status)
      VALUES(?,?,?,'synthetic-inbound-channel','caller','gateway','connected')`,[tenantId,crypto.randomUUID(),callId]);
    await assert.rejects(db.query(`INSERT INTO sx_telephony_calls(tenant_id,id,direction,status,gateway_channel_no,leased_channel_no)
      VALUES(?,?,'outbound','starting',1,1)`,[tenantId,crypto.randomUUID()]),{code:'ER_DUP_ENTRY'});
    await db.query("UPDATE sx_telephony_calls SET status='ended',leased_channel_no=NULL,ended_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",[tenantId,callId]);
    await db.query(`INSERT INTO sx_telephony_calls(tenant_id,id,direction,status,gateway_channel_no,leased_channel_no)
      VALUES(?,?,'outbound','starting',1,1)`,[tenantId,crypto.randomUUID()]);
    const [[runtime]]=await db.query('SELECT status,events_received,last_event_type FROM sx_platform_asterisk_runtime WHERE id=1');
    assert.equal(runtime.status,'connected');assert.equal(Number(runtime.events_received),1);assert.equal(runtime.last_event_type,'StasisStart');
    console.log(JSON.stringify({telephonyDatabase:true,dbVersion:versionRows[0].version,queueRevisionRace:true,inboundQueueTenantLink:true,disabledQueueCannotReceiveInbound:true,activeQueueProtectsExtensions:true,activeInboundProtectsQueue:true,dinstarOutboundSimRoute:true,agentSipWebRtcEndpointPreview:true,inboundStasisQueueFlow:true,duplicateStasisIsIdempotent:true,firstAgentAnswerWins:true,outboundAgentFirstThenGateway:true,outboundCallEndReleasesSim:true,callSessionLeaseUnique:true,ariEventRuntimeState:true,syntheticOnly:true}));
  }finally{
    plans.loadEntitlements=originalEntitlements;
    if(originalSipKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalSipKey;
    if(pool)await pool.end();if(other)await other.end();if(db)await db.end();
    if(created)await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await admin.end();
  }
}
main().catch(error=>{console.error('Telephony database integration failed:',error.code||'ERROR',error.stack||error.message);process.exitCode=1;});
