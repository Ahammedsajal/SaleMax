'use strict';
const crypto=require('node:crypto');
const taskManagement=require('./task-management');

async function createTaskContext(pool,businessContext,permission='tasks.read'){
  const tenantId=businessContext?.tenant?.id;
  const membership=businessContext?.membership;
  const identity=businessContext?.identity;
  if(!tenantId||!membership?.id||!identity?.id)throw Object.assign(new Error('TENANT_CONTEXT_REQUIRED'),{code:'TENANT_CONTEXT_REQUIRED',status:401});
  const db=await pool.getConnection();
  try{
    const [owners]=await db.query(`SELECT u.uid,o.legacy_uid_hash AS uidHash
      FROM sx_memberships m
      JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
      JOIN user u ON o.source_id=CAST(u.id AS CHAR)
      WHERE m.tenant_id=? AND m.role='owner' AND m.status='active' AND u.role='user' LIMIT 2`,[tenantId]);
    if(owners.length!==1||owners[0].uidHash!==crypto.createHash('sha256').update(String(owners[0].uid),'utf8').digest('hex'))throw Object.assign(new Error('BUSINESS_LINK_INVALID'),{code:'BUSINESS_LINK_INVALID',status:409});
    const ctx={...businessContext,tenantId,uid:owners[0].uid,uidHash:owners[0].uidHash,role:membership.role,actorType:'identity',actorId:String(identity.id)};
    if(membership.role==='agent'){
      const [agents]=await db.query(`SELECT a.id FROM sx_legacy_ownership o JOIN agents a ON o.source_table='agents' AND o.source_id=CAST(a.id AS CHAR)
        WHERE o.tenant_id=? AND o.membership_id=? AND a.owner_uid=? AND a.role='agent' AND a.is_active=1 LIMIT 2`,[tenantId,membership.id,owners[0].uid]);
      if(agents.length!==1)throw Object.assign(new Error('BUSINESS_LINK_INVALID'),{code:'BUSINESS_LINK_INVALID',status:409});
      ctx.actorType='agent';ctx.actorId=String(agents[0].id);ctx.agentId=Number(agents[0].id);
    }
    taskManagement.authorize(ctx,permission);
    return ctx;
  }finally{db.release();}
}
module.exports={createTaskContext};
