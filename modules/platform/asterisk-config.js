'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const secrets = require('./asterisk-secrets');
const { platformDecision } = require('./policy');

const fail = code => { throw Object.assign(new Error(code), { code }); };

async function auditEndpointCredentialAccess(db, context, clientType) {
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES(?,?,?,'identity','telephony.endpoint-credential-accessed','telephony-endpoint',?,?,?)`,[
    crypto.randomUUID(),context.tenant?.id||null,context.identity.id,context.membership?.id||'platform',JSON.stringify({clientType}),crypto.randomUUID()]);
}

function authorize(context) {
  if (!platformDecision(context, 'telephony.configure')) fail('PERMISSION_DENIED');
}

function endpoint(value) {
  if (typeof value !== 'string' || value.length > 512) fail('INVALID_ARI_URL');
  let url;
  try { url = new URL(value); } catch (_) { fail('INVALID_ARI_URL'); }
  if (url.protocol !== 'https:' || !url.hostname || (url.port && !['443', '8089'].includes(url.port)) || url.username || url.password || url.search || url.hash || !['/ari', '/ari/'].includes(url.pathname)) fail('INVALID_ARI_URL');
  return { value: `${url.origin}/ari`, hostname: url.hostname.toLowerCase() };
}

function allowlisted(hostname) {
  const hosts = String(process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS || '')
    .split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  if (!hosts.length) fail('ASTERISK_HOST_ALLOWLIST_REQUIRED');
  if (!hosts.includes(hostname)) fail('ASTERISK_HOST_NOT_ALLOWED');
}

function browserWebsocketUrl(value = process.env.SALEMAX_ASTERISK_WS_URL) {
  if (typeof value !== 'string' || value.length > 512) fail('ASTERISK_BROWSER_WSS_REQUIRED');
  let url;
  try { url = new URL(value); } catch (_) { fail('INVALID_ASTERISK_BROWSER_WSS'); }
  if (url.protocol !== 'wss:' || !url.hostname || (url.port && !['443','8089'].includes(url.port))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/ws') fail('INVALID_ASTERISK_BROWSER_WSS');
  allowlisted(url.hostname.toLowerCase());
  return url;
}

function mobileSipHost(value = process.env.SALEMAX_ASTERISK_MOBILE_SIP_HOST) {
  if (typeof value !== 'string' || value.length > 253 || !value || value !== value.trim()) fail('ASTERISK_MOBILE_SIP_HOST_REQUIRED');
  let hostname=value.toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname=hostname.slice(1,-1);
  if (net.isIP(hostname)===0 && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) fail('INVALID_ASTERISK_MOBILE_SIP_HOST');
  allowlisted(hostname);
  return hostname;
}

async function ownBrowserEndpoint(db, context) {
  const { decision } = require('./policy');
  const access = decision(context, { capability: 'telephony.call-center', permission: 'calls.control' });
  if (!access.allowed) fail(access.code);
  const [[pbx]] = await db.query('SELECT enabled FROM sx_platform_asterisk_config WHERE id=1');
  if (!pbx?.enabled) fail('ASTERISK_CONTROL_NOT_READY');
  const [[row]] = await db.query(`SELECT x.extension,x.browser_credential_revision,m.status AS membership_status,i.status AS identity_status,t.status AS tenant_status
    FROM sx_telephony_extensions x JOIN sx_memberships m ON m.tenant_id=x.tenant_id AND m.id=x.membership_id
    JOIN sx_identities i ON i.id=m.identity_id JOIN sx_tenants t ON t.id=m.tenant_id
    WHERE x.tenant_id=? AND x.membership_id=?`, [context.tenant.id,context.membership.id]);
  if (!row || !row.extension || row.membership_status !== 'active' || row.identity_status !== 'active' || row.tenant_status !== 'active') fail('SIP_ENDPOINT_NOT_PROVISIONED');
  const server = browserWebsocketUrl();
  const username = `${row.extension}-browser`;
  const config={ server:server.toString(), uri:`sip:${username}@${server.hostname}`, authorizationUsername:username,
    authorizationPassword:secrets.endpointCredential({tenantId:context.tenant.id,membershipId:context.membership.id,
      extension:row.extension,clientType:'browser',revision:Number(row.browser_credential_revision)}) };
  await auditEndpointCredentialAccess(db,context,'browser');
  return config;
}

async function ownMobileEndpoint(db, context) {
  const { decision } = require('./policy');
  const access=decision(context,{capability:'telephony.call-center',permission:'calls.control'});
  if(!access.allowed)fail(access.code);
  const [[pbx]]=await db.query('SELECT enabled FROM sx_platform_asterisk_config WHERE id=1');
  if(!pbx?.enabled)fail('ASTERISK_CONTROL_NOT_READY');
  const [[row]]=await db.query(`SELECT x.extension,x.mobile_credential_revision,m.status AS membership_status,i.status AS identity_status,t.status AS tenant_status
    FROM sx_telephony_extensions x JOIN sx_memberships m ON m.tenant_id=x.tenant_id AND m.id=x.membership_id
    JOIN sx_identities i ON i.id=m.identity_id JOIN sx_tenants t ON t.id=m.tenant_id
    WHERE x.tenant_id=? AND x.membership_id=?`,[context.tenant.id,context.membership.id]);
  if(!row||!row.extension||row.membership_status!=='active'||row.identity_status!=='active'||row.tenant_status!=='active')fail('SIP_ENDPOINT_NOT_PROVISIONED');
  const host=mobileSipHost(),username=`${row.extension}-mobile`;
  const config={host,port:5061,transport:'TLS',mediaEncryption:'SRTP',uri:`sip:${username}@${host}`,username,
    password:secrets.endpointCredential({tenantId:context.tenant.id,membershipId:context.membership.id,extension:row.extension,clientType:'mobile',revision:Number(row.mobile_credential_revision)})};
  await auditEndpointCredentialAccess(db,context,'mobile');
  return config;
}

function gateway(input) {
  const host = input.gatewayHost === undefined ? '' : input.gatewayHost;
  const port = input.gatewaySipPort === undefined ? 5061 : input.gatewaySipPort;
  const transport = input.gatewaySipTransport === undefined ? 'tls' : input.gatewaySipTransport;
  if (typeof host !== 'string' || host.length > 253 || (host && (host !== host.trim() || net.isIP(host) === 0))) fail('INVALID_GATEWAY_IP');
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('INVALID_GATEWAY_PORT');
  if (!['udp', 'tcp', 'tls'].includes(transport)) fail('INVALID_GATEWAY_TRANSPORT');
  if (transport !== 'tls') fail('INSECURE_GATEWAY_TRANSPORT');
  return { host, port, transport };
}

function gatewayPjsipPreview(row) {
  const host = String(row.gateway_host || '').trim();
  const ipVersion = net.isIP(host);
  if (!ipVersion) fail(host ? 'INVALID_GATEWAY_IP' : 'GATEWAY_IP_REQUIRED');
  const port = Number(row.gateway_sip_port || 5061);
  const transport = row.gateway_sip_transport || 'tls';
  const hostUri = ipVersion === 6 ? `[${host}]` : host;
  const scheme = transport === 'tls' ? 'sips' : 'sip';
  const transportParameter = transport === 'tcp' ? '\\;transport=tcp' : '';
  return {
    gatewayIp: host,
    port,
    transport,
    config: [
      '; SaleMaX starter peer for Dinstar UC2000-VE (four-channel model)',
      '; Review with the installed Asterisk version and existing PJSIP transports before applying.',
      '; The gateway address must be static/reserved; firewall rules must allow its TLS SIP and bounded RTP range only from this source IP.',
      '; Inbound calls land in an intentionally unrouted context until tenant DID/queue routing is configured.',
      '',
      '[salemax_dinstar_uc2000ve]',
      'type=endpoint',
      'context=from-dinstar-unrouted',
      'disallow=all',
      'allow=alaw,ulaw',
      'transport=transport-salemax-tls',
      'media_encryption=sdes',
      'media_encryption_optimistic=no',
      'aors=salemax_dinstar_uc2000ve',
      'direct_media=no',
      'rtp_symmetric=yes',
      'force_rport=yes',
      'rewrite_contact=yes',
      '',
      '[salemax_dinstar_uc2000ve]',
      'type=aor',
      `contact=${scheme}:${hostUri}:${port}${transportParameter}`,
      'qualify_frequency=30',
      '',
      '[salemax_dinstar_uc2000ve_identify]',
      'type=identify',
      'endpoint=salemax_dinstar_uc2000ve',
      `match=${host}`,
      '',
      '; The endpoint requires a configured PJSIP TLS transport named transport-salemax-tls.',
      '; Configure transport-salemax-tls with protocol=tls, bind=<public-ip>:<tls-port>, and protected cert_file/priv_key_file paths.',
      '; Keep SIP TLS limited to the gateway and authenticated phone clients using host firewall and rate limits.',
      '',
    ].join('\n'),
    warnings: [
      'This config requires TLS signaling and SDES-SRTP on the Dinstar peer. The datasheet lists both, but confirm the exact firmware and configure matching TLS/SRTP settings there.',
      'This config defines only the gateway PJSIP peer. It does not configure a dialplan, SIM ports, carrier routes, tenant extensions, queues, or call-control events.',
      'Create an explicit inbound route in context from-dinstar-unrouted before routing calls to any tenant.',
      `Ensure an Asterisk PJSIP ${transport.toUpperCase()} transport already exists. For the selected direct-internet topology, allow TLS SIP and the required bounded RTP range only from this configured gateway source IP; keep ARI/AMI management access restricted to SaleMaX server addresses.`,
      'Apply through your normal Asterisk configuration-management process, then verify the endpoint and a synthetic call before enabling users.',
    ],
  };
}

function present(row) {
  const configured = !!(row.ari_base_url && row.ari_username && row.credential_ciphertext);
  return {
    configured,
    enabled: !!row.enabled && configured,
    ariBaseUrl: row.ari_base_url || '',
    ariUsername: row.ari_username || '',
    gatewayHost: row.gateway_host || '',
    gatewaySipPort: Number(row.gateway_sip_port || 5061),
    gatewaySipTransport: row.gateway_sip_transport || 'tls',
    gatewayEndpointStatus: row.gateway_endpoint_status || 'not_tested',
    gatewayEndpointTestedAt: row.gateway_endpoint_tested_at || null,
    hasCredential: !!row.credential_ciphertext,
    revision: Number(row.revision),
    lastTestedAt: row.last_tested_at || null,
    lastTestStatus: row.last_test_status || null,
    lastTestVersion: row.last_test_version || null,
    updatedAt: row.updated_at || null,
  };
}

async function get(db, context) {
  authorize(context);
  const [[row]] = await db.query(`SELECT ari_base_url,ari_username,gateway_host,gateway_sip_port,gateway_sip_transport,gateway_endpoint_status,gateway_endpoint_tested_at,credential_ciphertext,enabled,revision,last_tested_at,last_test_status,last_test_version,updated_at
    FROM sx_platform_asterisk_config WHERE id=1`);
  if (!row) fail('ASTERISK_CONFIG_UNAVAILABLE');
  const [[runtime]] = await db.query(`SELECT status,worker_id,config_revision,connected_at,last_event_at,last_event_type,events_received,error_code,updated_at
    FROM sx_platform_asterisk_runtime WHERE id=1`);
  return { ...present(row), ariEvents: runtime ? {
    status: runtime.status,
    workerId: runtime.worker_id || null,
    configRevision: runtime.config_revision == null ? null : Number(runtime.config_revision),
    connectedAt: runtime.connected_at || null,
    lastEventAt: runtime.last_event_at || null,
    lastEventType: runtime.last_event_type || null,
    eventsReceived: Number(runtime.events_received || 0),
    errorCode: runtime.error_code || null,
    updatedAt: runtime.updated_at || null,
  } : { status: 'not_configured', eventsReceived: 0 } };
}

async function previewGateway(db, context) {
  authorize(context);
  const [[row]] = await db.query(`SELECT gateway_host,gateway_sip_port,gateway_sip_transport FROM sx_platform_asterisk_config WHERE id=1`);
  if (!row) fail('ASTERISK_CONFIG_UNAVAILABLE');
  return gatewayPjsipPreview(row);
}

async function previewAgentEndpoints(db, context) {
  authorize(context);
  const [rows] = await db.query(`SELECT x.tenant_id,x.membership_id,x.extension,x.mobile_credential_revision,x.browser_credential_revision FROM sx_telephony_extensions x
    JOIN sx_memberships m ON m.tenant_id=x.tenant_id AND m.id=x.membership_id AND m.status='active'
    JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
    JOIN sx_tenants t ON t.id=x.tenant_id AND t.status='active'
    WHERE m.role IN ('owner','manager','agent') AND x.extension REGEXP '^[0-9]{3,8}$' ORDER BY x.extension`);
  const lines = [
    '; SaleMaX agent endpoint templates for Asterisk 20 PJSIP. See https://docs.asterisk.org/Configuration/WebRTC/Configuring-Asterisk-for-WebRTC-Clients/.',
    '; Apply only after setting up TLS/WSS listeners, certificates, RTP firewall limits, and an unrouted context.',
    '; Passwords below are unique derived SIP endpoint secrets; they are separate from the ARI credential.',
    '; This preview derives credentials for authenticated member access but does not install/reload Asterisk configuration.',
    '',
    '[transport-salemax-mobile-tls]', 'type=transport', 'protocol=tls', 'bind=0.0.0.0:5061', 'method=tlsv1_2',
    'cert_file=/etc/asterisk/keys/pbx.crt', 'priv_key_file=/etc/asterisk/keys/pbx.key', 'verify_client=no', 'allow_reload=yes', '',
    '; Configure res_http_websocket and TLS certificate/key in http.conf before enabling browser clients.',
    '[transport-salemax-browser-wss]', 'type=transport', 'protocol=wss', 'bind=0.0.0.0', 'allow_reload=yes', '',
    '[from-salemax-agents-unrouted]',
    'exten => _X!,1,NoOp(Agent call route disabled until tenant-bound Stasis control is deployed)', ' same => n,Hangup(21)', '',
  ];
  for (const row of rows) {
    const ext = String(row.extension);
    if (!/^[0-9]{3,8}$/.test(ext)) continue;
    for (const client of ['mobile', 'browser']) {
      const suffix = `${ext}-${client}`;
      const password = secrets.endpointCredential({tenantId:row.tenant_id,membershipId:row.membership_id,extension:ext,clientType:client,
        revision:Number(client==='mobile'?row.mobile_credential_revision:row.browser_credential_revision)});
      lines.push(`[salemax-${suffix}-auth]`, 'type=auth', 'auth_type=userpass', `username=${ext}-${client}`,
        `password=${password}`, '',
        `[salemax-${suffix}-aor]`, 'type=aor', 'max_contacts=2', 'remove_existing=yes', 'qualify_frequency=30', '',
        `[salemax-${suffix}]`, 'type=endpoint', 'context=from-salemax-agents-unrouted', 'disallow=all', 'allow=alaw,ulaw',
        `auth=salemax-${suffix}-auth`, `aors=salemax-${suffix}-aor`, 'direct_media=no', 'rtp_symmetric=yes', 'force_rport=yes',
        'rewrite_contact=yes');
      if (client === 'mobile') lines.push('transport=transport-salemax-mobile-tls', 'media_encryption=sdes', 'media_encryption_optimistic=no');
      else lines.push('transport=transport-salemax-browser-wss', 'webrtc=yes', 'use_avpf=yes', 'media_encryption=dtls',
        'dtls_verify=fingerprint', 'dtls_setup=actpass', 'ice_support=yes', 'rtcp_mux=yes');
      lines.push('');
    }
  }
  await auditEndpointCredentialAccess(db,context,'mobile-and-browser');
  return {
    extensions: rows.map(row => String(row.extension)).filter(ext => /^[0-9]{3,8}$/.test(ext)), config: lines.join('\n'),
    warnings: [
      'This privileged preview contains derived endpoint passwords. Restrict access, copy it only into protected Asterisk config, and never attach or log the output.',
      'The browser profile requires a valid HTTPS/WSS certificate, Asterisk HTTP/WebSocket support, reachable ICE/STUN/TURN media, and browser codec testing.',
      'The mobile profile requires a compatible SIP app configured for TLS signaling and SDES-SRTP; confirm these options in the selected app.',
      'Agent dialplan is intentionally unrouted for direct inbound dialing. SaleMaX locally implements tenant-bound call authorization and the ARI call controller; this endpoint preview does not install/reload configuration or enable live calls.',
      'Do not open SIP, WSS, or RTP to all internet sources. Restrict signaling and media exposure and apply rate limits before activating listeners.',
    ],
  };
}

async function save(db, context, input) {
  authorize(context);
  if (!input || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || typeof input.enabled !== 'boolean') fail('INVALID_ARI_CONFIG');
  const target = endpoint(input.ariBaseUrl);
  const gatewaySettings = gateway(input);
  if (typeof input.ariUsername !== 'string' || !/^[A-Za-z0-9_.@-]{1,128}$/.test(input.ariUsername)) fail('INVALID_ARI_USERNAME');
  await db.beginTransaction();
  try {
    const [[old]] = await db.query(`SELECT ari_base_url,ari_username,gateway_host,gateway_sip_port,gateway_sip_transport,credential_ciphertext,credential_iv,credential_auth_tag,enabled,revision
      FROM sx_platform_asterisk_config WHERE id=1 FOR UPDATE`);
    if (!old) fail('ASTERISK_CONFIG_UNAVAILABLE');
    if (Number(old.revision) !== input.expectedRevision) fail('STALE_REVISION');
    const encrypted = input.ariPassword === undefined || input.ariPassword === '' ? null : secrets.encrypt(input.ariPassword);
    if (input.enabled && !encrypted && !old.credential_ciphertext) fail('ARI_CREDENTIAL_REQUIRED');
    const revision = Number(old.revision) + 1;
    await db.query(`UPDATE sx_platform_asterisk_config SET ari_base_url=?,ari_username=?,gateway_host=?,gateway_sip_port=?,gateway_sip_transport=?,credential_ciphertext=?,credential_iv=?,credential_auth_tag=?,
      enabled=?,revision=?,last_tested_at=NULL,last_test_status=NULL,last_test_version=NULL,gateway_endpoint_status=NULL,gateway_endpoint_tested_at=NULL,updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=1`, [
      target.value, input.ariUsername, gatewaySettings.host, gatewaySettings.port, gatewaySettings.transport,
      encrypted?.ciphertext ?? old.credential_ciphertext,
      encrypted?.iv ?? old.credential_iv,
      encrypted?.authTag ?? old.credential_auth_tag,
      input.enabled ? 1 : 0, revision, context.identity.id,
    ]);
    await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,'identity','asterisk.configured','asterisk-config','primary',?,?)`, [
      crypto.randomUUID(), context.identity.id,
      JSON.stringify({ ariHost: target.hostname, gatewayHost: gatewaySettings.host || null, gatewaySipPort: gatewaySettings.port,
        gatewaySipTransport: gatewaySettings.transport, enabled: input.enabled, credentialRotated: !!encrypted, revision }), crypto.randomUUID(),
    ]);
    await db.commit();
    return { configured: true, enabled: input.enabled, ariBaseUrl: target.value, ariUsername: input.ariUsername,
      gatewayHost: gatewaySettings.host, gatewaySipPort: gatewaySettings.port, gatewaySipTransport: gatewaySettings.transport,
      hasCredential: true, revision, updatedAt: new Date().toISOString() };
  } catch (error) {
    await db.rollback();
    throw error;
  }
}

