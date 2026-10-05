'use strict';

const crypto = require('node:crypto');
const ari = require('./asterisk-ari-client');
const gatewayPorts = require('./asterisk-gateway-ports');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNEL_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const CLIENT_TYPES = new Set(['mobile', 'browser']);
const ACTIVE_LEG_STATUSES = ['originating', 'ringing', 'connected'];
const fail = code => { throw Object.assign(new Error(code), { code }); };

function inboundArgs(args) {
  if (!Array.isArray(args) || args.length !== 4 || args[0] !== 'inbound' || !UUID.test(args[1] || '')
    || !/^[1-4]$/.test(args[2] || '') || !UUID.test(args[3] || '')) return null;
  return { tenantId: args[1], channelNo: Number(args[2]), queueId: args[3] };
}

function agentArgs(args) {
  if (!Array.isArray(args) || args.length !== 4 || args[0] !== 'inbound-agent' || !UUID.test(args[1] || '')
    || !UUID.test(args[2] || '') || !CLIENT_TYPES.has(args[3])) return null;
  return { callId: args[1], membershipId: args[2], clientType: args[3] };
}

function outboundAgentArgs(args) {
  if (!Array.isArray(args) || args.length !== 5 || args[0] !== 'outbound-agent' || !UUID.test(args[1] || '')
    || !UUID.test(args[2] || '') || !CLIENT_TYPES.has(args[3]) || !/^\+[1-9][0-9]{7,14}$/.test(args[4] || '')) return null;
  return { callId: args[1], membershipId: args[2], clientType: args[3], destination: args[4] };
}

function outboundGatewayArgs(args) {
  if (!Array.isArray(args) || args.length !== 2 || args[0] !== 'outbound-gateway' || !UUID.test(args[1] || '')) return null;
  return { callId: args[1] };
}

function connection(pool) {
  return pool.getConnection();
}

class AsteriskCallControl {
  constructor({ pool, ariClientFactory = ari.fromDatabase, log = () => {} } = {}) {
    if (!pool) throw new TypeError('ASTERISK_CALL_CONTROL_POOL_REQUIRED');
    this.pool = pool;
    this.ariClientFactory = ariClientFactory;
    this.log = log;
    this.events = null;
    this.listener = event => this.handle(event).catch(error => {
      this.log({ ariCallControl: 'event_failed', code: /^[A-Z0-9_]{2,80}$/.test(error.code || '') ? error.code : 'ARI_CALL_CONTROL_FAILED' });
    });
  }

  start(events) {
    if (this.events) return;
    this.events = events;
    events.on('ariEvent', this.listener);
  }

  stop() {
    if (!this.events) return;
    this.events.off('ariEvent', this.listener);
    this.events = null;
  }

  async client() {
    return this.ariClientFactory(this.pool);
  }

  async handle(event) {
    if (!event || event.application !== ari.APP_NAME || !CHANNEL_ID.test(event.channel?.id || '')) return false;
    if (event.type === 'StasisStart') {
      const incoming = inboundArgs(event.args);
      if (incoming) return this.startInbound(event.channel.id, incoming);
      const member = agentArgs(event.args);
      if (member) return this.connectInboundAgent(event.channel.id, member);
      const outboundAgent = outboundAgentArgs(event.args);
      if (outboundAgent) return this.startOutboundGateway(event.channel.id, outboundAgent);
      const outboundGateway = outboundGatewayArgs(event.args);
      if (outboundGateway) return this.connectOutboundGateway(event.channel.id, outboundGateway);
      await (await this.client()).hangup(event.channel.id);
      return false;
    }
    if (event.type === 'StasisEnd' || event.type === 'ChannelDestroyed') return this.endLeg(event.channel.id, event.cause_txt);
    return false;
  }

