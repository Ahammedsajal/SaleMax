'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const asterisk = require('../modules/platform/asterisk-config');
const secrets = require('../modules/platform/asterisk-secrets');
const staff = require('../modules/platform/staff-access');
const policy = require('../modules/platform/policy');

test('existing Super Admin host setup preview covers loopback ARI, shared TLS, dynamic PJSIP, DID routing and SIP intrusion blocking without secrets', () => {
  const context={audience:'platform',identity:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},membership:{role:'super_admin',status:'active'},mfaVerified:true};
  const preview=asterisk.previewHostSetup(context);
  assert.deepEqual(preview.files.map(file=>file.path),['/etc/asterisk/http.conf','/etc/asterisk/ari.conf','/etc/asterisk/pjsip.conf','/etc/asterisk/sorcery.conf','/etc/asterisk/extensions.conf','/etc/asterisk/logger.conf','/etc/fail2ban/jail.d/salemax-asterisk.local']);
  const configs=preview.files.map(file=>file.content).join('\n');
  assert.match(configs,/bindaddr=127\.0\.0\.1/);
  assert.match(configs,/\[transport-salemax-tls\]/);
  assert.match(configs,/\[transport-salemax-browser-wss\]/);
  assert.match(configs,/endpoint=astdb,ps_endpoints/);
  assert.match(configs,/Stasis\(salemax-call-center,inbound-did,\$\{EXTEN\}\)/);
  assert.match(configs,/salemax-security\.log => notice,warning,error,security/);
  assert.match(configs,/\[salemax-asterisk\][\s\S]*filter = asterisk[\s\S]*port = 5061[\s\S]*protocol = tcp[\s\S]*logpath = \/var\/log\/asterisk\/salemax-security\.log[\s\S]*backend = polling[\s\S]*maxretry = 5[\s\S]*findtime = 10m[\s\S]*bantime = 1h/);
  assert.match(configs,/password=REPLACE_WITH_THE_SAME_PASSWORD_SAVED_IN_SALEMAX/);
  assert.doesNotMatch(configs,/password=asterisk/i);
  assert.ok(preview.warnings.some(message=>message.includes('fail2ban-client -t')));
  assert.throws(()=>asterisk.previewHostSetup({audience:'platform',identity:{id:'x'},membership:{role:'staff',status:'active',delegatedPermissions:[]},mfaVerified:true}),{code:'PERMISSION_DENIED'});
});

test('Asterisk connection diagnostics distinguish running call, gateway and browser modules', async () => {
  const required=['chan_pjsip','res_pjsip','res_pjsip_endpoint_identifier_ip','res_pjsip_transport_tls','res_ari','res_ari_channels',
    'res_ari_bridges','app_stasis','res_stasis','res_sorcery_astdb','res_http_websocket','res_pjsip_transport_websocket',
    'codec_opus_open_source','res_format_attr_opus','res_security_log'];
  let modules=required.map(name=>({name:`${name}.so`,status:'Running'}));let request;
  const probe=await asterisk.probeModuleReadiness(async(url,options)=>{request={url,options};return{ok:true,async text(){return JSON.stringify(modules);}};},
    'https://pbx.example.com/ari','salemax-admin','server-secret');
  assert.equal(request.url,'https://pbx.example.com/ari/asterisk/modules');
  assert.equal(request.options.method,'GET');assert.equal(request.options.redirect,'error');
  assert.deepEqual(probe,{status:'available',features:{callControl:{ready:true,missing:[]},gatewayProvisioning:{ready:true,missing:[]},browserWebrtc:{ready:true,missing:[]},sipSecurityLogging:{ready:true,missing:[]}}});
  modules=modules.filter(module=>!['res_sorcery_astdb.so','res_security_log.so'].includes(module.name));modules[0].status='Not Running';
  const incomplete=await asterisk.probeModuleReadiness(async()=>({ok:true,async text(){return JSON.stringify(modules);}}),
    'https://pbx.example.com/ari','salemax-admin','server-secret');
  assert.equal(incomplete.features.callControl.ready,false);
  assert.deepEqual(incomplete.features.callControl.missing,['chan_pjsip']);
  assert.deepEqual(incomplete.features.gatewayProvisioning.missing,['res_sorcery_astdb']);
  assert.deepEqual(incomplete.features.sipSecurityLogging.missing,['res_security_log']);
  const unknown=await asterisk.probeModuleReadiness(async()=>({ok:false,status:403}),
    'https://pbx.example.com/ari','salemax-admin','server-secret');
  assert.equal(unknown.status,'unknown');
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-asterisk.js'),'utf8');
  assert.match(ui,/Call control/);assert.match(ui,/Browser WebRTC/);assert.match(ui,/SIP security logging/);assert.match(ui,/جارٍ اختبار اتصال ARI/);
});

