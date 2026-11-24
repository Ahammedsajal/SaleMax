'use strict';

const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ENV_KEY='SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS';

function configuredTenantIds(env=process.env){
  const value=env?.[ENV_KEY];
  if(typeof value!=='string'||value.length>4096)return new Set();
  return new Set(value.split(',').map(item=>item.trim().toLowerCase()).filter(item=>UUID.test(item)));
}

function isPilotTenant(tenantId,env=process.env){
  const id=typeof tenantId==='string'?tenantId.trim().toLowerCase():'';
  return UUID.test(id)&&configuredTenantIds(env).has(id);
}

module.exports={ENV_KEY,configuredTenantIds,isPilotTenant};
