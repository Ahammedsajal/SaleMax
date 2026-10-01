'use strict';

const crypto=require('node:crypto');

const denied=code=>({allowed:false,code});
const allowed=()=>({allowed:true});

function requiredPermission(method,path){
  const pathname=String(path||'').split('?')[0].replace(/\/$/,'')||'/';
  if(method==='GET'&&pathname==='/api/admin/get_admin')return null; // Own profile only.
  if(method==='GET'&&pathname==='/api/admin/get_users')return 'tenants.read';
  if(method==='GET'&&pathname==='/api/admin/user_plan_context')return 'plans.read';
  if(method==='POST'&&pathname==='/api/admin/preview_user_plan')return 'plans.assign';
  // These mounted modules independently enforce MFA, CSRF, audience, identity
  // mapping, and the specific platform grant for every action.
  if(pathname.startsWith('/api/admin/platform-auth/')||
    pathname.startsWith('/api/admin/plan-contracts/')||
    pathname.startsWith('/api/admin/business-contracts/')||
    pathname.startsWith('/api/admin/platform-access/'))return 'delegated-module';
  return undefined;
}

function createLegacyAdminStaffBoundary(runQuery){
  if(typeof runQuery!=='function')throw new TypeError('runQuery is required');
  return async function check({adminId,uid,method,path}){
    const uidHash=crypto.createHash('sha256').update(uid,'utf8').digest('hex');
    let rows;
    try{
      rows=await runQuery(`SELECT l.legacy_uid,l.status AS link_status,m.role,m.status AS membership_status,
          m.delegated_permissions,i.status AS identity_status
        FROM sx_legacy_admin_identities l
        LEFT JOIN sx_identities i ON i.id=l.identity_id
        LEFT JOIN sx_platform_memberships m ON m.identity_id=i.id AND m.role IN ('super_admin','staff')
        WHERE l.legacy_admin_id=? AND l.legacy_uid_hash=?`,[adminId,uidHash]);
    }catch(error){
      if(error.code==='ER_NO_SUCH_TABLE')return allowed(); // Existing installation before canonical adoption.
      throw error;
    }
    if(!rows.length)return allowed(); // Unmapped legacy administrators retain compatibility.
    if(rows.length!==1||rows[0].legacy_uid!==uid||rows[0].link_status!=='active'||rows[0].identity_status!=='active'||rows[0].membership_status!=='active')return denied('PLATFORM_ACCOUNT_INACTIVE');
    const account=rows[0];
    if(account.role==='super_admin')return allowed();
    if(account.role!=='staff')return denied('STAFF_PERMISSION_DENIED');
    const permission=requiredPermission(method,path);
    if(permission==='delegated-module')return allowed();
    if(permission===undefined)return denied('STAFF_PERMISSION_DENIED');
    if(permission===null)return allowed();
    let grants;
    try{grants=typeof account.delegated_permissions==='string'?JSON.parse(account.delegated_permissions):account.delegated_permissions;}catch(_){return denied('STAFF_PERMISSION_DENIED');}
    return Array.isArray(grants)&&grants.includes(permission)?allowed():denied('STAFF_PERMISSION_DENIED');
  };
}

module.exports={createLegacyAdminStaffBoundary,requiredPermission};
