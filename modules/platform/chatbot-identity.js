'use strict';
const crypto = require('node:crypto');
const plans = require('./plans');
const { getCategory, supportsBusinessCapability } = require('./categories');

const fail = code => { throw Object.assign(new Error(code), { code }); };

async function legacyChatbotContext(pool, ownerUid) {
  const db = await pool.getConnection();
  try {
    const [rows] = await db.query(`SELECT t.id AS tenantId,t.status AS tenantStatus,t.category_key AS categoryKey,t.category_version AS categoryVersion,
        m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,i.status AS identityStatus,o.legacy_uid_hash AS uidHash
      FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
      JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
      JOIN sx_identities i ON i.id=m.identity_id WHERE u.uid=? LIMIT 2`, [ownerUid]);
    if (!rows.length) fail('VERIFIED_BUSINESS_OWNER_REQUIRED');
    const row = rows[0];
    if (rows.length !== 1 || row.uidHash !== crypto.createHash('sha256').update(ownerUid).digest('hex')) fail('BUSINESS_LINK_INVALID');
    if (!['owner', 'manager'].includes(row.role) || row.membershipStatus !== 'active' || row.identityStatus !== 'active') fail('PERMISSION_DENIED');
    if (row.tenantStatus !== 'active') fail('BUSINESS_INACTIVE');
    const category = getCategory(row.categoryKey, Number(row.categoryVersion));
    if (!supportsBusinessCapability(category, 'automation.chatbot')) fail('CATEGORY_UNAVAILABLE');
    const subscription = await plans.loadEntitlements(db, row.tenantId);
    if (!subscription || !['active', 'trial', 'grace'].includes(subscription.status)) fail('FEATURE_UNAVAILABLE');
    return {
      audience: 'tenant', identity: { id: row.identityId, status: row.identityStatus },
      tenant: { id: row.tenantId, status: row.tenantStatus, categoryKey: row.categoryKey, categoryVersion: Number(row.categoryVersion) },
      membership: { id: row.membershipId, tenantId: row.tenantId, role: row.role, status: row.membershipStatus, delegatedPermissions: [] },
      category, subscription, runtimeReady: {}
    };
  } finally { db.release(); }
}

module.exports = { legacyChatbotContext };
