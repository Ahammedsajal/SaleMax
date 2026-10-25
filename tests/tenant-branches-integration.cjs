'use strict';
const assert=require('node:assert/strict');
const branches=require('../modules/platform/tenant-branches');
module.exports=async function tenantBranchesIntegration(db,other,{t1,i1,m1,t2,i2,m2}){
  const owner={audience:'tenant',identity:{id:i1},tenant:{id:t1},membership:{id:m1,tenantId:t1,identityId:i1,role:'owner',status:'active'}};
  const otherOwner={audience:'tenant',identity:{id:i2},tenant:{id:t2},membership:{id:m2,tenantId:t2,identityId:i2,role:'owner',status:'active'}};
  const branch=await branches.create(db,owner,{slug:'central-branch',nameEn:'Central',openingHours:{monday:[{open:'09:00',close:'12:00'}]},serviceAreas:['Doha'],fulfillmentModes:['in_person','onsite']});
  assert.equal(branch.bookingMode,'request_only');assert.equal(branch.preparationMinutes,0);assert.equal(branch.revision,1);
  assert.equal((await branches.list(db,otherOwner)).length,0);
  const changed={slug:branch.slug,nameEn:'Central updated',expectedRevision:branch.revision};
  const attempts=await Promise.allSettled([branches.update(db,owner,branch.id,changed),branches.update(other,owner,branch.id,changed)]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(attempts.filter(result=>result.status==='rejected'&&result.reason.code==='STALE_REVISION').length,1);
  const [[row]]=await db.query('SELECT tenant_id AS tenantId,revision,booking_mode AS bookingMode,preparation_minutes AS preparationMinutes FROM sx_tenant_branches WHERE id=?',[branch.id]);
  assert.equal(row.tenantId,t1);assert.equal(Number(row.revision),2);assert.equal(row.bookingMode,'request_only');assert.equal(Number(row.preparationMinutes),0);
  await assert.rejects(branches.list(db,{...owner,membership:{...owner.membership,role:'agent'}}),{code:'PERMISSION_DENIED'});
  await assert.rejects(branches.update(db,otherOwner,branch.id,{...changed,expectedRevision:2}),{code:'BRANCH_NOT_FOUND'});
  return {tenantBranchIsolation:true,branchRevisionConcurrency:true,branchRequestsDoNotReserveCapacity:true,branchOwnerPermission:true};
};
