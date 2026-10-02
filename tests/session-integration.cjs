// Called only inside the disposable real-MariaDB test database.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {loadSession,tokenHash} = require('../modules/platform/sessions');
const {platformDecision} = require('../modules/platform/policy');
module.exports = async function verifySessions(db,{t1,i1,m1}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const sid = crypto.randomUUID();
  assert.equal(tokenHash('invalid'),null);
  await db.query(`INSERT INTO sx_sessions(id,token_hash,identity_id,audience,tenant_id,membership_id,credential_version,authenticated_at,expires_at)
    VALUES (?,?,?,'tenant',?,?,1,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))`,[sid,tokenHash(token),i1,t1,m1]);
  const context = await loadSession(db,token);
  assert.equal(context.tenant.id,t1);
  assert.equal(context.membership.id,m1);
  assert.equal(context.audience,'tenant');
  assert.equal(platformDecision(context,'tenants.read'),false);
  assert.equal(await loadSession(db,crypto.randomBytes(32).toString('base64url')),null);
  // An already issued session must observe changes on the very next request.
  await db.query("UPDATE sx_memberships SET role='manager',permission_version=2,delegated_permissions=? WHERE id=?",[JSON.stringify(['team.invite']),m1]);
  const changed = await loadSession(db,token);
  assert.equal(changed.membership.role,'manager');
  assert.equal(changed.membership.permissionVersion,2);
  assert.deepEqual(changed.membership.delegatedPermissions,['team.invite']);
  for(const [table,column,id,status] of [['sx_memberships','id',m1,'inactive'],['sx_identities','id',i1,'disabled']]) {
    await db.query(`UPDATE ${table} SET status=? WHERE ${column}=?`,[status,id]);
    assert.equal(await loadSession(db,token),null);
    await db.query(`UPDATE ${table} SET status='active' WHERE ${column}=?`,[id]);
  }
  await db.query("UPDATE sx_tenants SET status='suspended' WHERE id=?",[t1]);
  assert.equal(await loadSession(db,token),null);
  await db.query("UPDATE sx_tenants SET status='active' WHERE id=?",[t1]);
  await db.query('UPDATE sx_identities SET credential_version=2 WHERE id=?',[i1]);
  assert.equal(await loadSession(db,token),null);
  await db.query('UPDATE sx_identities SET credential_version=1 WHERE id=?',[i1]);
  await db.query('UPDATE sx_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[sid]);
  assert.equal(await loadSession(db,token),null);
  await db.query('UPDATE sx_sessions SET expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY),revoked_at=UTC_TIMESTAMP(3) WHERE id=?',[sid]);
  assert.equal(await loadSession(db,token),null);
  const platformToken = crypto.randomBytes(32).toString('base64url');
  const psid=crypto.randomUUID();
  await db.query(`INSERT INTO sx_sessions(id,token_hash,identity_id,audience,credential_version,authenticated_at,expires_at)
    VALUES (?,?,?,'platform',1,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))`,[psid,tokenHash(platformToken),i1]);
  assert.equal(platformDecision(await loadSession(db,platformToken),'tenants.read'),false);
  await db.query('UPDATE sx_sessions SET mfa_verified_at=UTC_TIMESTAMP(3) WHERE id=?',[psid]);
  assert.equal(platformDecision(await loadSession(db,platformToken),'features.release'),true);
  await db.query('UPDATE sx_sessions SET authenticated_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 6 MINUTE) WHERE id=?',[psid]);
  assert.equal(platformDecision(await loadSession(db,platformToken),'features.release'),true);
  assert.equal(platformDecision(await loadSession(db,platformToken),'tenants.read'),true);
  await db.query('UPDATE sx_sessions SET mfa_verified_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 13 HOUR) WHERE id=?',[psid]);
  assert.equal(platformDecision(await loadSession(db,platformToken),'tenants.read'),true);
  await db.query('UPDATE sx_sessions SET mfa_verified_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),authenticated_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR) WHERE id=?',[psid]);
  const future = await loadSession(db,platformToken);
  assert.equal(future.mfaVerified,false);
  assert.equal(future.recentlyAuthenticated,false);
  await db.query("UPDATE sx_platform_memberships SET status='inactive' WHERE identity_id=?",[i1]);
  assert.equal(await loadSession(db,platformToken),null);
  await db.query("UPDATE sx_platform_memberships SET status='active' WHERE identity_id=?",[i1]);
  return {sessionRevocation:true,currentMembershipReload:true,disabledIdentityDenied:true,credentialChangeInvalidates:true,expiryDenied:true,platformMfaPersistsForSession:true,noRepeatedStepUp:true};
};
