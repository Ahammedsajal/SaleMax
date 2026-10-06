'use strict';
const {query}=require('../../database/dbpromise');
const policy=require('./policy');

function routePermission(req){
  const mount=String(req.baseUrl||'').replace(/\/$/,'');
  const path=String(req.path||'/').toLowerCase();
  const method=String(req.method||'GET').toUpperCase();
  const read=method==='GET'||method==='HEAD';
  if(mount==='/api/user/team-invitations')return path==='/sidebar-access'?'tenant.read':'team.invite';
  if(mount==='/api/user/call-center')return path==='/status'||read?'calls.read':'calls.control';
  if(mount==='/api/user/chatbots')return 'automation.manage';
  if(mount.startsWith('/api/user/training/courses'))return read?'courses.read':'courses.manage';
  if(mount.startsWith('/api/user/training/students'))return read?'sales.request':'sales.approve';
  if(mount.startsWith('/api/user/training/finance'))return read?'invoices.read':'payments.verify';
  if(mount.startsWith('/api/user/training/forms'))return read?'forms.manage':'forms.capture';
  if(mount==='/api/user/training/profile')return 'tenant.manage';
  if(mount==='/api/inbox')return read||/^\/(get_|import_chats)/.test(path)?'conversations.read':'conversations.reply';
  if(mount==='/api/phonebook')return read||/^\/(get_|search|check_)/.test(path)?'contacts.read':'contacts.manage';
  if(['/api/chat_flow','/api/chatbot'].includes(mount))return 'automation.manage';
  if(mount==='/api/templet')return 'templates.manage';
  if(mount==='/api/broadcast')return 'campaigns.manage';
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

async function authorizeLegacyRequest(req,{sourceTable,sourceId}){
  let rows;
  try{
    rows=await query(`SELECT m.role,m.role_profile_id AS roleProfileId,r.seat_role AS seatRole,r.permissions AS rolePermissions
      FROM sx_legacy_ownership o JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id
      JOIN sx_team_roles r ON r.tenant_id=m.tenant_id AND r.id=m.role_profile_id
      WHERE o.source_table=? AND o.source_id=? AND m.status='active' AND r.status IN ('active','archived') LIMIT 2`,[sourceTable,String(sourceId)]);
  }catch(error){if(error.code==='ER_NO_SUCH_TABLE'||error.code==='ER_BAD_FIELD_ERROR')return {allowed:false,code:'TEAM_ROLE_STORAGE_NOT_READY'};throw error;}
  if(!rows?.length)return {allowed:true};
  if(rows.length!==1)return {allowed:false,code:'TEAM_ROLE_LINK_INVALID'};
  const row=rows[0];let permissions;
  try{permissions=typeof row.rolePermissions==='string'?JSON.parse(row.rolePermissions):row.rolePermissions;}catch{permissions=null;}
  if(row.role!==row.seatRole||!Array.isArray(permissions)||permissions.some(item=>typeof item!=='string'))return {allowed:false,code:'TEAM_ROLE_STORAGE_INVALID'};
  const permission=routePermission(req);
  if(!permission)return {allowed:false,code:'TEAM_ROLE_ROUTE_UNMAPPED'};
  const scope=policy.scopeFor({role:row.role,delegatedPermissions:permissions,customPermissions:permissions},permission);
  if(!permissions.includes(permission)||!scope)return {allowed:false,code:'TEAM_ROLE_PERMISSION_DENIED'};
  if(scope!=='tenant'&&!(sourceTable==='agents'&&['assigned','own'].includes(scope)&&['/api/agent','/api/pipeline'].includes(String(req.baseUrl||'').replace(/\/$/,''))))return {allowed:false,code:'TEAM_ROLE_PERMISSION_DENIED'};
  return {allowed:true,permission};
}
module.exports={routePermission,authorizeLegacyRequest};
