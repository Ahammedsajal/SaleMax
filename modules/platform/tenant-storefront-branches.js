'use strict';

async function publicBranches(db,tenantId){
  const [rows]=await db.query(`SELECT slug,name_en AS nameEn,name_ar AS nameAr,
    address_en AS addressEn,address_ar AS addressAr,phone,timezone,
    opening_hours AS openingHours,CASE WHEN t.category_key='restaurant_cafe' THEN b.preparation_minutes ELSE 0 END AS preparationMinutes,service_areas AS serviceAreas,
    fulfillment_modes AS fulfillmentModes,booking_mode AS bookingMode
    FROM sx_tenant_branches b JOIN sx_tenants t ON t.id=b.tenant_id WHERE b.tenant_id=? AND b.status='active' AND b.public_enabled=1
    ORDER BY b.name_en,b.id LIMIT 50`,[tenantId]);
  const json=value=>typeof value==='string'?JSON.parse(value):value;
  return rows.map(row=>({slug:row.slug,nameEn:row.nameEn,nameAr:row.nameAr,addressEn:row.addressEn,addressAr:row.addressAr,phone:row.phone,timezone:row.timezone,openingHours:json(row.openingHours)||{},preparationMinutes:Number(row.preparationMinutes||0),serviceAreas:json(row.serviceAreas)||[],fulfillmentModes:json(row.fulfillmentModes)||[],bookingMode:'request_only'}));
}

async function resolvePublicBranch(db,tenantId,slug){
  const [rows]=await db.query(`SELECT b.id,b.slug,b.service_areas AS serviceAreas,b.fulfillment_modes AS fulfillmentModes,b.routing_membership_id AS routingMembershipId,m.role,
      a.id AS routedAgentId
    FROM sx_tenant_branches b
    LEFT JOIN sx_memberships m ON m.tenant_id=b.tenant_id AND m.id=b.routing_membership_id
      AND m.status='active'
    LEFT JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
    LEFT JOIN sx_legacy_ownership o ON o.tenant_id=b.tenant_id AND o.membership_id=m.id AND o.source_table='agents'
    LEFT JOIN agents a ON a.id=CAST(o.source_id AS UNSIGNED) AND a.role='agent' AND a.is_active=1
    WHERE b.tenant_id=? AND b.slug=? AND b.status='active' AND b.public_enabled=1
      AND (b.routing_membership_id IS NULL OR i.id IS NOT NULL)
    LIMIT 1`,[tenantId,slug]);
  const branch=rows[0];
  if(!branch)return null;
  if(branch.routingMembershipId&&branch.role==='agent'&&!branch.routedAgentId)throw Object.assign(new Error('BRANCH_ROUTING_UNAVAILABLE'),{code:'BRANCH_ROUTING_UNAVAILABLE',status:409});
  const json=value=>typeof value==='string'?JSON.parse(value):value;
  return {id:branch.id,slug:branch.slug,serviceAreas:json(branch.serviceAreas)||[],fulfillmentModes:json(branch.fulfillmentModes)||[],routingMembershipId:branch.routingMembershipId||null,routedAgentId:branch.routedAgentId==null?null:Number(branch.routedAgentId)};
}

module.exports={publicBranches,resolvePublicBranch};
