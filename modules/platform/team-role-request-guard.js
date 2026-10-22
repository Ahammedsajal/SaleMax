'use strict';
const canonicalMount=value=>({'/api/workspace/channels/qr':'/api/qr','/api/workspace/automation/flows':'/api/chat_flow','/api/workspace/automation/chatbot':'/api/chatbot','/api/workspace/templates':'/api/templet','/api/workspace/campaigns':'/api/broadcast','/api/workspace/inbox':'/api/inbox','/api/workspace/pipeline':'/api/pipeline'}[String(value||'').replace(/\/$/,'')]||String(value||'').replace(/\/$/,''));

const {query}=require('../../database/dbpromise');
const policy=require('./policy');
const {isSelfProfileRequest}=require('./self-profile-policy');

function routePermission(req){
  const mount=canonicalMount(req.baseUrl);
  const path=String(req.path||'/').toLowerCase();
  const method=String(req.method||'GET').toUpperCase();
  const read=method==='GET'||method==='HEAD';
  if(mount==='/api/crm')return path==='/tenant-context'&&read?'tenant.read':'tenant.manage';
  if(mount==='/api/user/business-auth'&&path==='/me'&&read)return 'tenant.read';
  if(mount==='/api/workspace/session')return 'tenant.read';
  if(['/api/workspace/tasks','/api/user/training/tasks'].includes(mount))return read?'tasks.read':'tasks.manage';
  if(mount==='/api/workspace/inbox/course-replies')return read?'conversations.read':'conversations.reply';
  if(mount==='/api/workspace/phonebook')return read||['/contacts','/values'].includes(path)?'contacts.read':'contacts.manage';
  if(mount==='/api/workspace/courses')return read?'courses.read':'courses.manage';
  if(mount==='/api/workspace/products-services')return read?'products.read':'products.manage';
  if(mount==='/api/workspace/properties')return read?'properties.read':'properties.manage';
  if(mount==='/api/workspace/students')return read?'sales.request':'sales.approve';
  if(mount==='/api/workspace/profile')return 'tenant.manage';
  if(mount==='/api/workspace/forms')return read?'forms.manage':'forms.capture';
  if(mount==='/api/workspace/finance'||mount==='/api/user/training/finance-policies'){
    const endpoint=path.replace(/^\/(accountant|canonical)(?=\/|$)/,'');
    if(endpoint.startsWith('/receipts'))return 'receipts.read';
    if(endpoint.startsWith('/reports'))return 'reports.read';
    return read?'invoices.read':endpoint.startsWith('/generator')&&!endpoint.endsWith('/payments')?'invoices.issue':'payments.verify';
  }
  if(mount==='/api/user/team-invitations')return ['/sidebar-access','/conversation-access'].includes(path)?'tenant.read':'team.invite';
  if(mount==='/api/user/call-center')return path==='/status'||read?'calls.read':'calls.control';
  if(mount==='/api/user/chatbots')return 'automation.manage';
  if(mount==='/api/agent/invitations'&&path==='/conversation-access'&&read)return 'tenant.read';
  if(mount==='/api/agent/invitations'&&['/conversation-staff','/conversation-transfer'].includes(path))return read?'conversations.read':'conversations.reply';
  if(mount.startsWith('/api/user/training/courses'))return read?'courses.read':'courses.manage';
  if(mount.startsWith('/api/user/training/students'))return read?'sales.request':'sales.approve';
  if(mount.startsWith('/api/user/training/finance'))return read?'invoices.read':'payments.verify';
  if(mount.startsWith('/api/user/training/forms'))return read?'forms.manage':'forms.capture';
  if(mount==='/api/user/training/profile')return 'tenant.manage';
  if(['/api/inbox/course-replies','/api/agent/course-replies'].includes(mount))return read?'conversations.read':'conversations.reply';
  if(mount==='/api/inbox')return read||/^\/(get_|import_chats)/.test(path)?'conversations.read':'conversations.reply';
  if(mount==='/api/agent/phonebook')return ['GET','HEAD'].includes(method)||['/contacts','/values'].includes(path)?'contacts.read':'contacts.manage';
  if(mount==='/api/phonebook/workspace')return read||['/contacts','/values'].includes(path)?'contacts.read':'contacts.manage';
  if(mount==='/api/phonebook')return read||/^\/(get_|search|check_)/.test(path)?'contacts.read':'contacts.manage';
  if(['/api/chat_flow','/api/chatbot'].includes(mount))return 'automation.manage';
  if(mount==='/api/templet')return 'templates.manage';
  if(mount==='/api/broadcast')return 'campaigns.manage';
  if(mount==='/api/qr'&&method==='POST'&&path==='/gen_qr')return 'channels.qr.create';
  if(mount==='/api/qr'&&method==='POST'&&['/del_instance','/change_instance_status'].includes(path))return 'channels.qr.manage';
  if(mount==='/api/qr'&&read&&path==='/get_all')return 'conversations.read';
  if(['/api/qr','/api/telegram','/api/webhook'].includes(mount))return 'channels.configure';
  if(mount==='/api/wa_call')return read||/^\/(get_|call_logs)/.test(path)?'calls.read':'calls.control';
  if(mount==='/api/agent'){
    if(/\/(login|invitations)(\/|$)/.test(path))return null;
    if(path.includes('task'))return read?'tasks.read':'tasks.manage';
    if(path.includes('quick_reply'))return 'conversations.read';
    if(path.includes('contact'))return read?'contacts.read':'contacts.manage';
    if(path.includes('chat')||path.includes('convo')||path.includes('text')||path.includes('audio')||path.includes('image')||path.includes('video')||path.includes('doc')||path.includes('media'))return read||/^\/(get_|logout)/.test(path)?'conversations.read':'conversations.reply';
    if(path==='/get_me'||path==='/logout'||path==='/update_fcm_token')return 'tenant.read';
    return 'team.invite';
  }
  if(mount==='/api/pipeline'){
    if(path.startsWith('/tasks'))return read?'tasks.read':'tasks.manage';
    if(path.startsWith('/reports'))return path.includes('schedule')?'reports.schedule':'reports.read';
    if(path==='/settings')return read?'leads.read':'leads.assign';
    if(path.startsWith('/training-forms'))return read?'forms.manage':'forms.capture';
    if(path.includes('/assign')||path.endsWith('/move')||path==='/stages'||path.includes('/stages/'))return read?'leads.read':'leads.assign';
    return read?'leads.read':'leads.manage';
  }
  if(mount==='/api/user'){
    if(path.startsWith('/training/courses'))return read?'courses.read':'courses.manage';
    if(path.startsWith('/training/students'))return read?'sales.request':'sales.approve';
    if(path.startsWith('/training/finance'))return read?'invoices.read':'payments.verify';
    if(path.startsWith('/training/forms'))return read?'forms.manage':'forms.capture';
    if(['/get_me','/fetch_profile','/get_dashboard','/get_dashboard_old','/optional-features','/get_fcm_data','/get_plan_details'].includes(path))return 'tenant.read';
    // The shared Inbox reads the tenant's saved quick replies through this
    // legacy endpoint. Agent seats with Inbox access may read them, while the
    // separate add/delete endpoints remain restricted by their own guards.
    if(path==='/get_all_quick_reply'&&read)return 'conversations.read';
    if(path.includes('agent_task')||path==='/add_task_for_agent'||path==='/del_task_for_agent')return read?'tasks.read':'tasks.manage';
    if(path.includes('agent_report'))return 'reports.read';
    if(path.includes('contact')||path.includes('tag'))return read?'contacts.read':'contacts.manage';
    if(path.includes('meta_templet')||path.includes('quick_reply')||path==='/send_template_message')return read?'templates.manage':'conversations.reply';
    if(path.includes('api_key')||path.includes('embed_keys')||path.includes('exchange_embed'))return 'tenant.manage';
    if(path.includes('meta')||path.includes('embed')||path.includes('g_auth'))return 'channels.configure';
    if(path.includes('warmer'))return 'campaigns.manage';
    if(path.includes('agent')&&path!=='/get_agent_report')return 'team.invite';
    if(path==='/return_media_url'||path==='/convert_audio')return 'conversations.reply';
    if(path==='/update_profile')return read?'tenant.read':'tenant.manage';
    return null;
  }
  return null;
}

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
  if(mountFor(req)==='/api/qr'&&String(req.path||'').toLowerCase()==='/gen_qr'&&String(req.method||'GET').toUpperCase()==='POST')
    return {allowed:true,permission:'channels.qr.create'};
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
  if(permission==='channels.qr.manage'&&permissions.includes('channels.qr.create')){
    const createScope=policy.scopeFor({role:row.role,delegatedPermissions:permissions,customPermissions:permissions},'channels.qr.create');
    if(createScope)return {allowed:true,permission};
  }
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
