'use strict';

// Aggregate-only preflight for category/identity adoption. This module never
// returns tenant names, account identifiers, emails, phone numbers or tokens.
const QUERIES = Object.freeze({
  tenants: `SELECT category_key AS categoryKey,category_version AS categoryVersion,status,COUNT(*) AS tenantCount
    FROM sx_tenants GROUP BY category_key,category_version,status ORDER BY category_key,category_version,status`,
  memberships: `SELECT t.category_key AS categoryKey,m.role,m.status,COUNT(*) AS membershipCount
    FROM sx_memberships m JOIN sx_tenants t ON t.id=m.tenant_id
    GROUP BY t.category_key,m.role,m.status ORDER BY t.category_key,m.role,m.status`,
  legacyMappings: `SELECT source_table AS sourceTable,COUNT(*) AS mappingCount,COUNT(DISTINCT tenant_id) AS tenantCount,
      SUM(membership_id IS NULL) AS withoutMembership
    FROM sx_legacy_ownership GROUP BY source_table ORDER BY source_table`,
  mappingIntegrity: `SELECT o.source_table AS sourceTable,COUNT(*) AS mappingCount,
      SUM(o.membership_id IS NULL) AS withoutMembership,
      SUM(CASE WHEN o.source_table='user' AND NOT EXISTS (SELECT 1 FROM user u WHERE BINARY o.source_id=BINARY CAST(u.id AS CHAR)) THEN 1
        WHEN o.source_table='agents' AND NOT EXISTS (SELECT 1 FROM agents a WHERE BINARY o.source_id=BINARY CAST(a.id AS CHAR)) THEN 1 ELSE 0 END) AS withoutLegacyRecord
    FROM sx_legacy_ownership o GROUP BY o.source_table ORDER BY o.source_table`,
  legacyUsers: `SELECT COALESCE(u.role,'<null>') AS legacyRole,COALESCE(m.role,'<unmapped>') AS membershipRole,
      COALESCE(m.status,'<unmapped>') AS membershipStatus,COALESCE(i.status,'<unmapped>') AS identityStatus,
      COALESCE(t.status,'<unmapped>') AS tenantStatus,COUNT(*) AS rowCount,SUM(o.source_id IS NULL) AS unmapped,
      SUM(o.source_id IS NOT NULL AND BINARY o.legacy_uid_hash<>BINARY LOWER(SHA2(u.uid,256))) AS hashMismatch,
      SUM(o.source_id IS NOT NULL AND (o.membership_id IS NULL OR m.status<>'active' OR i.status<>'active' OR t.status<>'active')) AS inactiveMapping
    FROM user u LEFT JOIN sx_legacy_ownership o ON o.source_table='user' AND BINARY o.source_id=BINARY CAST(u.id AS CHAR)
    LEFT JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id
    LEFT JOIN sx_identities i ON i.id=m.identity_id LEFT JOIN sx_tenants t ON t.id=o.tenant_id
    GROUP BY u.role,m.role,m.status,i.status,t.status ORDER BY rowCount DESC`,
  legacyAgents: `SELECT a.is_active AS isActive,COALESCE(m.role,'<unmapped>') AS membershipRole,
      COALESCE(m.status,'<unmapped>') AS membershipStatus,COALESCE(i.status,'<unmapped>') AS identityStatus,
      COALESCE(t.status,'<unmapped>') AS tenantStatus,COUNT(*) AS rowCount,SUM(o.source_id IS NULL) AS unmapped,
      SUM(o.source_id IS NOT NULL AND BINARY o.legacy_uid_hash<>BINARY LOWER(SHA2(a.uid,256))) AS hashMismatch,
      SUM(a.is_active=1 AND o.source_id IS NOT NULL AND (o.membership_id IS NULL OR m.role NOT IN ('agent','manager','team_leader') OR m.status<>'active' OR i.status<>'active' OR t.status<>'active')) AS invalidActiveMapping
    FROM agents a LEFT JOIN sx_legacy_ownership o ON o.source_table='agents' AND BINARY o.source_id=BINARY CAST(a.id AS CHAR)
    LEFT JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id
    LEFT JOIN sx_identities i ON i.id=m.identity_id LEFT JOIN sx_tenants t ON t.id=o.tenant_id
    GROUP BY a.is_active,m.role,m.status,i.status,t.status ORDER BY a.is_active DESC,rowCount DESC`,
  unmappedAgents: `SELECT COALESCE(t.category_key,'unresolved-owner') AS ownerCategory,a.is_active AS isActive,
      COUNT(*) AS agentCount,SUM(u.id IS NOT NULL) AS ownerUserExists,
      SUM(uo.source_id IS NOT NULL) AS ownerHasTenantMapping,
      SUM(t.status='active' AND uo.membership_id IS NOT NULL) AS linkedOwnerCount
    FROM agents a LEFT JOIN sx_legacy_ownership ao ON ao.source_table='agents' AND BINARY ao.source_id=BINARY CAST(a.id AS CHAR)
    LEFT JOIN user u ON u.uid=a.owner_uid
    LEFT JOIN sx_legacy_ownership uo ON uo.source_table='user' AND BINARY uo.source_id=BINARY CAST(u.id AS CHAR)
    LEFT JOIN sx_tenants t ON t.id=uo.tenant_id
    WHERE ao.source_id IS NULL GROUP BY t.category_key,a.is_active ORDER BY ownerCategory,a.is_active`,
  currentAssignments: `SELECT COUNT(*) AS assignmentCount,COALESCE(SUM(pv.id IS NULL),0) AS missingVersion,
      COALESCE(SUM(BINARY pv.category_key<>BINARY t.category_key OR pv.category_version<>t.category_version),0) AS categoryMismatch
    FROM sx_plan_assignments a JOIN sx_tenants t ON t.id=a.tenant_id
    LEFT JOIN sx_plan_versions pv ON pv.id=a.plan_version_id
    WHERE a.status IN ('trial','active','grace','suspended')`,
});

async function readTenantAdoptionSnapshot(connection) {
  if (!connection || typeof connection.query !== 'function') {
    throw Object.assign(new Error('READ_ONLY_CONNECTION_REQUIRED'), { code: 'READ_ONLY_CONNECTION_REQUIRED' });
  }
  const result = {};
  for (const [key, sql] of Object.entries(QUERIES)) {
    const [rows] = await connection.query(sql);
    result[key] = key === 'currentAssignments' ? (rows[0] || {}) : rows;
  }
  return result;
}

module.exports = { readTenantAdoptionSnapshot, QUERIES };