  async originateOutbound(context, input) {
    const { decision } = require('./policy');
    const access = decision(context, { capability: 'telephony.call-center', permission: 'calls.control' });
    if (!access.allowed) fail(access.code);
    if (!input || !/^\+[1-9][0-9]{7,14}$/.test(input.destination || '') || !CLIENT_TYPES.has(input.clientType)) fail('INVALID_OUTBOUND_CALL');
    const db = await connection(this.pool);
    const callId = crypto.randomUUID();
    const agentChannelId = crypto.randomUUID();
    let reservation;
    try {
      await db.beginTransaction();
      const [[pbx]] = await db.query('SELECT enabled,gateway_endpoint_status FROM sx_platform_asterisk_config WHERE id=1 FOR UPDATE');
      if (!pbx?.enabled) fail('ASTERISK_CONTROL_NOT_READY');
      if (pbx.gateway_endpoint_status !== 'online') fail('GATEWAY_ENDPOINT_NOT_READY');
      const [[member]] = await db.query(`SELECT x.extension,m.status AS membership_status,i.status AS identity_status,t.status AS tenant_status,
          t.category_key,t.category_version FROM sx_telephony_extensions x
        JOIN sx_memberships m ON m.tenant_id=x.tenant_id AND m.id=x.membership_id
        JOIN sx_identities i ON i.id=m.identity_id JOIN sx_tenants t ON t.id=m.tenant_id
        WHERE x.tenant_id=? AND x.membership_id=? FOR UPDATE`, [context.tenant.id, context.membership.id]);
      if (!member || member.membership_status !== 'active' || member.identity_status !== 'active' || member.tenant_status !== 'active'
        || !/^[0-9]{3,8}$/.test(member.extension || '')) fail('OUTBOUND_EXTENSION_NOT_READY');
      if (!(await gatewayPorts.eligible(db, { id: context.tenant.id, status: member.tenant_status,
        category_key: member.category_key, category_version: member.category_version }))) fail('OUTBOUND_TENANT_NOT_ELIGIBLE');
      const [[port]] = await db.query(`SELECT p.channel_no FROM sx_platform_asterisk_gateway_ports p
        WHERE p.tenant_id=? AND p.enabled=1 AND p.outbound_enabled=1
          AND NOT EXISTS(SELECT 1 FROM sx_telephony_calls c WHERE c.leased_channel_no=p.channel_no)
        ORDER BY p.channel_no LIMIT 1 FOR UPDATE`, [context.tenant.id]);
      if (!port) fail('OUTBOUND_CHANNEL_UNAVAILABLE');
      await db.query(`INSERT INTO sx_telephony_calls(tenant_id,id,direction,status,gateway_channel_no,leased_channel_no,started_by_membership_id)
        VALUES(?,?,'outbound','starting',?,?,?)`, [context.tenant.id,callId,port.channel_no,port.channel_no,context.membership.id]);
      await db.query(`INSERT INTO sx_telephony_call_legs(tenant_id,id,call_id,asterisk_channel_id,leg_role,device_kind,membership_id,status)
        VALUES(?,?,?,?,'agent',?,?, 'originating')`, [context.tenant.id,crypto.randomUUID(),callId,agentChannelId,input.clientType,context.membership.id]);
      reservation = { tenantId: context.tenant.id, callId, channelNo: Number(port.channel_no), agentChannelId,
        extension: member.extension, destination: input.destination, clientType: input.clientType };
      await db.commit();
    } catch (error) {
      try { await db.rollback(); } catch (_) {}
      if (error.code === 'ER_DUP_ENTRY') fail('OUTBOUND_CHANNEL_UNAVAILABLE');
      throw error;
    } finally { db.release(); }
    try {
      const client = await this.client();
      await client.originateAgent({ extension: reservation.extension, clientType: reservation.clientType,
        channelId: reservation.agentChannelId, appArgs: ['outbound-agent',reservation.callId,context.membership.id,
          reservation.clientType,reservation.destination], timeout: 30 });
      return { callId: reservation.callId, status: 'starting' };
    } catch (error) {
      await this.finishCall(reservation.tenantId,reservation.callId,'failed',error.code||'AGENT_ORIGINATE_FAILED');
      throw error;
    }
  }

