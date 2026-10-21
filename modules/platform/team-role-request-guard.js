'use strict';
const {query}=require('../../database/dbpromise');
const policy=require('./policy');
const {isSelfProfileRequest}=require('./self-profile-policy');
const {canonicalMount,routePermission}=require('./legacy-route-policy');

function salesAccountantLegacyRouteAllowed(req){
  const mount=canonicalMount(req.baseUrl);
  const path=String(req.path||'/').toLowerCase();
  const method=String(req.method||'GET').toUpperCase();
  if(mount==='/api/workspace/session'&&method==='GET')return true;
  // Keep the identity/bootstrap reads required by the existing /user shell.
  // Finance and commission workspaces use their canonical guarded APIs.
  return mount==='/api/user' && method==='GET' &&
    ['/get_me','/fetch_profile','/get_plan_details','/optional-features','/get_fcm_data'].includes(path);
}

function authorizeLegacyMembership(req,row){
  if(row.categoryKey==='7network_sales'&&row.role==='accountant'&&!salesAccountantLegacyRouteAllowed(req))
    return {allowed:false,code:'PERMISSION_DENIED'};
  // A default membership has no custom role profile. Keep its established
  // role policy, while still enforcing the internal Sales accountant boundary.
  if(!row.roleProfileId)return {allowed:true};
  let permissions;
  try{permissions=typeof row.rolePermissions==='string'?JSON.parse(row.rolePermissions):row.rolePermissions;}catch{permissions=null;}
  if(row.role!==row.seatRole||!Array.isArray(permissions)||permissions.some(item=>typeof item!=='string'))return {allowed:false,code:'TEAM_ROLE_STORAGE_INVALID'};
  if(mountFor(req)==='/api/workspace/session'&&['GET','HEAD'].includes(String(req.method||'GET').toUpperCase()))return {allowed:true,permission:'tenant.read'};
  const permission=routePermission(req);
  if(!permission)return {allowed:false,code:'TEAM_ROLE_ROUTE_UNMAPPED'};
  const scope=policy.scopeFor({role:row.role,delegatedPermissions:permissions,customPermissions:permissions},permission);
  if(!permissions.includes(permission)||!scope)return {allowed:false,code:'TEAM_ROLE_PERMISSION_DENIED'};
  if(scope!=='tenant'&&!(req.sourceTable==='agents'&&['assigned','own'].includes(scope)&&['/api/agent','/api/agent/phonebook','/api/pipeline','/api/agent/course-replies','/api/inbox/course-replies','/api/workspace/session','/api/workspace/tasks','/api/user/training/tasks','/api/workspace/phonebook','/api/workspace/inbox/course-replies'].includes(String(req.baseUrl||'').replace(/\/$/,'')))&&!(['/api/workspace/finance','/api/user/training/finance-policies'].includes(mountFor(req))&&['summary','finance','sales'].includes(scope)))return {allowed:false,code:'TEAM_ROLE_PERMISSION_DENIED'};
  return {allowed:true,permission};
}
const mountFor=req=>String(req.baseUrl||'').replace(/\/$/,'');

async function authorizeLegacyRequest(req,{sourceTable,sourceId}){
  // Updating the authenticated account's own Profile is a core account
  // capability, independent of its optional module grants. The route is
  // still protected by user/agent authentication and only targets that actor.
  if(isSelfProfileRequest(req,sourceTable))
    return {allowed:true,permission:'account.profile.update'};
  let rows;
  try{
    rows=await query(`SELECT m.role,m.role_profile_id AS roleProfileId,r.seat_role AS seatRole,r.permissions AS rolePermissions,
        t.category_key AS categoryKey
      FROM sx_legacy_ownership o JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id
      JOIN sx_tenants t ON t.id=o.tenant_id
      LEFT JOIN sx_team_roles r ON r.tenant_id=m.tenant_id AND r.id=m.role_profile_id
      WHERE o.source_table=? AND o.source_id=? AND m.status='active' AND (r.id IS NULL OR r.status IN ('active','archived')) LIMIT 2`,[sourceTable,String(sourceId)]);
  }catch(error){if(error.code==='ER_NO_SUCH_TABLE'||error.code==='ER_BAD_FIELD_ERROR')return {allowed:false,code:'TEAM_ROLE_STORAGE_NOT_READY'};throw error;}
  if(!rows?.length)return {allowed:true};
  if(rows.length!==1)return {allowed:false,code:'TEAM_ROLE_LINK_INVALID'};
  const mount=mountFor(req), permission=routePermission(req);
  if(rows[0].role==='accountant'&&rows[0].categoryKey==='training_center'&&['conversations.read','conversations.reply'].includes(permission)&&['/api/inbox','/api/qr'].includes(mount)){
    try{
      const shares=await query(`SELECT 1 FROM sx_legacy_ownership o JOIN sx_memberships member ON member.tenant_id=o.tenant_id AND member.id=o.membership_id
        JOIN sx_qr_channel_shares share ON share.tenant_id=member.tenant_id AND share.membership_id=member.id
        JOIN sx_memberships manager ON manager.tenant_id=share.tenant_id AND manager.identity_id=share.granted_by_identity_id AND manager.role='manager' AND manager.status='active'
        JOIN sx_qr_channel_shares manager_share ON manager_share.tenant_id=share.tenant_id AND manager_share.instance_id=share.instance_id AND manager_share.membership_id=manager.id
        WHERE o.source_table='user' AND o.source_id=? AND member.status='active' LIMIT 1`,[String(sourceId)]);
      if(shares?.length)return {allowed:true,permission};
    }catch(error){if(!['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error.code))throw error;}
  }
  return authorizeLegacyMembership({...req,sourceTable},rows[0]);
}
module.exports={routePermission,salesAccountantLegacyRouteAllowed,authorizeLegacyMembership,authorizeLegacyRequest};
