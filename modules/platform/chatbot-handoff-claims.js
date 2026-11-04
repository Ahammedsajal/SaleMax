'use strict';

const crypto = require('node:crypto');
const staffRoles = ['owner', 'manager', 'team_leader', 'agent'];
const roleOrder = new Map([['manager', 0], ['team_leader', 1], ['agent', 2], ['owner', 3]]);
const fail = code => { throw Object.assign(new Error(code), { code }); };

function parseYes(value) {
  const text = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const match = text.match(/^(?:yes|y|available|i can take(?: it)?|i am available|i'm available|نعم|متاح|متاحة)(?:\s+([a-z0-9]{6}))?[.!؟]?$/iu);
  return match ? { code: String(match[1] || '').toUpperCase() || null } : null;
}

function phone(value, normalizer = require('./business-whatsapp').phone) {
  const raw = String(value || '').replace(/@(s\.whatsapp\.net|c\.us)$/i, '');
  return normalizer(raw);
}

function newCode() { return crypto.randomInt(36 ** 6).toString(36).toUpperCase().padStart(6, '0'); }

async function expireDue(pool, { tenantId = null, channelKind = null, channelRef = null, conversationId = null, limit = 100 } = {}) {
  const expiry = 'COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))';
  const clauses = ["status='open'", `${expiry}<=UTC_TIMESTAMP(3)`];
  const args = [];
  if (tenantId) { clauses.push('tenant_id=?'); args.push(tenantId); }
  if (channelKind) { clauses.push('channel_kind=?'); args.push(channelKind); }
  if (channelRef) { clauses.push('channel_ref=?'); args.push(channelRef); }
  if (conversationId) { clauses.push('conversation_id=?'); args.push(conversationId); }
  limit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
  const db = await pool.getConnection();
  const totals = { expired: 0, controlsReset: 0, guidedSessionsReset: 0, flowSessionsReset: 0, tasksCanceled: 0, deliveriesSuppressed: 0 };
  try {
    await db.beginTransaction();
    const [rows] = await db.query(`SELECT id,tenant_id AS tenantId,profile_id AS profileId,channel_kind AS channelKind,channel_ref AS channelRef,
        conversation_id AS conversationId,owner_uid_hash AS ownerUidHash,handoff_task_id AS handoffTaskId,
        notification_event_key AS notificationEventKey
      FROM sx_chatbot_handoff_claims WHERE ${clauses.join(' AND ')}
      ORDER BY expires_at,id LIMIT ? FOR UPDATE SKIP LOCKED`, [...args, limit]);
    for (const claim of rows) {
      let flowSessionResetCount = 0;
      const [expired] = await db.query(`UPDATE sx_chatbot_handoff_claims SET status='expired'
        WHERE tenant_id=? AND id=? AND status='open' AND COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))<=UTC_TIMESTAMP(3)`, [claim.tenantId, claim.id]);
      if (!expired.affectedRows) continue;
      totals.expired++;
      const [control] = await db.query(`UPDATE sx_chatbot_conversation_controls SET mode='inherit',pause_until=NULL,reason=NULL,
          revision=revision+1,updated_by_kind='system',updated_by_identity_id=NULL
        WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? AND mode='paused'
          AND updated_by_kind='system' AND (pause_until IS NULL OR pause_until<=UTC_TIMESTAMP(3))`,
      [claim.tenantId, claim.channelKind, claim.channelRef, claim.conversationId]);
      totals.controlsReset += Number(control.affectedRows || 0);
      const [guidedSession] = await db.query(`DELETE FROM sx_chatbot_guided_sessions
        WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=?`,
      [claim.tenantId, claim.profileId, claim.channelKind, claim.channelRef, claim.conversationId]);
      totals.guidedSessionsReset += Number(guidedSession.affectedRows || 0);
      const [[profile]] = await db.query(`SELECT engine,config FROM sx_chatbot_profiles WHERE tenant_id=? AND id=? LIMIT 1`,
        [claim.tenantId, claim.profileId]);
      const [[chat]] = await db.query(`SELECT uid,sender_mobile AS senderMobile,origin FROM beta_chats
        WHERE BINARY chat_id=BINARY ? AND BINARY SHA2(uid,256)=BINARY ? LIMIT 1`, [claim.conversationId, claim.ownerUidHash]);
      let profileConfig = profile?.config;
      try { if (typeof profileConfig === 'string') profileConfig = JSON.parse(profileConfig); } catch { profileConfig = null; }
      if (profile?.engine === 'guided' && profileConfig?.flowId && chat?.uid && chat?.senderMobile) {
        const flowId = require('./chatbot-profile-utils').executionFlowId({
          id: claim.profileId, channelRef: claim.channelRef,
        });
        const flowOrigin = chat.origin === 'qr' ? 'qr' : 'meta';
        const flowOriginId = flowOrigin === 'qr' ? claim.channelRef : 'META';
        const [flowSession] = await db.query(`DELETE FROM flow_session
          WHERE uid=? AND origin=? AND origin_id=? AND flow_id=? AND sender_mobile=?`,
        [chat.uid, flowOrigin, flowOriginId, flowId, chat.senderMobile]);
        flowSessionResetCount = Number(flowSession.affectedRows || 0);
        totals.flowSessionsReset += flowSessionResetCount;
      }
      if (claim.handoffTaskId) {
        const [[task]] = await db.query(`SELECT status,revision FROM sx_tasks WHERE tenant_id=? AND id=?
          AND uid_hash=? AND task_type='chatbot_handoff' AND deleted_at IS NULL FOR UPDATE`,
        [claim.tenantId, claim.handoffTaskId, claim.ownerUidHash]);
        if (task && ['open', 'in_progress', 'blocked'].includes(task.status)) {
          const revision = Number(task.revision) + 1;
          const [updated] = await db.query(`UPDATE sx_tasks SET status='canceled',completed_at=NULL,revision=?
            WHERE tenant_id=? AND id=? AND revision=? AND status IN ('open','in_progress','blocked') AND deleted_at IS NULL`,
          [revision, claim.tenantId, claim.handoffTaskId, task.revision]);
          if (updated.affectedRows) {
            await db.query(`INSERT INTO sx_task_events(tenant_id,task_id,revision,actor_type,actor_id,event_type,from_status,to_status,details_json)
              VALUES (?,?,?,'system',NULL,'status_changed',?,'canceled',?)`,
            [claim.tenantId, claim.handoffTaskId, revision, task.status, JSON.stringify({ reason: 'chatbot-handoff-expired', afterHours: 24 })]);
            totals.tasksCanceled++;
          }
        }
      }
      if (claim.notificationEventKey) {
        const [deliveries] = await db.query(`UPDATE sx_business_notification_deliveries d
          JOIN sx_business_notification_events e ON e.tenant_id=d.tenant_id AND e.id=d.event_id
          SET d.status='suppressed',d.error_code='HANDOFF_EXPIRED'
          WHERE e.tenant_id=? AND e.event_key=? AND e.kind='chatbot_handoff' AND d.status IN ('queued','blocked')`,
        [claim.tenantId, claim.notificationEventKey]);
        totals.deliveriesSuppressed += Number(deliveries.affectedRows || 0);
        await db.query(`UPDATE sx_business_notification_events SET status='failed',last_error_code='HANDOFF_EXPIRED'
          WHERE tenant_id=? AND event_key=? AND kind='chatbot_handoff' AND status IN ('queued','prepared')`,
        [claim.tenantId, claim.notificationEventKey]);
      }
      await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES (?,?,NULL,'system','chatbot.handoff-expired','chatbot-handoff',?,?,?)`,
      [crypto.randomUUID(), claim.tenantId, claim.id,
        JSON.stringify({ channelKind: claim.channelKind, result: 'expired-after-24-hours', controlReset: Number(control.affectedRows || 0) === 1,
          guidedSessionReset: Number(guidedSession.affectedRows || 0) === 1, flowSessionsReset: flowSessionResetCount }),
        crypto.randomUUID()]);
    }
    await db.commit();
    return totals;
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function open(db, { ctx, profile, uid, chatId, channelKind, channelRef, reason, brief = {} }) {
  if (!ctx?.tenant?.id || !profile?.id || !uid || !chatId || !['whatsapp_qr', 'whatsapp_meta'].includes(channelKind) || !channelRef) fail('HANDOFF_INVALID_CONTEXT');
  const ownerHash = crypto.createHash('sha256').update(uid).digest('hex');
  const [[existing]] = await db.query(`SELECT id,claim_code AS claimCode,status,revision,notification_event_key AS notificationEventKey,
      (COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))>UTC_TIMESTAMP(3)) AS isActive
    FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? FOR UPDATE`,
  [ctx.tenant.id, channelKind, channelRef, chatId]);
  if (existing?.status === 'open' && Number(existing.isActive)) return { ...existing, created: false };
  const id = existing?.id || crypto.randomUUID();
  const revision = Number(existing?.revision || 0) + 1;
  const claimCode = newCode();
  const eventKey = `chatbot-handoff:${id}:${revision}`;
  if (existing) {
    await db.query(`UPDATE sx_chatbot_handoff_claims SET profile_id=?,owner_uid_hash=?,claim_code=?,reason=?,status='open',
      expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),
      handoff_task_id=NULL,notification_event_key=?,claimed_identity_id=NULL,claimed_at=NULL,last_customer_ack_at=NULL,
      last_customer_ack_inbound_id=NULL,customer_name=?,customer_phone=?,course_details=?,latest_enquiry=?,summary_context=?,ai_summary=NULL,
      ai_summary_status='pending',ai_summary_lease_until=NULL,ai_summary_attempts=0,revision=? WHERE tenant_id=? AND id=?`,
    [profile.id, ownerHash, claimCode, String(reason || 'human-review').slice(0, 120), eventKey,
      brief.customerName || null, brief.customerPhone || null, JSON.stringify(brief.courseDetails || []), brief.latestEnquiry || null,
      brief.summaryContext ? JSON.stringify(brief.summaryContext) : null, revision, ctx.tenant.id, id]);
  } else {
    await db.query(`INSERT INTO sx_chatbot_handoff_claims(id,tenant_id,profile_id,channel_kind,channel_ref,conversation_id,owner_uid_hash,claim_code,reason,expires_at,notification_event_key,customer_name,customer_phone,course_details,latest_enquiry,summary_context,revision)
      VALUES (?,?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR),?,?,?,?,?,?,?)`,
    [id, ctx.tenant.id, profile.id, channelKind, channelRef, chatId, ownerHash, claimCode, String(reason || 'human-review').slice(0, 120), eventKey,
      brief.customerName || null, brief.customerPhone || null, JSON.stringify(brief.courseDetails || []), brief.latestEnquiry || null,
      brief.summaryContext ? JSON.stringify(brief.summaryContext) : null, revision]);
  }
  return { id, claimCode, revision, notificationEventKey: eventKey, created: true };
}

async function queue(db, tenantId, claim) {
  return require('./business-notifications').enqueue(db, tenantId, {
    kind: 'chatbot_handoff', sourceType: 'chatbot_handoff', sourceId: claim.id,
    key: claim.notificationEventKey, payload: { claimCode: claim.claimCode, revision: claim.revision },
  });
}

async function findOpen(db, { tenantId, uid, channelKind, channelRef, chatId }) {
  const [[row]] = await db.query(`SELECT id,claim_code AS claimCode,status,reason,notification_event_key AS notificationEventKey,
      last_customer_ack_at AS lastCustomerAckAt,last_customer_ack_inbound_id AS lastCustomerAckInboundId
    FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? AND owner_uid_hash=? AND status='open'
      AND COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))>UTC_TIMESTAMP(3) LIMIT 1`,
  [tenantId, channelKind, channelRef, chatId, crypto.createHash('sha256').update(uid).digest('hex')]);
  return row || null;
}

async function reserveCustomerAcknowledgement(pool, { tenantId, claimId, inboundId, cooldownSeconds = 120 }) {
  const db = await pool.getConnection();
  try {
    const [result] = await db.query(`UPDATE sx_chatbot_handoff_claims SET last_customer_ack_at=UTC_TIMESTAMP(3),last_customer_ack_inbound_id=?
      WHERE tenant_id=? AND id=? AND status='open' AND COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))>UTC_TIMESTAMP(3)
        AND (last_customer_ack_inbound_id IS NULL OR last_customer_ack_inbound_id<>?)
        AND (last_customer_ack_at IS NULL OR last_customer_ack_at<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? SECOND))`,
    [inboundId, tenantId, claimId, inboundId, cooldownSeconds]);
    return result.affectedRows === 1;
  } finally { db.release(); }
}

async function releaseCustomerAcknowledgement(pool, { tenantId, claimId, inboundId }) {
  await pool.query(`UPDATE sx_chatbot_handoff_claims SET last_customer_ack_at=NULL,last_customer_ack_inbound_id=NULL
    WHERE tenant_id=? AND id=? AND status='open' AND last_customer_ack_inbound_id=?`, [tenantId, claimId, inboundId]);
}

async function handleStaffClaim(pool, { ctx, uid, message, text, channelKind, channelRef, chatId }) {
  const parsed = parseYes(text);
  if (!parsed) return { handled: false };
  const db = await pool.getConnection();
  let outcome;
  try {
    await db.beginTransaction();
    const qr = require('./business-whatsapp');
    const assignment = require('./team-conversation-assignment');
    const allPhones = await qr.staff(db, ctx.tenant.id, { roles: staffRoles });
    const permitted = await assignment.eligibleStaff(db, ctx.tenant.id);
    const eligibleIds = new Set(permitted.map(member => member.identityId));
    const from = phone(message?.senderMobile, qr.phone);
    const matches = allPhones.filter(member => member.phone && phone(member.phone, qr.phone) === from && eligibleIds.has(member.id));
    if (!matches.length) { await db.commit(); return { handled: false }; }
    matches.sort((a, b) => (roleOrder.get(a.role) ?? 9) - (roleOrder.get(b.role) ?? 9) || a.id.localeCompare(b.id));
    const staffIdentity = matches[0];
    const ownerHash = crypto.createHash('sha256').update(uid).digest('hex');
    const [openClaims] = await db.query(`SELECT id,claim_code AS claimCode,conversation_id AS conversationId,notification_event_key AS notificationEventKey
      FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND owner_uid_hash=? AND channel_kind=? AND channel_ref=? AND status='open'
        AND COALESCE(expires_at,DATE_ADD(created_at,INTERVAL 24 HOUR))>UTC_TIMESTAMP(3)
      ORDER BY created_at,id FOR UPDATE`, [ctx.tenant.id, ownerHash, channelKind, channelRef]);
    if (!openClaims.length) { await db.commit(); return { handled: true, outcome: 'none' }; }
    let claim;
    if (parsed.code) claim = openClaims.find(item => item.claimCode === parsed.code) || null;
    else if (openClaims.length === 1) claim = openClaims[0];
    if (!claim) {
      await db.commit();
      return { handled: true, outcome: parsed.code ? 'not_found' : 'ambiguous' };
    }
    const [[customerChat]] = await db.query(`SELECT sender_mobile AS senderMobile,sender_name AS senderName,origin
      FROM beta_chats WHERE uid=? AND chat_id=? FOR UPDATE`, [uid, claim.conversationId]);
    if (!customerChat?.senderMobile) { await db.rollback(); return { handled: true, outcome: 'chat_missing' }; }
    await assignment.assignConversation(db, { ctx, uid, chatId: claim.conversationId, identityId: staffIdentity.id, reason: 'bot-handoff-claimed' });
    const [updated] = await db.query(`UPDATE sx_chatbot_handoff_claims SET status='claimed',claimed_identity_id=?,claimed_at=UTC_TIMESTAMP(3)
      WHERE tenant_id=? AND id=? AND status='open'`, [staffIdentity.id, ctx.tenant.id, claim.id]);
    if (updated.affectedRows !== 1) { await db.rollback(); return { handled: true, outcome: 'already_claimed' }; }
    await db.query(`UPDATE sx_chatbot_conversation_controls SET pause_until=NULL,revision=revision+1,
        updated_by_kind='identity',updated_by_identity_id=?
      WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? AND mode='paused' AND updated_by_kind='system'`,
    [staffIdentity.id, ctx.tenant.id, channelKind, channelRef, claim.conversationId]);
    if (claim.notificationEventKey) await db.query(`UPDATE sx_business_notification_deliveries d
      JOIN sx_business_notification_events e ON e.tenant_id=d.tenant_id AND e.id=d.event_id
      SET d.status='suppressed',d.error_code='HANDOFF_ALREADY_CLAIMED'
      WHERE e.tenant_id=? AND e.event_key=? AND d.status IN ('queued','blocked')`, [ctx.tenant.id, claim.notificationEventKey]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','chatbot.handoff-claimed','chatbot-conversation',?,?,?)`,
    [crypto.randomUUID(), ctx.tenant.id, staffIdentity.id, claim.conversationId, JSON.stringify({ claimId: claim.id, channelKind, claimedIdentityId: staffIdentity.id }), crypto.randomUUID()]);
    await db.commit();
    outcome = {
      handled: true, outcome: 'claimed', claimCode: claim.claimCode, identityId: staffIdentity.id,
      identityName: staffIdentity.name, conversationId: claim.conversationId, customerChat,
    };
    return outcome;
  } catch (error) {
    await db.rollback().catch(() => {});
    console.warn('[chatbot] staff handoff claim failed', error.code || 'HANDOFF_CLAIM_FAILED');
    return { handled: true, outcome: 'error', code: error.code || 'HANDOFF_CLAIM_FAILED' };
  } finally { db.release(); }
}

module.exports = { parseYes, phone, open, queue, findOpen, reserveCustomerAcknowledgement, releaseCustomerAcknowledgement, handleStaffClaim, expireDue, staffRoles };