  async startOutboundGateway(agentChannelId, input) {
    const db=await connection(this.pool);let call;const gatewayChannelId=crypto.randomUUID();
    try {
      await db.beginTransaction();
      const [[row]]=await db.query(`SELECT c.tenant_id,c.id,c.status,c.gateway_channel_no,c.started_by_membership_id,c.bridge_id,
          l.membership_id,l.device_kind,l.status AS leg_status FROM sx_telephony_calls c
        JOIN sx_telephony_call_legs l ON l.tenant_id=c.tenant_id AND l.call_id=c.id
        WHERE c.id=? AND c.direction='outbound' AND l.asterisk_channel_id=? FOR UPDATE`,[input.callId,agentChannelId]);
      if(row&&row.started_by_membership_id===input.membershipId&&row.membership_id===input.membershipId
        &&row.device_kind===input.clientType&&row.status==='starting'&&row.leg_status==='connected'){
        const [[existingGateway]]=await db.query(`SELECT id FROM sx_telephony_call_legs
          WHERE tenant_id=? AND call_id=? AND leg_role='gateway' AND status IN ('originating','ringing','connected')`,[row.tenant_id,row.id]);
        if(existingGateway){await db.rollback();return true;}
      }
      if(!row||row.started_by_membership_id!==input.membershipId||row.membership_id!==input.membershipId
        ||row.device_kind!==input.clientType||row.status!=='starting'||row.leg_status!=='originating'){
        await db.rollback();
        try{await(await this.client()).hangup(agentChannelId);}catch(_){}return false;
      }
      call={tenantId:row.tenant_id,id:row.id,channelNo:Number(row.gateway_channel_no),bridgeId:crypto.randomUUID()};
      await db.query(`UPDATE sx_telephony_calls SET bridge_id=?,revision=revision+1 WHERE tenant_id=? AND id=? AND status='starting'`,[call.bridgeId,call.tenantId,call.id]);
      await db.query(`UPDATE sx_telephony_call_legs SET status='connected',answered_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND call_id=? AND asterisk_channel_id=? AND status='originating'`,[call.tenantId,call.id,agentChannelId]);
      await db.query(`INSERT INTO sx_telephony_call_legs(tenant_id,id,call_id,asterisk_channel_id,leg_role,device_kind,status)
        VALUES(?,?,?,?,'gateway','gateway','originating')`,[call.tenantId,crypto.randomUUID(),call.id,gatewayChannelId]);
      await db.commit();
    }catch(error){try{await db.rollback();}catch(_){}if(call)await this.finishCall(call.tenantId,call.id,'failed','OUTBOUND_RESERVATION_FAILED');throw error;}
    finally{db.release();}
    const client=await this.client();
    try{
      await client.createMixingBridge(call.bridgeId);
      await client.addToBridge(call.bridgeId,[agentChannelId]);
      await client.originateGateway({destination:input.destination,channelNo:call.channelNo,channelId:gatewayChannelId,
        appArgs:['outbound-gateway',call.id],timeout:45});
      return true;
    }catch(error){
      await this.finishCall(call.tenantId,call.id,'failed','OUTBOUND_GATEWAY_ORIGINATE_FAILED');
      try{await client.hangup(agentChannelId);}catch(_){}try{await client.destroyBridge(call.bridgeId);}catch(_){}throw error;
    }
  }

  async connectOutboundGateway(channelId,input) {
    const db=await connection(this.pool);let call;
    try{
      await db.beginTransaction();
      const [[row]]=await db.query(`SELECT c.tenant_id,c.id,c.status,c.bridge_id,l.status AS leg_status
        FROM sx_telephony_calls c JOIN sx_telephony_call_legs l ON l.tenant_id=c.tenant_id AND l.call_id=c.id
        WHERE c.id=? AND c.direction='outbound' AND l.asterisk_channel_id=? FOR UPDATE`,[input.callId,channelId]);
      if(row&&row.status==='connected'&&row.bridge_id&&row.leg_status==='connected'){
        await db.rollback();return true;
      }
      if(!row||row.status!=='starting'||!row.bridge_id||row.leg_status!=='originating'){
        await db.rollback();try{await(await this.client()).hangup(channelId);}catch(_){}return false;
      }
      await db.query(`UPDATE sx_telephony_call_legs SET status='connected',answered_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND call_id=? AND asterisk_channel_id=?`,[row.tenant_id,row.id,channelId]);
      await db.query(`UPDATE sx_telephony_calls SET status='connected',answered_by_membership_id=started_by_membership_id,answered_at=UTC_TIMESTAMP(3),revision=revision+1
        WHERE tenant_id=? AND id=? AND status='starting'`,[row.tenant_id,row.id]);
      call={tenantId:row.tenant_id,id:row.id,bridgeId:row.bridge_id};await db.commit();
    }catch(error){try{await db.rollback();}catch(_){}throw error;}finally{db.release();}
    try{await(await this.client()).addToBridge(call.bridgeId,[channelId]);return true;}
    catch(error){await this.finishCall(call.tenantId,call.id,'failed','OUTBOUND_BRIDGE_FAILED');throw error;}
  }

