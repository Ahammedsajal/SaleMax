const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,inspect}=require('../modules/platform/preview-fixtures');
const app=require('../scripts/preview-workspace.cjs');
test('prototype role fixtures do not reveal another tenant or unassigned agent leads',()=>{
  for(const role of ['owner','accountant','manager','agent'])assert.ok(fixture(role).leads.every(l=>l.tenantId==='demo-tenant-a'));
  assert.deepEqual(fixture('agent').leads.map(l=>l.id),['LEAD-001','LEAD-003']);
  assert.equal(inspect('agent','training_center','payments').allowed,false);
  assert.equal(inspect('owner','restaurant_fixture','courses').allowed,false);
  assert.equal(inspect('staff','training_center','staff').allowed,false);
});
test('isolated preview API validates choices and returns explicit synthetic readiness',async()=>{
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const valid=await fetch(base+'/api/preview/context?role=agent');assert.equal(valid.status,200);
    const data=await valid.json();assert.equal(data.syntheticData,true);assert.equal(data.finance,false);
    const invalid=await fetch(base+'/api/preview/context?role=invented');assert.equal(invalid.status,400);
    const inspectResponse=await fetch(base+'/api/preview/inspect?role=owner&key=courses');const result=await inspectResponse.json();assert.equal(result.allowed,true);assert.equal(result.implementedWorkflow,false);
    assert.ok(valid.headers.get('content-security-policy').includes("connect-src 'self'"));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
