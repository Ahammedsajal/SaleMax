'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const bcrypt=require('bcrypt');
test('legacy sign-in bridges both production categories and rejects inactive or unsupported mappings',async()=>{
 const authPath=require.resolve('../modules/platform/authentication'),bridgePath=require.resolve('../modules/platform/legacy-session-bridge');
 const prior=require.cache[authPath],enabled=process.env.SALEMAX_PLATFORM_ENABLED;let logins=0;
 require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{createAuthentication:()=>({login:async(db,input)=>{logins++;assert.equal(input.tenantId,'tenant');return {token:'synthetic',context:{tenant:{id:input.tenantId}},csrfToken:'synthetic',maxAgeSeconds:60};}})}};
 delete require.cache[bridgePath];process.env.SALEMAX_PLATFORM_ENABLED='true';
 try{
  const password='Synthetic-category-password-84',passwordHash=await bcrypt.hash(password,12);
  const base={tenantId:'tenant',membershipId:'member',identityId:'identity',legacyUidHash:crypto.createHash('sha256').update('uid').digest('hex'),role:'owner',membershipStatus:'active',identityStatus:'active',tenantStatus:'active',categoryKey:'training_center',categoryVersion:1,email:'synthetic@example.test',passwordHash};
  let mapping={...base},commits=0,rollbacks=0;
  const db={beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{rollbacks++;},release:()=>{},query:async()=>[[mapping]]};
  const invoke=()=>require(bridgePath).issueForVerifiedLegacyAccount({kind:'user',legacyId:1,legacyUid:'uid',legacyEmail:base.email,password,address:'127.0.0.1',origin:'https://synthetic.example',expectedOrigin:'https://synthetic.example',pool:{getConnection:async()=>db},key:Buffer.alloc(32,7)});
  for(const categoryKey of ['training_center','7network_sales']){mapping={...base,categoryKey};assert.equal((await invoke()).context.tenant.id,'tenant');}
  assert.equal(logins,2);assert.equal(commits,2);
  for(const changed of [{categoryKey:'restaurant_fixture'},{categoryKey:'unknown'},{categoryVersion:999},{membershipStatus:'suspended'},{identityStatus:'suspended'},{tenantStatus:'suspended'},{legacyUidHash:'invalid'},{email:'foreign@example.test'},{role:'platform_admin'}]){mapping={...base,categoryKey:'7network_sales',...changed};await assert.rejects(invoke(),{code:'BUSINESS_ACCESS_INACTIVE'});}
  assert.equal(logins,2);assert.equal(rollbacks,9);
 }finally{delete require.cache[bridgePath];if(prior)require.cache[authPath]=prior;else delete require.cache[authPath];if(enabled===undefined)delete process.env.SALEMAX_PLATFORM_ENABLED;else process.env.SALEMAX_PLATFORM_ENABLED=enabled;}
});