  async reserveInbound(channelId, input) {
    const db = await connection(this.pool);
    const callId = crypto.randomUUID();
    const bridgeId = crypto.randomUUID();
    try {
      await db.beginTransaction();
      const [[mapping]] = await db.query(`SELECT p.channel_no,p.tenant_id,p.inbound_queue_id,t.status AS tenant_status,
          t.category_key,t.category_version,q.enabled AS queue_enabled,q.ring_timeout_seconds
        FROM sx_platform_asterisk_gateway_ports p
        JOIN sx_tenants t ON t.id=p.tenant_id
        JOIN sx_telephony_queues q ON q.tenant_id=p.tenant_id AND q.id=p.inbound_queue_id
        WHERE p.channel_no=? AND p.tenant_id=? AND p.enabled=1 AND p.inbound_enabled=1 AND p.inbound_queue_id=? FOR UPDATE`,
      [input.channelNo, input.tenantId, input.queueId]);
      if (!mapping || mapping.tenant_status !== 'active' || !mapping.queue_enabled) fail('INBOUND_ROUTE_NOT_ACTIVE');
      if (!(await gatewayPorts.eligible(db, { id: mapping.tenant_id, status: mapping.tenant_status,
        category_key: mapping.category_key, category_version: mapping.category_version }))) fail('INBOUND_TENANT_NOT_ELIGIBLE');
      const [members] = await db.query(`SELECT m.id AS membership_id,x.extension FROM sx_telephony_queue_members qm
        JOIN sx_memberships m ON m.tenant_id=qm.tenant_id AND m.id=qm.membership_id AND m.status='active'
        JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
        JOIN sx_telephony_extensions x ON x.tenant_id=m.tenant_id AND x.membership_id=m.id AND x.extension REGEXP '^[0-9]{3,8}$'
        WHERE qm.tenant_id=? AND qm.queue_id=? AND m.role IN ('owner','manager','agent') ORDER BY qm.position FOR UPDATE`,
      [input.tenantId, input.queueId]);
      if (!members.length) fail('INBOUND_QUEUE_HAS_NO_ACTIVE_ENDPOINTS');
      await db.query(`INSERT INTO sx_telephony_calls(tenant_id,id,direction,status,gateway_channel_no,leased_channel_no,
          inbound_queue_id,inbound_channel_id,bridge_id)
        VALUES(?,?,'inbound','ringing',?,?,?,?,?)`,
      [input.tenantId, callId, input.channelNo, input.channelNo, input.queueId, channelId, bridgeId]);
      await db.query(`INSERT INTO sx_telephony_call_legs(tenant_id,id,call_id,asterisk_channel_id,leg_role,device_kind,status)
        VALUES(?,?,?,?,'caller','gateway','connected')`, [input.tenantId, crypto.randomUUID(), callId, channelId]);
      const agentLegs = [];
      for (const member of members) for (const clientType of CLIENT_TYPES) {
        const leg = { id: crypto.randomUUID(), channelId: crypto.randomUUID(), membershipId: member.membership_id,
          extension: member.extension, clientType };
        await db.query(`INSERT INTO sx_telephony_call_legs(tenant_id,id,call_id,asterisk_channel_id,leg_role,device_kind,membership_id,status)
          VALUES(?,?,?,?,'agent',?,?,'originating')`, [input.tenantId, leg.id, callId, leg.channelId, clientType, leg.membershipId]);
        agentLegs.push(leg);
      }
      await db.commit();
      return { tenantId: input.tenantId, callId, bridgeId, channelNo: input.channelNo, channelId,
        ringTimeoutSeconds: Math.max(5, Math.min(120, Number(mapping.ring_timeout_seconds) || 20)), agentLegs };
    } catch (error) {
      try { await db.rollback(); } catch (_) {}
      if (error.code === 'ER_DUP_ENTRY') {
        const [[duplicate]] = await db.query('SELECT id,status FROM sx_telephony_calls WHERE inbound_channel_id=?', [channelId]);
        if (duplicate) return { duplicate: true, callId: duplicate.id, status: duplicate.status };
        fail('GATEWAY_CHANNEL_ALREADY_IN_USE');
      }
      throw error;
    } finally {
      db.release();
    }
  }

