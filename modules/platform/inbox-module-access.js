'use strict';

const {createLegacyModuleAccess}=require('./legacy-module-access');
const {routePermission}=require('./legacy-route-policy');

const INBOX_ROUTE_PERMISSIONS=Object.freeze({
  'GET /get_chats':'conversations.read',
  'POST /get_convo':'conversations.read',
  'GET /import_chats_from_v3':'conversations.read',
  'POST /del_chat':'conversations.reply',
  'POST /import_convo_from_v3':'conversations.reply',
  'POST /merge_chats':'conversations.reply',
  'POST /send_audio':'conversations.reply',
  'POST /send_doc':'conversations.reply',
  'POST /send_image':'conversations.reply',
  'POST /send_meta_templet':'conversations.reply',
  'POST /send_templet':'conversations.reply',
  'POST /send_text':'conversations.reply',
  'POST /send_video':'conversations.reply',
});

function resolveInboxPermission(req){
  const method=String(req?.method||'GET').toUpperCase();
  const path=String(req?.path||'/').toLowerCase().replace(/\/+$/,'')||'/';
  const explicit=INBOX_ROUTE_PERMISSIONS[`${method} ${path}`];
  if(!explicit)return null;
  const legacyPermission=routePermission({...req,baseUrl:req.baseUrl||'/api/inbox'});
  return legacyPermission===explicit?explicit:null;
}

function createInboxModuleAccess({pool,resolveContext,decide}={}){
  return createLegacyModuleAccess({
    pool,
    capability:'messaging.inbox',
    resolvePermission:resolveInboxPermission,
    resolveContext,
    decide,
    errorCode:'INBOX_MODULE_ACCESS_UNAVAILABLE',
    contextProperty:'inboxModuleContext',
  });
}

function withInboxModuleAccess(authenticate,inboxAccess){
  if(typeof authenticate!=='function'||typeof inboxAccess!=='function')throw new TypeError('INBOX_MODULE_GUARD_REQUIRED');
  return (req,res,next)=>authenticate(req,res,error=>{
    if(error)return next(error);
    return inboxAccess(req,res,next);
  });
}

module.exports={INBOX_ROUTE_PERMISSIONS,createInboxModuleAccess,resolveInboxPermission,withInboxModuleAccess};
