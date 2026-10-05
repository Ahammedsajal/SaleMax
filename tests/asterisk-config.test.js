'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asterisk = require('../modules/platform/asterisk-config');
const secrets = require('../modules/platform/asterisk-secrets');
const staff = require('../modules/platform/staff-access');
const policy = require('../modules/platform/policy');

test('Asterisk setup access is assignable through the existing bilingual platform staff screen', () => {
  const source = fs.readFileSync(path.join(__dirname, '../client/public/admin-platform-staff.js'), 'utf8');
  assert.match(source, /'telephony\.configure':\['Configure Asterisk PBX','إعداد مقسم أستريسك'\]/);
  assert.deepEqual(staff.permissions(['telephony.configure']), ['telephony.configure']);
  assert.equal(policy.platformStaffAllowlist.includes('telephony.configure'), true);
  assert.equal(policy.platformDecision({ audience: 'platform', membership: { role: 'platform_admin', status: 'active' }, mfaVerified: true }, 'telephony.configure'), true);
  assert.equal(policy.platformDecision({ audience: 'platform', membership: { role: 'staff', status: 'active', delegatedPermissions: ['telephony.configure'] }, mfaVerified: true }, 'telephony.configure'), true);
  assert.equal(policy.platformDecision({ audience: 'platform', membership: { role: 'staff', status: 'active', delegatedPermissions: [] }, mfaVerified: true }, 'telephony.configure'), false);
});

test('Call Center queue UI exposes only the ring behavior implemented by the ARI caller', () => {
  const source = fs.readFileSync(path.join(__dirname, '../client/public/call-center/call-center.js'), 'utf8');
  assert.match(source, /Ring all assigned agent endpoints/);
  assert.match(source, /strategy\.disabled=true/);
  assert.doesNotMatch(source, /rrmemory|Linear order/);
});

test('Dinstar public peer preview requires TLS, SRTP and the configured source address', () => {
  const result = asterisk.gatewayPjsipPreview({ gateway_host: '198.51.100.42', gateway_sip_port: 5061, gateway_sip_transport: 'tls' });
  assert.equal(result.transport, 'tls');
  assert.match(result.config, /transport=transport-salemax-tls/);
  assert.match(result.config, /media_encryption=sdes/);
  assert.match(result.config, /match=198\.51\.100\.42/);
  assert.match(result.warnings.join('\n'), /direct-internet topology, allow TLS SIP and the required bounded RTP range only from this configured gateway source IP/);
  assert.doesNotMatch(result.warnings.join('\n'), /private PBX-gateway path/);
});

test('Dinstar public peer preview rejects missing and non-IP source addresses', () => {
  assert.throws(() => asterisk.gatewayPjsipPreview({ gateway_host: '', gateway_sip_port: 5061, gateway_sip_transport: 'tls' }), { code: 'GATEWAY_IP_REQUIRED' });
  assert.throws(() => asterisk.gatewayPjsipPreview({ gateway_host: 'gateway.example', gateway_sip_port: 5061, gateway_sip_transport: 'tls' }), { code: 'INVALID_GATEWAY_IP' });
});

test('direct-internet gateway config cannot fall back to UDP or TCP', () => {
  assert.throws(() => asterisk.gateway({ gatewayHost: '198.51.100.42', gatewaySipPort: 5061, gatewaySipTransport: 'udp' }), { code: 'INSECURE_GATEWAY_TRANSPORT' });
  assert.throws(() => asterisk.gateway({ gatewayHost: '198.51.100.42', gatewaySipPort: 5061, gatewaySipTransport: 'tcp' }), { code: 'INSECURE_GATEWAY_TRANSPORT' });
});

