'use strict';
const crypto=require('node:crypto');
const {decision}=require('./policy');
const {sevenNetworkSales}=require('./categories');
const fail=(code,status)=>{throw Object.assign(Error(code),{code,status});};
const fields=Object.freeze({
  industries:{type:'list',max:12,item:80},geographies:{type:'list',max:12,item:80},businessModels:{type:'list',max:10,item:80},
  decisionRoles:{type:'list',max:12,item:100},technologySignals:{type:'list',max:12,item:100},
  companySize:{type:'text',max:160},revenueRange:{type:'text',max:160},growthStage:{type:'text',max:160},
  priorityNeeds:{type:'text',max:1200},desiredOutcomes:{type:'text',max:1200},buyingTriggers:{type:'text',max:1200},
  budgetSignals:{type:'text',max:1000},exclusions:{type:'text',max:1200},evidence:{type:'text',max:1200},
  confidence:{type:'enum',values:['hypothesis','needs_review','validated']}
});
function cleanText(value,max,code){if(typeof value!=='string')fail(code,400);const text=value.trim();if(text.length>max)fail(code,400);return text;}
function cleanDocument(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_ICP_DOCUMENT',400);
  const result={};
  for(const [key,rule] of Object.entries(fields)){
    const value=input[key];
    if(rule.type==='list'){
      if(value===undefined||value===null){result[key]=[];continue;}
      if(!Array.isArray(value)||value.length>rule.max)fail('INVALID_ICP_DOCUMENT',400);
      result[key]=[...new Set(value.map(item=>cleanText(item,rule.item,'INVALID_ICP_DOCUMENT')).filter(Boolean))];
    }else if(rule.type==='text')result[key]=cleanText(value===undefined?'':value,rule.max,'INVALID_ICP_DOCUMENT');
    else {const candidate=value===undefined?'hypothesis':value;if(!rule.values.includes(candidate))fail('INVALID_ICP_DOCUMENT',400);result[key]=candidate;}
  }
  return result;
}
function assertAccess(ctx,permission='icp.read'){
  if(ctx?.audience!=='tenant'||ctx.category?.key!==sevenNetworkSales.key||ctx.category?.version!==sevenNetworkSales.version||ctx.tenant?.categoryKey!==sevenNetworkSales.key||Number(ctx.tenant?.categoryVersion)!==sevenNetworkSales.version)fail('CATEGORY_UNAVAILABLE',403);
  if(ctx.tenant.status!=='active'||ctx.membership?.status!=='active')fail('ACCOUNT_INACTIVE',403);
  if(!ctx.identity?.id||!ctx.membership?.id)fail('PERMISSION_DENIED',403);
  if(Array.isArray(ctx.membership.assignedNavigation)&&!ctx.membership.assignedNavigation.includes('icp'))fail('PERMISSION_DENIED',403);
  const access=decision(ctx,{capability:'sales.icp',permission});if(!access.allowed)fail(access.code,403);
}
function decode(row){let document=row.document;if(typeof document==='string')document=JSON.parse(document);return {id:row.id,title:row.title,summary:row.summary,document,revision:Number(row.revision),createdAt:row.createdAt,updatedAt:row.updatedAt};}
async function list(db,ctx){assertAccess(ctx,'icp.read');const [rows]=await db.query('SELECT id,title,summary,document,revision,created_at AS createdAt,updated_at AS updatedAt FROM sx_sales_icp_profiles WHERE tenant_id=? ORDER BY updated_at DESC,id DESC LIMIT 100',[ctx.tenant.id]);return {items:rows.map(decode),permissions:{canManage:decision(ctx,{capability:'sales.icp',permission:'icp.manage'}).allowed}};}
async function create(db,ctx,input){
  assertAccess(ctx,'icp.manage');if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_ICP_INPUT',400);
  const title=cleanText(input.title,120,'INVALID_ICP_TITLE');if(!title)fail('INVALID_ICP_TITLE',400);
  const summary=cleanText(input.summary||'',800,'INVALID_ICP_SUMMARY'),document=cleanDocument(input.document);
  const id=crypto.randomUUID();await db.beginTransaction();
  try{
    await db.query('INSERT INTO sx_sales_icp_profiles(id,tenant_id,title,summary,document,created_by_identity_id,updated_by_identity_id) VALUES(?,?,?,?,?,?,?)',[id,ctx.tenant.id,title,summary,JSON.stringify(document),ctx.identity.id,ctx.identity.id]);
    await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES(?,?,?,'identity','sales.icp.created','sales-icp-profile',?,?,?)",[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({title,revision:1}),crypto.randomUUID()]);
    const [[row]]=await db.query('SELECT id,title,summary,document,revision,created_at AS createdAt,updated_at AS updatedAt FROM sx_sales_icp_profiles WHERE tenant_id=? AND id=?',[ctx.tenant.id,id]);await db.commit();return decode(row);
  }catch(error){await db.rollback();throw error;}
}
async function update(db,ctx,id,input){
  assertAccess(ctx,'icp.manage');if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))fail('INVALID_ICP_ID',400);
  if(!input||typeof input!=='object'||Array.isArray(input)||!Number.isSafeInteger(input.revision)||input.revision<1)fail('INVALID_ICP_REVISION',400);
  const title=cleanText(input.title,120,'INVALID_ICP_TITLE');if(!title)fail('INVALID_ICP_TITLE',400);
  const summary=cleanText(input.summary||'',800,'INVALID_ICP_SUMMARY'),document=cleanDocument(input.document);
  await db.beginTransaction();
  try{
    const [result]=await db.query('UPDATE sx_sales_icp_profiles SET title=?,summary=?,document=?,revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=? AND revision=?',[title,summary,JSON.stringify(document),ctx.identity.id,ctx.tenant.id,id,input.revision]);
    if(!result.affectedRows){const [[found]]=await db.query('SELECT revision FROM sx_sales_icp_profiles WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);if(!found)fail('ICP_PROFILE_NOT_FOUND',404);fail('STALE_ICP_PROFILE',409);}
    await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES(?,?,?,'identity','sales.icp.updated','sales-icp-profile',?,?,?)",[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({title,revision:input.revision+1}),crypto.randomUUID()]);
    const [[row]]=await db.query('SELECT id,title,summary,document,revision,created_at AS createdAt,updated_at AS updatedAt FROM sx_sales_icp_profiles WHERE tenant_id=? AND id=?',[ctx.tenant.id,id]);await db.commit();return decode(row);
  }catch(error){await db.rollback();throw error;}
}
module.exports={assertAccess,cleanDocument,list,create,update};
