'use strict';
async function assertDelegatedSession(query,claims){
  if(!claims?.delegatedSessionId)return;
  if(!Number.isFinite(claims.exp)||claims.exp<=Date.now()/1000)throw new Error('ACCOUNT_SESSION_EXPIRED');
  const rows=await query(`SELECT s.id FROM sx_sessions s
    JOIN sx_identities i ON i.id=s.identity_id AND i.status='active' AND i.credential_version=s.credential_version
    JOIN sx_memberships m ON m.id=s.membership_id AND m.tenant_id=s.tenant_id AND m.identity_id=s.identity_id AND m.status='active'
    JOIN sx_tenants t ON t.id=s.tenant_id AND t.status='active'
    JOIN sx_legacy_ownership o ON o.membership_id=m.id AND o.tenant_id=m.tenant_id AND o.source_table='user'
    JOIN user u ON CAST(u.id AS CHAR)=o.source_id
    WHERE s.id=? AND s.audience='tenant' AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3)
      AND u.uid=? AND u.email=? AND u.password=? LIMIT 2`,[claims.delegatedSessionId,claims.uid,claims.email,claims.password]);
  if(rows.length!==1)throw new Error('ACCOUNT_SESSION_EXPIRED');
}
module.exports={assertDelegatedSession};