async function test(db, context, fetchImpl = globalThis.fetch) {
  authorize(context);
  const [[row]] = await db.query(`SELECT ari_base_url,ari_username,credential_ciphertext,credential_iv,credential_auth_tag,enabled,revision
    FROM sx_platform_asterisk_config WHERE id=1`);
  if (!row || !row.credential_ciphertext || !row.ari_base_url || !row.ari_username) fail('ARI_CREDENTIAL_REQUIRED');
  const target = endpoint(row.ari_base_url);
  allowlisted(target.hostname);
  const password = secrets.decrypt(row);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const started = Date.now();
  let version;
  let gatewayEndpointStatus = 'unknown';
  try {
    const response = await fetchImpl(`${target.value}/asterisk/info?only=system`, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${row.ari_username}:${password}`).toString('base64')}` },
    });
    if (response.status === 401 || response.status === 403) fail('ARI_AUTH_REJECTED');
    if (!response.ok) fail('ARI_UNAVAILABLE');
    let info;
    try { info = await response.json(); } catch (_) { fail('ARI_INVALID_RESPONSE'); }
    version = info?.system?.version;
    if (typeof version !== 'string' || version.length > 80) fail('ARI_INVALID_RESPONSE');
  } catch (error) {
    const code = error.code && ['ARI_AUTH_REJECTED', 'ARI_UNAVAILABLE', 'ARI_INVALID_RESPONSE'].includes(error.code)
      ? error.code : error.name === 'AbortError' ? 'ARI_TIMEOUT' : 'ARI_UNREACHABLE';
    await recordTest(db, context, Number(row.revision), target.hostname, 'failed', null, code);
    fail(code);
  } finally {
    clearTimeout(timer);
  }
  gatewayEndpointStatus = await probeGatewayEndpoint(fetchImpl, target.value, row.ari_username, password);
  await recordTest(db, context, Number(row.revision), target.hostname, 'success', version, null, gatewayEndpointStatus);
  return { connected: true, asteriskVersion: version, latencyMs: Date.now() - started, enabled: !!row.enabled,
    gatewayEndpoint: { name: 'salemax_dinstar_uc2000ve', status: gatewayEndpointStatus }, testedAt: new Date().toISOString() };
}