test('Super Admin Asterisk overview marks a connected worker stale when its heartbeat expires', async () => {
  const context={audience:'platform',identity:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},membership:{role:'super_admin',status:'active'},mfaVerified:true};
  const config={ari_base_url:'https://pbx.example.com/ari',ari_username:'salemax-admin',credential_ciphertext:Buffer.from('encrypted'),enabled:1,revision:2};
  let fresh=1;
  const db={async query(sql){return sql.includes('sx_platform_asterisk_runtime')
    ?[[{status:'connected',worker_id:'worker-1',events_received:5,heartbeat_fresh:fresh}]]:[[config]];}};
  let result=await asterisk.get(db,context);
  assert.equal(result.ariEvents.ready,true);
  fresh=0;
  result=await asterisk.get(db,context);
  assert.equal(result.ariEvents.status,'connected');
  assert.equal(result.ariEvents.ready,false);
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-asterisk.js'),'utf8');
  const page=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  assert.match(ui,/eventState\.status==='connected'\?tr\('stale heartbeat','نبضة اتصال قديمة'\)/);
  assert.match(page,/admin-asterisk\.js\?v=20261006-tenant-structure1/);
});

test('live PJSIP registration probe returns only requested bounded endpoint states', async () => {
  const oldHosts=process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS;
  process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS='pbx.example.com';
  let request;
  try{
    const states=await asterisk.probePjsipEndpointStates(async(url,options)=>{
      request={url:new URL(url),options};
      return{ok:true,async text(){return JSON.stringify([
        {technology:'PJSIP',resource:'salemax_dinstar_uc2000ve',state:'online',channel_ids:[]},
        {technology:'PJSIP',resource:'salemax-7401-mobile',state:'offline',channel_ids:[]},
        {technology:'PJSIP',resource:'salemax-9999-mobile',state:'online',channel_ids:[]},
      ]);}};
    },'https://pbx.example.com/ari','salemax-admin','ari-probe-password',['salemax_dinstar_uc2000ve','salemax-7401-mobile','salemax-7401-browser']);
    assert.equal(request.url.pathname,'/ari/endpoints/PJSIP');
    assert.equal(request.options.method,'GET');assert.equal(request.options.redirect,'error');
    assert.equal(states.salemax_dinstar_uc2000ve,'online');
    assert.equal(states['salemax-7401-mobile'],'offline');
    assert.equal(states['salemax-7401-browser'],'unknown','unlisted provisioned endpoints remain unknown');
    assert.equal(Object.hasOwn(states,'salemax-9999-mobile'),false,'unrequested tenant endpoints are not returned');
    await assert.rejects(asterisk.probePjsipEndpointStates(async()=>({ok:true,async text(){return'[]';}}),
      'https://pbx.example.com/ari','salemax-admin','password',['endpoint/injection']),{code:'INVALID_ARI_ENDPOINT_PROBE'});
  }finally{if(oldHosts===undefined)delete process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS;else process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS=oldHosts;}
});

