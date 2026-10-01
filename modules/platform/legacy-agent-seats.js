'use strict';
const crypto=require('node:crypto');
const plans=require('./plans');
const {trainingCenter}=require('./categories');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const required=['user','agents','sx_legacy_ownership','sx_tenants','sx_memberships','sx_plan_versions','sx_plan_assignments','sx_team_invites'];
async function ownershipInstalled(db){
  const [[row]]=await db.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_legacy_ownership'");
  return Number(row.n)===1;
}
async function ready(db){
  const [rows]=await db.query('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('+required.map(()=>'?').join(',')+')',required);
  if(rows.length!==required.length||rows.some(row=>row.ENGINE!=='InnoDB'))fail('SEAT_STORAGE_NOT_READY');
}
async function ownerAndTenant(db,ownerUid){
  if(typeof ownerUid!=='string'||!ownerUid||ownerUid.length>999)fail('INVALID_OWNER');
  const [users]=await db.query('SELECT id,uid FROM user WHERE uid=? FOR UPDATE',[ownerUid]);
  if(!users.length)fail('OWNER_NOT_FOUND');if(users.length!==1||users[0].uid!==ownerUid)fail('AMBIGUOUS_OWNER');
  const [mappings]=await db.query("SELECT tenant_id,membership_id,legacy_uid_hash FROM sx_legacy_ownership WHERE source_table='user' AND source_id=? FOR UPDATE",[String(users[0].id)]);
  if(!mappings.length)return {user:users[0],tenant:null,mapping:null};
  if(mappings.length!==1||mappings[0].legacy_uid_hash!==hash(ownerUid)||!mappings[0].membership_id)fail('BUSINESS_LINK_INVALID');
  const [[tenant]]=await db.query('SELECT id,status,category_key,category_version FROM sx_tenants WHERE id=? FOR UPDATE',[mappings[0].tenant_id]);
  if(!tenant)fail('BUSINESS_LINK_INVALID');
  const [[owner]]=await db.query("SELECT id FROM sx_memberships WHERE id=? AND tenant_id=? AND role='owner' AND status='active' FOR UPDATE",[mappings[0].membership_id,tenant.id]);
  if(!owner)fail('BUSINESS_LINK_INVALID');
  return {user:users[0],tenant,mapping:mappings[0]};
}
async function activeAgentCounts(db,ownerUid,tenantId){
  await db.query("UPDATE sx_team_invites SET status='expired' WHERE tenant_id=? AND status='pending' AND expires_at<=UTC_TIMESTAMP(3)",[tenantId]);
  const used=await plans.readUsage(db,tenantId);
  const [[legacy]] =await db.query(`SELECT COUNT(*) AS n FROM agents a
    LEFT JOIN sx_legacy_ownership o ON o.source_table='agents' AND o.source_id=CAST(a.id AS CHAR) AND o.tenant_id=?
    LEFT JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='agent' AND m.status='active'
    WHERE a.owner_uid=? AND (a.is_active IS NULL OR a.is_active<>0) AND m.id IS NULL`,[tenantId,ownerUid]);
  used.agent+=Number(legacy.n);return used;
}
async function entitlement(db,tenant){
  if(tenant.status!=='active'||tenant.category_key!==trainingCenter.key||tenant.category_version!==trainingCenter.version)fail('BUSINESS_INACTIVE');
  const current=await plans.loadEntitlements(db,tenant.id);
  if(!current||!['active','trial','grace'].includes(current.status)||current.categoryKey!==tenant.category_key||current.categoryVersion!==tenant.category_version||!current.capabilities.includes('team.members'))fail('TEAM_FEATURE_UNAVAILABLE');
  return current;
}
async function createIfMapped(pool,ownerUid,agent){
  const db=await pool.getConnection();try{
    if(!await ownershipInstalled(db))return null;
    await ready(db);await db.beginTransaction();
    try{
      const scope=await ownerAndTenant(db,ownerUid);
      if(!scope.mapping){await db.commit();return null;}
      const current=await entitlement(db,scope.tenant),used=await activeAgentCounts(db,ownerUid,scope.tenant.id);
      if(used.agent>=current.roleLimits.agent)fail('AGENT_SEAT_LIMIT');
      const [[duplicate]]=await db.query('SELECT id FROM agents WHERE email=? LIMIT 1 FOR UPDATE',[agent.email]);
      if(duplicate)fail('AGENT_EMAIL_EXISTS');
      const uid=agent.uid;
      await db.query(`INSERT INTO agents(owner_uid,uid,email,password,name,mobile,comments,role,is_active)
        VALUES (?,?,?,?,?,?,?,'agent',1)`,[ownerUid,uid,agent.email,agent.password,agent.name,agent.mobile,agent.comments]);
      await db.commit();return {mapped:true,uid,used:used.agent+1,limit:current.roleLimits.agent};
    }catch(error){await db.rollback();throw error;}
  }finally{db.release();}
}
async function updateIfMapped(pool,ownerUid,agentUid,active){
  const db=await pool.getConnection();try{
    if(!await ownershipInstalled(db))return null;
    await ready(db);await db.beginTransaction();
    try{
      const scope=await ownerAndTenant(db,ownerUid);
      if(!scope.mapping){await db.commit();return null;}
      const [[agent]]=await db.query('SELECT id,is_active FROM agents WHERE owner_uid=? AND uid=? FOR UPDATE',[ownerUid,agentUid]);
      if(!agent)fail('AGENT_NOT_FOUND');
      const [mappings]=await db.query("SELECT membership_id,tenant_id FROM sx_legacy_ownership WHERE source_table='agents' AND source_id=? FOR UPDATE",[String(agent.id)]);
      if(mappings.length>1||mappings.some(link=>link.tenant_id!==scope.tenant.id))fail('AGENT_LINK_INVALID');
      const wasActive=agent.is_active==null||Number(agent.is_active)!==0;
      if(wasActive!==Boolean(active)&&active){
        const current=await entitlement(db,scope.tenant),used=await activeAgentCounts(db,ownerUid,scope.tenant.id);
        if(used.agent>=current.roleLimits.agent)fail('AGENT_SEAT_LIMIT');
      }
      if(mappings.length){
        if(!mappings[0].membership_id)fail('AGENT_LINK_INVALID');
        const [members]=await db.query("SELECT id,role,status FROM sx_memberships WHERE id=? AND tenant_id=? FOR UPDATE",[mappings[0].membership_id,scope.tenant.id]);
        if(members.length!==1||members[0].role!=='agent')fail('AGENT_LINK_INVALID');
        await db.query('UPDATE sx_memberships SET status=? WHERE id=?',[active?'active':'inactive',members[0].id]);
      }
      await db.query('UPDATE agents SET is_active=? WHERE id=? AND owner_uid=?',[active?1:0,agent.id,ownerUid]);
      await db.commit();return {mapped:true,active:Boolean(active)};
    }catch(error){await db.rollback();throw error;}
  }finally{db.release();}
}
async function deleteIfMapped(pool,ownerUid,agentUid){
  const db=await pool.getConnection();try{
    if(!await ownershipInstalled(db))return null;
    await ready(db);await db.beginTransaction();
    try{
      const scope=await ownerAndTenant(db,ownerUid);
      if(!scope.mapping){await db.commit();return null;}
      const [[agent]]=await db.query('SELECT id FROM agents WHERE owner_uid=? AND uid=? FOR UPDATE',[ownerUid,agentUid]);
      if(!agent){await db.commit();return {mapped:true,deleted:false};}
      const [mappings]=await db.query("SELECT membership_id,tenant_id FROM sx_legacy_ownership WHERE source_table='agents' AND source_id=? FOR UPDATE",[String(agent.id)]);
      if(mappings.length>1||mappings.some(link=>link.tenant_id!==scope.tenant.id))fail('AGENT_LINK_INVALID');
      if(mappings[0]?.membership_id){
        const [members]=await db.query("SELECT id,role FROM sx_memberships WHERE id=? AND tenant_id=? FOR UPDATE",[mappings[0].membership_id,scope.tenant.id]);
        if(members.length!==1||members[0].role!=='agent')fail('AGENT_LINK_INVALID');
        await db.query("UPDATE sx_memberships SET status='inactive' WHERE id=?",[members[0].id]);
      }
      await db.query('DELETE FROM agents WHERE id=? AND owner_uid=?',[agent.id,ownerUid]);
      await db.commit();return {mapped:true,deleted:true};
    }catch(error){await db.rollback();throw error;}
  }finally{db.release();}
}
const messages={AGENT_SEAT_LIMIT:'No agent seats are available on this business plan. Ask SaleMaX staff to review the assigned limit.',TEAM_FEATURE_UNAVAILABLE:'Agent accounts are not enabled by the active business contract.',BUSINESS_INACTIVE:'This business is inactive or is not an active training-center account.',BUSINESS_LINK_INVALID:'The reviewed business-owner link needs administrator review.',AGENT_LINK_INVALID:'This agent has an inconsistent business membership link.',AGENT_EMAIL_EXISTS:'An agent already uses this email address.',OWNER_NOT_FOUND:'Business account not found.',AMBIGUOUS_OWNER:'This business account identifier is duplicated.',AGENT_NOT_FOUND:'Agent account not found.',SEAT_STORAGE_NOT_READY:'Agent seat controls are not ready. Contact SaleMaX support.'};
module.exports={createIfMapped,updateIfMapped,deleteIfMapped,activeAgentCounts,messages};
