'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const inbound=require('../modules/platform/email-marketing-inbound');

const DOMAIN='reply.7network.live';
const REGION='eu-north-1';
const EXPECTED='inbound-smtp.eu-north-1.amazonaws.com';
const mx=exchange=>[{exchange,priority:10}];
const dnsError=code=>Object.assign(Error(code),{code});

test('MX check trusts a correct system DNS answer without querying public DNS',async()=>{
  let publicCalls=0;
  const result=await inbound.checkMx(DOMAIN,REGION,{
    resolveSystemMx:async()=>mx(EXPECTED+'.'),
    resolvePublicMx:async()=>{publicCalls++;return [];}
  });
  assert.equal(result,true);
  assert.equal(publicCalls,0);
});

test('MX check bypasses a cached system NXDOMAIN with the public answer',async()=>{
  let publicCalls=0;
  const result=await inbound.checkMx(DOMAIN,REGION,{
    resolveSystemMx:async()=>{throw dnsError('ENOTFOUND');},
    resolvePublicMx:async(domain,expected)=>{publicCalls++;assert.equal(domain,DOMAIN);assert.equal(expected,EXPECTED);return mx(EXPECTED);}
  });
  assert.equal(result,true);
  assert.equal(publicCalls,1);
});

test('MX check retries public DNS when the system cache has a stale MX target',async()=>{
  const result=await inbound.checkMx(DOMAIN,REGION,{
    resolveSystemMx:async()=>mx('mx1.old-provider.example'),
    resolvePublicMx:async()=>mx(EXPECTED)
  });
  assert.equal(result,true);
});

test('MX check reports missing records only after public DNS also has no expected MX',async()=>{
  const result=await inbound.checkMx(DOMAIN,REGION,{
    resolveSystemMx:async()=>{throw dnsError('ENODATA');},
    resolvePublicMx:async()=>mx('mx1.other-provider.example')
  });
  assert.equal(result,false);
});

test('MX check reports unavailable when public fallback cannot provide a reliable answer',async()=>{
  await assert.rejects(inbound.checkMx(DOMAIN,REGION,{
    resolveSystemMx:async()=>{throw dnsError('ETIMEOUT');},
    resolvePublicMx:async()=>{throw dnsError('ECONNREFUSED');}
  }),{code:'DNS_LOOKUP_UNAVAILABLE',status:503});
});

test('unexpected system resolver failures remain unavailable instead of being hidden',async()=>{
  let publicCalls=0;
  await assert.rejects(inbound.checkMx(DOMAIN,REGION,{
    resolveSystemMx:async()=>{throw Error('unexpected failure');},
    resolvePublicMx:async()=>{publicCalls++;return mx(EXPECTED);}
  }),{code:'DNS_LOOKUP_UNAVAILABLE',status:503});
  assert.equal(publicCalls,0);
});
