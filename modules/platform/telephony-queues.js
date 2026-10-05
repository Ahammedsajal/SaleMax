'use strict';

const crypto=require('node:crypto');
const {decision}=require('./policy');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function authorize(context){const result=decision(context,{capability:'telephony.call-center',permission:'calls.manage'});if(!result.allowed)fail(result.code);}
function parse(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0
    ||typeof input.name!=='string'||!/^[-a-z0-9_]{2,80}$/.test(input.name)||!/^[a-z]/.test(input.name)
    ||!['ringall','rrmemory','linear'].includes(input.strategy)||!Number.isInteger(input.ringTimeoutSeconds)||input.ringTimeoutSeconds<5||input.ringTimeoutSeconds>120
    ||typeof input.enabled!=='boolean'||!Array.isArray(input.membershipIds)||input.membershipIds.length>50
    ||input.membershipIds.some(id=>!uuid(id))||new Set(input.membershipIds).size!==input.membershipIds.length
    ||(input.id!==null&&input.id!==undefined&&!uuid(input.id)))fail('INVALID_TELEPHONY_QUEUE');
  return {id:input.id||null,expectedRevision:input.expectedRevision,name:input.name,strategy:input.strategy,
    ringTimeoutSeconds:input.ringTimeoutSeconds,enabled:input.enabled,membershipIds:input.membershipIds};
}
async function list(db,context){
  authorize(context);
  const [queues]=await db.query(`SELECT id,queue_name AS name,strategy,ring_timeout_seconds AS ringTimeoutSeconds,
      enabled,revision,updated_at AS updatedAt FROM sx_telephony_queues WHERE tenant_id=? ORDER BY queue_name,id`,[context.tenant.id]);
  const [members]=await db.query(`SELECT qm.queue_id AS queueId,qm.membership_id AS membershipId,qm.position,
      i.display_name AS displayName,m.role,x.extension FROM sx_telephony_queue_members qm
      JOIN sx_memberships m ON m.tenant_id=qm.tenant_id AND m.id=qm.membership_id
      JOIN sx_identities i ON i.id=m.identity_id
      LEFT JOIN sx_telephony_extensions x ON x.tenant_id=qm.tenant_id AND x.membership_id=qm.membership_id
      WHERE qm.tenant_id=? AND m.status='active' AND i.status='active' ORDER BY qm.queue_id,qm.position`,[context.tenant.id]);
  const byQueue=new Map();for(const member of members){if(!byQueue.has(member.queueId))byQueue.set(member.queueId,[]);byQueue.get(member.queueId).push({membershipId:member.membershipId,displayName:member.displayName,role:member.role,extension:member.extension||'',position:Number(member.position)});}
  return queues.map(row=>({id:row.id,name:row.name,strategy:row.strategy,ringTimeoutSeconds:Number(row.ringTimeoutSeconds),enabled:!!row.enabled,revision:Number(row.revision),updatedAt:row.updatedAt,members:byQueue.get(row.id)||[]}));
}
async function save(db,context,input){
  authorize(context);const value=parse(input);await db.beginTransaction();
  try{
    const [[current]]=value.id?await db.query('SELECT id,revision FROM sx_telephony_queues WHERE tenant_id=? AND id=? FOR UPDATE',[context.tenant.id,value.id]):[[null]];
    if(value.id&&!current)fail('TELEPHONY_QUEUE_NOT_FOUND');
    if(Number(current?.revision||0)!==value.expectedRevision)fail('STALE_TELEPHONY_QUEUE');
    if(current&&!value.enabled){
      const [[mapped]]=await db.query(`SELECT COUNT(*) AS activeChannels FROM sx_platform_asterisk_gateway_ports
        WHERE tenant_id=? AND inbound_queue_id=? AND enabled=1 AND inbound_enabled=1`,[context.tenant.id,value.id]);
      if(Number(mapped.activeChannels)>0)fail('TELEPHONY_QUEUE_INBOUND_CHANNELS_ACTIVE');
    }
    if(value.enabled&&!value.membershipIds.length)fail('TELEPHONY_QUEUE_MEMBERS_REQUIRED');
    if(value.membershipIds.length){
      const [eligible]=await db.query(`SELECT m.id,x.extension FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
        JOIN sx_telephony_extensions x ON x.tenant_id=m.tenant_id AND x.membership_id=m.id AND x.extension IS NOT NULL AND x.extension<>''
        WHERE m.tenant_id=? AND m.status='active' AND m.role IN ('owner','manager','agent') AND m.id IN (${value.membershipIds.map(()=>'?').join(',')}) FOR UPDATE`,[context.tenant.id,...value.membershipIds]);
      if(eligible.length!==value.membershipIds.length)fail('TELEPHONY_QUEUE_MEMBER_EXTENSION_REQUIRED');
    }
    const id=value.id||crypto.randomUUID(),revision=value.expectedRevision+1;
    if(current)await db.query(`UPDATE sx_telephony_queues SET queue_name=?,strategy=?,ring_timeout_seconds=?,enabled=?,revision=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?`,[value.name,value.strategy,value.ringTimeoutSeconds,value.enabled?1:0,revision,context.tenant.id,id]);
    else await db.query(`INSERT INTO sx_telephony_queues(tenant_id,id,queue_name,strategy,ring_timeout_seconds,enabled,revision,created_by_identity_id) VALUES(?,?,?,?,?,?,?,?)`,[context.tenant.id,id,value.name,value.strategy,value.ringTimeoutSeconds,value.enabled?1:0,revision,context.identity.id]);
    await db.query('DELETE FROM sx_telephony_queue_members WHERE tenant_id=? AND queue_id=?',[context.tenant.id,id]);
    for(let position=0;position<value.membershipIds.length;position++)await db.query('INSERT INTO sx_telephony_queue_members(tenant_id,queue_id,membership_id,position) VALUES(?,?,?,?)',[context.tenant.id,id,value.membershipIds[position],position+1]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES(?,?,?,'identity','telephony.queue-configured','telephony-queue',?,?,?)`,[crypto.randomUUID(),context.tenant.id,context.identity.id,id,JSON.stringify({name:value.name,strategy:value.strategy,ringTimeoutSeconds:value.ringTimeoutSeconds,enabled:value.enabled,membershipIds:value.membershipIds,revision}),crypto.randomUUID()]);
    await db.commit();return (await list(db,context)).find(queue=>queue.id===id);
  }catch(error){try{await db.rollback();}catch{}if(error.code==='ER_DUP_ENTRY')fail('TELEPHONY_QUEUE_NAME_EXISTS');throw error;}
}
module.exports={parse,list,save};
