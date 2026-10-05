'use strict';

const crypto = require('node:crypto');
const { platformDecision } = require('./policy');
const plans = require('./plans');
const { getCategory, supportsBusinessCapability } = require('./categories');

const fail = code => { throw Object.assign(new Error(code), { code }); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function authorize(context) {
  if (!platformDecision(context, 'telephony.configure')) fail('PERMISSION_DENIED');
}
function parsePorts(input) {
  if (!Array.isArray(input) || input.length !== 4) fail('INVALID_GATEWAY_CHANNELS');
  const seen = new Set();
  const channels = input.map(row => {
    if (!row || !Number.isInteger(row.channelNo) || row.channelNo < 1 || row.channelNo > 4 || seen.has(row.channelNo)
      || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 0
      || typeof row.enabled !== 'boolean' || typeof row.inboundEnabled !== 'boolean' || typeof row.outboundEnabled !== 'boolean') fail('INVALID_GATEWAY_CHANNEL');
    const tenantId = row.tenantId === null || row.tenantId === '' ? null : row.tenantId;
    if (tenantId !== null && !uuid(tenantId)) fail('INVALID_GATEWAY_TENANT');
    const inboundDid = row.inboundDid === null || row.inboundDid === '' ? null : row.inboundDid;
    if (inboundDid !== null && (typeof inboundDid !== 'string' || !/^\+[1-9][0-9]{7,14}$/.test(inboundDid))) fail('INVALID_GATEWAY_DID');
    const inboundQueueId = row.inboundQueueId === null || row.inboundQueueId === '' || row.inboundQueueId === undefined ? null : row.inboundQueueId;
    if (inboundQueueId !== null && !uuid(inboundQueueId)) fail('INVALID_GATEWAY_QUEUE');
    if (!row.enabled && (row.inboundEnabled || row.outboundEnabled)) fail('INVALID_GATEWAY_CHANNEL_POLICY');
    if (row.enabled && !tenantId) fail('GATEWAY_TENANT_REQUIRED');
    if (row.inboundEnabled && !inboundDid) fail('GATEWAY_DID_REQUIRED');
    if (row.inboundEnabled && !inboundQueueId) fail('GATEWAY_QUEUE_REQUIRED');
    if (!tenantId && (inboundDid || inboundQueueId)) fail('GATEWAY_TENANT_REQUIRED');
    seen.add(row.channelNo);
    return { channelNo: row.channelNo, expectedRevision: row.expectedRevision, enabled: row.enabled,
      inboundEnabled: row.inboundEnabled, outboundEnabled: row.outboundEnabled, tenantId, inboundDid, inboundQueueId };
  });
  if (seen.size !== 4) fail('INVALID_GATEWAY_CHANNELS');
  return channels.sort((a, b) => a.channelNo - b.channelNo);
}
function present(row) {
  return { channelNo: Number(row.channel_no), enabled: !!row.enabled, inboundEnabled: !!row.inbound_enabled,
    outboundEnabled: !!row.outbound_enabled, tenantId: row.tenant_id || '', tenantName: row.tenant_name || '',
    tenantStatus: row.tenant_status || '', inboundDid: row.inbound_did || '', inboundQueueId: row.inbound_queue_id || '',
    inboundQueueName: row.inbound_queue_name || '', revision: Number(row.revision), updatedAt: row.updated_at || null };
}
function dinstarRoutePrefix(channelNo) {
  if (!Number.isInteger(channelNo) || channelNo < 1 || channelNo > 4) fail('INVALID_GATEWAY_CHANNEL');
  return `990${channelNo}`;
}
async function list(db, context) {
  authorize(context);
  const [rows] = await db.query(`SELECT p.channel_no,p.enabled,p.inbound_enabled,p.outbound_enabled,p.tenant_id,p.inbound_did,p.inbound_queue_id,p.revision,p.updated_at,
      t.name AS tenant_name,t.status AS tenant_status,q.queue_name AS inbound_queue_name
    FROM sx_platform_asterisk_gateway_ports p LEFT JOIN sx_tenants t ON t.id=p.tenant_id
    LEFT JOIN sx_telephony_queues q ON q.tenant_id=p.tenant_id AND q.id=p.inbound_queue_id ORDER BY p.channel_no`);
  if (rows.length !== 4) fail('ASTERISK_GATEWAY_CHANNELS_UNAVAILABLE');
  return rows.map(present);
}
async function eligible(db, tenant) {
  const category = getCategory(tenant.category_key, Number(tenant.category_version));
  const entitlement = tenant.status === 'active' ? await plans.loadEntitlements(db, tenant.id) : null;
  return !!(supportsBusinessCapability(category, 'telephony.call-center') && entitlement
    && ['active', 'trial', 'grace'].includes(entitlement.status)
    && entitlement.categoryKey === tenant.category_key && Number(entitlement.categoryVersion) === Number(tenant.category_version)
    && entitlement.capabilities.includes('telephony.call-center'));
}
async function listTenants(db, context) {
  authorize(context);
  const [rows] = await db.query(`SELECT id,name,slug,status,category_key,category_version FROM sx_tenants ORDER BY name,id`);
  const tenants = [];
  for (const row of rows) tenants.push({ id: row.id, name: row.name, slug: row.slug, status: row.status,
    categoryKey: row.category_key, telephonyEligible: await eligible(db, row) });
  return tenants;
}
async function listQueues(db, context, tenantId) {
  authorize(context);
  if (tenantId !== undefined && tenantId !== '' && !uuid(tenantId)) fail('INVALID_GATEWAY_TENANT');
  const [rows] = await db.query(`SELECT q.tenant_id AS tenantId,q.id,q.queue_name AS name,q.enabled,q.revision,t.name AS tenantName
    FROM sx_telephony_queues q JOIN sx_tenants t ON t.id=q.tenant_id ${tenantId ? 'WHERE q.tenant_id=?' : ''}
    ORDER BY t.name,q.queue_name,q.id`, tenantId ? [tenantId] : []);
  return rows.map(row => ({tenantId:row.tenantId,tenantName:row.tenantName,id:row.id,name:row.name,enabled:!!row.enabled,revision:Number(row.revision)}));
}
async function previewRouting(db, context) {
  authorize(context);
  const [rows] = await db.query(`SELECT p.channel_no,p.enabled,p.inbound_enabled,p.outbound_enabled,p.tenant_id,p.inbound_did,p.inbound_queue_id,
      t.name AS tenant_name,t.status AS tenant_status,t.category_key,t.category_version,q.enabled AS inbound_queue_enabled,q.queue_name AS inbound_queue_name
    FROM sx_platform_asterisk_gateway_ports p LEFT JOIN sx_tenants t ON t.id=p.tenant_id
    LEFT JOIN sx_telephony_queues q ON q.tenant_id=p.tenant_id AND q.id=p.inbound_queue_id ORDER BY p.channel_no`);
  if (rows.length !== 4) fail('ASTERISK_GATEWAY_CHANNELS_UNAVAILABLE');
  const eligibleByTenant = new Map();
  for (const row of rows) if (row.tenant_id && !eligibleByTenant.has(row.tenant_id)) {
    eligibleByTenant.set(row.tenant_id, await eligible(db, { id: row.tenant_id, status: row.tenant_status,
      category_key: row.category_key, category_version: row.category_version }));
  }
  const active = rows.filter(row => row.enabled && row.tenant_id && eligibleByTenant.get(row.tenant_id));
  const inbound = active.filter(row => row.inbound_enabled && row.inbound_queue_id && row.inbound_queue_enabled
    && /^\+[1-9][0-9]{7,14}$/.test(row.inbound_did || ''));
  const lines = [
    '; SaleMaX generic UC2000-VE inbound route preview; apply once, then manage DID/queue mappings in SaleMaX.',
    '; The ARI controller resolves each presented DID against current enabled SaleMaX channel policy.',
    '', '[from-dinstar-unrouted]',
    'exten => _+X.,1,NoOp(SaleMaX inbound DID ${EXTEN})',
    ' same => n,Stasis(salemax-call-center,inbound-did,${EXTEN})',
    ' same => n,Hangup()',
    'exten => _X.,1,NoOp(SaleMaX inbound DID ${EXTEN})',
    ' same => n,Stasis(salemax-call-center,inbound-did,${EXTEN})',
    ' same => n,Hangup()',
  ];
  if (!inbound.length) lines.push('; No enabled eligible inbound DID is currently assigned; unknown calls are rejected by SaleMaX.');
  const outboundChannels = active.filter(row => row.outbound_enabled);
  const outboundTenants = [...new Map(outboundChannels.map(row => [row.tenant_id, row])).values()];
  const dinstarOutboundRoutes = outboundChannels.map(row => ({
    channelNo: Number(row.channel_no), tenantId: row.tenant_id, tenantName: row.tenant_name,
    gatewayPort: Number(row.channel_no) - 1, routePrefix: dinstarRoutePrefix(Number(row.channel_no)), digitsToDelete: 4,
  }));
  lines.push('', '; Dinstar UC2000-VE IP->Tel rules; configure manually in Call Configuration -> IP->Tel Routing.',
    '; SaleMaX must prepend the per-channel route prefix only after tenant/channel authorization.',
    '; Dinstar removes the selector before sending the unchanged destination number to the SIM.');
  for (const route of dinstarOutboundRoutes) {
    lines.push('', `; Tenant ${route.tenantId} channel ${route.channelNo} -> gateway Port-${route.gatewayPort}`,
      '; Source: SIP Server', `; Destination: Port-${route.gatewayPort}`, '; Call Restriction: Allow',
      '; Source Prefix: any', `; Destination Prefix: ${route.routePrefix}`, '; Prefix to Add: (blank)',
      `; Digits to be Deleted: ${route.digitsToDelete}`, '; Number of Digits Reserved: (blank)');
  }
  if (!dinstarOutboundRoutes.length) lines.push('; No currently eligible outbound channel is enabled.');
  lines.push('', '; SaleMaX locally implements an ARI outbound controller that enforces tenant entitlement,',
    '; assigned extension, available channel, agent-first answer, and the matching 9901-9904 selector.',
    '; It originates directly through PJSIP and does not require an agent dialplan route.');
  return {
    config: lines.join('\n'),
    inboundRoutes: inbound.map(row => ({ channelNo: Number(row.channel_no), tenantId: row.tenant_id, tenantName: row.tenant_name,
      did: row.inbound_did, queueId: row.inbound_queue_id, queueName: row.inbound_queue_name })),
    dinstarOutboundRoutes,
    outboundEligibleTenants: outboundTenants.map(row => ({ tenantId: row.tenant_id, tenantName: row.tenant_name })),
    warnings: [
      'Preview only. It does not write or reload Asterisk configuration.',
      'Generic _+X. and _X. patterns accept plus-prefixed or digits-only DIDs; SaleMaX normalizes then requires an exact enabled mapping.',
      'The singleton ARI event worker and tenant-aware Stasis call controller are implemented locally; production use still requires deploying the matching source/migrations and operating the worker.',
      'The Dinstar IP->Tel rules map SaleMaX route prefixes 9901–9904 to gateway ports 0–3 and strip four selector digits. Configure these rules manually and test the exact firmware behavior before enabling outbound calls.',
      'Outbound ARI call control is implemented locally and selects only enabled tenant-assigned channels. It is not live until the source/migrations, endpoint profiles, Dinstar routes and worker are deployed and verified together.',
      `${outboundTenants.length} eligible tenant(s) currently have outbound channel policy; this is policy state, not call readiness.`,
    ],
  };
}
async function validateTenant(db, tenantId) {
  if (!tenantId) return;
  const [[tenant]] = await db.query(`SELECT id,status,category_key,category_version FROM sx_tenants WHERE id=? FOR UPDATE`, [tenantId]);
  if (!tenant) fail('TENANT_NOT_FOUND');
  if (!(await eligible(db, tenant))) fail('TENANT_TELEPHONY_UNAVAILABLE');
}
async function save(db, context, body) {
  authorize(context);
  const channels = parsePorts(body?.channels);
  await db.beginTransaction();
  try {
    const [rows] = await db.query(`SELECT channel_no,enabled,inbound_enabled,outbound_enabled,tenant_id,inbound_did,inbound_queue_id,revision
      FROM sx_platform_asterisk_gateway_ports ORDER BY channel_no FOR UPDATE`);
    if (rows.length !== 4) fail('ASTERISK_GATEWAY_CHANNELS_UNAVAILABLE');
    const current = new Map(rows.map(row => [Number(row.channel_no), row]));
    for (const channel of channels) {
      const row = current.get(channel.channelNo);
      if (!row) fail('ASTERISK_GATEWAY_CHANNELS_UNAVAILABLE');
      if (Number(row.revision) !== channel.expectedRevision) fail('STALE_GATEWAY_CHANNEL_REVISION');
      if (channel.tenantId) {
        try { await validateTenant(db, channel.tenantId); }
        catch (error) {
          const unchangedRetiredAssignment = error.code === 'TENANT_TELEPHONY_UNAVAILABLE' && channel.tenantId === (row.tenant_id || null)
            && channel.inboundDid === (row.inbound_did || null) && channel.inboundQueueId === (row.inbound_queue_id || null)
            && !channel.enabled && !channel.inboundEnabled && !channel.outboundEnabled;
          if (!unchangedRetiredAssignment) throw error;
        }
      }
      if (channel.inboundQueueId) {
        if (!channel.tenantId) fail('GATEWAY_TENANT_REQUIRED');
        const [[queue]] = await db.query(`SELECT id,enabled FROM sx_telephony_queues WHERE tenant_id=? AND id=? FOR UPDATE`, [channel.tenantId, channel.inboundQueueId]);
        if (!queue) fail('GATEWAY_QUEUE_TENANT_MISMATCH');
        if (channel.inboundEnabled && !queue.enabled) fail('GATEWAY_QUEUE_DISABLED');
      }
    }
    const changes = [];
    for (const channel of channels) {
      const row = current.get(channel.channelNo);
      const before = { enabled: !!row.enabled, inboundEnabled: !!row.inbound_enabled, outboundEnabled: !!row.outbound_enabled,
        tenantId: row.tenant_id || null, inboundDid: row.inbound_did || null, inboundQueueId: row.inbound_queue_id || null };
      const after = { enabled: channel.enabled, inboundEnabled: channel.inboundEnabled, outboundEnabled: channel.outboundEnabled,
        tenantId: channel.tenantId, inboundDid: channel.inboundDid, inboundQueueId: channel.inboundQueueId };
      const routingChanged = before.tenantId !== after.tenantId || before.inboundDid !== after.inboundDid || before.inboundQueueId !== after.inboundQueueId;
      if (routingChanged && (before.enabled || after.enabled)) fail('GATEWAY_CHANNEL_MUST_BE_DISABLED_FOR_REASSIGNMENT');
      if (before.enabled === after.enabled && before.inboundEnabled === after.inboundEnabled && before.outboundEnabled === after.outboundEnabled
        && before.tenantId === after.tenantId && before.inboundDid === after.inboundDid && before.inboundQueueId === after.inboundQueueId) continue;
      await db.query(`UPDATE sx_platform_asterisk_gateway_ports SET enabled=?,inbound_enabled=?,outbound_enabled=?,tenant_id=?,inbound_did=?,inbound_queue_id=?,revision=revision+1,
        updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE channel_no=?`, [
        after.enabled ? 1 : 0, after.inboundEnabled ? 1 : 0, after.outboundEnabled ? 1 : 0, after.tenantId, after.inboundDid, after.inboundQueueId,
        context.identity.id, channel.channelNo,
      ]);
      changes.push({ channelNo: channel.channelNo, before, after });
    }
    if (changes.length) {
      await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES (?,?,'identity','asterisk.gateway-ports-configured','asterisk-gateway-ports','uc2000ve',?,?)`, [
        crypto.randomUUID(), context.identity.id, JSON.stringify({ changes }), crypto.randomUUID(),
      ]);
    }
    await db.commit();
    return await list(db, context);
  } catch (error) {
    await db.rollback();
    if (error.code === 'ER_DUP_ENTRY') fail('GATEWAY_DID_ALREADY_ASSIGNED');
    throw error;
  }
}

module.exports = { parsePorts, present, dinstarRoutePrefix, list, listTenants, previewRouting, eligible, validateTenant, save };
