'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asterisk = require('../modules/platform/asterisk-config');
const secrets = require('../modules/platform/asterisk-secrets');
const staff = require('../modules/platform/staff-access');
const policy = require('../modules/platform/policy');

test('existing Super Admin host setup preview covers loopback ARI, shared TLS, dynamic PJSIP, and generic DID routes without secrets', () => {
  const context={audience:'platform',identity:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},membership:{role:'super_admin',status:'active'},mfaVerified:true};
  const preview=asterisk.previewHostSetup(context);
  assert.deepEqual(preview.files.map(file=>file.path),['/etc/asterisk/http.conf','/etc/asterisk/ari.conf','/etc/asterisk/pjsip.conf','/etc/asterisk/sorcery.conf','/etc/asterisk/extensions.conf']);
  const configs=preview.files.map(file=>file.content).join('\n');
  assert.match(configs,/bindaddr=127\.0\.0\.1/);
  assert.match(configs,/\[transport-salemax-tls\]/);
  assert.match(configs,/\[transport-salemax-browser-wss\]/);
  assert.match(configs,/endpoint=astdb,ps_endpoints/);
  assert.match(configs,/Stasis\(salemax-call-center,inbound-did,\$\{EXTEN\}\)/);
  assert.match(configs,/password=REPLACE_WITH_THE_SAME_PASSWORD_SAVED_IN_SALEMAX/);
  assert.doesNotMatch(configs,/password=asterisk/i);
  assert.throws(()=>asterisk.previewHostSetup({audience:'platform',identity:{id:'x'},membership:{role:'staff',status:'active',delegatedPermissions:[]},mfaVerified:true}),{code:'PERMISSION_DENIED'});
});

test('Asterisk setup access is assignable through the existing bilingual platform staff screen', () => {
  const source = fs.readFileSync(path.join(__dirname, '../client/public/admin-platform-staff.js'), 'utf8');
  assert.match(source, /'telephony\.configure':\['Configure Asterisk PBX','إعداد مقسم أستريسك'\]/);
  assert.deepEqual(staff.permissions(['telephony.configure']), ['telephony.configure']);
  assert.equal(policy.platformStaffAllowlist.includes('telephony.configure'), true);
  assert.equal(policy.platformDecision({ audience: 'platform', membership: { role: 'platform_admin', status: 'active' }, mfaVerified: true }, 'telephony.configure'), true);
  assert.equal(policy.platformDecision({ audience: 'platform', membership: { role: 'staff', status: 'active', delegatedPermissions: ['telephony.configure'] }, mfaVerified: true }, 'telephony.configure'), true);
  assert.equal(policy.platformDecision({ audience: 'platform', membership: { role: 'staff', status: 'active', delegatedPermissions: [] }, mfaVerified: true }, 'telephony.configure'), false);
});

