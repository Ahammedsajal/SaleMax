'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const secrets = require('./asterisk-secrets');
const { platformDecision } = require('./policy');

const fail = code => { throw Object.assign(new Error(code), { code }); };

const REQUIRED_MODULES = Object.freeze({
  callControl: ['chan_pjsip', 'res_pjsip', 'res_pjsip_endpoint_identifier_ip', 'res_pjsip_transport_tls',
    'res_ari', 'res_ari_channels', 'res_ari_bridges', 'app_stasis', 'res_stasis'],
  gatewayProvisioning: ['res_sorcery_astdb'],
  browserWebrtc: ['res_http_websocket', 'res_pjsip_transport_websocket', 'codec_opus_open_source', 'res_format_attr_opus'],
  sipSecurityLogging: ['res_security_log'],
});

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

async function applyMemberEndpoint(db, context, extension, clientType, extensionRevision, credentialRevision, asteriskConfig, password, clientFactory) {
  if (!/^[0-9]{3,8}$/.test(extension || '') || !['mobile', 'browser'].includes(clientType)
    || !Number.isSafeInteger(extensionRevision) || extensionRevision < 1
    || !Number.isSafeInteger(credentialRevision) || credentialRevision < 1
    || !Number.isSafeInteger(Number(asteriskConfig?.revision)) || Number(asteriskConfig.revision) < 0
    || typeof password !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(password)) fail('INVALID_SIP_ENDPOINT');
  const [[applied]] = await db.query(`SELECT extension,extension_revision,credential_revision,asterisk_config_revision
    FROM sx_telephony_endpoint_provisioning WHERE tenant_id=? AND membership_id=? AND client_type=?`,
  [context.tenant.id, context.membership.id, clientType]);
  if (applied && applied.extension === extension && Number(applied.extension_revision) === extensionRevision
    && Number(applied.credential_revision) === credentialRevision
    && Number(applied.asterisk_config_revision) === Number(asteriskConfig.revision)) return { changed: false };
  const client = await (clientFactory || ((connection, config) => require('./asterisk-ari-client').createAriClient(config, { pool: connection })))(db, asteriskConfig);
  const username = `${extension}-${clientType}`;
  const authId = `salemax-${username}-auth`;
  const aorId = `salemax-${username}-aor`;
  const endpointId = `salemax-${username}`;
  const correlationId = crypto.randomUUID();
  let objectsApplied = 0;
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,?,'identity','telephony.endpoint-provision-requested','telephony-endpoint',?,?,?)`, [
    crypto.randomUUID(), context.tenant.id, context.identity.id, context.membership.id,
    JSON.stringify({ clientType, extension, extensionRevision, credentialRevision }), correlationId,
  ]);
  try {
    const [staleProfiles] = await db.query(`SELECT client_type,extension FROM sx_telephony_endpoint_provisioning
      WHERE tenant_id=? AND membership_id=? AND extension<>?`, [context.tenant.id, context.membership.id, extension]);
    for (const stale of staleProfiles) {
      const staleUser = `${stale.extension}-${stale.client_type}`;
      await client.deletePjsipObject('endpoint', `salemax-${staleUser}`);
      await client.deletePjsipObject('aor', `salemax-${staleUser}-aor`);
      await client.deletePjsipObject('auth', `salemax-${staleUser}-auth`);
      await db.query(`DELETE FROM sx_telephony_endpoint_provisioning WHERE tenant_id=? AND membership_id=? AND client_type=?`,
        [context.tenant.id, context.membership.id, stale.client_type]);
    }
    await client.upsertPjsipObject('auth', authId, [
      { attribute: 'auth_type', value: 'userpass' },
      { attribute: 'username', value: username },
      { attribute: 'password', value: password },
    ]);
    objectsApplied++;
    await client.upsertPjsipObject('aor', aorId, [
      { attribute: 'max_contacts', value: '2' },
      { attribute: 'remove_existing', value: 'yes' },
      { attribute: 'qualify_frequency', value: '30' },
    ]);
    objectsApplied++;
    const fields = [
      { attribute: 'context', value: 'from-salemax-agents-unrouted' },
      { attribute: 'disallow', value: 'all' },
      { attribute: 'allow', value: clientType === 'browser' ? 'opus,alaw,ulaw' : 'alaw,ulaw' },
      { attribute: 'auth', value: authId },
      { attribute: 'aors', value: aorId },
      { attribute: 'direct_media', value: 'no' },
      { attribute: 'rtp_symmetric', value: 'yes' },
      { attribute: 'force_rport', value: 'yes' },
      { attribute: 'rewrite_contact', value: 'yes' },
    ];
    if (clientType === 'mobile') fields.push(
      { attribute: 'transport', value: 'transport-salemax-tls' },
      { attribute: 'media_encryption', value: 'sdes' },
      { attribute: 'media_encryption_optimistic', value: 'no' },
    );
    else fields.push(
      { attribute: 'transport', value: 'transport-salemax-browser-wss' },
      { attribute: 'webrtc', value: 'yes' },
      { attribute: 'use_avpf', value: 'yes' },
      { attribute: 'media_encryption', value: 'dtls' },
      { attribute: 'dtls_verify', value: 'fingerprint' },
      { attribute: 'dtls_setup', value: 'actpass' },
      { attribute: 'ice_support', value: 'yes' },
      { attribute: 'rtcp_mux', value: 'yes' },
    );
    await client.upsertPjsipObject('endpoint', endpointId, fields);
    objectsApplied++;
    await db.query(`INSERT INTO sx_telephony_endpoint_provisioning(tenant_id,membership_id,client_type,extension,extension_revision,credential_revision,asterisk_config_revision,applied_at)
      VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE extension=VALUES(extension),extension_revision=VALUES(extension_revision),
      credential_revision=VALUES(credential_revision),asterisk_config_revision=VALUES(asterisk_config_revision),applied_at=UTC_TIMESTAMP(3)`,
    [context.tenant.id, context.membership.id, clientType, extension, extensionRevision, credentialRevision, Number(asteriskConfig.revision)]);
  } catch (error) {
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','telephony.endpoint-provision-failed','telephony-endpoint',?,?,?)`, [
      crypto.randomUUID(), context.tenant.id, context.identity.id, context.membership.id,
      JSON.stringify({ clientType, extension, extensionRevision, credentialRevision, objectsApplied,
        failureCode: /^[A-Z0-9_]{2,80}$/.test(error.code || '') ? error.code : 'ARI_UNAVAILABLE' }), correlationId,
    ]);
    throw error;
  }
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,?,'identity','telephony.endpoint-provisioned','telephony-endpoint',?,?,?)`, [
    crypto.randomUUID(), context.tenant.id, context.identity.id, context.membership.id,
    JSON.stringify({ clientType, extension, extensionRevision, credentialRevision, objects: objectsApplied }), correlationId,
  ]);
  return { changed: true };
}

async function ownBrowserEndpoint(db, context, clientFactory) {
  const { decision } = require('./policy');
  const access = decision(context, { capability: 'telephony.call-center', permission: 'calls.control' });
  if (!access.allowed) fail(access.code);
  const [[pbx]] = await db.query(`SELECT enabled,revision,ari_base_url,ari_username,credential_ciphertext,credential_iv,credential_auth_tag
    FROM sx_platform_asterisk_config WHERE id=1`);
  if (!pbx?.enabled) fail('ASTERISK_CONTROL_NOT_READY');
  const [[row]] = await db.query(`SELECT x.extension,x.revision AS extension_revision,x.browser_credential_revision,m.status AS membership_status,i.status AS identity_status,t.status AS tenant_status
    FROM sx_telephony_extensions x JOIN sx_memberships m ON m.tenant_id=x.tenant_id AND m.id=x.membership_id
    JOIN sx_identities i ON i.id=m.identity_id JOIN sx_tenants t ON t.id=m.tenant_id
    WHERE x.tenant_id=? AND x.membership_id=?`, [context.tenant.id,context.membership.id]);
  if (!row || !row.extension || row.membership_status !== 'active' || row.identity_status !== 'active' || row.tenant_status !== 'active') fail('SIP_ENDPOINT_NOT_PROVISIONED');
  const server = browserWebsocketUrl();
  const username = `${row.extension}-browser`;
  const revision = Number(row.browser_credential_revision);
  const authorizationPassword = secrets.endpointCredential({tenantId:context.tenant.id,membershipId:context.membership.id,
    extension:row.extension,clientType:'browser',revision});
  await applyMemberEndpoint(db, context, row.extension, 'browser', Number(row.extension_revision), revision, pbx, authorizationPassword, clientFactory);
  const config={ server:server.toString(), uri:`sip:${username}@${server.hostname}`, authorizationUsername:username,
    authorizationPassword };
  await auditEndpointCredentialAccess(db,context,'browser');
  return config;
}

async function ownMobileEndpoint(db, context, clientFactory) {
  const { decision } = require('./policy');
  const access=decision(context,{capability:'telephony.call-center',permission:'calls.control'});
  if(!access.allowed)fail(access.code);
  const [[pbx]]=await db.query(`SELECT enabled,revision,ari_base_url,ari_username,credential_ciphertext,credential_iv,credential_auth_tag
    FROM sx_platform_asterisk_config WHERE id=1`);
  if(!pbx?.enabled)fail('ASTERISK_CONTROL_NOT_READY');
  const [[row]]=await db.query(`SELECT x.extension,x.revision AS extension_revision,x.mobile_credential_revision,m.status AS membership_status,i.status AS identity_status,t.status AS tenant_status
    FROM sx_telephony_extensions x JOIN sx_memberships m ON m.tenant_id=x.tenant_id AND m.id=x.membership_id
    JOIN sx_identities i ON i.id=m.identity_id JOIN sx_tenants t ON t.id=m.tenant_id
    WHERE x.tenant_id=? AND x.membership_id=?`,[context.tenant.id,context.membership.id]);
  if(!row||!row.extension||row.membership_status!=='active'||row.identity_status!=='active'||row.tenant_status!=='active')fail('SIP_ENDPOINT_NOT_PROVISIONED');
  const host=mobileSipHost(),username=`${row.extension}-mobile`;
  const revision=Number(row.mobile_credential_revision);
  const password=secrets.endpointCredential({tenantId:context.tenant.id,membershipId:context.membership.id,extension:row.extension,clientType:'mobile',revision});
  await applyMemberEndpoint(db,context,row.extension,'mobile',Number(row.extension_revision),revision,pbx,password,clientFactory);
  const config={host,port:5061,transport:'TLS',mediaEncryption:'SRTP',uri:`sip:${username}@${host}`,username,
    password};
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
      '; The gateway address must be static/reserved. Restrict its source at the edge/SBC where possible; the shared TLS listener also serves mobile SIP clients.',
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
      '; This shared TLS listener serves both the gateway and mobile SIP apps; harden SIP authentication before public exposure.',
      '',
    ].join('\n'),
    warnings: [
      'This config requires TLS signaling and SDES-SRTP on the Dinstar peer. The datasheet lists both, but confirm the exact firmware and configure matching TLS/SRTP settings there.',
      'This config defines only the gateway PJSIP peer. Mobile softphones share the same TLS transport; do not create a second TLS listener on the same Asterisk IP family. It does not configure a dialplan, SIM ports, carrier routes, tenant extensions, queues, or call-control events.',
      'Create an explicit inbound route in context from-dinstar-unrouted before routing calls to any tenant.',
      `Ensure an Asterisk PJSIP ${transport.toUpperCase()} transport already exists. The shared TLS listener serves the gateway and mobile SIP apps, so a gateway-only host firewall allowlist would block remote agents; use a VPN/SBC for mobile SIP or apply strong authenticated SIP rate limits and intrusion blocking. Restrict the Dinstar source at the network/SBC layer where possible, scope RTP media exposure, and keep ARI/AMI private to SaleMaX server addresses.`,
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
  const [[runtime]] = await db.query(`SELECT status,worker_id,config_revision,connected_at,last_event_at,last_event_type,events_received,error_code,updated_at,
      (status='connected' AND updated_at>=UTC_TIMESTAMP(3)-INTERVAL 15 SECOND) AS heartbeat_fresh
    FROM sx_platform_asterisk_runtime WHERE id=1`);
  return { ...present(row), ariEvents: runtime ? {
    status: runtime.status,
    ready: Number(runtime.heartbeat_fresh) === 1,
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

async function applyGatewayPeer(db, context, clientFactory) {
  authorize(context);
  const [[row]] = await db.query(`SELECT ari_base_url,ari_username,credential_ciphertext,credential_iv,credential_auth_tag,
    gateway_host,gateway_sip_port,gateway_sip_transport,enabled,revision,last_test_status
    FROM sx_platform_asterisk_config WHERE id=1`);
  if (!row) fail('ASTERISK_CONFIG_UNAVAILABLE');
  if (!row.enabled) fail('ASTERISK_CONTROL_NOT_READY');
  if (row.last_test_status !== 'success') fail('ASTERISK_CONNECTION_TEST_REQUIRED');
  const preview = gatewayPjsipPreview(row);
  const client = await (clientFactory || ((connection, config) => require('./asterisk-ari-client').createAriClient(config, { pool: connection })))(db, row);
  const hostUri = net.isIP(preview.gatewayIp) === 6 ? `[${preview.gatewayIp}]` : preview.gatewayIp;
  const aor = 'salemax_dinstar_uc2000ve';
  const endpointId = 'salemax_dinstar_uc2000ve';
  const identify = 'salemax_dinstar_uc2000ve_identify';
  const correlationId = crypto.randomUUID();
  let objectsApplied = 0;
  await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,'identity','asterisk.gateway-peer-apply-requested','asterisk-config','dinstar-uc2000ve',?,?)`, [
    crypto.randomUUID(), context.identity.id, JSON.stringify({ gatewayIp: preview.gatewayIp, revision: Number(row.revision) }), correlationId,
  ]);
  try {
    await client.upsertPjsipObject('aor', aor, [
      { attribute: 'contact', value: `sips:${hostUri}:${preview.port}` },
      { attribute: 'qualify_frequency', value: '30' },
    ]);
    objectsApplied++;
    await client.upsertPjsipObject('endpoint', endpointId, [
      { attribute: 'context', value: 'from-dinstar-unrouted' },
      { attribute: 'disallow', value: 'all' },
      { attribute: 'allow', value: 'alaw,ulaw' },
      { attribute: 'transport', value: 'transport-salemax-tls' },
      { attribute: 'media_encryption', value: 'sdes' },
      { attribute: 'media_encryption_optimistic', value: 'no' },
      { attribute: 'aors', value: aor },
      { attribute: 'direct_media', value: 'no' },
      { attribute: 'rtp_symmetric', value: 'yes' },
      { attribute: 'force_rport', value: 'yes' },
      { attribute: 'rewrite_contact', value: 'yes' },
    ]);
    objectsApplied++;
    await client.upsertPjsipObject('identify', identify, [
      { attribute: 'endpoint', value: endpointId },
      { attribute: 'match', value: preview.gatewayIp },
    ]);
    objectsApplied++;
  } catch (error) {
    await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,'identity','asterisk.gateway-peer-apply-failed','asterisk-config','dinstar-uc2000ve',?,?)`, [
      crypto.randomUUID(), context.identity.id, JSON.stringify({ gatewayIp: preview.gatewayIp, revision: Number(row.revision),
        objectsApplied, failureCode: /^[A-Z0-9_]{2,80}$/.test(error.code || '') ? error.code : 'ARI_UNAVAILABLE' }), correlationId,
    ]);
    throw error;
  }
  await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,'identity','asterisk.gateway-peer-applied','asterisk-config','dinstar-uc2000ve',?,?)`, [
    crypto.randomUUID(), context.identity.id, JSON.stringify({ gatewayIp: preview.gatewayIp, revision: Number(row.revision), objects: 3 }), correlationId,
  ]);
  return { applied: true, gatewayIp: preview.gatewayIp, objects: objectsApplied, revision: Number(row.revision),
    note: 'Asterisk dynamic PJSIP objects were accepted. The TLS transport, unrouted dialplan context, firewall, and Dinstar settings remain separate prerequisites.' };
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
    '; Mobile softphones and the Dinstar peer share one TLS listener (transport-salemax-tls); do not define duplicate TLS transports.',
    '; Apply only after setting up the TLS/WSS listeners, certificates, RTP firewall limits, and unrouted contexts.',
    '; Passwords below are unique derived SIP endpoint secrets; they are separate from the ARI credential.',
    '; This preview derives credentials for authenticated member access but does not install/reload Asterisk configuration.',
    '',
    '[transport-salemax-tls]', 'type=transport', 'protocol=tls', 'bind=0.0.0.0:5061', 'method=tlsv1_2',
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
      if (client === 'mobile') lines.push('transport=transport-salemax-tls', 'media_encryption=sdes', 'media_encryption_optimistic=no');
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

