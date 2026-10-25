'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const bcrypt=require('bcrypt');
const transfer=require('../modules/platform/tenant-owner-transfer');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');

module.exports=async function ownerTransferIntegration(db,{platformIdentityId}){
  const tenantId=crypto.randomUUID(),ownerIdentityId=crypto.randomUUID(),ownerMembershipId=crypto.randomUUID(),
    sessionId=crypto.randomUUID(),legacyUid=`synthetic-owner-transfer-${crypto.randomUUID()}`,
    ownerEmail=`current-owner-${crypto.randomUUID()}@example.invalid`,recipientEmail=`successor-${crypto.randomUUID()}@example.invalid`;
  await db.query("INSERT INTO sx_tenants(id,slug,name,category_key,category_version,status) VALUES (?,?,?,'training_center',1,'active')",[tenantId,`synthetic-handover-${crypto.randomUUID().slice(0,8)}`,'Synthetic Handover Business']);
  await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES (?,?,?,'active')",[ownerIdentityId,ownerEmail,'Current synthetic owner']);
  await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'owner','active')",[ownerMembershipId,tenantId,ownerIdentityId]);
  const [legacy]=await db.query('INSERT INTO user(uid,name,email,password,plan,plan_expire) VALUES (?,?,?,?,?,?)',[legacyUid,'Current synthetic owner',ownerEmail,await bcrypt.hash('Synthetic-old-owner-password',10),JSON.stringify({synthetic:true}),String(Date.now()+86400000)]);
  await db.query("INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES ('user',?,?,?,?,UTC_TIMESTAMP(3))",[String(legacy.insertId),tenantId,ownerMembershipId,sha(legacyUid)]);
  const published={headline:'Keep this storefront',category:'training_center',sections:[{type:'courses',visible:true}]};
  await db.query('INSERT INTO sx_tenant_storefronts(tenant_id,draft_json,published_json,revision,published_revision,updated_by_identity_id,published_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))',[tenantId,JSON.stringify(published),JSON.stringify(published),4,3,ownerIdentityId]);
  await db.query("INSERT INTO sx_sessions(id,token_hash,identity_id,audience,tenant_id,membership_id,credential_version,authenticated_at,expires_at) VALUES (?,?,?,'tenant',?,?,1,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))",[sessionId,crypto.randomBytes(32).toString('hex'),ownerIdentityId,tenantId,ownerMembershipId]);
  const actor={audience:'platform',identity:{id:platformIdentityId},membership:{role:'super_admin',status:'active'},mfaVerified:true,recentlyAuthenticated:true};
  const invitation=await transfer.create(db,actor,tenantId,{email:recipientEmail,reason:'Approved transfer to the successor business owner.'});
  const accepted=await transfer.accept(db,{token:invitation.token,name:'Successor Business Owner',password:'Synthetic-successor-password-2026'});
  assert.equal(accepted.status,'accepted');assert.equal(accepted.tenantId,tenantId);assert.equal(accepted.email,recipientEmail);
  const [[tenant]]=await db.query('SELECT id,slug FROM sx_tenants WHERE id=?',[tenantId]);assert.equal(tenant.id,tenantId);
  const [[storefront]]=await db.query('SELECT tenant_id AS tenantId,draft_json AS draft,published_json AS published,revision,published_revision AS publishedRevision FROM sx_tenant_storefronts WHERE tenant_id=?',[tenantId]);
  assert.equal(storefront.tenantId,tenantId);assert.deepEqual(typeof storefront.published==='string'?JSON.parse(storefront.published):storefront.published,published);assert.equal(Number(storefront.revision),4);assert.equal(Number(storefront.publishedRevision),3);
  const [[owners]]=await db.query("SELECT COUNT(*) AS total FROM sx_memberships WHERE tenant_id=? AND role='owner' AND status='active' AND identity_id=(SELECT id FROM sx_identities WHERE email_normalized=?)",[tenantId,recipientEmail]);assert.equal(Number(owners.total),1);
  const [[prior]]=await db.query('SELECT status FROM sx_memberships WHERE tenant_id=? AND id=?',[tenantId,ownerMembershipId]);assert.equal(prior.status,'inactive');
  const [[mapping]]=await db.query("SELECT membership_id AS membershipId,legacy_uid_hash AS uidHash FROM sx_legacy_ownership WHERE source_table='user' AND source_id=? AND tenant_id=?",[String(legacy.insertId),tenantId]);assert.notEqual(mapping.membershipId,ownerMembershipId);assert.equal(mapping.uidHash,sha(legacyUid));
  const [[session]]=await db.query('SELECT revoked_at AS revokedAt FROM sx_sessions WHERE id=?',[sessionId]);assert.ok(session.revokedAt);
  const [[handover]]=await db.query('SELECT status,new_identity_id AS newIdentityId,new_membership_id AS newMembershipId FROM sx_tenant_owner_transfers WHERE id=?',[invitation.id]);assert.equal(handover.status,'accepted');assert.ok(handover.newIdentityId);assert.ok(handover.newMembershipId);
  await assert.rejects(transfer.accept(db,{token:invitation.token,name:'Replay Owner',password:'Synthetic-successor-password-2026'}),{code:'TRANSFER_INVALID'});
  return {ownerTransferUsesReviewedLegacyLink:true,ownerTransferRevokesPriorMembershipSession:true,storefrontAndTenantStayAttachedAcrossOwnerTransfer:true,ownerTransferAcceptanceIsOneTime:true};
};