test('existing Super Admin PBX setup applies the Dinstar peer only after a current ARI check', () => {
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-asterisk.js'),'utf8');
  const index=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/asterisk-router.js'),'utf8');
  const mount=fs.readFileSync(path.join(__dirname,'../modules/platform/mount-existing-upgrade.js'),'utf8');
  assert.match(ui,/data-apply-gateway/);
  assert.match(ui,/saved\.lastTestStatus!=='success'/);
  assert.match(ui,/window\.confirm\(/);
  assert.match(ui,/\/api\/admin\/asterisk\/apply-gateway-peer/);
  assert.match(router,/router\.post\('\/apply-gateway-peer'/);
  assert.match(router,/router\.get\('\/host-setup-preview'/);
  assert.match(ui,/host-setup-preview/);
  assert.match(index,/admin-asterisk\.js\?v=20261005-host-setup-preview1/);
  assert.match(mount,/app\.use\('\/api\/admin\/asterisk',legacyGuard,boundary\.guard,createAsteriskRouter/);
});

test('production deployment routes ARI only from the SaleMaX app container to loopback Asterisk', () => {
  const compose=fs.readFileSync(path.join(__dirname,'../deploy/compose.yml'),'utf8');
  const nginx=fs.readFileSync(path.join(__dirname,'../deploy/nginx-https.conf'),'utf8');
  assert.match(compose,/crm\.salemax\.qa:host-gateway/);
  assert.match(compose,/ipv4_address:\s*172\.30\.240\.2/);
  assert.match(compose,/subnet:\s*172\.30\.240\.0\/28/);
  assert.match(nginx,/location \^~ \/ari\/ \{[\s\S]*?allow 172\.30\.240\.2;[\s\S]*?deny all;[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8088\/ari\//);
  assert.match(nginx,/proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(nginx,/proxy_set_header Connection "upgrade";/);
  assert.match(nginx,/location = \/ws \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8088\/ws;[\s\S]*?proxy_set_header Upgrade \$http_upgrade;[\s\S]*?proxy_read_timeout 1h;/);
  assert.doesNotMatch(nginx,/location = \/ws \{[^}]*allow 172\.30\.240\.2/s,
    'browser SIP WSS must be reachable for agents while ARI stays app-container-only');
  assert.match(nginx,/location \^~ \/api\/user\/training\/courses\/ \{[\s\S]*?client_max_body_size 1025m;[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3011;/,
    'retain the live Training Courses media upload route when preparing the Nginx release');
});

test('Call Center requests provisioning with authenticated POSTs before showing SIP credentials', () => {
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/call-center-router.js'),'utf8');
  const client=fs.readFileSync(path.join(__dirname,'../client/public/call-center/call-center.js'),'utf8');
  assert.match(router,/router\.post\('\/webrtc-config'/);
  assert.match(router,/router\.post\('\/sip-config'/);
  assert.doesNotMatch(router,/router\.get\('\/(?:webrtc-config|sip-config)'/);
  assert.match(client,/request\('\/webrtc-config','POST',\{\}\)/);
  assert.match(client,/request\('\/sip-config','POST',\{\}\)/);
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
  assert.match(result.warnings.join('\n'), /shared TLS listener serves the gateway and mobile SIP apps/);
  assert.match(result.warnings.join('\n'), /gateway-only host firewall allowlist would block remote agents/);
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

test('Super Admin can apply only the fixed Dinstar peer through audited ARI dynamic PJSIP writes', async () => {
  const operations=[];
  const queries=[];
  const row={gateway_host:'198.51.100.42',gateway_sip_port:5061,gateway_sip_transport:'tls',enabled:1,revision:7,last_test_status:'success'};
  const db={async query(sql,params){queries.push({sql,params});if(sql.includes('FROM sx_platform_asterisk_config'))return [[row]];return [{affectedRows:1}];}};
  const context={audience:'platform',identity:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},membership:{status:'active',role:'super_admin'},mfaVerified:true};
  const result=await asterisk.applyGatewayPeer(db,context,async()=>({async upsertPjsipObject(type,id,fields){operations.push({type,id,fields});return{attributes:fields.length};}}));
  assert.deepEqual(result,{applied:true,gatewayIp:'198.51.100.42',objects:3,revision:7,
    note:'Asterisk dynamic PJSIP objects were accepted. The TLS transport, unrouted dialplan context, firewall, and Dinstar settings remain separate prerequisites.'});
  assert.deepEqual(operations.map(item=>[item.type,item.id]),[
    ['aor','salemax_dinstar_uc2000ve'],['endpoint','salemax_dinstar_uc2000ve'],['identify','salemax_dinstar_uc2000ve_identify'],
  ]);
  assert.equal(operations[0].fields[0].value,'sips:198.51.100.42:5061');
  assert.ok(operations[1].fields.some(field=>field.attribute==='context'&&field.value==='from-dinstar-unrouted'));
  assert.ok(operations[1].fields.some(field=>field.attribute==='media_encryption'&&field.value==='sdes'));
  assert.ok(operations[2].fields.some(field=>field.attribute==='match'&&field.value==='198.51.100.42'));
  const audit=queries.filter(item=>item.sql.includes('INSERT INTO sx_audit_events'));
  assert.equal(audit.length,2);
  assert.match(audit[0].sql,/asterisk\.gateway-peer-apply-requested/);
  assert.match(audit[1].sql,/asterisk\.gateway-peer-applied/);
  assert.doesNotMatch(JSON.stringify(audit),/password|credential/i);
  row.last_test_status=null;let clientCreated=false;
  await assert.rejects(asterisk.applyGatewayPeer(db,context,async()=>{clientCreated=true;return{};}),{code:'ASTERISK_CONNECTION_TEST_REQUIRED'});
  assert.equal(clientCreated,false,'do not write Asterisk config before a successful ARI test for this saved revision');
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
  assert.match(result.config, /transport=transport-salemax-tls/);
  assert.equal((result.config.match(/\[transport-salemax-tls\]/g) || []).length, 1,
    'the gateway and mobile endpoints must share one TLS transport and socket');
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
  const db={async query(sql){if(sql.includes('sx_platform_asterisk_config'))return [[{enabled:1,revision:2}]];if(sql.includes('sx_telephony_extensions'))return [[{extension:'1201',extension_revision:1,browser_credential_revision:1,membership_status:'active',identity_status:'active',tenant_status:'active'}]];if(sql.includes('sx_telephony_endpoint_provisioning'))return [[]];return [{affectedRows:1}];}};const writes=[];const clientFactory=async()=>({async upsertPjsipObject(type,id,fields){writes.push({type,id,fields});return{attributes:fields.length};},async deletePjsipObject(type,id){writes.push({type,id,deleted:true});return{deleted:true};}});
  try{const credential=await asterisk.ownBrowserEndpoint(db,context,clientFactory);assert.equal(credential.server,'wss://crm.example.test/ws');assert.equal(credential.authorizationUsername,'1201-browser');assert.equal(credential.authorizationPassword.length,43);assert.match(credential.uri,/^sip:1201-browser@crm\.example\.test$/);assert.deepEqual(writes.map(row=>[row.type,row.id]),[['auth','salemax-1201-browser-auth'],['aor','salemax-1201-browser-aor'],['endpoint','salemax-1201-browser']]);assert.ok(writes[2].fields.some(field=>field.attribute==='webrtc'&&field.value==='yes'));}
  finally{if(oldKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=oldKey;if(oldHosts===undefined)delete process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS;else process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS=oldHosts;if(oldWs===undefined)delete process.env.SALEMAX_ASTERISK_WS_URL;else process.env.SALEMAX_ASTERISK_WS_URL=oldWs;}
});

test('mobile endpoint credentials are own-member scoped and require an allowlisted TLS SIP host',async()=>{
  const oldKey=process.env.SALEMAX_PLATFORM_KEY_BASE64,oldHosts=process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS,oldHost=process.env.SALEMAX_ASTERISK_MOBILE_SIP_HOST;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=Buffer.alloc(32,29).toString('base64');process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS='sip.example.test';process.env.SALEMAX_ASTERISK_MOBILE_SIP_HOST='sip.example.test';
  const tenantId='11111111-1111-4111-8111-111111111111',membershipId='22222222-2222-4222-8222-222222222222';
  const context={audience:'tenant',identity:{id:'identity'},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:membershipId,tenantId,role:'agent',status:'active'},category:{key:'training_center',version:1,capabilities:['telephony.call-center']},subscription:{status:'active',capabilities:['telephony.call-center']}};
  const db={async query(sql){if(sql.includes('sx_platform_asterisk_config'))return [[{enabled:1,revision:2}]];if(sql.includes('sx_telephony_extensions'))return [[{extension:'1201',extension_revision:1,mobile_credential_revision:1,membership_status:'active',identity_status:'active',tenant_status:'active'}]];if(sql.includes('sx_telephony_endpoint_provisioning'))return [[]];return [{affectedRows:1}];}};const writes=[];const clientFactory=async()=>({async upsertPjsipObject(type,id,fields){writes.push({type,id,fields});return{attributes:fields.length};},async deletePjsipObject(type,id){writes.push({type,id,deleted:true});return{deleted:true};}});
  try{const config=await asterisk.ownMobileEndpoint(db,context,clientFactory);assert.equal(config.host,'sip.example.test');assert.equal(config.port,5061);assert.equal(config.transport,'TLS');assert.equal(config.mediaEncryption,'SRTP');assert.equal(config.username,'1201-mobile');assert.equal(config.password.length,43);assert.match(config.uri,/^sip:1201-mobile@sip\.example\.test$/);assert.deepEqual(writes.map(row=>[row.type,row.id]),[['auth','salemax-1201-mobile-auth'],['aor','salemax-1201-mobile-aor'],['endpoint','salemax-1201-mobile']]);assert.ok(writes[2].fields.some(field=>field.attribute==='transport'&&field.value==='transport-salemax-tls'));assert.ok(writes[2].fields.some(field=>field.attribute==='media_encryption'&&field.value==='sdes'));}
  finally{if(oldKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=oldKey;if(oldHosts===undefined)delete process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS;else process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS=oldHosts;if(oldHost===undefined)delete process.env.SALEMAX_ASTERISK_MOBILE_SIP_HOST;else process.env.SALEMAX_ASTERISK_MOBILE_SIP_HOST=oldHost;}
});