test('agent endpoint preview builds distinct tenant-bound mobile and browser credentials without call routes', async () => {
  const oldKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;process.env.SALEMAX_PLATFORM_KEY_BASE64=Buffer.alloc(32,19).toString('base64');
  const tenantA='11111111-1111-4111-8111-111111111111',memberA='22222222-2222-4222-8222-222222222222';
  const queries = [];
  const db = { query: async sql => {
    queries.push(sql);
    return [[{ tenant_id:tenantA,membership_id:memberA,extension: '1201',mobile_credential_revision:1,browser_credential_revision:1 },
      { tenant_id:'33333333-3333-4333-8333-333333333333',membership_id:'44444444-4444-4444-8444-444444444444',extension: '1202',mobile_credential_revision:1,browser_credential_revision:1 },
      { tenant_id:tenantA,membership_id:memberA,extension: '1201;include=unsafe',mobile_credential_revision:1,browser_credential_revision:1 }]];
  } };
  const context = { audience: 'platform', identity:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}, membership: { status: 'active', role: 'super_admin' }, mfaVerified: true };
  const result = await asterisk.previewAgentEndpoints(db, context);
  assert.deepEqual(result.extensions, ['1201', '1202']);
  assert.match(queries[0], /m\.status='active'/);
  assert.match(queries[0], /i\.status='active'/);
  assert.match(queries[0], /t\.status='active'/);
  assert.match(result.config, /\[salemax-1201-mobile\]/);
  assert.match(result.config, /transport=transport-salemax-mobile-tls/);
  assert.match(result.config, /media_encryption=sdes/);
  assert.match(result.config, /media_encryption_optimistic=no/);
  assert.match(result.config, /\[salemax-1201-browser\]/);
  assert.match(result.config, /protocol=wss/);
  assert.match(result.config, /webrtc=yes/);
  assert.match(result.config, /media_encryption=dtls/);
  assert.match(result.config, /from-salemax-agents-unrouted/);
  const mobilePassword=secrets.endpointCredential({tenantId:tenantA,membershipId:memberA,extension:'1201',clientType:'mobile',revision:1});
  const browserPassword=secrets.endpointCredential({tenantId:tenantA,membershipId:memberA,extension:'1201',clientType:'browser',revision:1});
  assert.match(result.config,new RegExp(`password=${mobilePassword}`));
  assert.match(result.config,new RegExp(`password=${browserPassword}`));
  assert.notEqual(mobilePassword,browserPassword);
  assert.notEqual(browserPassword,secrets.endpointCredential({tenantId:tenantA,membershipId:memberA,extension:'1201',clientType:'browser',revision:2}));
  assert.doesNotMatch(result.config, /1201;include=unsafe/);
  assert.doesNotMatch(result.config, /Stasis\(/);
  assert.match(result.warnings.join('\n'), /derived endpoint passwords/);
  await assert.rejects(asterisk.previewAgentEndpoints(db, {
    audience: 'platform', membership: { status: 'active', role: 'staff', delegatedPermissions: [] }, mfaVerified: true,
  }), { code: 'PERMISSION_DENIED' });
  if(oldKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=oldKey;
});

test('browser endpoint credentials are own-member scoped and require enabled Asterisk plus allowlisted WSS', async()=>{
  const oldKey=process.env.SALEMAX_PLATFORM_KEY_BASE64,oldHosts=process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS,oldWs=process.env.SALEMAX_ASTERISK_WS_URL;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=Buffer.alloc(32,23).toString('base64');process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS='crm.example.test';process.env.SALEMAX_ASTERISK_WS_URL='wss://crm.example.test/ws';
  const context={audience:'tenant',identity:{id:'identity'},tenant:{id:'11111111-1111-4111-8111-111111111111',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'22222222-2222-4222-8222-222222222222',tenantId:'11111111-1111-4111-8111-111111111111',role:'agent',status:'active'},category:{key:'training_center',version:1,capabilities:['telephony.call-center']},subscription:{status:'active',capabilities:['telephony.call-center']}};
  let index=0;const db={async query(){index++;return index===1?[[{enabled:1}]]:[[ {extension:'1201',browser_credential_revision:1,membership_status:'active',identity_status:'active',tenant_status:'active'} ]];}};
  try{const credential=await asterisk.ownBrowserEndpoint(db,context);assert.equal(credential.server,'wss://crm.example.test/ws');assert.equal(credential.authorizationUsername,'1201-browser');assert.equal(credential.authorizationPassword.length,43);assert.match(credential.uri,/^sip:1201-browser@crm\.example\.test$/);}
  finally{if(oldKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=oldKey;if(oldHosts===undefined)delete process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS;else process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS=oldHosts;if(oldWs===undefined)delete process.env.SALEMAX_ASTERISK_WS_URL;else process.env.SALEMAX_ASTERISK_WS_URL=oldWs;}
});

test('mobile endpoint credentials are own-member scoped and require an allowlisted TLS SIP host',async()=>{
  const oldKey=process.env.SALEMAX_PLATFORM_KEY_BASE64,oldHosts=process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS,oldHost=process.env.SALEMAX_ASTERISK_MOBILE_SIP_HOST;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=Buffer.alloc(32,29).toString('base64');process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS='sip.example.test';process.env.SALEMAX_ASTERISK_MOBILE_SIP_HOST='sip.example.test';
  const tenantId='11111111-1111-4111-8111-111111111111',membershipId='22222222-2222-4222-8222-222222222222';
  const context={audience:'tenant',identity:{id:'identity'},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:membershipId,tenantId,role:'agent',status:'active'},category:{key:'training_center',version:1,capabilities:['telephony.call-center']},subscription:{status:'active',capabilities:['telephony.call-center']}};
  let index=0;const db={async query(){index++;return index===1?[[{enabled:1}]]:[[ {extension:'1201',mobile_credential_revision:1,membership_status:'active',identity_status:'active',tenant_status:'active'} ]];}};
  try{const config=await asterisk.ownMobileEndpoint(db,context);assert.equal(config.host,'sip.example.test');assert.equal(config.port,5061);assert.equal(config.transport,'TLS');assert.equal(config.mediaEncryption,'SRTP');assert.equal(config.username,'1201-mobile');assert.equal(config.password.length,43);assert.match(config.uri,/^sip:1201-mobile@sip\.example\.test$/);}
  finally{if(oldKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=oldKey;if(oldHosts===undefined)delete process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS;else process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS=oldHosts;if(oldHost===undefined)delete process.env.SALEMAX_ASTERISK_MOBILE_SIP_HOST;else process.env.SALEMAX_ASTERISK_MOBILE_SIP_HOST=oldHost;}
});
