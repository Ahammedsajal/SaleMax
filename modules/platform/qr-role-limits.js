'use strict';

const ROLE_KEYS = Object.freeze(['owner', 'accountant', 'manager', 'team_leader', 'agent']);
const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 50;

function fail(code, status = 400) {
  throw Object.assign(new Error(code), { code, status });
}

function integer(value, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum;
}

async function eligibleUserIds(db, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return [];
  const [rows] = await db.query(`
    SELECT u.id
      FROM user u
      JOIN sx_legacy_ownership link
        ON link.source_table='user'
       AND BINARY link.source_id=BINARY CAST(u.id AS CHAR)
       AND BINARY link.legacy_uid_hash=BINARY SHA2(u.uid,256)
      JOIN sx_tenants tenant ON tenant.id=link.tenant_id AND tenant.category_key='training_center'
      JOIN sx_memberships owner_member
        ON owner_member.tenant_id=tenant.id AND owner_member.id=link.membership_id
       AND owner_member.role='owner' AND owner_member.status='active'
     WHERE u.id IN (${ids.map(() => '?').join(',')})
     GROUP BY u.id
    HAVING COUNT(DISTINCT tenant.id)=1`, ids);
  return rows.map(row => Number(row.id));
}

async function resolveTenant(db, userId, { lock = false } = {}) {
  if (!integer(userId, 1, Number.MAX_SAFE_INTEGER)) fail('INVALID_USER_ID');
  const [rows] = await db.query(`
    SELECT u.id,u.uid,tenant.id AS tenant_id,tenant.category_key
      FROM user u
      JOIN sx_legacy_ownership link
        ON link.source_table='user'
       AND BINARY link.source_id=BINARY CAST(u.id AS CHAR)
       AND BINARY link.legacy_uid_hash=BINARY SHA2(u.uid,256)
      JOIN sx_tenants tenant ON tenant.id=link.tenant_id
      JOIN sx_memberships owner_member
        ON owner_member.tenant_id=tenant.id AND owner_member.id=link.membership_id
       AND owner_member.role='owner' AND owner_member.status='active'
     WHERE u.id=? ${lock ? 'FOR UPDATE' : ''}`, [Number(userId)]);
  if (!rows.length) fail('VERIFIED_TRAINING_CENTER_REQUIRED', 404);
  const unique = new Map(rows.map(row => [row.tenant_id, row]));
  if (unique.size !== 1) fail('AMBIGUOUS_TENANT_LINK', 409);
  const owner = [...unique.values()][0];
  if (owner.category_key !== 'training_center') fail('TRAINING_CENTER_ONLY', 400);
  return owner;
}

async function limitFor(db, tenantId, role) {
  if (!tenantId || !ROLE_KEYS.includes(role)) return DEFAULT_LIMIT;
  try {
    const [rows] = await db.query(
      'SELECT max_instances FROM sx_qr_role_limits WHERE tenant_id=? AND role_key=? LIMIT 1',
      [tenantId, role],
    );
    return rows.length ? Number(rows[0].max_instances) : DEFAULT_LIMIT;
  } catch (error) {
    // Keep the current one-instance behavior during mixed-version rollout.
    if (error.code === 'ER_NO_SUCH_TABLE') return DEFAULT_LIMIT;
    throw error;
  }
}

async function readForUser(db, userId) {
  const owner = await resolveTenant(db, userId);
  const [groups] = await db.query(`
    SELECT m.role,
      SUM(CASE WHEN m.status='active' THEN 1 ELSE 0 END) AS active_members,
      SUM(CASE WHEN m.status='inactive' THEN 1 ELSE 0 END) AS inactive_members,
      SUM(CASE WHEN m.role='owner' THEN 0 ELSE COALESCE(created_qr.total,0) END) AS qr_instances
      FROM sx_memberships m
      LEFT JOIN (
        SELECT share.tenant_id,share.membership_id,share.granted_by_identity_id,
          COUNT(DISTINCT share.instance_id) AS total
          FROM sx_qr_channel_shares share
          JOIN instance ON instance.id=share.instance_id
         WHERE share.tenant_id=? AND instance.uid=?
         GROUP BY share.tenant_id,share.membership_id,share.granted_by_identity_id
      ) created_qr ON created_qr.tenant_id=m.tenant_id
        AND created_qr.membership_id=m.id AND created_qr.granted_by_identity_id=m.identity_id
     WHERE m.tenant_id=?
     GROUP BY m.role`, [owner.tenant_id, owner.uid, owner.tenant_id]);
  const [[ownerQr]] = await db.query('SELECT COUNT(*) AS total FROM instance WHERE uid=?', [owner.uid]);
  const [saved] = await db.query('SELECT role_key,max_instances FROM sx_qr_role_limits WHERE tenant_id=?', [owner.tenant_id]);
  const settings = new Map(saved.map(row => [row.role_key, Number(row.max_instances)]));
  const usage = new Map(groups.map(row => [row.role, {
    active: Number(row.active_members || 0),
    inactive: Number(row.inactive_members || 0),
    qrInstances: Number(row.role === 'owner' ? ownerQr.total : row.qr_instances || 0),
  }]));
  return {
    userId: Number(owner.id),
    categoryKey: owner.category_key,
    roles: ROLE_KEYS.map(role => ({
      role,
      members: usage.get(role)?.active || 0,
      inactiveMembers: usage.get(role)?.inactive || 0,
      qrInstances: usage.get(role)?.qrInstances || 0,
      maxInstances: settings.get(role) ?? DEFAULT_LIMIT,
    })),
  };
}

async function saveForUser(db, { userId, roleLimits, actorIdentityId = null, legacyAdminId = null }) {
  if (!roleLimits || typeof roleLimits !== 'object' || Array.isArray(roleLimits) ||
      Object.keys(roleLimits).length !== ROLE_KEYS.length ||
      ROLE_KEYS.some(role => !Object.hasOwn(roleLimits, role) || !integer(roleLimits[role], 0, MAX_LIMIT))) {
    fail('INVALID_QR_ROLE_LIMITS');
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const owner = await resolveTenant(connection, userId, { lock: true });
    for (const role of ROLE_KEYS) {
      await connection.query(`
        INSERT INTO sx_qr_role_limits(tenant_id,role_key,max_instances,updated_by_identity_id)
        VALUES (?,?,?,?)
        ON DUPLICATE KEY UPDATE max_instances=VALUES(max_instances),updated_by_identity_id=VALUES(updated_by_identity_id)`,
      [owner.tenant_id, role, Number(roleLimits[role]), actorIdentityId]);
    }
    const crypto = require('node:crypto');
    const actorKind = actorIdentityId ? 'identity' : 'system';
    const changes = { roleLimits: Object.fromEntries(ROLE_KEYS.map(role => [role, Number(roleLimits[role])])) };
    if (!actorIdentityId) changes.legacyAdminId = Number(legacyAdminId) || null;
    await connection.query(`
      INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,?,'tenant.qr-role-limits.updated','qr-role-limits',?,?,?)`,
    [crypto.randomUUID(), owner.tenant_id, actorIdentityId, actorKind, owner.tenant_id, JSON.stringify(changes), crypto.randomUUID()]);
    await connection.commit();
    connection.release();
    return { tenantId: owner.tenant_id, roleLimits: changes.roleLimits };
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
}

module.exports = { ROLE_KEYS, DEFAULT_LIMIT, MAX_LIMIT, eligibleUserIds, resolveTenant, limitFor, readForUser, saveForUser };
