'use strict';

const crypto=require('node:crypto');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const actorId=context=>typeof context?.identity?.id==='string'?context.identity.id:null;
function portfolioIdentity(context){
  if(context?.audience!=='platform'||context.membership?.status!=='active'||!actorId(context))fail('PLATFORM_REQUIRED');
  if(context.membership.role==='super_admin')return null;
  if(context.membership.role==='platform_admin')return actorId(context);
  if(context.membership.role==='staff')return context.membership.reportsToIdentityId||actorId(context);
  fail('PERMISSION_DENIED');
}
function canSeeAll(context){return context?.audience==='platform'&&context.membership?.role==='super_admin'&&context.membership?.status==='active';}
function userId(value){const id=Number(value);if(!Number.isSafeInteger(id)||id<1||id>2147483647)fail('INVALID_USER_ID');return id;}
async function canAccess(db,context,id){
  id=userId(id);if(canSeeAll(context))return true;
  const owner=portfolioIdentity(context);if(!owner)return false;
  const [[row]]=await db.query('SELECT 1 AS allowed FROM sx_platform_user_portfolios WHERE legacy_user_id=? AND managed_by_identity_id=?',[id,owner]);
  return !!row;
}
async function requireAccess(db,context,id){if(!await canAccess(db,context,id))fail('PORTFOLIO_ACCESS_DENIED');return userId(id);}
async function recordCreated(db,context,id){
  id=userId(id);const creator=actorId(context);if(!creator)fail('PLATFORM_REQUIRED');
  const role=context.membership?.role;
  const managedBy=role==='super_admin'?null:portfolioIdentity(context);
  const source=role==='super_admin'?'super_admin_created':role==='staff'?'staff_created':'admin_created';
  await db.query(`INSERT INTO sx_platform_user_portfolios(legacy_user_id,managed_by_identity_id,created_by_identity_id,source)
    VALUES (?,?,?,?)`,[id,managedBy,creator,source]);
  await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,'identity','platform.customer-created','platform-user',?,?,?)`,[crypto.randomUUID(),creator,String(id),JSON.stringify({managedByIdentityId:managedBy,source}),crypto.randomUUID()]);
}
async function assign(db,context,id,targetIdentityId){
  if(!canSeeAll(context))fail('PERMISSION_DENIED');id=userId(id);
  if(targetIdentityId!==null&&typeof targetIdentityId!=='string')fail('INVALID_PORTFOLIO_OWNER');
  if(targetIdentityId){
    const [[target]]=await db.query(`SELECT p.role,p.status,i.status AS identity_status FROM sx_platform_memberships p
      JOIN sx_identities i ON i.id=p.identity_id WHERE p.identity_id=?`,[targetIdentityId]);
    if(!target||target.identity_status!=='active'||target.status!=='active'||!['platform_admin','staff'].includes(target.role))fail('PORTFOLIO_OWNER_NOT_FOUND');
    if(target.role==='staff'){
      const [[manager]]=await db.query('SELECT reports_to_identity_id FROM sx_platform_memberships WHERE identity_id=?',[targetIdentityId]);
      if(manager?.reports_to_identity_id)targetIdentityId=manager.reports_to_identity_id;
    }
  }
  const [[exists]]=await db.query('SELECT id FROM user WHERE id=?',[id]);if(!exists)fail('USER_NOT_FOUND');
  const [[prior]]=await db.query('SELECT managed_by_identity_id,source FROM sx_platform_user_portfolios WHERE legacy_user_id=? FOR UPDATE',[id]);
  const oldOwner=prior?.managed_by_identity_id??null;
  if(prior){
    await db.query(`UPDATE sx_platform_user_portfolios SET managed_by_identity_id=?,source='super_admin_assigned' WHERE legacy_user_id=?`,[targetIdentityId,id]);
  }else{
    await db.query(`INSERT INTO sx_platform_user_portfolios(legacy_user_id,managed_by_identity_id,created_by_identity_id,source)
      VALUES (?,?,?,'super_admin_assigned')`,[id,targetIdentityId,actorId(context)]);
  }
  await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,'identity','platform.user-assigned','platform-user',?,?,?)`,[crypto.randomUUID(),actorId(context),String(id),JSON.stringify({fromAdminIdentityId:oldOwner,toAdminIdentityId:targetIdentityId}),crypto.randomUUID()]);
  return {userId:id,managedByIdentityId:targetIdentityId};
}
async function accessibleUserIds(db,context){
  if(canSeeAll(context))return null;
  const owner=portfolioIdentity(context);if(!owner)return [];
  const [rows]=await db.query('SELECT legacy_user_id AS id FROM sx_platform_user_portfolios WHERE managed_by_identity_id=? ORDER BY legacy_user_id',[owner]);
  return rows.map(row=>Number(row.id));
}
module.exports={portfolioIdentity,canSeeAll,canAccess,requireAccess,recordCreated,assign,accessibleUserIds,userId};
