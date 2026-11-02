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

async function open(db, { ctx, profile, uid, chatId, channelKind, channelRef, reason, brief = {} }) {
  if (!ctx?.tenant?.id || !profile?.id || !uid || !chatId || !['whatsapp_qr', 'whatsapp_meta'].includes(channelKind) || !channelRef) fail('HANDOFF_INVALID_CONTEXT');
  const ownerHash = crypto.createHash('sha256').update(uid).digest('hex');
  const [[existing]] = await db.query(`SELECT id,claim_code AS claimCode,status,revision,notification_event_key AS notificationEventKey
    FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? FOR UPDATE`,
  [ctx.tenant.id, channelKind, channelRef, chatId]);
  if (existing?.status === 'open') return { ...existing, created: false };
  const id = existing?.id || crypto.randomUUID();
  const revision = Number(existing?.revision || 0) + 1;
  const claimCode = newCode();
  const eventKey = `chatbot-handoff:${id}:${revision}`;
  if (existing) {
    await db.query(`UPDATE sx_chatbot_handoff_claims SET profile_id=?,owner_uid_hash=?,claim_code=?,reason=?,status='open',
      handoff_task_id=NULL,notification_event_key=?,claimed_identity_id=NULL,claimed_at=NULL,last_customer_ack_at=NULL,
      last_customer_ack_inbound_id=NULL,customer_name=?,customer_phone=?,course_details=?,latest_enquiry=?,summary_context=?,ai_summary=NULL,
      ai_summary_status='pending',ai_summary_lease_until=NULL,ai_summary_attempts=0,revision=? WHERE tenant_id=? AND id=?`,
    [profile.id, ownerHash, claimCode, String(reason || 'human-review').slice(0, 120), eventKey,
      brief.customerName || null, brief.customerPhone || null, JSON.stringify(brief.courseDetails || []), brief.latestEnquiry || null,
      brief.summaryContext ? JSON.stringify(brief.summaryContext) : null, revision, ctx.tenant.id, id]);
  } else {
    await db.query(`INSERT INTO sx_chatbot_handoff_claims(id,tenant_id,profile_id,channel_kind,channel_ref,conversation_id,owner_uid_hash,claim_code,reason,notification_event_key,customer_name,customer_phone,course_details,latest_enquiry,summary_context,revision)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
    FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? AND owner_uid_hash=? AND status='open' LIMIT 1`,
  [tenantId, channelKind, channelRef, chatId, crypto.createHash('sha256').update(uid).digest('hex')]);
  return row || null;
}

async function reserveCustomerAcknowledgement(pool, { tenantId, claimId, inboundId, cooldownSeconds = 120 }) {
  const db = await pool.getConnection();
  try {
    const [result] = await db.query(`UPDATE sx_chatbot_handoff_claims SET last_customer_ack_at=UTC_TIMESTAMP(3),last_customer_ack_inbound_id=?
      WHERE tenant_id=? AND id=? AND status='open' AND (last_customer_ack_inbound_id IS NULL OR last_customer_ack_inbound_id<>?)
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

module.exports = { parseYes, phone, open, queue, findOpen, reserveCustomerAcknowledgement, releaseCustomerAcknowledgement, handleStaffClaim, staffRoles };
