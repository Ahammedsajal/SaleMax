'use strict';
const FLAGS=Object.freeze({maskNumber:'mask_number',allowSendNewQr:'allow_send_new_qr'});
const fail=code=>{throw Object.assign(new Error(code),{code});};
const withConnection=async(pool,fn)=>{const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}};
async function setOwnerFlag(pool,ownerUid,agentUid,flag,active){
  const column=FLAGS[flag];
  if(!column||typeof ownerUid!=='string'||!ownerUid||typeof agentUid!=='string'||!agentUid||typeof active!=='boolean')fail('INVALID_AGENT_UPDATE');
  return withConnection(pool,async db=>{
    await db.beginTransaction();
    try{
      const [[agent]]=await db.query('SELECT id FROM agents WHERE owner_uid=? AND uid=? FOR UPDATE',[ownerUid,agentUid]);
      if(!agent)fail('AGENT_NOT_FOUND');
      await db.query(`UPDATE agents SET ${column}=? WHERE id=? AND owner_uid=?`,[active?1:0,agent.id,ownerUid]);
      await db.commit();return {uid:agentUid,active};
    }catch(error){await db.rollback();throw error;}
  });
}
async function findOwnedAgent(pool,ownerUid,agentUid,{activeOnly=false}={}){
  if(typeof ownerUid!=='string'||!ownerUid||typeof agentUid!=='string'||!agentUid)fail('INVALID_AGENT_LOOKUP');
  return withConnection(pool,async db=>{
    const [rows]=await db.query(`SELECT id,uid,email,name,mobile,role,is_active,mask_number,allow_send_new_qr,comments FROM agents WHERE owner_uid=? AND uid=?${activeOnly?' AND (is_active IS NULL OR is_active<>0)':''} LIMIT 1`,[ownerUid,agentUid]);
    return rows[0]||null;
  });
}
async function listOwnedAgents(pool,ownerUid){
  if(typeof ownerUid!=='string'||!ownerUid)fail('INVALID_AGENT_LOOKUP');
  return withConnection(pool,async db=>{
    const [rows]=await db.query('SELECT id,uid,email,name,mobile,role,is_active,mask_number,allow_send_new_qr,comments FROM agents WHERE owner_uid=? ORDER BY id DESC',[ownerUid]);
    return rows;
  });
}
module.exports={setOwnerFlag,findOwnedAgent,listOwnedAgents,messages:{INVALID_AGENT_UPDATE:'Choose a valid agent setting.',INVALID_AGENT_LOOKUP:'Choose an agent in this business.',AGENT_NOT_FOUND:'Agent account not found in this business.'}};