  async startInbound(channelId, input) {
    let reserved;
    try {
      reserved = await this.reserveInbound(channelId, input);
    } catch (error) {
      const code = error.code || 'INBOUND_CALL_REJECTED';
      if (code === 'ER_DUP_ENTRY') this.log({ ariCallControl: 'duplicate_inbound', code: 'DUPLICATE_INBOUND_EVENT' });
      try { await (await this.client()).hangup(channelId); } catch (_) {}
      throw error;
    }
    if (reserved.duplicate) return true;
    let client;
    try { client = await this.client(); }
    catch (error) {
      await this.finishCall(reserved.tenantId, reserved.callId, 'failed', 'ARI_CONTROL_NOT_READY');
      try { await (await this.client()).hangup(channelId); } catch (_) {}
      throw error;
    }
    try {
      await client.createMixingBridge(reserved.bridgeId);
      await client.answer(channelId);
      await client.addToBridge(reserved.bridgeId, [channelId]);
    } catch (error) {
      await this.finishCall(reserved.tenantId, reserved.callId, 'failed', 'INBOUND_BRIDGE_SETUP_FAILED');
      try { await client.hangup(channelId); } catch (_) {}
      try { await client.destroyBridge(reserved.bridgeId); } catch (_) {}
      throw error;
    }
    const results = await Promise.allSettled(reserved.agentLegs.map(async leg => {
      try {
        await client.originateAgent({ extension: leg.extension, clientType: leg.clientType, channelId: leg.channelId,
          appArgs: ['inbound-agent', reserved.callId, leg.membershipId, leg.clientType], timeout: reserved.ringTimeoutSeconds });
      } catch (error) {
        await this.markLegFailed(reserved.tenantId, reserved.callId, leg.channelId, error.code || 'AGENT_ORIGINATE_FAILED');
        throw error;
      }
    }));
    if (results.every(result => result.status === 'rejected')) {
      await this.finishCall(reserved.tenantId, reserved.callId, 'failed', 'NO_AGENT_ENDPOINT_AVAILABLE');
      try { await client.hangup(channelId); } catch (_) {}
      try { await client.destroyBridge(reserved.bridgeId); } catch (_) {}
    }
    return true;
  }

  async connectInboundAgent(channelId, input) {
    const db = await connection(this.pool);
    let decision;
    try {
      await db.beginTransaction();
      const [[row]] = await db.query(`SELECT c.tenant_id,c.id,c.status,c.bridge_id,c.inbound_channel_id,c.answered_by_membership_id,
          l.id AS leg_id,l.membership_id,l.device_kind,l.status AS leg_status
        FROM sx_telephony_calls c JOIN sx_telephony_call_legs l ON l.tenant_id=c.tenant_id AND l.call_id=c.id
        WHERE c.tenant_id=? AND c.id=? AND l.asterisk_channel_id=? FOR UPDATE`, [
        (await db.query('SELECT tenant_id FROM sx_telephony_calls WHERE id=? LIMIT 1', [input.callId]))[0]?.[0]?.tenant_id || '',
        input.callId, channelId,
      ]);
      if (!row || row.membership_id !== input.membershipId || row.device_kind !== input.clientType
        || !['originating','ringing','connected'].includes(row.leg_status)) {
        decision = { action: 'hangup' };
      } else if (row.status === 'connected' && row.answered_by_membership_id === input.membershipId && row.leg_status === 'connected') {
        decision = { action: 'duplicate' };
      } else if (row.status === 'ringing' && !row.answered_by_membership_id) {
        await db.query(`UPDATE sx_telephony_calls SET status='connected',answered_by_membership_id=?,answered_at=UTC_TIMESTAMP(3),revision=revision+1
          WHERE tenant_id=? AND id=? AND status='ringing' AND answered_by_membership_id IS NULL`, [input.membershipId,row.tenant_id,row.id]);
        await db.query(`UPDATE sx_telephony_call_legs SET status='connected',answered_at=UTC_TIMESTAMP(3)
          WHERE tenant_id=? AND call_id=? AND asterisk_channel_id=? AND status='originating'`, [row.tenant_id,row.id,channelId]);
        const [others] = await db.query(`SELECT asterisk_channel_id FROM sx_telephony_call_legs
          WHERE tenant_id=? AND call_id=? AND leg_role='agent' AND asterisk_channel_id<>? AND status IN ('originating','ringing','connected')`,
        [row.tenant_id,row.id,channelId]);
        decision = { action: 'bridge', tenantId: row.tenant_id, callId: row.id, bridgeId: row.bridge_id,
          inboundChannelId: row.inbound_channel_id, otherChannels: others.map(item => item.asterisk_channel_id) };
      } else {
        decision = { action: row.status === 'connected' && row.answered_by_membership_id === input.membershipId
          ? 'duplicate' : 'hangup', tenantId: row.tenant_id, callId: row.id };
      }
      await db.commit();
    } catch (error) {
      try { await db.rollback(); } catch (_) {}
      throw error;
    } finally {
      db.release();
    }
    const client = await this.client();
    if (decision.action === 'bridge') {
      try {
        await client.addToBridge(decision.bridgeId, [channelId]);
        for (const otherChannel of decision.otherChannels) {
          try { await client.hangup(otherChannel); } catch (_) {}
        }
        await this.endOtherAgentLegs(decision.tenantId, decision.callId, channelId);
      } catch (error) {
        await this.finishCall(decision.tenantId, decision.callId, 'failed', 'AGENT_BRIDGE_FAILED');
        try { await client.hangup(decision.inboundChannelId); } catch (_) {}
        try { await client.hangup(channelId); } catch (_) {}
        try { await client.destroyBridge(decision.bridgeId); } catch (_) {}
        throw error;
      }
      return true;
    }
    if (decision.action === 'hangup') {
      try { await client.hangup(channelId); } catch (_) {}
    }
    return decision.action === 'duplicate';
  }

