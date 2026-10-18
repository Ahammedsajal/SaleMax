'use strict';
// Authentication adapters end here. Feature handlers receive the same current
// tenant/member context regardless of the panel or credential used to sign in.
const crypto=require('node:crypto');
const {parseGrants}=require('./sessions');
const {getCategory}=require('./categories');
const {loadEntitlements}=require('./plans');
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const fail=(code,status=403)=>{throw Object.assign(Error(code),{code,status});};
async function legacyContext(db,actor,agent=false){
  const [rows]=await db.query(`SELECT o.legacy_uid_hash AS uidHash,t.id AS tenantId,t.name AS tenantName,t.status AS tenantStatus,
    t.category_key AS categoryKey,t.category_version AS categoryVersion,t.currency,t.timezone,
    m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,m.role_profile_id AS roleProfileId,
    m.delegated_permissions AS delegatedPermissions,m.assigned_navigation AS assignedNavigation,
    r.permissions AS rolePermissions,r.seat_role AS seatRole,r.status AS roleStatus,i.status AS identityStatus
    FROM sx_legacy_ownership o JOIN sx_tenants t ON t.id=o.tenant_id
    JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id
    JOIN sx_identities i ON i.id=m.identity_id LEFT JOIN sx_team_roles r ON r.id=m.role_profile_id AND r.tenant_id=m.tenant_id
    WHERE o.source_table=? AND o.source_id=? LIMIT 2`,[agent?'agents':'user',String(actor.id)]);
  if(!rows.length)return null;
  const row=rows[0];
  if(rows.length!==1||row.uidHash!==hash(actor.uid)||row.tenantStatus!=='active'||row.membershipStatus!=='active'||row.identityStatus!=='active')fail('ACCOUNT_INACTIVE');
  const customPermissions=row.roleProfileId?parseGrants(row.rolePermissions):null;
  const assignedNavigation=row.assignedNavigation==null?null:parseGrants(row.assignedNavigation);
  const delegatedPermissions=parseGrants(row.delegatedPermissions);
  if(!delegatedPermissions||(row.roleProfileId&&(!customPermissions||row.seatRole!==row.role||!['active','archived'].includes(row.roleStatus)))||(row.assignedNavigation!=null&&!assignedNavigation))fail('BUSINESS_LINK_INVALID');
  const category=getCategory(row.categoryKey,Number(row.categoryVersion));if(!category)fail('CATEGORY_UNAVAILABLE');
  return {audience:'tenant',identity:{id:row.identityId},tenant:{id:row.tenantId,name:row.tenantName,status:row.tenantStatus,categoryKey:row.categoryKey,categoryVersion:Number(row.categoryVersion),currency:row.currency,timezone:row.timezone},
    membership:{id:row.membershipId,tenantId:row.tenantId,identityId:row.identityId,role:row.role,status:row.membershipStatus,roleProfileId:row.roleProfileId,customPermissions,assignedNavigation,delegatedPermissions},category,subscription:await loadEntitlements(db,row.tenantId),runtimeReady:{}};
}
async function resolve(pool,{context,actor,agent=false,owner=null,refreshContext}){
  const db=await pool.getConnection();
  try{
    if(!context&&actor)context=await legacyContext(db,actor,agent);
    if(!context){if(!actor)fail('AUTH_REQUIRED',401);return {context:null,actor,agent,owner:agent?owner:actor,ownerUid:agent?owner?.uid:actor.uid,refresh:()=>resolve(pool,{actor,agent,owner})};}
    if(context.audience!=='tenant'||context.tenant?.status!=='active'||context.membership?.status!=='active'||context.membership.tenantId!==context.tenant.id)fail('ACCOUNT_INACTIVE');
    const ownerLink=await require('./invoice-customers').owner(db,context.tenant.id);
    const [[businessOwner]]=await db.query('SELECT * FROM user WHERE uid=?',[ownerLink.uid]);
    if(!businessOwner)fail('BUSINESS_LINK_INVALID');
    if(!actor){
      const [links]=await db.query('SELECT source_table,source_id,legacy_uid_hash FROM sx_legacy_ownership WHERE tenant_id=? AND membership_id=? AND source_table IN (\'user\',\'agents\') LIMIT 2',[context.tenant.id,context.membership.id]);
      if(links.length>1)fail('BUSINESS_LINK_INVALID');
      if(links.length){const link=links[0];agent=link.source_table==='agents';const [[row]]=await db.query(`SELECT * FROM ${agent?'agents':'user'} WHERE id=?`,[link.source_id]);if(!row||hash(row.uid)!==link.legacy_uid_hash)fail('BUSINESS_LINK_INVALID');actor=row;}
    }
    if(agent&&(!actor?.is_active||actor.owner_uid!==ownerLink.uid))fail('PERMISSION_DENIED');
    const session={context,actor,agent,owner:businessOwner,ownerUid:ownerLink.uid};
    session.refresh=async()=>{
      if(refreshContext){const current=await refreshContext();if(!current)fail('AUTH_REQUIRED',401);return resolve(pool,{context:current,refreshContext});}
      const [[current]]=await pool.query(`SELECT * FROM ${agent?'agents':'user'} WHERE id=?`,[actor.id]);
      if(!current||current.uid!==actor.uid||current.password!==actor.password)fail('AUTH_REQUIRED',401);
      return resolve(pool,{actor:current,agent,owner:businessOwner});
    };
    return session;
  }finally{db.release();}
}
function createBusinessFeatureSession({pool,origin,userGuard,agentGuard,canonicalGuard,resolveBusinessContext}){
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  const guard=(req,res,next)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!require('./request-origin').matches(req,origin))return res.status(403).json({success:false,code:'ORIGIN_DENIED'});
    if(req.featureSession)return next();
    const legacy=/^Bearer\s+\S+/i.test(req.get('Authorization')||'');
    const agent=req.get('X-Salemax-Actor')==='agent'||/^\/api\/agent(?:\/|$)/.test(req.originalUrl||'');
    const finish=wrap(async()=>{
      const claims=legacy?{...req.decode}:null;
      const session=await resolve(pool,legacy?{actor:req.decode.userData,agent,owner:req.owner}:{context:req.businessContext,refreshContext:()=>resolveBusinessContext(req)});
      if(legacy){
        const protect=current=>{const refresh=current.refresh;current.refresh=async()=>{
          if(Number.isFinite(claims.exp)&&claims.exp<=Date.now()/1000)fail('AUTH_REQUIRED',401);
          await require('./delegated-account-session').assertDelegatedSession(async(sql,args)=>(await pool.query(sql,args))[0],claims);
          return protect(await refresh());
        };return current;};protect(session);
      }
      req.featureSession=session;req.businessContext=session.context;
      req.decode={...(req.decode||{}),uid:session.ownerUid,actorUid:session.actor?.uid,userData:session.actor};req.owner=session.owner;
      next();
    });
    return (legacy?(agent?agentGuard:userGuard):canonicalGuard)(req,res,()=>finish(req,res,next));
  };
  return {guard};
}
module.exports={createBusinessFeatureSession,legacyContext,resolve};
