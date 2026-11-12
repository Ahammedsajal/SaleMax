'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const source=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('7Network Sales team leaders can receive inbound calls and use assigned mobile endpoints',()=>{
  const callControl=source('modules/platform/asterisk-call-control.js');
  const endpointConfig=source('modules/platform/asterisk-config.js');
  const extensions=source('modules/platform/telephony-extensions.js');
  const queues=source('modules/platform/telephony-queues.js');
  assert.match(callControl,/m\.role IN \('owner','manager','team_leader','agent'\)/);
  assert.match(callControl,/m\.role IN \('owner','manager','team_leader','agent'\) ORDER BY qm\.position/);
  assert.match(endpointConfig,/m\.role IN \('owner','manager','team_leader','agent'\)/);
  assert.match(extensions,/m\.role IN \('owner','manager','team_leader','agent'\)/);
  assert.match(extensions,/role IN \('owner','manager','team_leader','agent'\)/);
  assert.match(queues,/m\.role IN \('owner','manager','team_leader','agent'\)/);
});
test('mobile direct dial is E.164-only and rejects unrecognized Stasis requests',()=>{
  const callControl=source('modules/platform/asterisk-call-control.js');
  const endpointConfig=source('modules/platform/asterisk-config.js');
  const gatewayPorts=source('modules/platform/asterisk-gateway-ports.js');
  const leadLinks=source('modules/platform/telephony-call-leads.js');
  assert.match(endpointConfig,/exten => _\+X\.[\s\S]*?Ringing\(\)[\s\S]*?Stasis\(salemax-call-center,mobile-outbound,\$\{EXTEN\}\)/);
  assert.match(gatewayPorts,/exten => _\+X\.[\s\S]*?Ringing\(\)[\s\S]*?Stasis\(salemax-call-center,inbound-did,\$\{EXTEN\}\)/);
  assert.match(gatewayPorts,/exten => _X\.[\s\S]*?Ringing\(\)[\s\S]*?Stasis\(salemax-call-center,inbound-did,\$\{EXTEN\}\)/);
  assert.match(callControl,/function mobileOutboundArgs\(args\)[\s\S]*?\^\\\+\[1-9\]\[0-9\]\{7,14\}\$/);
  assert.match(callControl,/const mobileOutbound = mobileOutboundArgs\(event\.args\);[\s\S]*?if \(mobileOutbound\) return this\.startMobileOutbound[\s\S]*?await \(await this\.client\(\)\)\.hangup\(event\.channel\.id\)/);
  assert.match(callControl,/const normalizedMobile=`CASE WHEN LEFT\(REGEXP_REPLACE[\s\S]*?WHERE l\.uid_hash=\? AND \$\{normalizedMobile\}=\?/);
  assert.match(callControl,/resolveAccessibleLeadLinkByNumber\(db,[\s\S]*?categoryKey:row\.category_key,[\s\S]*?membershipId:input\.membershipId/);
  assert.match(callControl,/lead_uid_hash,lead_id,remote_number/);
  assert.match(leadLinks,/if\(matches\.length!==1\)return null/);
});
