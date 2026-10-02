'use strict';

const crypto=require('node:crypto');
const {platformAdminAllowlist,platformStaffAllowlist}=require('./policy');

const denied=code=>({allowed:false,code});
const allowed=platform=>({allowed:true,...(platform?{platform}:{})});
function requiredPermission(method,path){
  const pathname=String(path||'').split('?')[0].replace(/\/$/,'')||'/';
  if(method==='GET'&&pathname==='/api/admin/get_admin')return null;
  if(method==='POST'&&pathname==='/api/admin/update-admin')return 'staff.manage';
  if(method==='GET'&&pathname==='/api/admin/get_users')return 'tenants.read';
  if(method==='GET'&&pathname==='/api/admin/user_plan_context')return 'plans.read';
  if(method==='POST'&&pathname==='/api/admin/preview_user_plan')return 'plans.assign';
  if(method==='POST'&&pathname==='/api/admin/add_user')return 'tenants.create';
  if(method==='POST'&&pathname==='/api/admin/update_user')return 'tenants.manage';
  if(method==='POST'&&pathname==='/api/admin/update_plan')return 'plans.assign';
  if(method==='GET'&&pathname==='/api/admin/get_dashboard_for_user')return 'tenants.read';
  if(method==='POST'&&pathname==='/api/admin/del_user')return 'tenants.manage';
  if(method==='POST'&&pathname==='/api/admin/auto_login')return 'owner.impersonate';
  if(['POST'].includes(method)&&['/api/admin/add_plan','/api/admin/edit_plan','/api/admin/del_plan'].includes(pathname))return 'plans.draft';
  if(pathname.startsWith('/api/admin/platform-auth/')||
    pathname.startsWith('/api/admin/plan-contracts/')||
    pathname.startsWith('/api/admin/business-contracts/')||
    pathname.startsWith('/api/admin/platform-access/'))return 'delegated-module';
  return undefined;
}

function createLegacyAdminStaffBoundary(runQuery,{enforcePlatform=()=>process.env.SALEMAX_PLATFORM_ENABLED==='true'}={}){
  if(typeof runQuery!=='function')throw new TypeError('runQuery is required');
  const platformEnforced=()=>typeof enforcePlatform==='function'?!!enforcePlatform():!!enforcePlatform;
  return async function check({adminId,uid,method,path}){
    const uidHash=crypto.createHash('sha256').update(uid,'utf8').digest('hex');
    let rows;
    try{
      rows=await runQuery(`SELECT l.legacy_uid,l.status AS link_status,l.identity_id AS identity_id,
          m.role,m.status AS membership_status,m.delegated_permissions,m.reports_to_identity_id,
          i.status AS identity_status
        FROM sx_legacy_admin_identities l
        LEFT JOIN sx_identities i ON i.id=l.identity_id
        LEFT JOIN sx_platform_memberships m ON m.identity_id=i.id AND m.role IN ('super_admin','platform_admin','staff')
        WHERE l.legacy_admin_id=? AND l.legacy_uid_hash=?`,[adminId,uidHash]);
    }catch(error){
      if(error.code==='ER_NO_SUCH_TABLE')return platformEnforced()?denied('PLATFORM_ACCOUNT_NOT_LINKED'):allowed();
      throw error;
    }
    if(!rows.length)return platformEnforced()?denied('PLATFORM_ACCOUNT_NOT_LINKED'):allowed();
    if(rows.length!==1||rows[0].legacy_uid!==uid||rows[0].link_status!=='active'||rows[0].identity_status!=='active'||rows[0].membership_status!=='active')return denied('PLATFORM_ACCOUNT_INACTIVE');
    const account=rows[0],platform={identityId:account.identity_id,role:account.role,reportsToIdentityId:account.reports_to_identity_id||null};
    if(account.role==='super_admin')return allowed(platform);
    const permission=requiredPermission(method,path);
    if(permission==='delegated-module')return allowed(platform);
    if(permission===null)return allowed(platform);
    if(permission===undefined)return denied('PLATFORM_PERMISSION_DENIED');
    if(account.role==='platform_admin')return platformAdminAllowlist.includes(permission)?allowed(platform):denied('PLATFORM_PERMISSION_DENIED');
    if(account.role!=='staff')return denied('PLATFORM_PERMISSION_DENIED');
    let grants;
    try{grants=typeof account.delegated_permissions==='string'?JSON.parse(account.delegated_permissions):account.delegated_permissions;}catch(_){return denied('STAFF_PERMISSION_DENIED');}
    const valid=Array.isArray(grants)&&grants.every(permission=>platformStaffAllowlist.includes(permission));
    if(!valid||!grants.includes(permission))return denied('STAFF_PERMISSION_DENIED');
    platform.delegatedPermissions=grants;
    return allowed(platform);
  };
}

module.exports={createLegacyAdminStaffBoundary,requiredPermission};
