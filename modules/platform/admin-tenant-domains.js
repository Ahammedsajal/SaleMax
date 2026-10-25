'use strict';

const crypto = require('node:crypto');
const domains = require('./tenant-crm-domains');

const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const uuid = () => crypto.randomUUID();

function actor(req) {
  if (req.platformAccess?.role !== 'super_admin' || !req.platformAccess.identityId) fail('PERMISSION_DENIED', 403);
  return req.platformAccess.identityId;
}
function audit(db, tenantId, actorId, action, id, changes) {
  return db.query(`INSERT INTO sx_audit_events
    (id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,?,'identity',?,'tenant-crm-domain',?,?,?)`,
  [uuid(), tenantId, actorId, action, id, JSON.stringify(changes), uuid()]);
}
async function tenantForUser(db, userId) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) < 1) fail('INVALID_USER_ID');
  const [rows] = await db.query(`SELECT u.id AS userId,u.name,u.email,o.tenant_id AS tenantId,t.status AS tenantStatus
    FROM user u LEFT JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
    LEFT JOIN sx_tenants t ON t.id=o.tenant_id WHERE u.id=? LIMIT 2`, [Number(userId)]);
  if (!rows.length) fail('USER_NOT_FOUND', 404);
  if (rows.length !== 1 || !rows[0].tenantId) fail('BUSINESS_TENANT_NOT_LINKED', 409);
  if (rows[0].tenantStatus !== 'active') fail('BUSINESS_TENANT_INACTIVE', 409);
  return rows[0];
}
async function list(db, req) {
  const actorId = actor(req);
  void actorId;
  const search = String(req.query?.q || '').trim().slice(0, 100);
  const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const [businesses] = await db.query(`SELECT u.id AS userId,u.name,u.email,o.tenant_id AS tenantId,t.status AS tenantStatus
    FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
    JOIN sx_tenants t ON t.id=o.tenant_id
    WHERE (?='' OR u.name LIKE ? OR u.email LIKE ? OR CAST(u.id AS CHAR)=?)
    ORDER BY u.name,u.id LIMIT 300`, [search, like, like, search]);
  const ids = businesses.map(row => row.tenantId);
  const byTenant = new Map(ids.map(id => [id, []]));
  if (ids.length) {
    const [rows] = await db.query(`SELECT id,tenant_id AS tenantId,hostname,status,is_primary AS isPrimary,
      dns_health_status AS dnsHealthStatus,dns_last_checked_at AS dnsLastCheckedAt,
      ownership_verified_at AS ownershipVerifiedAt,tls_ready_at AS tlsReadyAt,created_at AS createdAt
      FROM sx_tenant_crm_domains WHERE tenant_id IN (${ids.map(() => '?').join(',')}) ORDER BY tenant_id,is_primary DESC,created_at`, ids);
    for (const row of rows) byTenant.get(row.tenantId)?.push(row);
  }
  return businesses.map(row => ({ ...row, domains: byTenant.get(row.tenantId) || [] }));
}
async function create(db, req) {
  const actorId = actor(req), business = await tenantForUser(db, req.body?.userId);
  const hostname = domains.normalizeHostname(req.body?.hostname);
  const requestedPrimary = req.body?.primary === true;
  let id = uuid(); const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  let isPrimary = false;
  await db.beginTransaction();
  try {
    await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE', [business.tenantId]);
    const [[count]] = await db.query("SELECT COUNT(*) AS total,COALESCE(MAX(is_primary=1),0) AS hasPrimary FROM sx_tenant_crm_domains WHERE tenant_id=? AND status<>'disabled' FOR UPDATE", [business.tenantId]);
    if (Number(count.total) >= 10) fail('DOMAIN_ALIAS_LIMIT_REACHED', 409);
    const primary = requestedPrimary || !Number(count.hasPrimary);
    isPrimary = primary;
    const [[existing]] = await db.query('SELECT id,tenant_id AS tenantId,status FROM sx_tenant_crm_domains WHERE hostname=? LIMIT 1 FOR UPDATE', [hostname]);
    if (existing && (existing.tenantId !== business.tenantId || existing.status !== 'disabled')) fail('HOSTNAME_ALREADY_CLAIMED', 409);
    if (existing) id = existing.id;
    if (primary) await db.query('UPDATE sx_tenant_crm_domains SET is_primary=NULL WHERE tenant_id=?', [business.tenantId]);
    if (existing) await db.query(`UPDATE sx_tenant_crm_domains SET status='pending',verification_token_hash=?,verification_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),ownership_verified_at=NULL,cname_verified_at=NULL,tls_ready_at=NULL,dns_check_after=NULL,dns_health_status='unknown',dns_last_checked_at=NULL,created_by_identity_id=?,active_tenant_id=?,is_primary=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND tenant_id=? AND status='disabled'`, [tokenHash, actorId, business.tenantId, primary ? 1 : null, id, business.tenantId]);
    else await db.query(`INSERT INTO sx_tenant_crm_domains
      (id,tenant_id,hostname,status,verification_token_hash,verification_expires_at,created_by_identity_id,active_tenant_id,is_primary)
      VALUES (?,?,?,'pending',?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),?,?,?)`,
    [id, business.tenantId, hostname, tokenHash, actorId, business.tenantId, primary ? 1 : null]);
    await audit(db, business.tenantId, actorId, 'platform.tenant-crm-domain.requested', id, { hostname, userId: business.userId, primary });
    await db.commit();
  } catch (error) { await db.rollback(); if (error.code === 'ER_DUP_ENTRY') fail('HOSTNAME_ALREADY_CLAIMED', 409); throw error; }
  const aRecordIpv4 = await domains.resolveTargetIpv4();
  const hostLabels = domains.dnsProviderHostLabels(hostname);
  return { id, hostname, status: 'pending', isPrimary, ...hostLabels, apexARecord: hostLabels.apex, txtName: `${domains.TXT_RECORD_LABEL}.${hostname}`,
    txtValue: `${domains.TXT_VALUE_PREFIX}${token}`, cnameName: hostname, cnameTarget: domains.ROOT_HOST,
    aRecordIpv4, expiresInHours: 24 };
}
async function verify(db, req, id) {
  const actorId = actor(req);
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) fail('INVALID_DOMAIN_ID');
  const [[row]] = await db.query(`SELECT id,tenant_id AS tenantId,hostname,status,verification_token_hash AS tokenHash,
    dns_health_status AS dnsHealthStatus,(verification_expires_at>UTC_TIMESTAMP(3)) AS validChallenge,
    (dns_check_after IS NULL OR dns_check_after<=UTC_TIMESTAMP(3)) AS canCheck
    FROM sx_tenant_crm_domains WHERE id=? LIMIT 1`, [id]);
  if (!row) fail('DOMAIN_NOT_FOUND', 404);
  if (!['pending', 'active'].includes(row.status) || (row.status === 'pending' && !Number(row.validChallenge))) fail('DOMAIN_CHALLENGE_EXPIRED', 409);
  if (!Number(row.canCheck)) fail('DOMAIN_DNS_RATE_LIMITED', 429);
  const [changed] = await db.query(`UPDATE sx_tenant_crm_domains SET dns_check_after=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ${domains.DNS_CHECK_COOLDOWN_SECONDS} SECOND),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status IN ('pending','active')`, [id]);
  if (!changed.affectedRows) fail('DOMAIN_NOT_FOUND', 404);
  const records = await domains.checkDnsRecords(row);
  await db.beginTransaction();
  try {
    const [[current]] = await db.query('SELECT status,verification_token_hash AS tokenHash,dns_health_status AS dnsHealthStatus,(verification_expires_at>UTC_TIMESTAMP(3)) AS validChallenge FROM sx_tenant_crm_domains WHERE id=? FOR UPDATE', [id]);
    if (!current || current.tokenHash !== row.tokenHash || !['pending', 'active'].includes(current.status)) fail('DOMAIN_CHALLENGE_CHANGED', 409);
    if (current.status === 'pending' && !Number(current.validChallenge)) fail('DOMAIN_CHALLENGE_EXPIRED', 409);
    if (!records.healthy) {
      await db.query("UPDATE sx_tenant_crm_domains SET dns_health_status='stale',dns_last_checked_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=?", [id]);
      await audit(db, row.tenantId, actorId, 'platform.tenant-crm-domain.dns-check-failed', id, { hostname: row.hostname, txtOk: records.txtOk, cnameOk: records.cnameOk, aRecordOk: records.aRecordOk });
      await db.commit();
      fail(records.txtOk ? 'DOMAIN_TARGET_NOT_VERIFIED' : 'DOMAIN_TXT_NOT_VERIFIED', 409);
    }
    if (current.status === 'pending') await db.query("UPDATE sx_tenant_crm_domains SET status='verified',dns_check_after=NULL,dns_health_status='healthy',dns_last_checked_at=UTC_TIMESTAMP(3),ownership_verified_at=UTC_TIMESTAMP(3),cname_verified_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=?", [id]);
    else await db.query("UPDATE sx_tenant_crm_domains SET dns_check_after=NULL,dns_health_status='healthy',dns_last_checked_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=?", [id]);
    await audit(db, row.tenantId, actorId, 'platform.tenant-crm-domain.dns-verified', id, { hostname: row.hostname, tlsReady: false });
    await db.commit();
    return { id, hostname: row.hostname, status: current.status === 'active' ? 'active' : 'verified', dnsHealthy: true, tlsReady: current.status === 'active' };
  } catch (error) { if (!['DOMAIN_TXT_NOT_VERIFIED', 'DOMAIN_TARGET_NOT_VERIFIED'].includes(error.code)) await db.rollback(); throw error; }
}
async function rotateChallenge(db, req, id) {
  const actorId = actor(req);
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) fail('INVALID_DOMAIN_ID');
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await db.beginTransaction();
  let row;
  try {
    const [[locked]] = await db.query("SELECT id,tenant_id AS tenantId,hostname,status FROM sx_tenant_crm_domains WHERE id=? LIMIT 1 FOR UPDATE", [id]);
    row = locked;
    if (!row) fail('DOMAIN_NOT_FOUND', 404);
    if (row.status !== 'pending') fail('DOMAIN_NOT_PENDING', 409);
    await db.query("UPDATE sx_tenant_crm_domains SET verification_token_hash=?,verification_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),dns_check_after=NULL,dns_health_status='unknown',dns_last_checked_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='pending'", [tokenHash, id]);
    await audit(db, row.tenantId, actorId, 'platform.tenant-crm-domain.challenge-rotated', id, { hostname: row.hostname });
    await db.commit();
  } catch (error) { await db.rollback(); throw error; }
  const hostLabels = domains.dnsProviderHostLabels(row.hostname);
  return { id, hostname: row.hostname, status: 'pending', ...hostLabels, apexARecord: hostLabels.apex, txtName: `${domains.TXT_RECORD_LABEL}.${row.hostname}`,
    txtValue: `${domains.TXT_VALUE_PREFIX}${token}`, cnameName: row.hostname, cnameTarget: domains.ROOT_HOST,
    aRecordIpv4: await domains.resolveTargetIpv4(), expiresInHours: 24 };
}
async function setPrimary(db, req, id) {
  const actorId = actor(req);
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) fail('INVALID_DOMAIN_ID');
  await db.beginTransaction();
  try {
    const [[row]] = await db.query("SELECT id,tenant_id AS tenantId,hostname,status FROM sx_tenant_crm_domains WHERE id=? LIMIT 1 FOR UPDATE", [id]);
    if (!row) fail('DOMAIN_NOT_FOUND', 404);
    if (!['verified', 'active'].includes(row.status)) fail('DOMAIN_NOT_READY_FOR_PRIMARY', 409);
    await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE', [row.tenantId]);
    await db.query('UPDATE sx_tenant_crm_domains SET is_primary=NULL WHERE tenant_id=?', [row.tenantId]);
    await db.query('UPDATE sx_tenant_crm_domains SET is_primary=1 WHERE id=? AND tenant_id=?', [id, row.tenantId]);
    await audit(db, row.tenantId, actorId, 'platform.tenant-crm-domain.primary-changed', id, { hostname: row.hostname });
    await db.commit();
    return { id, hostname: row.hostname, isPrimary: true };
  } catch (error) { await db.rollback(); throw error; }
}
async function disable(db, req, id) {
  const actorId = actor(req);
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) fail('INVALID_DOMAIN_ID');
  await db.beginTransaction();
  try {
    const [[row]] = await db.query('SELECT id,tenant_id AS tenantId,hostname,status,is_primary AS isPrimary FROM sx_tenant_crm_domains WHERE id=? LIMIT 1 FOR UPDATE', [id]);
    if (!row) fail('DOMAIN_NOT_FOUND', 404);
    await db.query("UPDATE sx_tenant_crm_domains SET active_tenant_id=NULL,status='disabled',is_primary=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [id]);
    if (row.isPrimary) {
      const [[next]] = await db.query("SELECT id FROM sx_tenant_crm_domains WHERE tenant_id=? AND status IN ('verified','active') AND id<>? ORDER BY (status='active') DESC,created_at,id LIMIT 1 FOR UPDATE", [row.tenantId, id]);
      if (next) await db.query('UPDATE sx_tenant_crm_domains SET is_primary=1 WHERE id=?', [next.id]);
    }
    await audit(db, row.tenantId, actorId, 'platform.tenant-crm-domain.disabled', id, { hostname: row.hostname, previousStatus: row.status });
    await db.commit();
    return { id, hostname: row.hostname, status: 'disabled' };
  } catch (error) { await db.rollback(); throw error; }
}

module.exports = { actor, list, create, verify, rotateChallenge, setPrimary, disable };