function previewHostSetup(context) {
  authorize(context);
  const files = [
    {
      path: '/etc/asterisk/http.conf',
      purpose: 'Loopback-only ARI and WebSocket listener; Nginx terminates public HTTPS/WSS.',
      content: ['[general]', 'enabled=yes', 'bindaddr=127.0.0.1', 'bindport=8088'].join('\n'),
    },
    {
      path: '/etc/asterisk/ari.conf',
      purpose: 'Asterisk control account; substitute the exact username and password entered in SaleMaX Admin.',
      content: [
        '[general]', 'enabled=yes', 'pretty=no', '', '[REPLACE_WITH_SALEMAX_ARI_USERNAME]',
        'type=user', 'read_only=no', 'password=REPLACE_WITH_THE_SAME_PASSWORD_SAVED_IN_SALEMAX',
      ].join('\n'),
    },
    {
      path: '/etc/asterisk/pjsip.conf',
      purpose: 'One shared TLS transport for Dinstar and mobile apps, plus the WebRTC WSS transport.',
      content: [
        '[transport-salemax-tls]', 'type=transport', 'protocol=tls', 'bind=0.0.0.0:5061', 'method=tlsv1_2',
        'cert_file=/etc/asterisk/keys/pbx.crt', 'priv_key_file=/etc/asterisk/keys/pbx.key', 'verify_client=no', 'allow_reload=yes', '',
        '[transport-salemax-browser-wss]', 'type=transport', 'protocol=wss', 'bind=0.0.0.0', 'allow_reload=yes',
      ].join('\n'),
    },
    {
      path: '/etc/asterisk/sorcery.conf',
      purpose: 'Merge these mappings with existing sections; preserve unrelated providers and entries.',
      content: [
        '[res_pjsip]', 'endpoint=astdb,ps_endpoints', 'auth=astdb,ps_auths', 'aor=astdb,ps_aors', '',
        '[res_pjsip_endpoint_identifier_ip]', 'identify=astdb,ps_endpoint_id_ips',
      ].join('\n'),
    },
    {
      path: '/etc/asterisk/extensions.conf',
      purpose: 'Static generic routes; SaleMaX resolves the DID and call policy at call time.',
      content: [
        '[from-dinstar-unrouted]',
        'exten => _+X.,1,NoOp(SaleMaX inbound DID ${EXTEN})',
        ' same => n,Stasis(salemax-call-center,inbound-did,${EXTEN})',
        ' same => n,Hangup()',
        'exten => _X.,1,NoOp(SaleMaX inbound DID ${EXTEN})',
        ' same => n,Stasis(salemax-call-center,inbound-did,${EXTEN})',
        ' same => n,Hangup()',
        '',
        '[from-salemax-agents-unrouted]',
        'exten => _X!,1,NoOp(SaleMaX agent calls are controlled through ARI)',
        ' same => n,Hangup(21)',
      ].join('\n'),
    },
    {
      path: '/etc/asterisk/logger.conf',
      purpose: 'Write Asterisk registration failures and security events to a dedicated log consumed by the Fail2ban jail.',
      content: ['[logfiles]', 'salemax-security.log => notice,warning,error,security'].join('\n'),
    },
    {
      path: '/etc/fail2ban/jail.d/salemax-asterisk.local',
      purpose: 'Temporarily ban repeated failed PJSIP registrations on the shared TLS port.',
      content: [
        '[salemax-asterisk]', 'enabled = true', 'filter = asterisk', 'port = 5061', 'protocol = tcp',
        'logpath = /var/log/asterisk/salemax-security.log', 'backend = polling',
        'maxretry = 5', 'findtime = 10m', 'bantime = 1h',
      ].join('\n'),
    },
  ];
  return {
    files,
    warnings: [
      'Preview only. It does not write files, restart Asterisk, open firewall ports, or configure the Dinstar gateway.',
      'Back up each existing file and merge the snippets; do not replace a file that contains unrelated Asterisk configuration.',
      'Protect the SIP TLS private key at the listed path. Install the host certificate there with read access limited to Asterisk.',
      'Create the ARI user in ari.conf with the same username/password saved in SaleMaX; this preview never returns the saved password.',
      'Replace both ari.conf placeholders before restarting Asterisk; never commit the actual ARI password.',
      'Asterisk HTTP must stay bound to loopback. Public browser WSS is routed through Nginx /ws; private ARI is routed through the app-only /ari/ location.',
      'Set RTP bounds and firewall policy only after the direct gateway IP and mobile VPN/SBC or public SIP access design are confirmed.',
      'Fail2ban requires its Asterisk filter, the res_security_log module, and the configured security log channel. Merge the logger snippet, verify the jail log path exists and captures failed REGISTER events, then run fail2ban-client -t before enabling the jail.',
      'Before real clients connect, add the confirmed fixed Dinstar source IP to the existing Fail2ban ignoreip list to avoid banning the gateway during credential recovery; do not add broad address ranges. Keep a documented unban/rollback procedure.',
      'The Fail2ban jail is a defense-in-depth control, not a replacement for edge firewall/SBC source restrictions, unique strong SIP credentials, TLS/SRTP, or monitoring.',
      'Load res_sorcery_astdb before the first dynamic endpoint write; test config and call paths before enabling channel policies.',
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
  let moduleReadiness;
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
  const latencyMs = Date.now() - started;
  [gatewayEndpointStatus, moduleReadiness] = await Promise.all([
    probeGatewayEndpoint(fetchImpl, target.value, row.ari_username, password),
    probeModuleReadiness(fetchImpl, target.value, row.ari_username, password),
  ]);
  await recordTest(db, context, Number(row.revision), target.hostname, 'success', version, null, gatewayEndpointStatus);
  return { connected: true, asteriskVersion: version, latencyMs, enabled: !!row.enabled,
    gatewayEndpoint: { name: 'salemax_dinstar_uc2000ve', status: gatewayEndpointStatus }, moduleReadiness,
    testedAt: new Date().toISOString() };
}

async function probeModuleReadiness(fetchImpl, ariBaseUrl, username, password) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(`${ariBaseUrl}/asterisk/modules`, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
    });
    if (!response.ok) return { status: 'unknown', features: Object.fromEntries(Object.keys(REQUIRED_MODULES).map(key => [key, { ready: false, missing: [] }])) };
    const raw = await response.text();
    if (raw.length > 512 * 1024) return { status: 'unknown', features: Object.fromEntries(Object.keys(REQUIRED_MODULES).map(key => [key, { ready: false, missing: [] }])) };
    let modules;
    try { modules = JSON.parse(raw); } catch (_) { modules = null; }
    if (!Array.isArray(modules) || modules.length > 2048 || modules.some(module => !module
      || typeof module.name !== 'string' || module.name.length > 128 || typeof module.status !== 'string' || module.status.length > 64)) {
      return { status: 'unknown', features: Object.fromEntries(Object.keys(REQUIRED_MODULES).map(key => [key, { ready: false, missing: [] }])) };
    }
    const loaded = new Set(modules.filter(module => module.status.toLowerCase() === 'running')
      .map(module => module.name.toLowerCase().replace(/\.so$/, '')));
    const features = Object.fromEntries(Object.entries(REQUIRED_MODULES).map(([key, required]) => {
      const missing = required.filter(name => !loaded.has(name));
      return [key, { ready: missing.length === 0, missing }];
    }));
    return { status: 'available', features };
  } catch (_) {
    return { status: 'unknown', features: Object.fromEntries(Object.keys(REQUIRED_MODULES).map(key => [key, { ready: false, missing: [] }])) };
  } finally {
    clearTimeout(timer);
  }
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