  async endOtherAgentLegs(tenantId, callId, winnerChannelId) {
    const db = await connection(this.pool);
    try {
      await db.query(`UPDATE sx_telephony_call_legs SET status='ended',ended_at=UTC_TIMESTAMP(3),end_reason='OTHER_AGENT_ANSWERED'
        WHERE tenant_id=? AND call_id=? AND leg_role='agent' AND asterisk_channel_id<>? AND status IN ('originating','ringing')`,
      [tenantId,callId,winnerChannelId]);
    } finally { db.release(); }
  }

  async markLegFailed(tenantId, callId, channelId, reason) {
    const db = await connection(this.pool);
    try {
      await db.query(`UPDATE sx_telephony_call_legs SET status='failed',ended_at=UTC_TIMESTAMP(3),end_reason=?
        WHERE tenant_id=? AND call_id=? AND asterisk_channel_id=? AND status='originating'`,
      [/^[A-Z0-9_]{2,80}$/.test(reason) ? reason : 'AGENT_ORIGINATE_FAILED',tenantId,callId,channelId]);
    } finally { db.release(); }
  }

  async endLeg(channelId, cause) {
    const db = await connection(this.pool);
    let cleanup;
    try {
      await db.beginTransaction();
      const [[leg]] = await db.query(`SELECT tenant_id,id AS leg_id,call_id,leg_role,membership_id,status FROM sx_telephony_call_legs
        WHERE asterisk_channel_id=? FOR UPDATE`, [channelId]);
      if (!leg) { await db.rollback(); return false; }
      await db.query(`UPDATE sx_telephony_call_legs SET status='ended',ended_at=COALESCE(ended_at,UTC_TIMESTAMP(3)),end_reason=?
        WHERE tenant_id=? AND id=? AND status IN ('originating','ringing','connected')`, [
        /^[A-Z0-9_ -]{1,80}$/.test(cause || '') ? cause : 'CHANNEL_ENDED',leg.tenant_id,leg.leg_id]);
      const [[call]] = await db.query(`SELECT direction,status,bridge_id,inbound_channel_id,answered_by_membership_id FROM sx_telephony_calls
        WHERE tenant_id=? AND id=? FOR UPDATE`, [leg.tenant_id,leg.call_id]);
      if (!call || ['ended','failed'].includes(call.status)) { await db.commit(); return true; }
      const winningAgentEnded = leg.leg_role === 'agent' && call.status === 'connected'
        && leg.membership_id === call.answered_by_membership_id;
      const callerEnded = leg.leg_role === 'caller' || (leg.leg_role === 'gateway' && call.direction === 'outbound');
      if (callerEnded || winningAgentEnded) {
        const [others] = await db.query(`SELECT asterisk_channel_id FROM sx_telephony_call_legs
          WHERE tenant_id=? AND call_id=? AND asterisk_channel_id<>? AND status IN ('originating','ringing','connected')`,
        [leg.tenant_id,leg.call_id,channelId]);
        await db.query(`UPDATE sx_telephony_call_legs SET status='ended',ended_at=COALESCE(ended_at,UTC_TIMESTAMP(3)),end_reason='PEER_ENDED'
          WHERE tenant_id=? AND call_id=? AND asterisk_channel_id<>? AND status IN ('originating','ringing','connected')`,
        [leg.tenant_id,leg.call_id,channelId]);
        await db.query(`UPDATE sx_telephony_calls SET status='ended',leased_channel_no=NULL,ended_at=UTC_TIMESTAMP(3),
          duration_seconds=IF(answered_at IS NULL,NULL,TIMESTAMPDIFF(SECOND,answered_at,UTC_TIMESTAMP(3))),revision=revision+1
          WHERE tenant_id=? AND id=? AND status IN ('ringing','connected')`, [leg.tenant_id,leg.call_id]);
        cleanup = { ...leg, bridgeId: call.bridge_id, inbound_channel_id: call.inbound_channel_id,
          channels: others.map(row => row.asterisk_channel_id) };
      } else if (call.status === 'ringing') {
        const [[remaining]] = await db.query(`SELECT COUNT(*) AS activeLegs FROM sx_telephony_call_legs
          WHERE tenant_id=? AND call_id=? AND leg_role='agent' AND status IN ('originating','ringing','connected')`, [leg.tenant_id,leg.call_id]);
        if (Number(remaining.activeLegs) === 0) {
          const [others] = await db.query(`SELECT asterisk_channel_id FROM sx_telephony_call_legs
            WHERE tenant_id=? AND call_id=? AND asterisk_channel_id<>? AND status IN ('originating','ringing','connected')`,
          [leg.tenant_id,leg.call_id,channelId]);
          await db.query(`UPDATE sx_telephony_call_legs SET status='ended',ended_at=COALESCE(ended_at,UTC_TIMESTAMP(3)),end_reason='NO_AGENT_ANSWER'
            WHERE tenant_id=? AND call_id=? AND status IN ('originating','ringing','connected')`, [leg.tenant_id,leg.call_id]);
          await db.query(`UPDATE sx_telephony_calls SET status='failed',leased_channel_no=NULL,ended_at=UTC_TIMESTAMP(3),end_reason='NO_AGENT_ANSWER',revision=revision+1
            WHERE tenant_id=? AND id=? AND status='ringing'`, [leg.tenant_id,leg.call_id]);
          cleanup = { ...leg, bridgeId: call.bridge_id, inbound_channel_id: call.inbound_channel_id,
            channels: others.map(row => row.asterisk_channel_id) };
        }
      }
      await db.commit();
    } catch (error) {
      try { await db.rollback(); } catch (_) {}
      throw error;
    } finally { db.release(); }
    if (cleanup) {
      const client = await this.client();
      for (const otherChannel of cleanup.channels) try { await client.hangup(otherChannel); } catch (_) {}
      if (cleanup.leg_role === 'agent' && cleanup.membership_id) {
        try { await client.hangup(cleanup.inbound_channel_id); } catch (_) {}
      }
      try { await client.destroyBridge(cleanup.bridgeId); } catch (_) {}
    }
    return true;
  }

