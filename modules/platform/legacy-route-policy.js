'use strict';

// Canonical names for historical route aliases. Keep this pure so coverage
// tools and tests can inspect legacy permissions without loading auth/DB code.
const canonicalMount=value=>({'/api/workspace/channels/qr':'/api/qr','/api/workspace/automation/flows':'/api/chat_flow','/api/workspace/automation/chatbot':'/api/chatbot','/api/workspace/templates':'/api/templet','/api/workspace/campaigns':'/api/broadcast','/api/workspace/inbox':'/api/inbox','/api/workspace/pipeline':'/api/pipeline'}[String(value||'').replace(/\/$/,'')]||String(value||'').replace(/\/$/,''));

// Legacy role-permission mapping only. This does not replace category/plan
// authorization, which belongs to policy.decision() at module boundaries.
function routePermission(req){
  const mount=canonicalMount(req.baseUrl),path=String(req.path||'/').toLowerCase(),method=String(req.method||'GET').toUpperCase(),read=method==='GET'||method==='HEAD';
  // API request/response logs can contain customer message content and phone
  // numbers. Keep these account-owned records owner-only.
  if(mount==='/api/v1'&&path==='/get_logs'&&read)return 'tenant.manage';
  if(mount==='/api/v1'&&path==='/delete_logs'&&method==='POST')return 'tenant.manage';
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
  if(mount==='/api/agent/phonebook')return read||['/contacts','/values'].includes(path)?'contacts.read':'contacts.manage';
  if(mount==='/api/phonebook/workspace')return read||['/contacts','/values'].includes(path)?'contacts.read':'contacts.manage';
  if(mount==='/api/phonebook')return read||/^\/(get_|search|check_)/.test(path)?'contacts.read':'contacts.manage';
  if(['/api/chat_flow','/api/chatbot'].includes(mount))return 'automation.manage';
  if(mount==='/api/templet')return 'templates.manage';
  if(mount==='/api/broadcast')return 'campaigns.manage';
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

module.exports={canonicalMount,routePermission};
