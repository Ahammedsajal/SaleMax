'use strict';

const crypto = require('node:crypto');
const { decision } = require('./policy');

const fail = code => { throw Object.assign(new Error(code), { code }); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function authorize(context) {
  const result = decision(context, { capability: 'telephony.call-center', permission: 'calls.manage' });
  if (!result.allowed) fail(result.code);
  return result;
}

function parseAssignment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !uuid(input.membershipId)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('INVALID_EXTENSION_ASSIGNMENT');
  const extension = input.extension === null || input.extension === '' ? null : input.extension;
  if (extension !== null && (typeof extension !== 'string' || !/^[0-9]{3,8}$/.test(extension))) fail('INVALID_EXTENSION');
  return { membershipId: input.membershipId, expectedRevision: input.expectedRevision, extension };
}

async function list(db, context) {
  authorize(context);
  const [rows] = await db.query(`SELECT m.id AS membershipId,m.role,i.display_name AS displayName,
      x.extension,x.revision,x.mobile_credential_revision AS mobileCredentialRevision,
      x.browser_credential_revision AS browserCredentialRevision,x.updated_at AS updatedAt
    FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
    LEFT JOIN sx_telephony_extensions x ON x.tenant_id=m.tenant_id AND x.membership_id=m.id
    WHERE m.tenant_id=? AND m.status='active' AND m.role IN ('owner','manager','agent')
    ORDER BY FIELD(m.role,'owner','manager','agent'),i.display_name,m.id`, [context.tenant.id]);
  return rows.map(row => ({ membershipId: row.membershipId, role: row.role, displayName: row.displayName,
    extension: row.extension || '', revision: Number(row.revision || 0), updatedAt: row.updatedAt || null,
    mobileCredentialRevision:Number(row.mobileCredentialRevision||1),browserCredentialRevision:Number(row.browserCredentialRevision||1),
    assigned: !!row.extension }));
}

async function rotateEndpointCredential(db,context,input) {
  authorize(context);
  if(!input||typeof input!=='object'||!uuid(input.membershipId)||!['mobile','browser'].includes(input.clientType)
    ||!Number.isSafeInteger(input.expectedCredentialRevision)||input.expectedCredentialRevision<1)fail('INVALID_ENDPOINT_CREDENTIAL_ROTATION');
  const column=input.clientType==='mobile'?'mobile_credential_revision':'browser_credential_revision';
  await db.beginTransaction();
  try{
    const [[row]]=await db.query(`SELECT extension,${column} AS credential_revision FROM sx_telephony_extensions
      WHERE tenant_id=? AND membership_id=? FOR UPDATE`,[context.tenant.id,input.membershipId]);
    if(!row||!row.extension)fail('SIP_ENDPOINT_NOT_PROVISIONED');
    const current=Number(row.credential_revision);
    if(current!==input.expectedCredentialRevision)fail('STALE_ENDPOINT_CREDENTIAL');
    const next=current+1;
    await db.query(`UPDATE sx_telephony_extensions SET ${column}=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND membership_id=?`,[next,context.tenant.id,input.membershipId]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES(?,?,?,'identity','telephony.endpoint-credential-rotated','telephony-endpoint',?,?,?)`,[
      crypto.randomUUID(),context.tenant.id,context.identity.id,input.membershipId,JSON.stringify({clientType:input.clientType,revision:next}),crypto.randomUUID()]);
    await db.commit();
    return {membershipId:input.membershipId,clientType:input.clientType,credentialRevision:next};
  }catch(error){try{await db.rollback();}catch(_){}throw error;}
}

async function save(db, context, input) {
  authorize(context);
  const value = parseAssignment(input);
  await db.beginTransaction();
  try {
    const [[member]] = await db.query(`SELECT id,role FROM sx_memberships
      WHERE tenant_id=? AND id=? AND status='active' AND role IN ('owner','manager','agent') FOR UPDATE`,
    [context.tenant.id, value.membershipId]);
    if (!member) fail('TEAM_MEMBER_NOT_FOUND');
    const [[current]] = await db.query(`SELECT extension,revision FROM sx_telephony_extensions
      WHERE tenant_id=? AND membership_id=? FOR UPDATE`, [context.tenant.id, member.id]);
    const revision = Number(current?.revision || 0);
    if (revision !== value.expectedRevision) fail('STALE_EXTENSION_ASSIGNMENT');
    if (current && current.extension !== value.extension) {
      const [[usage]] = await db.query(`SELECT COUNT(*) AS activeQueues FROM sx_telephony_queue_members qm
        JOIN sx_telephony_queues q ON q.tenant_id=qm.tenant_id AND q.id=qm.queue_id AND q.enabled=1
        WHERE qm.tenant_id=? AND qm.membership_id=?`, [context.tenant.id, member.id]);
      if (Number(usage.activeQueues) > 0) fail('EXTENSION_QUEUE_MUST_BE_DISABLED');
    }
    if (!current && value.extension === null) {
      await db.commit();
      return { membershipId: member.id, extension: '', revision: 0, assigned: false };
    }
    const nextRevision = revision + 1;
    if (current) {
      await db.query(`UPDATE sx_telephony_extensions SET extension=?,revision=?,assigned_by_identity_id=?,updated_at=UTC_TIMESTAMP(3)
        WHERE tenant_id=? AND membership_id=?`, [value.extension, nextRevision, context.identity.id, context.tenant.id, member.id]);
    } else {
      await db.query(`INSERT INTO sx_telephony_extensions(tenant_id,membership_id,extension,revision,assigned_by_identity_id)
        VALUES (?,?,?,?,?)`, [context.tenant.id, member.id, value.extension, nextRevision, context.identity.id]);
    }
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','telephony.extension-assigned','telephony-extension',?,?,?)`, [
      crypto.randomUUID(), context.tenant.id, context.identity.id, member.id,
      JSON.stringify({ previousExtension: current?.extension || null, extension: value.extension, revision: nextRevision }), crypto.randomUUID(),
    ]);
    await db.commit();
    return { membershipId: member.id, extension: value.extension || '', revision: nextRevision, assigned: !!value.extension };
  } catch (error) {
    await db.rollback();
    if (error.code === 'ER_DUP_ENTRY') fail('EXTENSION_ALREADY_ASSIGNED');
    throw error;
  }
}

async function own(db, context) {
  const decisionResult = decision(context, { capability: 'telephony.call-center', permission: 'calls.read' });
  if (!decisionResult.allowed) fail(decisionResult.code);
  const [[row]] = await db.query(`SELECT extension,revision,mobile_credential_revision,browser_credential_revision FROM sx_telephony_extensions
    WHERE tenant_id=? AND membership_id=?`, [context.tenant.id, context.membership.id]);
  return { membershipId: context.membership.id, extension: row?.extension || '', revision:Number(row?.revision||0),
    mobileCredentialRevision:Number(row?.mobile_credential_revision||1),browserCredentialRevision:Number(row?.browser_credential_revision||1),
    assigned: !!row?.extension };
}

module.exports = { authorize, parseAssignment, list, save, rotateEndpointCredential, own };