  async finishCall(tenantId, callId, status, reason) {
    const db = await connection(this.pool);
    let row;
    try {
      const [[current]] = await db.query(`SELECT bridge_id,inbound_channel_id FROM sx_telephony_calls
        WHERE tenant_id=? AND id=? AND status IN ('starting','ringing','connected')`, [tenantId,callId]);
      if (!current) return false;
      row = current;
      await db.query(`UPDATE sx_telephony_calls SET status=?,leased_channel_no=NULL,ended_at=UTC_TIMESTAMP(3),end_reason=?,revision=revision+1
        WHERE tenant_id=? AND id=? AND status IN ('starting','ringing','connected')`, [status,reason,tenantId,callId]);
      await db.query(`UPDATE sx_telephony_call_legs SET status='ended',ended_at=COALESCE(ended_at,UTC_TIMESTAMP(3)),end_reason=?
        WHERE tenant_id=? AND call_id=? AND status IN ('originating','ringing','connected')`, [reason,tenantId,callId]);
    } finally { db.release(); }
    const client = await this.client();
    if (row.inbound_channel_id) try { await client.hangup(row.inbound_channel_id); } catch (_) {}
    if (row.bridge_id) try { await client.destroyBridge(row.bridge_id); } catch (_) {}
    return true;
  }
}

module.exports = { AsteriskCallControl, inboundArgs, agentArgs, outboundAgentArgs, outboundGatewayArgs };