async function probePjsipEndpointStates(fetchImpl, ariBaseUrl, username, password, resources) {
  if (!Array.isArray(resources) || resources.length > 32 || resources.some(resource => typeof resource !== 'string'
    || !(/^(?:salemax_dinstar_uc2000ve|salemax-[0-9]{3,8}-(?:mobile|browser))$/.test(resource)))) fail('INVALID_ARI_ENDPOINT_PROBE');
  const states = Object.fromEntries([...new Set(resources)].map(resource => [resource, 'unknown']));
  if (!Object.keys(states).length) return states;
  const target = endpoint(ariBaseUrl);
  allowlisted(target.hostname);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetchImpl(`${target.value}/endpoints/PJSIP`, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
    });
    if (!response.ok) return states;
    const body = await response.text();
    if (body.length > 1024 * 1024) return states;
    let endpoints;
    try { endpoints = JSON.parse(body); } catch (_) { return states; }
    if (!Array.isArray(endpoints) || endpoints.length > 2048) return states;
    const wanted = new Set(Object.keys(states));
    for (const item of endpoints) {
      if (!item || item.technology !== 'PJSIP' || typeof item.resource !== 'string' || !wanted.has(item.resource)) continue;
      states[item.resource] = ['online', 'offline', 'unknown'].includes(item.state) ? item.state : 'unknown';
    }
  } catch (_) {
    return states;
  } finally {
    clearTimeout(timer);
  }
  return states;
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

module.exports = { endpoint, allowlisted, browserWebsocketUrl, mobileSipHost, ownBrowserEndpoint, ownMobileEndpoint, gateway, gatewayPjsipPreview, present, get, previewGateway, applyGatewayPeer, previewAgentEndpoints, previewHostSetup, save, test, probeModuleReadiness, probePjsipEndpointStates };