test('Super Admin ARI connection test checks PBX version, gateway peer and feature modules without returning secrets', async () => {
  const oldKey=process.env.SALEMAX_PLATFORM_KEY_BASE64,oldHosts=process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=crypto.randomBytes(32).toString('base64');
  process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS='pbx.example.com';
  const encrypted=secrets.encrypt('integration-test-ari-password');
  const row={ari_base_url:'https://pbx.example.com/ari',ari_username:'salemax-admin',credential_ciphertext:encrypted.ciphertext,
    credential_iv:encrypted.iv,credential_auth_tag:encrypted.authTag,enabled:1,revision:4};
  const requests=[],queries=[];let committed=false,activeDiagnostics=0,maxConcurrentDiagnostics=0;
  const required=['chan_pjsip','res_pjsip','res_pjsip_endpoint_identifier_ip','res_pjsip_transport_tls','res_ari','res_ari_channels',
    'res_ari_bridges','app_stasis','res_stasis','res_sorcery_astdb','res_http_websocket','res_pjsip_transport_websocket',
    'codec_opus_open_source','res_format_attr_opus','res_security_log'];
  const db={
    async query(sql,params){queries.push({sql,params});if(sql.includes('FROM sx_platform_asterisk_config'))return[[row]];return[{affectedRows:1}];},
    async beginTransaction(){},async commit(){committed=true;},async rollback(){throw new Error('unexpected rollback');},
  };
  const fetchImpl=async(url,options)=>{
    const target=new URL(url);requests.push({target,options});
    if(!target.pathname.endsWith('/asterisk/info')){
      activeDiagnostics++;maxConcurrentDiagnostics=Math.max(maxConcurrentDiagnostics,activeDiagnostics);
      await new Promise(resolve=>setImmediate(resolve));activeDiagnostics--;
    }
    const body=target.pathname.endsWith('/asterisk/info')?{system:{version:'20.6.0'}}
      :target.pathname.endsWith('/endpoints/PJSIP/salemax_dinstar_uc2000ve')
        ?{technology:'PJSIP',resource:'salemax_dinstar_uc2000ve',state:'online'}
        :required.map(name=>({name:`${name}.so`,status:'Running'}));
    return{ok:true,status:200,async json(){return body;},async text(){return JSON.stringify(body);}};
  };
  const context={audience:'platform',identity:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},membership:{role:'super_admin',status:'active'},mfaVerified:true};
  try{
    const result=await asterisk.test(db,context,fetchImpl);
    assert.equal(result.connected,true);assert.equal(result.asteriskVersion,'20.6.0');
    assert.equal(result.gatewayEndpoint.status,'online');assert.equal(result.moduleReadiness.status,'available');
    assert.ok(Object.values(result.moduleReadiness.features).every(feature=>feature.ready));
    assert.equal(maxConcurrentDiagnostics,2,'gateway endpoint and feature-module probes execute concurrently');
    assert.equal(Object.hasOwn(result,'password'),false);assert.equal(committed,true);
    assert.deepEqual(requests.map(request=>request.target.pathname),[
      '/ari/asterisk/info','/ari/endpoints/PJSIP/salemax_dinstar_uc2000ve','/ari/asterisk/modules',
    ]);
    assert.ok(requests.every(request=>request.options.method==='GET'&&request.options.redirect==='error'));
    assert.ok(requests.every(request=>request.options.headers.Authorization===`Basic ${Buffer.from('salemax-admin:integration-test-ari-password').toString('base64')}`));
    assert.ok(queries.some(query=>query.sql.includes('asterisk.connection-tested')));
  }finally{
    if(oldKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=oldKey;
    if(oldHosts===undefined)delete process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS;else process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS=oldHosts;
  }
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
  assert.match(index,/admin-asterisk\.js\?v=20261006-tenant-structure1/);
  assert.match(mount,/app\.use\('\/api\/admin\/asterisk',legacyGuard,boundary\.guard,createAsteriskRouter/);
});

test('PBX settings have a dedicated admin sidebar page and tenant gateways live in Edit User', () => {
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-asterisk.js'),'utf8');
  const telephony=fs.readFileSync(path.join(__dirname,'../client/public/admin-telephony.js'),'utf8');
  const index=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/asterisk-router.js'),'utf8');
  const tenantGateway=fs.readFileSync(path.join(__dirname,'../modules/platform/tenant-asterisk-gateways.js'),'utf8');
  const migration=fs.readFileSync(path.join(__dirname,'../database/migrations/20261114_tenant_asterisk_gateways.sql'),'utf8');
  assert.match(ui,/trigger\?\.remove\(\)/);
  assert.match(telephony,/PBX & Telephony/);
  assert.match(telephony,/pbx-telephony/);
  assert.match(telephony,/data-sx-tenant-gateway/);
  assert.match(telephony,/business-gateway-statuses/);
  assert.match(telephony,/Needs attention/);
  assert.match(telephony,/page\.style\.left=`\$\{Math\.max\(0,rect\.right\+24\)\}px`/);
  assert.match(telephony,/platformPageInstance\.page\.remove\(\)/);
  assert.match(tenantGateway,/GATEWAY_RUNTIME_MIGRATION_REQUIRED/);
  assert.match(router,/tenantGateways\.save/);
  assert.match(router,/tenantGateways\.statuses/);
  assert.match(migration,/CREATE TABLE sx_telephony_gateways/);
  assert.match(migration,/PRIMARY KEY \(tenant_id,gateway_id,channel_no\)/);
  assert.match(index,/admin-telephony\.js\?v=20261006-tenant-pbx4/);
  assert.match(ui,/VERIFIED_ADMIN_LINK_REQUIRED:tr\(/);
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
  assert.match(nginx,/location \^~ \/api\/user\/training\/courses\/ \{[\s\S]*?client_max_body_size 1025m;[\s\S]*?client_body_timeout 3600s;[\s\S]*?proxy_request_buffering off;[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3011;[\s\S]*?proxy_send_timeout 3600s;/,
    'retain the complete live Training Courses upload buffering/timeouts when preparing the Nginx release');
});

test('Call Center requests provisioning with authenticated POSTs before showing SIP credentials', () => {
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/call-center-router.js'),'utf8');
  const client=fs.readFileSync(path.join(__dirname,'../client/public/call-center/call-center.js'),'utf8');
  assert.match(router,/router\.post\('\/webrtc-config'/);
  assert.match(router,/router\.post\('\/sip-config'/);
  assert.match(router,/router\.post\('\/calls\/:callId\/end'/);
  assert.doesNotMatch(router,/router\.get\('\/(?:webrtc-config|sip-config)'/);
  assert.match(client,/request\('\/webrtc-config','POST',\{\}\)/);
  assert.match(client,/request\('\/sip-config','POST',\{\}\)/);
});

test('Call Center status reports call readiness only with live Asterisk and endpoint prerequisites', () => {
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/call-center-router.js'),'utf8');
  const client=fs.readFileSync(path.join(__dirname,'../client/public/call-center/call-center.js'),'utf8');
  const page=fs.readFileSync(path.join(__dirname,'../client/public/call-center/index.html'),'utf8');
  assert.match(router,/status='connected' AND updated_at>=UTC_TIMESTAMP\(3\)-INTERVAL 15 SECOND/);
  assert.match(router,/events:\{status:eventRuntime\?\.status\|\|'not_started',ready:Number\(eventRuntime\?\.heartbeat_fresh\)===1/);
  assert.match(router,/ready:Number\(eventRuntime\?\.heartbeat_fresh\)===1/);
  assert.match(router,/gatewayLiveStatus==='online'/);
  assert.match(router,/inboundAgentReady/);
  assert.match(router,/freeOutboundChannels>0/);
  assert.match(router,/AGENT_ENDPOINT_NOT_REGISTERED/);
  assert.match(client,/Call events \$\{eventReady\?'connected':eventStatus\}/);
  assert.match(client,/SaleMaX is not receiving Asterisk call events/);
  assert.match(client,/لا يستقبل SaleMaX أحداث المكالمات من أستريسك/);
  assert.match(client,/calls\/\$\{encodeURIComponent\(call\.callId\)\}\/end/);
  assert.match(client,/text\('End call','إنهاء المكالمة'\)/);
  assert.match(page,/call-center\.js\?v=20261005-call-control1/);
  assert.match(page,/call-center\.css\?v=20261005-call-control1/);
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
