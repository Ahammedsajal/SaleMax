'use strict';

const crypto = require('node:crypto');

const fail = code => { throw Object.assign(new Error(code), { code }); };

async function legacyOwnerUidForTenant(db, tenantId) {
  const [rows] = await db.query(`SELECT u.uid,o.legacy_uid_hash AS uidHash
    FROM sx_legacy_ownership o
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED)
    JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id
    WHERE o.source_table='user' AND o.tenant_id=? AND u.role='user'
      AND m.role='owner' AND m.status='active' AND m.active_owner_tenant=o.tenant_id
    LIMIT 2`, [tenantId]);
  if (rows.length !== 1 || rows[0].uidHash !== crypto.createHash('sha256').update(rows[0].uid).digest('hex')) {
    fail('LEGACY_INBOX_LINK_REQUIRED');
  }
  return rows[0].uid;
}

module.exports = { legacyOwnerUidForTenant };
