'use strict';

/**
 * Read the canonical accountant/manager memberships for a set of visible
 * business-owner rows. Only verified legacy ownership links are returned.
 */
async function list(query, ownerUserIds) {
  const owners = [...new Set((ownerUserIds || []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!owners.length) return { businesses: [], staffUserIds: [] };

  let rows;
  try {
    rows = await query(`
      SELECT DISTINCT owner.id AS ownerUserId,
        staff.id AS staffUserId, staff.name AS name, staff.email AS email,
        membership.role AS role, membership.status AS status
      FROM sx_legacy_ownership staff_link
      JOIN sx_memberships membership
        ON membership.id=staff_link.membership_id
       AND membership.tenant_id=staff_link.tenant_id
       AND membership.role IN ('accountant','manager')
      JOIN sx_tenants tenant ON tenant.id=staff_link.tenant_id
      JOIN user staff
        ON staff_link.source_table='user'
       AND BINARY staff_link.source_id=BINARY CAST(staff.id AS CHAR)
       AND BINARY staff_link.legacy_uid_hash=BINARY SHA2(staff.uid,256)
      JOIN sx_legacy_ownership owner_link
        ON owner_link.tenant_id=staff_link.tenant_id
       AND owner_link.source_table='user'
      JOIN sx_memberships owner_membership
        ON owner_membership.id=owner_link.membership_id
       AND owner_membership.tenant_id=owner_link.tenant_id
       AND owner_membership.role='owner'
       AND owner_membership.status='active'
      JOIN user owner
        ON BINARY owner_link.source_id=BINARY CAST(owner.id AS CHAR)
       AND BINARY owner_link.legacy_uid_hash=BINARY SHA2(owner.uid,256)
      WHERE owner.id IN (${owners.map(() => '?').join(',')})
      ORDER BY owner.id, membership.role, staff.name, staff.id`, owners);
  } catch (error) {
    // Keep the legacy Manage Users page available during staged schema adoption.
    if (error.code === 'ER_NO_SUCH_TABLE') return { businesses: [], staffUserIds: [] };
    throw error;
  }

  const ownerSets = new Map();
  const uniqueRows = new Map();
  for (const row of rows) {
    const ownerId = Number(row.ownerUserId);
    const staffId = Number(row.staffUserId);
    if (!Number.isSafeInteger(ownerId) || !Number.isSafeInteger(staffId)) continue;
    if (!ownerSets.has(staffId)) ownerSets.set(staffId, new Set());
    ownerSets.get(staffId).add(ownerId);
    const key = `${ownerId}:${staffId}`;
    uniqueRows.set(key, {
      id: staffId,
      name: row.name || '',
      email: row.email || '',
      role: row.role,
      status: row.status
    });
  }

  const businesses = new Map();
  for (const [key, staff] of uniqueRows) {
    const ownerId = Number(key.slice(0, key.indexOf(':')));
    if (ownerSets.get(staff.id)?.size !== 1) continue;
    if (!businesses.has(ownerId)) businesses.set(ownerId, []);
    businesses.get(ownerId).push(staff);
  }
  return {
    businesses: [...businesses].map(([ownerUserId, staff]) => ({ ownerUserId, staff })),
    staffUserIds: [...ownerSets].filter(([, linkedOwners]) => linkedOwners.size === 1).map(([id]) => id)
  };
}

module.exports = { list };