async function probeGatewayEndpoint(fetchImpl, ariBaseUrl, username, password) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(`${ariBaseUrl}/endpoints/PJSIP/salemax_dinstar_uc2000ve`, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
    });
    if (response.status === 404) return 'not_configured';
    if (!response.ok) return 'unknown';
    const endpointInfo = await response.json();
    if (endpointInfo?.technology !== 'PJSIP' || endpointInfo?.resource !== 'salemax_dinstar_uc2000ve') return 'unknown';
    return ['online', 'offline', 'unknown'].includes(endpointInfo.state) ? endpointInfo.state : 'unknown';
  } catch (_) {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

async function recordTest(db, context, revision, hostname, status, version, failureCode = null, gatewayEndpointStatus = null) {
  await db.beginTransaction();
  try {
    const [result] = await db.query(`UPDATE sx_platform_asterisk_config SET last_tested_at=UTC_TIMESTAMP(3),last_test_status=?,last_test_version=?,
      gateway_endpoint_status=?,gateway_endpoint_tested_at=IF(? IS NULL,NULL,UTC_TIMESTAMP(3)) WHERE id=1 AND revision=?`, [status, version, gatewayEndpointStatus, gatewayEndpointStatus, revision]);
    if (result.affectedRows !== 1) fail('ASTERISK_CONFIG_CHANGED_DURING_TEST');
    await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,'identity','asterisk.connection-tested','asterisk-config','primary',?,?)`, [
      crypto.randomUUID(), context.identity.id,
      JSON.stringify({ ariHost: hostname, result: status, ...(version ? { asteriskVersion: version } : {}),
        ...(gatewayEndpointStatus ? { gatewayEndpointStatus } : {}), ...(failureCode ? { failureCode } : {}) }),
      crypto.randomUUID(),
    ]);
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  }
}

module.exports = { endpoint, allowlisted, browserWebsocketUrl, mobileSipHost, ownBrowserEndpoint, ownMobileEndpoint, gateway, gatewayPjsipPreview, present, get, previewGateway, previewAgentEndpoints, save, test };
