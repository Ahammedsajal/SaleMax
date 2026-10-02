const crypto=require('node:crypto');
function tokenHash(token) {
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}
function parseGrants(value) {
  try {const grants=typeof value==='string'?JSON.parse(value):value;return Array.isArray(grants)&&grants.every(g=>typeof g==='string')?grants:null;}
  catch{return null;}
}
async function loadSession(connection, token, {forUpdate=false}={}) {
  const hash=tokenHash(token);if(!hash)return null;
  const [rows]=await connection.query(`SELECT s.id AS sessionId,s.audience,s.identity_id AS identityId,
    i.display_name AS displayName,s.tenant_id AS tenantId,s.membership_id AS membershipId,
    m.role AS tenantRole,m.status AS membershipStatus,m.permission_version AS permissionVersion,m.delegated_permissions AS tenantGrants,
    t.name AS tenantName,t.category_key AS categoryKey,t.category_version AS categoryVersion,t.status AS tenantStatus,t.revision AS tenantRevision,t.currency,t.timezone,
    p.role AS platformRole,p.status AS platformStatus,p.delegated_permissions AS platformGrants,p.permission_version AS platformPermissionVersion,
    (s.mfa_verified_at IS NOT NULL AND s.mfa_verified_at<=UTC_TIMESTAMP(3)) AS mfaVerified,
    (s.authenticated_at BETWEEN DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE) AND UTC_TIMESTAMP(3)) AS recentlyAuthenticated
    FROM sx_sessions s JOIN sx_identities i ON i.id=s.identity_id
    LEFT JOIN sx_memberships m ON m.tenant_id=s.tenant_id AND m.id=s.membership_id AND m.identity_id=s.identity_id
    LEFT JOIN sx_tenants t ON t.id=s.tenant_id
    LEFT JOIN sx_platform_memberships p ON p.identity_id=s.identity_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3)
    AND i.status='active' AND i.credential_version=s.credential_version LIMIT 1${forUpdate?' FOR UPDATE':''}`,[hash]);
  const row=rows[0];if(!row)return null;
  const base={audience:row.audience,sessionId:row.sessionId,identity:{id:row.identityId,displayName:row.displayName}};
  if(row.audience==='platform') {
    const grants=parseGrants(row.platformGrants);
    if(row.platformStatus!=='active'||!grants||!['super_admin','staff'].includes(row.platformRole))return null;
    return {...base,mfaVerified:!!row.mfaVerified,recentlyAuthenticated:!!row.recentlyAuthenticated,membership:{identityId:row.identityId,role:row.platformRole,status:row.platformStatus,delegatedPermissions:grants,permissionVersion:row.platformPermissionVersion}};
  }
  const grants=parseGrants(row.tenantGrants);
  if(row.audience!=='tenant'||row.membershipStatus!=='active'||row.tenantStatus!=='active'||!grants)return null;
  return {...base,tenant:{id:row.tenantId,name:row.tenantName,status:row.tenantStatus,categoryKey:row.categoryKey,categoryVersion:row.categoryVersion,revision:row.tenantRevision,currency:row.currency,timezone:row.timezone},membership:{id:row.membershipId,tenantId:row.tenantId,identityId:row.identityId,role:row.tenantRole,status:row.membershipStatus,permissionVersion:row.permissionVersion,delegatedPermissions:grants}};
}
module.exports={tokenHash,loadSession};
